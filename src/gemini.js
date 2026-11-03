// Client Gemini (REST) : transcription audio + compte rendu
import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './audio-utils.js';

const BASE = 'https://generativelanguage.googleapis.com';
const INLINE_MAX = 14 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function errMessage(status, body) {
  const msg = body?.error?.message || (typeof body === 'string' ? body.slice(0, 300) : '') || `HTTP ${status}`;
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return 'Clé API Gemini invalide.';
  if (status === 403) return `Accès refusé (403) : ${msg}`;
  if (status === 429) return 'Quota Gemini dépassé (429). Réessaie dans une minute ou vérifie ton quota.';
  return msg;
}

// JSON via fetch, repli sur le HTTP natif si le WebView bloque (CORS/réseau)
async function jsonRequest(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  let status, data;
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    status = res.status;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (e) {
    if (!Capacitor.isNativePlatform()) throw new Error('Réseau indisponible : ' + e.message);
    const r = await CapacitorHttp.request({ method, url, headers, data: body, responseType: 'json', connectTimeout: 30000, readTimeout: 600000 });
    status = r.status;
    data = r.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
  }
  if (status < 200 || status >= 300) throw new ApiError(status, errMessage(status, data), data);
  return data;
}

async function withRetry(fn, onWait) {
  const delays = [4000, 12000, 30000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retriable = e instanceof ApiError ? [429, 500, 502, 503, 504].includes(e.status) : /Réseau|network|Failed to fetch/i.test(e.message);
      if (!retriable || i >= delays.length) throw e;
      let d = delays[i];
      const rd = e.body?.error?.details?.find?.((x) => x.retryDelay)?.retryDelay;
      if (rd) d = Math.max(d, parseFloat(rd) * 1000 + 1000);
      onWait?.(Math.round(d / 1000));
      await sleep(d);
    }
  }
}

export async function listModels(key) {
  const data = await jsonRequest('GET', `${BASE}/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
    .filter((m) => /gemini/i.test(m.id) && !/(tts|image|embedding|live|audio-dialog|native-audio|robotics|computer-use)/i.test(m.id));
}

// Choisit le meilleur modèle "flash" récent par défaut
export function pickDefaultModel(models) {
  const score = (id) => {
    const v = parseFloat((/gemini-(\d+(\.\d+)?)/.exec(id) || [])[1] || '0');
    let s = v * 100;
    if (/flash/.test(id)) s += 50;
    if (/lite/.test(id)) s -= 40;
    if (/pro/.test(id)) s += 10;
    if (/(preview|exp|latest)/.test(id)) s -= 5;
    if (/-\d{3,}$/.test(id)) s -= 2;
    return s;
  };
  const flash = models.filter((m) => /flash/.test(m.id) && !/lite/.test(m.id));
  const pool = flash.length ? flash : models;
  return [...pool].sort((a, b) => score(b.id) - score(a.id))[0]?.id || '';
}

// Upload via Files API (multipart, puis repli "resumable")
async function uploadFile(key, blob, mime, name) {
  const boundary = 'resaka' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ file: { display_name: name } });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--\r\n`,
  ]);
  let file;
  try {
    const res = await fetch(`${BASE}/upload/v1beta/files?uploadType=multipart&key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, errMessage(res.status, data), data);
    file = data.file;
  } catch (e) {
    // repli : protocole resumable
    const start = await fetch(`${BASE}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json',
      },
      body: meta,
    });
    const upUrl = start.headers.get('x-goog-upload-url');
    if (!upUrl) throw e;
    const res = await fetch(upUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, errMessage(res.status, data), data);
    file = data.file;
  }
  // attendre que le fichier soit prêt
  for (let i = 0; i < 120 && file.state === 'PROCESSING'; i++) {
    await sleep(2500);
    file = await jsonRequest('GET', `${BASE}/v1beta/${file.name}?key=${encodeURIComponent(key)}`);
  }
  if (file.state === 'FAILED') throw new Error('Gemini n’a pas pu traiter le fichier audio.');
  return { uri: file.uri, mime: file.mimeType || mime };
}

export async function audioPart(key, blob, mime, name) {
  if (blob.size <= INLINE_MAX) {
    return { inline_data: { mime_type: mime, data: await blobToBase64(blob) } };
  }
  const f = await uploadFile(key, blob, mime, name);
  return { file_data: { mime_type: f.mime, file_uri: f.uri } };
}

export { uploadFile };

function extractText(data) {
  const cand = data.candidates?.[0];
  if (!cand) {
    const block = data.promptFeedback?.blockReason;
    throw new Error(block ? `Requête bloquée par Gemini (${block}).` : 'Réponse vide de Gemini.');
  }
  const text = (cand.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  return { text, finish: cand.finishReason };
}

// Répare un JSON tronqué (MAX_TOKENS) en coupant au dernier objet complet
function parseJsonLoose(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const first = t.indexOf('{');
  if (first > 0) t = t.slice(first);
  for (let i = t.lastIndexOf('}'); i > 0; i = t.lastIndexOf('}', i - 1)) {
    const cand = t.slice(0, i + 1);
    for (const suffix of ['', ']}', ']}]}', '}']) {
      try { return JSON.parse(cand + suffix); } catch {}
    }
  }
  throw new Error('Réponse de Gemini illisible (JSON invalide).');
}

/**
 * Appel generateContent avec sortie JSON. Dégrade la config si le modèle la refuse.
 */
export async function generateJson({ key, model, parts, schema, onWait, temperature = 0.2 }) {
  const url = `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const configs = [
    { temperature, responseMimeType: 'application/json', responseSchema: schema },
    { temperature, responseMimeType: 'application/json' },
    null,
  ];
  let lastErr;
  for (const gc of configs) {
    const body = { contents: [{ role: 'user', parts }] };
    if (gc) body.generationConfig = gc;
    try {
      const data = await withRetry(() => jsonRequest('POST', url, body), onWait);
      const { text, finish } = extractText(data);
      if (!text) throw new Error(`Réponse vide (${finish || 'inconnu'}).`);
      return parseJsonLoose(text);
    } catch (e) {
      lastErr = e;
      const configProblem = e instanceof ApiError && e.status === 400 && /(schema|generation_?config|response_?mime|Unknown name|Invalid JSON payload)/i.test(e.message);
      if (!configProblem) throw e;
    }
  }
  throw lastErr;
}
