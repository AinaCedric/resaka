// Préparation des fichiers audio importés
import { Mp3Encoder } from '@breezystack/lamejs';

// Formats acceptés directement par Gemini
const DIRECT = {
  mp3: 'audio/mp3', mpeg: 'audio/mp3', mpga: 'audio/mp3',
  wav: 'audio/wav', wave: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff',
};

export function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function directMime(file) {
  const ext = extOf(file.name);
  if (DIRECT[ext]) return DIRECT[ext];
  const t = (file.type || '').toLowerCase();
  if (t.includes('mpeg') || t.includes('mp3')) return 'audio/mp3';
  if (t.includes('wav')) return 'audio/wav';
  if (t.includes('ogg') || t.includes('opus')) return 'audio/ogg';
  if (t.includes('flac')) return 'audio/flac';
  if (t === 'audio/aac') return 'audio/aac';
  return null;
}

export function fallbackMime(file) {
  const ext = extOf(file.name);
  if (['mp4', 'm4v', 'mov'].includes(ext)) return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (['m4a', 'm4b'].includes(ext)) return 'audio/aac';
  if (ext === '3gp') return 'video/3gpp';
  return file.type || 'application/octet-stream';
}

export function getDuration(blob) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (d) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        // astuce webm : forcer le calcul de la durée
        a.currentTime = 1e7;
        a.ontimeupdate = () => { a.ontimeupdate = null; finish(a.duration); };
      } else finish(a.duration);
    };
    a.onerror = () => finish(null);
    setTimeout(() => finish(null), 15000);
    a.src = url;
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Décode un fichier (m4a, webm, mp4…) et le ré-encode en MP3 16 kHz mono, découpé en segments.
 * Retourne [{blob, start, duration}]
 */
export async function convertToMp3Segments(file, segmentSeconds, onProgress) {
  const buf = await file.arrayBuffer();
  let ctx;
  try { ctx = new OfflineAudioContext(1, 16000, 16000); } catch { ctx = new AudioContext({ sampleRate: 16000 }); }
  const audio = await ctx.decodeAudioData(buf);
  const sr = audio.sampleRate;
  const len = audio.length;
  const chs = audio.numberOfChannels;
  const data = [];
  for (let c = 0; c < chs; c++) data.push(audio.getChannelData(c));
  const segLen = Math.round(segmentSeconds * sr);
  const kbps = sr <= 24000 ? 32 : 64;
  const out = [];
  const block = 4608;
  for (let s = 0; s < len; s += segLen) {
    const end = Math.min(len, s + segLen);
    const enc = new Mp3Encoder(1, sr, kbps);
    const parts = [];
    for (let i = s; i < end; i += block) {
      const n = Math.min(block, end - i);
      const pcm = new Int16Array(n);
      for (let k = 0; k < n; k++) {
        let v = 0;
        for (let c = 0; c < chs; c++) v += data[c][i + k];
        v = Math.max(-1, Math.min(1, v / chs));
        pcm[k] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      const mp3 = enc.encodeBuffer(pcm);
      if (mp3.length) parts.push(new Uint8Array(mp3));
      if ((i / block) % 200 === 0) {
        onProgress?.(i / len);
        await tick();
      }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    out.push({ blob: new Blob(parts, { type: 'audio/mpeg' }), start: s / sr, duration: (end - s) / sr });
  }
  onProgress?.(1);
  return out;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
