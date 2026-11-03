import './style.css';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { db, newId } from './db.js';
import { getSettings, saveSettings, isConfigured } from './settings.js';
import { SegmentedRecorder } from './recorder.js';
import { transcribeMeeting, summarize, onTranscriptionUpdate, status, transcriptText } from './transcribe.js';
import { listModels, pickDefaultModel } from './gemini.js';
import { whisperPing } from './whisper.js';
import { directMime, fallbackMime, getDuration, convertToMp3Segments } from './audio-utils.js';
import { MeetingPlayer } from './player.js';
import { shareText, shareAudio, copyText, toReport } from './export.js';
import { fmtTime, fmtDuration, fmtDate, esc, speakerColor } from './util.js';
import { icons, toast, modal, promptText, confirmDlg, actionSheet } from './ui.js';

const app = document.getElementById('app');
let cleanup = null;
let rec = null; // enregistrement en cours : { recorder, meetingId, startedAt }

const go = (h) => { location.hash = h; };

function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  const h = location.hash || '#/';
  let m;
  if (h === '#/rec') renderRecord();
  else if (h === '#/settings') renderSettings();
  else if ((m = /^#\/m\/([^/]+)(?:\/(\w+))?$/.exec(h))) renderMeeting(m[1], m[2] || 'transcript');
  else renderHome();
}
window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------- Accueil */

function statusPill(m) {
  if (m.status === 'recording') return '<span class="pill rec">● Enregistrement</span>';
  if (status.get(m.id)) return '<span class="pill busy">Transcription…</span>';
  if (m.error) return '<span class="pill err">Erreur</span>';
  if (m.status === 'done') return '<span class="pill ok">Transcrit</span>';
  return '<span class="pill">À transcrire</span>';
}

async function renderHome() {
  const meetings = await db.listMeetings();
  const configured = isConfigured();
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="logo">${icons.mic}</span><div><h1>Resaka</h1><small>Transcription malgache · français</small></div></div>
      <button class="icon-btn" id="btn-settings" aria-label="Réglages">${icons.gear}</button>
    </header>
    <main class="content home">
      ${!configured ? `
        <div class="banner warn" id="setup">
          <strong>Première étape 👋</strong>
          <span>Ajoute ta clé API Gemini (gratuite) pour activer la transcription.</span>
          <button class="btn small primary">Configurer</button>
        </div>` : ''}
      ${rec ? `<button class="banner rec" id="rec-banner"><span class="dot"></span> Enregistrement en cours — revenir</button>` : ''}
      ${meetings.length ? `<h2 class="section-title">Mes réunions</h2>
        <ul class="cards">${meetings.map((m) => `
          <li class="card" data-id="${m.id}">
            <div class="card-main">
              <div class="card-title">${esc(m.title)}</div>
              <div class="card-meta">${fmtDate(m.createdAt)} · ${fmtDuration(m.duration)}${m.segments?.length ? ` · ${new Set(m.segments.map((s) => s.speaker)).size} intervenant(s)` : ''}</div>
              ${m.summary?.resume ? `<div class="card-excerpt">${esc(m.summary.resume.slice(0, 140))}${m.summary.resume.length > 140 ? '…' : ''}</div>` : ''}
            </div>
            ${statusPill(m)}
          </li>`).join('')}</ul>`
      : `<div class="empty">
          <div class="empty-art">${icons.mic}</div>
          <h2>Aucune réunion</h2>
          <p>Enregistre ta prochaine réunion ou importe un audio (note vocale WhatsApp, enregistrement…). Resaka gère le mélange malgache / français.</p>
        </div>`}
    </main>
    <nav class="dock">
      <button class="btn ghost" id="btn-import">${icons.upload}<span>Importer</span></button>
      <button class="rec-btn" id="btn-rec" aria-label="Enregistrer">${icons.mic}</button>
      <span class="dock-spacer"></span>
    </nav>
    <input type="file" id="file" accept="audio/*,video/*,.opus,.m4a,.amr,.ogg,.aac,.3gp" hidden>`;

  app.querySelector('#btn-settings').onclick = () => go('#/settings');
  app.querySelector('#setup')?.addEventListener('click', () => go('#/settings'));
  app.querySelector('#rec-banner')?.addEventListener('click', () => go('#/rec'));
  app.querySelectorAll('.card').forEach((c) => (c.onclick = () => go(`#/m/${c.dataset.id}`)));
  app.querySelector('#btn-rec').onclick = () => (rec ? go('#/rec') : startRecording());
  const file = app.querySelector('#file');
  app.querySelector('#btn-import').onclick = () => file.click();
  file.onchange = () => file.files[0] && importFile(file.files[0]);
  cleanup = onTranscriptionUpdate(() => { if (location.hash === '' || location.hash === '#/') renderHomeSoft(); });
}

let softTimer;
function renderHomeSoft() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => { if (!document.querySelector('.modal-wrap')) route(); }, 300);
}

/* ---------------------------------------------------------- Enregistrement */

async function startRecording() {
  const s = getSettings();
  const id = newId();
  const now = Date.now();
  const meeting = {
    id, createdAt: now, source: 'record', status: 'recording', autoTitle: true,
    title: `Réunion du ${new Date(now).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    chunks: [], segments: [], duration: 0,
  };
  await db.putMeeting(meeting);
  const recorder = new SegmentedRecorder({
    segmentSeconds: (s.segmentMinutes || 5) * 60,
    onLevel: (l) => document.dispatchEvent(new CustomEvent('rec-level', { detail: l })),
    onSegment: async (seg) => {
      await db.putAudio(id, seg.idx, seg.blob);
      await db.update(id, (m) => {
        const c = m.chunks.find((x) => x.idx === seg.idx);
        const data = { idx: seg.idx, start: seg.start, duration: seg.duration, mime: 'audio/mp3', final: seg.final };
        if (c) Object.assign(c, data); else m.chunks.push({ ...data, transcribed: false });
        m.chunks.sort((a, b) => a.idx - b.idx);
        m.duration = Math.max(m.duration || 0, seg.start + seg.duration);
      });
      document.dispatchEvent(new CustomEvent('rec-segment', { detail: seg }));
      if (seg.final && rec && getSettings().liveTranscribe && isConfigured() && navigator.onLine) {
        transcribeMeeting(id, { withSummary: false }).catch(() => {});
      }
    },
  });
  try {
    await recorder.start();
  } catch (e) {
    await db.deleteMeeting(meeting);
    const denied = /Permission|NotAllowed|denied/i.test(e.name + e.message);
    toast(denied ? 'Accès au micro refusé. Autorise le micro dans les paramètres Android.' : `Impossible de démarrer : ${e.message}`, 'error');
    return;
  }
  rec = { recorder, meetingId: id, startedAt: Date.now() };
  KeepAwake.keepAwake().catch(() => {});
  go('#/rec');
}

async function stopRecording() {
  if (!rec) return;
  const { recorder, meetingId } = rec;
  const btn = document.querySelector('#rec-stop');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  await recorder.stop();
  rec = null;
  KeepAwake.allowSleep().catch(() => {});
  const m = await db.update(meetingId, (mm) => {
    mm.status = 'ready';
    mm.chunks = mm.chunks.filter((c) => c.duration > 0.3);
    mm.chunks.forEach((c) => (c.final = true));
  });
  go(`#/m/${meetingId}`);
  if (isConfigured() && m.chunks.length) transcribeMeeting(meetingId).catch((e) => toast(e.message, 'error'));
  else if (!isConfigured()) toast('Enregistré ✔ Configure la transcription dans les Réglages.');
}

function renderRecord() {
  if (!rec) return go('#/');
  const s = getSettings();
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="back">${icons.back}</button>
      <h1 class="title-sm">Enregistrement</h1>
      <span style="width:40px"></span>
    </header>
    <main class="content rec-screen">
      <div class="rec-state"><span class="dot"></span><span id="rec-label">Enregistrement en cours</span></div>
      <div class="timer" id="timer">00:00</div>
      <div class="viz" id="viz">${Array.from({ length: 32 }, () => '<i></i>').join('')}</div>
      <input class="input title-input" id="rec-title" placeholder="Titre de la réunion (optionnel)">
      <div class="rec-info" id="rec-info">
        ${s.liveTranscribe && isConfigured() ? `Transcription automatique toutes les ${s.segmentMinutes} min.` : 'La transcription démarrera à la fin.'}
      </div>
      <p class="hint">📱 Garde l’application ouverte pendant la réunion, l’écran restera allumé. Pose le téléphone au centre de la table.</p>
    </main>
    <div class="rec-controls">
      <button class="round-btn" id="rec-pause" aria-label="Pause">${icons.pause}</button>
      <button class="rec-btn stop" id="rec-stop" aria-label="Terminer">${icons.stop}</button>
      <span class="round-spacer"></span>
    </div>`;

  const bars = [...app.querySelectorAll('#viz i')];
  const levels = new Array(bars.length).fill(0);
  const onLevel = (e) => {
    levels.shift();
    levels.push(e.detail);
    bars.forEach((b, i) => (b.style.transform = `scaleY(${0.08 + levels[i] * 0.92})`));
  };
  document.addEventListener('rec-level', onLevel);
  const timer = app.querySelector('#timer');
  const iv = setInterval(() => { if (rec) timer.textContent = fmtTime(rec.recorder.seconds); }, 250);
  const info = app.querySelector('#rec-info');
  const unsub = onTranscriptionUpdate((id, text) => { if (rec && id === rec.meetingId && text) info.textContent = text; });

  const title = app.querySelector('#rec-title');
  title.onchange = () => {
    const v = title.value.trim();
    if (v && rec) db.update(rec.meetingId, (m) => { m.title = v; m.autoTitle = false; });
  };
  app.querySelector('#back').onclick = () => go('#/');
  const pauseBtn = app.querySelector('#rec-pause');
  pauseBtn.onclick = () => {
    if (!rec) return;
    const r = rec.recorder;
    if (r.paused) { r.resume(); pauseBtn.innerHTML = icons.pause; app.querySelector('#rec-label').textContent = 'Enregistrement en cours'; app.querySelector('.rec-state').classList.remove('paused'); }
    else { r.pause(); pauseBtn.innerHTML = icons.mic; app.querySelector('#rec-label').textContent = 'En pause'; app.querySelector('.rec-state').classList.add('paused'); }
  };
  app.querySelector('#rec-stop').onclick = async () => {
    if (title.value.trim()) await db.update(rec.meetingId, (m) => { m.title = title.value.trim(); m.autoTitle = false; });
    stopRecording();
  };
  cleanup = () => { clearInterval(iv); document.removeEventListener('rec-level', onLevel); unsub(); };
}

/* ------------------------------------------------------------------ Import */

async function importFile(file) {
  const s = getSettings();
  const id = newId();
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80) || 'Audio importé';
  const meeting = { id, createdAt: Date.now(), source: 'import', status: 'ready', autoTitle: /^(PTT|AUD|WA|Recording|Enregistrement|audio)/i.test(title), title, chunks: [], segments: [], duration: 0 };
  let progressEl;
  const closer = { close: null };
  modal({
    title: 'Préparation de l’audio…',
    content: '<div class="progress"><div id="imp-bar"></div></div><p class="muted" id="imp-txt">Lecture du fichier</p>',
    buttons: [],
    onMount: (w, close) => { progressEl = w; closer.close = close; },
  });
  try {
    const direct = directMime(file);
    const duration = await getDuration(file);
    if (direct) {
      await db.putAudio(id, 0, file);
      meeting.chunks = [{ idx: 0, start: 0, duration: duration || 0, mime: direct, final: true, transcribed: false }];
      meeting.duration = duration || 0;
    } else if (file.size <= 40 * 1024 * 1024 && (!duration || duration <= 45 * 60)) {
      progressEl.querySelector('#imp-txt').textContent = 'Conversion en MP3…';
      const segs = await convertToMp3Segments(file, (s.segmentMinutes || 5) * 60, (p) => {
        progressEl.querySelector('#imp-bar').style.width = `${Math.round(p * 100)}%`;
      });
      for (let i = 0; i < segs.length; i++) {
        await db.putAudio(id, i, segs[i].blob);
        meeting.chunks.push({ idx: i, start: segs[i].start, duration: segs[i].duration, mime: 'audio/mp3', final: true, transcribed: false });
      }
      meeting.duration = segs.reduce((a, x) => a + x.duration, 0);
    } else {
      await db.putAudio(id, 0, file);
      meeting.chunks = [{ idx: 0, start: 0, duration: duration || 0, mime: fallbackMime(file), final: true, transcribed: false }];
      meeting.duration = duration || 0;
    }
    await db.putMeeting(meeting);
    closer.close?.();
    go(`#/m/${id}`);
    if (isConfigured()) transcribeMeeting(id).catch((e) => toast(e.message, 'error'));
    else toast('Importé ✔ Configure la transcription dans les Réglages.');
  } catch (e) {
    closer.close?.();
    toast(`Import impossible : ${e.message}`, 'error');
  }
}

/* ----------------------------------------------------------------- Réunion */

async function renderMeeting(id, tab) {
  let m = await db.getMeeting(id);
  if (!m) return go('#/');
  let player = null;
  let activeId = null;
  let query = '';

  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="back">${icons.back}</button>
      <button class="title-btn" id="title"></button>
      <button class="icon-btn" id="menu">${icons.more}</button>
    </header>
    <div class="tabs">
      <button data-tab="transcript">Transcription</button>
      <button data-tab="summary">Compte rendu</button>
    </div>
    <div id="statusbar"></div>
    <main class="content meeting" id="body"></main>
    <div class="player" id="player">
      <button class="icon-btn" id="p-rew">${icons.rew}</button>
      <button class="play-btn" id="p-play">${icons.play}</button>
      <button class="icon-btn" id="p-fwd">${icons.fwd}</button>
      <div class="p-track">
        <input type="range" id="p-range" min="0" max="1000" value="0">
        <div class="p-times"><span id="p-cur">00:00</span><span id="p-dur">${fmtTime(m.duration)}</span></div>
      </div>
    </div>`;

  const body = app.querySelector('#body');
  const titleBtn = app.querySelector('#title');
  const statusbar = app.querySelector('#statusbar');

  function speakers() {
    return [...new Set((m.segments || []).map((s) => s.speaker))];
  }

  function renderHeader() {
    titleBtn.innerHTML = `<span>${esc(m.title)}</span><small>${fmtDate(m.createdAt)} · ${fmtDuration(m.duration)}</small>`;
    app.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }

  function renderStatus() {
    const st = status.get(id);
    const pending = (m.chunks || []).filter((c) => !c.transcribed).length;
    if (m.status === 'recording' && rec?.meetingId === id) {
      statusbar.innerHTML = `<div class="status rec"><span class="dot"></span> Enregistrement en cours <button class="btn small" id="s-rec">Voir</button></div>`;
      statusbar.querySelector('#s-rec').onclick = () => go('#/rec');
    } else if (st) {
      statusbar.innerHTML = `<div class="status busy"><span class="spinner"></span> ${esc(st)}</div>`;
    } else if (m.error) {
      statusbar.innerHTML = `<div class="status err"><span>⚠️ ${esc(m.error)}</span><button class="btn small" id="s-retry">Réessayer</button></div>`;
      statusbar.querySelector('#s-retry').onclick = () => runTranscribe();
    } else if (pending && m.status !== 'recording') {
      statusbar.innerHTML = `<div class="status"><span>${pending === m.chunks.length ? 'Pas encore transcrit.' : `${pending} segment(s) à transcrire.`}</span><button class="btn small primary" id="s-go">Transcrire</button></div>`;
      statusbar.querySelector('#s-go').onclick = () => runTranscribe();
    } else statusbar.innerHTML = '';
  }

  function runTranscribe() {
    if (!isConfigured()) { toast('Configure d’abord la transcription dans les Réglages.', 'error'); return go('#/settings'); }
    transcribeMeeting(id).catch((e) => toast(e.message, 'error'));
    setTimeout(renderStatus, 50);
  }

  function renderTranscript() {
    const segs = m.segments || [];
    if (!segs.length) {
      body.innerHTML = `<div class="empty small"><p>${status.get(id) ? 'La transcription arrive… elle s’affichera ici au fur et à mesure.' : 'Aucune transcription pour le moment.'}</p></div>`;
      return;
    }
    const spk = speakers();
    const q = query.toLowerCase();
    const shown = q ? segs.filter((s) => s.text.toLowerCase().includes(q) || s.speaker.toLowerCase().includes(q)) : segs;
    body.innerHTML = `
      <div class="search">${icons.search}<input id="q" placeholder="Rechercher dans la transcription" value="${esc(query)}"></div>
      <div class="speakers-row">${spk.map((s) => `<span class="spk-chip" style="--c:${speakerColor(s, spk)}">${esc(s)}</span>`).join('')}</div>
      <ol class="segments">${shown.map((s) => `
        <li class="seg ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
          <div class="seg-head">
            <button class="spk" style="--c:${speakerColor(s.speaker, spk)}" data-act="spk">${esc(s.speaker)}</button>
            <button class="ts" data-act="seek">${fmtTime(s.start)}</button>
          </div>
          <textarea class="seg-text" rows="1" spellcheck="false">${esc(s.text)}</textarea>
        </li>`).join('')}</ol>
      ${q && !shown.length ? '<p class="muted center">Aucun résultat.</p>' : ''}`;
    const qi = body.querySelector('#q');
    qi.oninput = () => {
      query = qi.value;
      const pos = qi.selectionStart;
      renderTranscript();
      const n = body.querySelector('#q');
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    body.querySelectorAll('.seg-text').forEach(autoGrow);
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function list(arr) {
    return arr?.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>';
  }

  function renderSummary() {
    const s = m.summary;
    const busy = status.get(id);
    if (!s) {
      body.innerHTML = `<div class="empty small">
        <div class="empty-art">${icons.sparkle}</div>
        <p>${m.segments?.length ? 'Génère un compte rendu : résumé, décisions et actions à mener.' : 'Le compte rendu sera disponible après la transcription.'}</p>
        ${m.segments?.length ? `<button class="btn primary" id="gen" ${busy ? 'disabled' : ''}>${icons.sparkle} Générer le compte rendu</button>` : ''}
      </div>`;
    } else {
      body.innerHTML = `
        <article class="summary">
          <h2>${esc(s.titre || m.title)}</h2>
          <section><h3>Résumé</h3><p>${esc(s.resume).replace(/\n/g, '<br>')}</p></section>
          <section><h3>Points clés</h3>${list(s.points_cles)}</section>
          <section><h3>Décisions</h3>${list(s.decisions)}</section>
          <section><h3>Actions</h3>${s.actions?.length ? `<ul class="actions">${s.actions.map((a) => `<li><span class="check"></span><div><div>${esc(a.tache)}</div>${a.responsable || a.echeance ? `<small>${esc([a.responsable, a.echeance].filter(Boolean).join(' · '))}</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">—</p>'}</section>
          ${s.questions_ouvertes?.length ? `<section><h3>Questions ouvertes</h3>${list(s.questions_ouvertes)}</section>` : ''}
          <div class="row gap">
            <button class="btn ghost" id="copy-sum">Copier</button>
            <button class="btn ghost" id="share-sum">Partager</button>
            <button class="btn ghost" id="gen" ${busy ? 'disabled' : ''}>Régénérer</button>
          </div>
        </article>`;
      body.querySelector('#copy-sum').onclick = async () => {
        (await copyText(toReport(m))) && toast('Compte rendu copié ✔');
      };
      body.querySelector('#share-sum').onclick = () => shareText(m, 'md').catch((e) => toast(e.message, 'error'));
    }
    body.querySelector('#gen')?.addEventListener('click', () => {
      summarize(id).then(() => toast('Compte rendu prêt ✔')).catch((e) => toast(e.message, 'error'));
      setTimeout(refresh, 50);
    });
  }

  function renderBody() {
    if (tab === 'summary') renderSummary(); else renderTranscript();
  }

  async function refresh() {
    m = await db.getMeeting(id);
    if (!m) return go('#/');
    renderHeader();
    renderStatus();
    // ne pas re-rendre pendant une édition
    const editing = document.activeElement?.classList?.contains('seg-text') || document.activeElement?.id === 'q';
    if (!editing) renderBody();
  }

  // --- événements
  app.querySelector('#back').onclick = () => (history.length > 1 ? history.back() : go('#/'));
  app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/m/${id}/${tab}`); renderHeader(); renderBody(); }));
  titleBtn.onclick = async () => {
    const v = await promptText('Renommer la réunion', m.title);
    if (v) { m = await db.update(id, (x) => { x.title = v; x.autoTitle = false; }); renderHeader(); }
  };

  body.addEventListener('input', (e) => { if (e.target.classList.contains('seg-text')) autoGrow(e.target); });
  body.addEventListener('focusout', async (e) => {
    if (!e.target.classList.contains('seg-text')) return;
    const segId = e.target.closest('.seg').dataset.id;
    const text = e.target.value.trim();
    const cur = m.segments.find((s) => s.id === segId);
    if (!cur || cur.text === text) return;
    m = await db.update(id, (x) => {
      const s = x.segments.find((y) => y.id === segId);
      if (!s) return false;
      if (!text) x.segments = x.segments.filter((y) => y.id !== segId); else s.text = text;
    });
    if (!text) renderBody();
  });
  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const segId = btn.closest('.seg').dataset.id;
    const seg = m.segments.find((s) => s.id === segId);
    if (!seg) return;
    if (btn.dataset.act === 'seek') {
      activeId = segId;
      await player.seek(seg.start);
    } else if (btn.dataset.act === 'spk') {
      await speakerDialog(seg);
    }
  });

  async function speakerDialog(seg) {
    const spk = speakers();
    const others = spk.filter((s) => s !== seg.speaker);
    const res = await modal({
      title: `Intervenant : ${esc(seg.speaker)}`,
      content: `
        <label class="label">Renommer « ${esc(seg.speaker)} » partout</label>
        <input class="input" id="rn" value="${esc(seg.speaker)}">
        ${others.length ? `<label class="label">Ou attribuer ce passage à</label>
        <div class="chips">${others.map((o) => `<button class="spk" style="--c:${speakerColor(o, spk)}" data-assign="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}`,
      buttons: [
        { label: 'Annuler', value: null },
        { label: 'Renommer', value: (w) => ({ rename: w.querySelector('#rn').value.trim() }), kind: 'primary' },
      ],
      onMount: (w, close) => w.querySelectorAll('[data-assign]').forEach((b) => (b.onclick = () => close({ assign: b.dataset.assign }))),
    });
    if (!res) return;
    if (res.rename && res.rename !== seg.speaker) {
      const old = seg.speaker;
      m = await db.update(id, (x) => x.segments.forEach((s) => { if (s.speaker === old) s.speaker = res.rename; }));
      toast(`« ${old} » → « ${res.rename} »`);
    } else if (res.assign) {
      m = await db.update(id, (x) => { const s = x.segments.find((y) => y.id === seg.id); if (s) s.speaker = res.assign; });
    }
    renderBody();
  }

  app.querySelector('#menu').onclick = async () => {
    const allMp3 = m.chunks.every((c) => c.mime === 'audio/mp3');
    const choice = await actionSheet('Options', [
      { label: 'Partager la transcription (.txt)', value: 'txt' },
      { label: 'Exporter les sous-titres (.srt)', value: 'srt' },
      { label: 'Partager le compte rendu (.md)', value: 'md' },
      { label: 'Copier la transcription', value: 'copy' },
      ...(allMp3 || m.chunks.length === 1 ? [{ label: 'Partager l’audio', value: 'audio' }] : []),
      { label: 'Retranscrire entièrement', value: 'redo' },
      { label: 'Supprimer la réunion', value: 'delete', danger: true },
    ]);
    try {
      if (['txt', 'srt', 'md'].includes(choice)) {
        if (!m.segments?.length && choice !== 'md') return toast('Rien à exporter pour le moment.');
        await shareText(m, choice);
      } else if (choice === 'copy') {
        (await copyText(transcriptText(m))) && toast('Transcription copiée ✔');
      } else if (choice === 'audio') {
        const blobs = [];
        for (const c of m.chunks) blobs.push(await db.getAudio(id, c.idx));
        await shareAudio(m, blobs.filter(Boolean));
      } else if (choice === 'redo') {
        if (await confirmDlg('Retranscrire ?', 'La transcription actuelle et tes corrections seront remplacées.', 'Retranscrire')) {
          m = await db.update(id, (x) => { x.segments = []; x.summary = null; x.error = null; x.chunks.forEach((c) => { c.transcribed = false; c.windowsDone = 0; }); });
          runTranscribe();
          refresh();
        }
      } else if (choice === 'delete') {
        if (await confirmDlg('Supprimer ?', `« ${esc(m.title)} » et son audio seront supprimés définitivement.`, 'Supprimer', true)) {
          await db.deleteMeeting(m);
          toast('Réunion supprimée');
          go('#/');
        }
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // --- lecteur
  const range = app.querySelector('#p-range');
  const curEl = app.querySelector('#p-cur');
  const playBtn = app.querySelector('#p-play');
  let dragging = false;
  player = new MeetingPlayer(m, (t, playing) => {
    playBtn.innerHTML = playing ? icons.pause : icons.play;
    curEl.textContent = fmtTime(t);
    const d = player.duration || m.duration || 1;
    if (!dragging) range.value = Math.round((t / d) * 1000);
    // surligne le segment courant
    if (playing && m.segments?.length) {
      let cur = null;
      for (const s of m.segments) { if (s.start <= t + 0.2) cur = s; else break; }
      if (cur && cur.id !== activeId) {
        activeId = cur.id;
        body.querySelectorAll('.seg.active').forEach((el) => el.classList.remove('active'));
        const el = body.querySelector(`.seg[data-id="${cur.id}"]`);
        if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }
    }
  });
  app.querySelector('#p-dur').textContent = fmtTime(player.duration || m.duration);
  playBtn.onclick = () => player.toggle();
  app.querySelector('#p-rew').onclick = () => player.skip(-10);
  app.querySelector('#p-fwd').onclick = () => player.skip(10);
  range.oninput = () => { dragging = true; curEl.textContent = fmtTime((range.value / 1000) * (player.duration || m.duration)); };
  range.onchange = async () => { dragging = false; await player.seek((range.value / 1000) * (player.duration || m.duration), player.playing); };

  const unsub = onTranscriptionUpdate((mid) => { if (mid === id) refresh(); });
  const poll = setInterval(() => { if (m.status === 'recording') refresh(); }, 5000);
  cleanup = () => { unsub(); clearInterval(poll); player?.destroy(); };

  renderHeader();
  renderStatus();
  renderBody();
}

/* ----------------------------------------------------------------- Réglages */

function renderSettings() {
  const s = getSettings();
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="back">${icons.back}</button>
      <h1 class="title-sm">Réglages</h1>
      <span style="width:40px"></span>
    </header>
    <main class="content settings">
      <section class="panel">
        <h2>Moteur de transcription</h2>
        <div class="segmented" id="provider">
          <button data-v="gemini">Google Gemini</button>
          <button data-v="whisper">Mon serveur Whisper</button>
        </div>

        <div id="p-gemini">
          <p class="muted">Gemini comprend le malgache et le français mélangés, reconnaît les intervenants et rédige le compte rendu.</p>
          <label class="label">Clé API Gemini</label>
          <div class="input-group">
            <input class="input" id="g-key" type="password" autocomplete="off" placeholder="AIza…" value="${esc(s.geminiKey)}">
            <button class="icon-btn" id="g-eye">${icons.eye}</button>
          </div>
          <a class="link" href="https://aistudio.google.com/apikey">Obtenir une clé gratuite sur Google AI Studio →</a>
          <button class="btn primary block" id="g-test">Tester la clé et charger les modèles</button>
          <label class="label">Modèle</label>
          <select class="input" id="g-model">${s.geminiModel ? `<option value="${esc(s.geminiModel)}">${esc(s.geminiModel)}</option>` : '<option value="">— teste la clé d’abord —</option>'}</select>
          <p class="muted small">Conseil : un modèle « flash » est rapide et économique ; « pro » est plus précis mais plus lent.</p>
        </div>

        <div id="p-whisper">
          <p class="muted">Pour utiliser ton propre modèle Whisper (par ex. un modèle malgache fine-tuné) via le serveur fourni dans le dépôt (dossier <code>server/</code>).</p>
          <label class="label">Adresse du serveur</label>
          <input class="input" id="w-url" placeholder="http://192.168.1.20:8000" value="${esc(s.whisperUrl)}">
          <label class="label">Clé (optionnelle)</label>
          <input class="input" id="w-key" type="password" value="${esc(s.whisperKey)}">
          <button class="btn primary block" id="w-test">Tester la connexion</button>
          <p class="muted small">Le compte rendu utilise toujours Gemini si une clé est renseignée.</p>
        </div>
      </section>

      <section class="panel">
        <h2>Précision</h2>
        <label class="label">Vocabulaire spécifique</label>
        <textarea class="input" id="vocab" rows="3" placeholder="Noms des participants, entreprises, sigles… ex. Rakoto, Fitiavana, MTechniix, Odoo, CNaPS">${esc(s.vocabulary)}</textarea>
        <p class="muted small">Aide l’IA à bien écrire les noms propres et le jargon.</p>
      </section>

      <section class="panel">
        <h2>Réunion</h2>
        <label class="label">Langue du compte rendu</label>
        <select class="input" id="lang">
          <option value="fr" ${s.summaryLang === 'fr' ? 'selected' : ''}>Français</option>
          <option value="mg" ${s.summaryLang === 'mg' ? 'selected' : ''}>Malagasy</option>
        </select>
        <label class="label">Découpage de l’enregistrement</label>
        <select class="input" id="segmin">
          ${[2, 5, 10].map((n) => `<option value="${n}" ${s.segmentMinutes === n ? 'selected' : ''}>Toutes les ${n} minutes</option>`).join('')}
        </select>
        <label class="switch"><input type="checkbox" id="live" ${s.liveTranscribe ? 'checked' : ''}><span></span>Transcrire pendant l’enregistrement</label>
        <label class="switch"><input type="checkbox" id="autosum" ${s.autoSummary ? 'checked' : ''}><span></span>Compte rendu automatique à la fin</label>
      </section>

      <section class="panel about">
        <h2>À propos</h2>
        <p class="muted">Resaka v${__APP_VERSION__} · Les enregistrements restent sur ton téléphone. L’audio n’est envoyé qu’au moteur de transcription choisi.</p>
      </section>
    </main>`;

  app.querySelector('#back').onclick = () => (history.length > 1 ? history.back() : go('#/'));
  const setProvider = (v) => {
    saveSettings({ provider: v });
    app.querySelectorAll('#provider button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    app.querySelector('#p-gemini').hidden = v !== 'gemini';
    app.querySelector('#p-whisper').hidden = v !== 'whisper';
  };
  setProvider(s.provider);
  app.querySelectorAll('#provider button').forEach((b) => (b.onclick = () => setProvider(b.dataset.v)));

  const key = app.querySelector('#g-key');
  key.onchange = () => saveSettings({ geminiKey: key.value.trim() });
  app.querySelector('#g-eye').onclick = () => (key.type = key.type === 'password' ? 'text' : 'password');
  const sel = app.querySelector('#g-model');
  sel.onchange = () => saveSettings({ geminiModel: sel.value });
  const testBtn = app.querySelector('#g-test');
  testBtn.onclick = async () => {
    const k = key.value.trim();
    if (!k) return toast('Colle d’abord ta clé API.', 'error');
    saveSettings({ geminiKey: k });
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner"></span> Vérification…';
    try {
      const models = await listModels(k);
      if (!models.length) throw new Error('Aucun modèle disponible pour cette clé.');
      const current = getSettings().geminiModel;
      const chosen = models.some((x) => x.id === current) ? current : pickDefaultModel(models);
      sel.innerHTML = models.map((x) => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.label)} (${esc(x.id)})</option>`).join('');
      saveSettings({ geminiModel: chosen, geminiModels: models.map((x) => x.id) });
      toast(`Clé valide ✔ Modèle : ${chosen}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Tester la clé et charger les modèles';
    }
  };

  const wurl = app.querySelector('#w-url');
  wurl.onchange = () => saveSettings({ whisperUrl: wurl.value.trim() });
  app.querySelector('#w-key').onchange = (e) => saveSettings({ whisperKey: e.target.value.trim() });
  app.querySelector('#w-test').onclick = async () => {
    saveSettings({ whisperUrl: wurl.value.trim() });
    try {
      const info = await whisperPing(wurl.value.trim());
      toast(`Serveur OK ✔ ${info.model || ''}`);
    } catch (e) {
      toast('Serveur injoignable. Vérifie l’adresse et le Wi-Fi.', 'error');
    }
  };

  app.querySelector('#vocab').onchange = (e) => saveSettings({ vocabulary: e.target.value.trim() });
  app.querySelector('#lang').onchange = (e) => saveSettings({ summaryLang: e.target.value });
  app.querySelector('#segmin').onchange = (e) => saveSettings({ segmentMinutes: +e.target.value });
  app.querySelector('#live').onchange = (e) => saveSettings({ liveTranscribe: e.target.checked });
  app.querySelector('#autosum').onchange = (e) => saveSettings({ autoSummary: e.target.checked });
}

/* --------------------------------------------------------------- Démarrage */

async function recoverInterrupted() {
  // Réunions restées "en enregistrement" (app fermée brutalement) -> récupérer l'audio sauvegardé
  const all = await db.listMeetings();
  for (const m of all) {
    if (m.status === 'recording') {
      await db.update(m.id, (x) => {
        x.status = 'ready';
        x.chunks = x.chunks.filter((c) => c.duration > 0.3);
        x.chunks.forEach((c) => (c.final = true));
        x.error = x.chunks.length ? null : 'Enregistrement interrompu, aucun audio récupéré.';
      });
    }
  }
}

(async () => {
  if (Capacitor.getPlatform() === 'android') document.documentElement.classList.add('android');
  await recoverInterrupted().catch(() => {});
  route();
  // reprendre les transcriptions interrompues quand le réseau revient
  window.addEventListener('online', async () => {
    if (!isConfigured()) return;
    for (const m of await db.listMeetings()) {
      if (m.status !== 'recording' && m.chunks?.some((c) => !c.transcribed) && m.segments?.length) transcribeMeeting(m.id).catch(() => {});
    }
  });
})();
