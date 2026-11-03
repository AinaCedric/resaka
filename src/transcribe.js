// Orchestration : transcription des morceaux audio + compte rendu
import { db } from './db.js';
import { getSettings } from './settings.js';
import { generateJson, audioPart, uploadFile } from './gemini.js';
import { whisperTranscribe } from './whisper.js';
import { fmtTime, parseTime } from './util.js';

const WINDOW = 600; // fenêtre (s) pour les longs fichiers importés

const SEG_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          t: { type: 'STRING', description: 'Horodatage de début MM:SS ou HH:MM:SS' },
          speaker: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['t', 'speaker', 'text'],
      },
    },
  },
  required: ['segments'],
};

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    titre: { type: 'STRING' },
    resume: { type: 'STRING' },
    points_cles: { type: 'ARRAY', items: { type: 'STRING' } },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tache: { type: 'STRING' }, responsable: { type: 'STRING' }, echeance: { type: 'STRING' } },
        required: ['tache'],
      },
    },
    questions_ouvertes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['titre', 'resume', 'points_cles', 'decisions', 'actions'],
};

function transcriptionPrompt({ vocabulary, context, speakers, window }) {
  return `Tu es un transcripteur professionnel de réunions à Madagascar.
Les participants parlent malgache (officiel ou dialectes) en mélangeant très souvent le français dans la même phrase (code-switching), parfois l'anglais.

RÈGLES :
1. Transcris mot à mot ce qui est réellement dit. NE TRADUIS RIEN.
2. Les mots malgaches s'écrivent en orthographe malgache standard (ex. « manao ahoana », « tsy maintsy », « ny fivoriana »).
3. Les mots et expressions français s'écrivent en orthographe française correcte (ex. « le budget », « valider », « la réunion »).
4. Garde le mélange des langues exactement comme prononcé.
5. Identifie les intervenants à la voix : « Intervenant 1 », « Intervenant 2 »… Si un prénom est clairement associé à une voix, utilise-le.
6. Découpe en segments courts (une prise de parole ou une phrase, 25 secondes max), chacun avec l'horodatage de début au format MM:SS (ou HH:MM:SS).
7. Ajoute la ponctuation. Marque [inaudible] les passages incompréhensibles. Ignore les silences et bruits. N'invente rien.
8. S'il n'y a aucune parole, renvoie "segments": [].
${window ? `\nIMPORTANT : transcris UNIQUEMENT la portion de l'audio entre ${fmtTime(window[0])} et ${fmtTime(window[1])}. Les horodatages sont comptés depuis le DÉBUT du fichier.` : '\nLes horodatages sont relatifs au début de cet extrait audio.'}
${vocabulary ? `\nVocabulaire et noms propres susceptibles d'apparaître : ${vocabulary}` : ''}
${speakers.length ? `\nIntervenants déjà identifiés dans les extraits précédents (réutilise ces noms si les voix correspondent) : ${speakers.join(', ')}` : ''}
${context ? `\nFin de l'extrait précédent (pour le contexte, ne pas retranscrire) :\n${context}` : ''}

Réponds uniquement en JSON : {"segments":[{"t":"MM:SS","speaker":"...","text":"..."}]}`;
}

function contextOf(m, before) {
  const prev = (m.segments || []).filter((s) => s.start < before).slice(-8);
  return prev.map((s) => `${s.speaker}: ${s.text}`).join('\n');
}

function speakersOf(m) {
  return [...new Set((m.segments || []).map((s) => s.speaker).filter(Boolean))];
}

function mergeSegments(m, newSegs) {
  const all = [...(m.segments || []), ...newSegs].sort((a, b) => a.start - b.start);
  m.segments = all.map((s, i) => ({ ...s, id: s.id || `${Math.round(s.start * 1000)}-${i}-${Math.random().toString(36).slice(2, 6)}` }));
}

function toAbsolute(raw, offset, window, chunkDur) {
  return raw
    .map((s) => {
      let t = typeof s.t === 'number' ? s.t : parseTime(s.t);
      if (!Number.isFinite(t)) t = 0;
      if (window) {
        if (t < window[0] - 5) t += window[0]; // le modèle a donné un temps relatif
      } else {
        t += offset;
      }
      return { start: t, speaker: (s.speaker || '').trim() || 'Intervenant', text: (s.text || '').trim() };
    })
    .filter((s) => s.text && (!chunkDur || s.start <= offset + chunkDur + 30));
}

async function transcribeChunk(m, chunk, onStatus) {
  const s = getSettings();
  const blob = await db.getAudio(m.id, chunk.idx);
  if (!blob) throw new Error('Audio introuvable pour ce segment.');
  const name = `${m.title || 'reunion'}-${chunk.idx}`;

  if (s.provider === 'whisper') {
    const segs = await whisperTranscribe({ url: s.whisperUrl, key: s.whisperKey, blob, filename: `${name}.mp3` });
    return toAbsolute(segs.map((x) => ({ ...x, speaker: x.speaker || 'Intervenant' })), chunk.start, null, chunk.duration);
  }

  if (!s.geminiKey) throw new Error('Ajoute ta clé API Gemini dans les Réglages.');
  if (!s.geminiModel) throw new Error('Choisis un modèle Gemini dans les Réglages (bouton « Tester la clé »).');
  const onWait = (sec) => onStatus?.(`Gemini occupé, nouvel essai dans ${sec} s…`);
  const long = chunk.duration && chunk.duration > WINDOW * 1.5;

  if (!long) {
    const part = await audioPart(s.geminiKey, blob, chunk.mime, name);
    const prompt = transcriptionPrompt({ vocabulary: s.vocabulary, context: contextOf(m, chunk.start), speakers: speakersOf(m) });
    const out = await generateJson({ key: s.geminiKey, model: s.geminiModel, parts: [part, { text: prompt }], schema: SEG_SCHEMA, onWait });
    return toAbsolute(out.segments || [], chunk.start, null, chunk.duration);
  }

  // Long fichier : upload unique puis transcription par fenêtres
  onStatus?.('Envoi du fichier à Gemini…');
  const f = await uploadFile(s.geminiKey, blob, chunk.mime, name);
  const part = { file_data: { mime_type: f.mime, file_uri: f.uri } };
  const done = chunk.windowsDone || 0;
  const nWin = Math.ceil(chunk.duration / WINDOW);
  const result = [];
  for (let w = done; w < nWin; w++) {
    const win = [w * WINDOW, Math.min(chunk.duration, (w + 1) * WINDOW)];
    onStatus?.(`Transcription ${fmtTime(win[0])} → ${fmtTime(win[1])}…`);
    const prompt = transcriptionPrompt({ vocabulary: s.vocabulary, context: contextOf(m, win[0]), speakers: speakersOf(m), window: win });
    const out = await generateJson({ key: s.geminiKey, model: s.geminiModel, parts: [part, { text: prompt }], schema: SEG_SCHEMA, onWait });
    const segs = toAbsolute(out.segments || [], 0, win, null).filter((x) => x.start >= win[0] - 3 && x.start < win[1] + 3);
    m = await db.update(m.id, (mm) => {
      mergeSegments(mm, segs);
      const c = mm.chunks.find((x) => x.idx === chunk.idx);
      if (c) c.windowsDone = w + 1;
    });
    result.push(...segs);
  }
  return { alreadyMerged: true, segs: result };
}

// File d'attente : une seule transcription à la fois par réunion
const locks = new Map();
const listeners = new Set();
export const status = new Map(); // meetingId -> texte d'état

export function onTranscriptionUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id, text) {
  if (text == null) status.delete(id); else status.set(id, text);
  listeners.forEach((fn) => fn(id, text));
}

export function transcribeMeeting(id, { withSummary = true } = {}) {
  const prev = locks.get(id) || Promise.resolve();
  const p = prev.catch(() => {}).then(() => runTranscription(id, withSummary));
  locks.set(id, p);
  return p;
}

async function runTranscription(id, withSummary) {
  let m = await db.update(id, (mm) => { mm.error = null; });
  if (!m) return;
  try {
    // boucle tant qu'il reste des segments (de nouveaux peuvent arriver pendant l'enregistrement)
    for (;;) {
      m = await db.getMeeting(id);
      const c = (m.chunks || []).find((x) => x.final && !x.transcribed);
      if (!c) break;
      const total = m.chunks.length;
      emit(id, total > 1 ? `Transcription du segment ${c.idx + 1}/${total}…` : 'Transcription en cours…');
      const res = await transcribeChunk(m, c, (t) => emit(id, t));
      m = await db.update(id, (mm) => {
        if (!res?.alreadyMerged) mergeSegments(mm, res);
        const cc = mm.chunks.find((x) => x.idx === c.idx);
        if (cc) cc.transcribed = true;
      });
    }
    m = await db.update(id, (mm) => {
      const allDone = mm.chunks.length && mm.chunks.every((c) => c.final && c.transcribed);
      if (!allDone || mm.status === 'recording') return false;
      mm.status = 'done';
    });
    const s = getSettings();
    if (m.status === 'done' && withSummary && s.autoSummary && m.segments?.length && !m.summary && s.geminiKey && s.geminiModel) {
      await summarize(id).catch(async (e) => {
        await db.update(id, (mm) => { mm.error = `Compte rendu : ${e.message}`; });
      });
    }
    emit(id, null);
  } catch (e) {
    await db.update(id, (mm) => { mm.error = e.message; });
    emit(id, null);
    throw e;
  }
}

export function transcriptText(m, { withSpeakers = true } = {}) {
  return (m.segments || [])
    .map((s) => `[${fmtTime(s.start)}] ${withSpeakers ? `${s.speaker} : ` : ''}${s.text}`)
    .join('\n');
}

export async function summarize(id) {
  const s = getSettings();
  if (!s.geminiKey || !s.geminiModel) throw new Error('Le compte rendu nécessite une clé Gemini (Réglages).');
  const m = await db.getMeeting(id);
  if (!m.segments?.length) throw new Error('Aucune transcription à résumer.');
  emit(id, 'Rédaction du compte rendu…');
  const lang = s.summaryLang === 'mg' ? 'en malgache (teny malagasy)' : 'en français';
  const prompt = `Voici la transcription d'une réunion à Madagascar (mélange malgache/français).
Rédige un compte rendu professionnel ${lang}, fidèle et sans rien inventer :
- titre : titre court de la réunion
- resume : synthèse de 5 à 10 phrases
- points_cles : principaux sujets abordés
- decisions : décisions prises (liste vide si aucune)
- actions : tâches à faire avec responsable et échéance si mentionnés (sinon chaînes vides)
- questions_ouvertes : points non résolus
${s.vocabulary ? `Vocabulaire / noms propres : ${s.vocabulary}\n` : ''}
TRANSCRIPTION :
${transcriptText(m)}`;
  try {
    const out = await generateJson({
      key: s.geminiKey, model: s.geminiModel, parts: [{ text: prompt }], schema: SUMMARY_SCHEMA, temperature: 0.3,
      onWait: (sec) => emit(id, `Gemini occupé, nouvel essai dans ${sec} s…`),
    });
    await db.update(id, (fresh) => {
      fresh.summary = { ...out, lang: s.summaryLang, at: Date.now() };
      if (fresh.autoTitle && out.titre) { fresh.title = out.titre; fresh.autoTitle = false; }
    });
  } finally {
    emit(id, null);
  }
}
