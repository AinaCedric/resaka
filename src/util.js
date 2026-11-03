export function fmtTime(sec, forceHours = false) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h || forceHours ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function parseTime(str) {
  if (typeof str === 'number') return str;
  const parts = String(str || '').trim().replace(/[^\d:.,]/g, '').replace(',', '.').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COLORS = ['#0e9f6e', '#e8590c', '#3b5bdb', '#c2255c', '#7048e8', '#0c8599', '#d9480f', '#5c940d', '#ae3ec9', '#1971c2'];
export function speakerColor(name, list) {
  const i = Math.max(0, list.indexOf(name));
  return COLORS[i % COLORS.length];
}
