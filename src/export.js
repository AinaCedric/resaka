// Exports TXT / SRT / compte rendu + partage Android
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { fmtTime, fmtDate } from './util.js';
import { transcriptText } from './transcribe.js';

function srtTime(sec) {
  const ms = Math.round((sec % 1) * 1000);
  return `${fmtTime(sec, true)},${String(ms).padStart(3, '0')}`;
}

export function toSrt(m) {
  const segs = m.segments || [];
  return segs
    .map((s, i) => {
      const next = segs[i + 1]?.start;
      let end = next != null ? Math.min(next, s.start + 12) : s.start + Math.min(12, Math.max(3, s.text.length / 14));
      if (end <= s.start) end = s.start + 2;
      return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end)}\n${s.speaker ? `${s.speaker}: ` : ''}${s.text}\n`;
    })
    .join('\n');
}

export function toTxt(m) {
  return `${m.title}\n${fmtDate(m.createdAt)}\n\n${transcriptText(m)}\n`;
}

export function toReport(m) {
  const s = m.summary;
  const lines = [`# ${m.title}`, '', `*${fmtDate(m.createdAt)}*`, ''];
  if (s) {
    lines.push('## Résumé', '', s.resume || '', '');
    if (s.points_cles?.length) lines.push('## Points clés', '', ...s.points_cles.map((x) => `- ${x}`), '');
    if (s.decisions?.length) lines.push('## Décisions', '', ...s.decisions.map((x) => `- ${x}`), '');
    if (s.actions?.length) {
      lines.push('## Actions', '');
      s.actions.forEach((a) => lines.push(`- [ ] ${a.tache}${a.responsable ? ` — **${a.responsable}**` : ''}${a.echeance ? ` (${a.echeance})` : ''}`));
      lines.push('');
    }
    if (s.questions_ouvertes?.length) lines.push('## Questions ouvertes', '', ...s.questions_ouvertes.map((x) => `- ${x}`), '');
  }
  lines.push('## Transcription', '', ...(m.segments || []).map((x) => `**[${fmtTime(x.start)}] ${x.speaker} :** ${x.text}  `));
  return lines.join('\n');
}

function safeName(t) {
  return (t || 'reunion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'reunion';
}

export async function shareText(m, kind) {
  const content = kind === 'srt' ? toSrt(m) : kind === 'md' ? toReport(m) : toTxt(m);
  const ext = kind === 'srt' ? 'srt' : kind === 'md' ? 'md' : 'txt';
  const filename = `${safeName(m.title)}.${ext}`;
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: m.title, url: r.uri, dialogTitle: 'Partager' });
  } else {
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
  }
}

export async function shareAudio(m, blobs) {
  const filename = `${safeName(m.title)}.mp3`;
  const blob = new Blob(blobs, { type: 'audio/mpeg' });
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    const w = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: m.title, url: w.uri, dialogTitle: 'Partager l’audio' });
  } else downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
