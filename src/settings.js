// Réglages persistés localement
const KEY = 'resaka.settings';

const DEFAULTS = {
  provider: 'gemini',          // 'gemini' | 'whisper'
  geminiKey: '',
  geminiModel: '',
  geminiModels: [],            // modèles disponibles pour la clé (secours automatique)             // choisi après "Tester la clé"
  whisperUrl: '',              // ex. http://192.168.1.20:8000
  whisperKey: '',
  vocabulary: '',              // noms propres, jargon, sigles
  summaryLang: 'fr',           // 'fr' | 'mg'
  segmentMinutes: 5,
  liveTranscribe: true,
  autoSummary: true,
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  return cache;
}

export function isConfigured() {
  const s = getSettings();
  if (s.provider === 'whisper') return !!s.whisperUrl;
  return !!s.geminiKey;
}
