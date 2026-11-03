// Client pour un serveur Whisper compatible OpenAI (/v1/audio/transcriptions)
export async function whisperTranscribe({ url, key, blob, filename }) {
  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('model', 'whisper-1');
  fd.append('response_format', 'verbose_json');
  const base = url.replace(/\/+$/, '');
  const endpoint = /\/v1\/audio\/transcriptions$/.test(base) ? base : `${base}/v1/audio/transcriptions`;
  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', body: fd, headers: key ? { Authorization: `Bearer ${key}` } : {} });
  } catch (e) {
    throw new Error(`Serveur Whisper injoignable (${endpoint}). Vérifie l’adresse et que le téléphone est sur le même réseau.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.detail || `Erreur serveur Whisper ${res.status}`);
  const segs = data.segments?.length
    ? data.segments.map((s) => ({ t: s.start, speaker: s.speaker || '', text: (s.text || '').trim() }))
    : [{ t: 0, speaker: '', text: (data.text || '').trim() }];
  return segs.filter((s) => s.text);
}

export async function whisperPing(url) {
  const base = url.replace(/\/+$/, '').replace(/\/v1\/audio\/transcriptions$/, '');
  const res = await fetch(`${base}/health`).catch(() => null);
  if (!res || !res.ok) throw new Error('Serveur injoignable');
  return res.json().catch(() => ({}));
}
