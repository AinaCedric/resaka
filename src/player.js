// Lecteur audio multi-segments (temps global de la réunion)
import { db } from './db.js';

export class MeetingPlayer {
  constructor(meeting, onTime) {
    this.m = meeting;
    this.onTime = onTime;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.urls = new Map();
    this.cur = -1;
    this.chunks = (meeting.chunks || []).filter((c) => c.final).sort((a, b) => a.start - b.start);
    this.audio.addEventListener('timeupdate', () => this.onTime?.(this.time, !this.audio.paused));
    this.audio.addEventListener('play', () => this.onTime?.(this.time, true));
    this.audio.addEventListener('pause', () => this.onTime?.(this.time, false));
    this.audio.addEventListener('ended', () => this._next());
  }

  get duration() {
    const last = this.chunks[this.chunks.length - 1];
    return last ? last.start + (last.duration || 0) : 0;
  }

  get time() {
    const c = this.chunks[this.cur];
    return c ? c.start + (this.audio.currentTime || 0) : 0;
  }

  get playing() {
    return !this.audio.paused;
  }

  async _load(i) {
    if (i === this.cur) return;
    const c = this.chunks[i];
    if (!c) return;
    let url = this.urls.get(c.idx);
    if (!url) {
      const blob = await db.getAudio(this.m.id, c.idx);
      if (!blob) throw new Error('Audio introuvable');
      url = URL.createObjectURL(blob);
      this.urls.set(c.idx, url);
    }
    this.cur = i;
    this.audio.src = url;
    await new Promise((r) => {
      if (this.audio.readyState >= 1) return r();
      this.audio.addEventListener('loadedmetadata', r, { once: true });
      setTimeout(r, 3000);
    });
  }

  async seek(t, play = true) {
    let i = this.chunks.findIndex((c) => t >= c.start && t < c.start + (c.duration || Infinity));
    if (i < 0) i = t <= 0 ? 0 : this.chunks.length - 1;
    await this._load(i);
    const c = this.chunks[i];
    this.audio.currentTime = Math.max(0, t - c.start);
    if (play) await this.audio.play().catch(() => {});
    this.onTime?.(this.time, !this.audio.paused);
  }

  async toggle() {
    if (this.cur < 0) return this.seek(0);
    if (this.audio.paused) await this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  skip(d) {
    return this.seek(Math.max(0, Math.min(this.duration - 0.5, this.time + d)), this.playing);
  }

  async _next() {
    if (this.cur + 1 < this.chunks.length) {
      await this._load(this.cur + 1);
      this.audio.currentTime = 0;
      await this.audio.play().catch(() => {});
    } else this.onTime?.(this.time, false);
  }

  destroy() {
    this.audio.pause();
    this.audio.src = '';
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
  }
}
