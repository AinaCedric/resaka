// Capture PCM mono et envoie des blocs de ~4096 échantillons au thread principal
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const chs = input.length;
      const n = input[0].length;
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let c = 0; c < chs; c++) v += input[c][i];
        this.buf[this.len++] = v / chs;
        if (this.len === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.len = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
