// Enregistreur : micro -> PCM (AudioWorklet) -> MP3 (lamejs), découpé en segments
import { Mp3Encoder } from '@breezystack/lamejs';

function floatTo16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export class SegmentedRecorder {
  /**
   * @param {object} o
   * @param {number} o.segmentSeconds durée d'un segment
   * @param {(seg:{idx:number,start:number,duration:number,blob:Blob,final:boolean})=>Promise<void>} o.onSegment
   *        appelé à la fin de chaque segment (final=true) et périodiquement pour sauvegarde partielle (final=false)
   * @param {(level:number)=>void} o.onLevel niveau sonore 0..1
   */
  constructor(o) {
    this.o = o;
    this.paused = false;
    this.running = false;
    this.totalSamples = 0;
    this.segIdx = 0;
    this.segSamples = 0;
    this.segStartSamples = 0;
    this.parts = [];
    this.lastPartialSave = 0;
  }

  get seconds() {
    return this.ctx ? this.totalSamples / this.sampleRate : 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    const allowed = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
    if (!allowed.includes(this.sampleRate)) throw new Error(`Fréquence non supportée: ${this.sampleRate}`);
    this.kbps = this.sampleRate <= 24000 ? 32 : 64;
    this.encoder = new Mp3Encoder(1, this.sampleRate, this.kbps);
    this.segLimit = Math.round(this.o.segmentSeconds * this.sampleRate);

    await ctx.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-capture');
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);
    this.node.port.onmessage = (e) => this._onPcm(e.data);
    if (ctx.state === 'suspended') await ctx.resume();
    this.running = true;
  }

  _onPcm(f32) {
    if (!this.running || this.paused) return;
    // niveau
    let sum = 0;
    for (let i = 0; i < f32.length; i += 4) sum += f32[i] * f32[i];
    const rms = Math.sqrt(sum / (f32.length / 4));
    this.o.onLevel?.(Math.min(1, rms * 6));

    let offset = 0;
    while (offset < f32.length) {
      const room = this.segLimit - this.segSamples;
      const take = Math.min(room, f32.length - offset);
      const slice = f32.subarray(offset, offset + take);
      const mp3 = this.encoder.encodeBuffer(floatTo16(slice));
      if (mp3.length) this.parts.push(new Uint8Array(mp3));
      this.segSamples += take;
      this.totalSamples += take;
      offset += take;
      if (this.segSamples >= this.segLimit) this._closeSegment(false);
    }
    const now = Date.now();
    if (now - this.lastPartialSave > 20000) {
      this.lastPartialSave = now;
      this._emit(false);
    }
  }

  _emit(final) {
    const blob = new Blob(this.parts, { type: 'audio/mpeg' });
    const seg = {
      idx: this.segIdx,
      start: this.segStartSamples / this.sampleRate,
      duration: this.segSamples / this.sampleRate,
      blob,
      final,
    };
    // chaîne les sauvegardes pour garder l'ordre
    this._chain = (this._chain || Promise.resolve()).then(() => this.o.onSegment(seg)).catch((e) => console.error(e));
    return this._chain;
  }

  _closeSegment(isLast) {
    const tail = this.encoder.flush();
    if (tail.length) this.parts.push(new Uint8Array(tail));
    const p = this.segSamples > this.sampleRate * 0.5 || this.segIdx === 0 ? this._emit(true) : Promise.resolve();
    this.segIdx++;
    this.segStartSamples = this.totalSamples;
    this.segSamples = 0;
    this.parts = [];
    if (!isLast) this.encoder = new Mp3Encoder(1, this.sampleRate, this.kbps);
    return p;
  }

  pause() {
    this.paused = true;
    this.o.onLevel?.(0);
  }

  resume() {
    this.paused = false;
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    await this._closeSegment(true);
    await this._chain;
    try { this.node.port.onmessage = null; this.src.disconnect(); this.node.disconnect(); } catch {}
    this.stream.getTracks().forEach((t) => t.stop());
    await this.ctx.close().catch(() => {});
  }
}
