# 🎙️ Resaka

**Application Android de transcription de réunions en malgache + français mélangés.**

Resaka enregistre la réunion et la transcrit mot à mot, sans traduire, en conservant le mélange des langues (« Mila *valider*-na aloha ny *budget* »). Elle reconnaît les intervenants et rédige un compte rendu : résumé, décisions et actions.

## ✨ Fonctionnalités

- 🔴 **Enregistrement de réunion**, écran maintenu allumé, sauvegarde automatique toutes les 20 s (rien n'est perdu si l'app se ferme)
- ⚡ **Transcription pendant la réunion** : l'audio est découpé en segments de 2, 5 ou 10 min, transcrits au fil de l'eau
- 📂 **Import d'audio** : notes vocales WhatsApp (.opus), mp3, m4a, wav, vidéos mp4…
- 🗣️ **Intervenants** séparés, renommables (« Intervenant 1 » → « Rakoto ») ou réattribuables
- ✏️ **Éditeur** : corrige le texte, touche l'horodatage pour réécouter le passage, recherche
- 📝 **Compte rendu** automatique en français ou en malgache
- 📤 **Exports** : .txt, sous-titres .srt, compte rendu .md, audio .mp3
- 📚 **Vocabulaire personnalisé** (noms, sigles, jargon) pour améliorer la précision
- 🔒 Les données restent sur le téléphone ; l'audio n'est envoyé qu'au moteur de transcription choisi

## 📲 Installation

1. Ouvre la page [Releases](../../releases/latest) depuis ton téléphone et télécharge **Resaka-x.y.z.apk**
2. Ouvre le fichier et autorise l'installation depuis cette source si Android le demande
3. Dans l'app, va dans **Réglages ⚙️** :
   - colle ta **clé API Gemini**, gratuite sur [Google AI Studio](https://aistudio.google.com/apikey)
   - appuie sur **Tester la clé** : le meilleur modèle est choisi automatiquement
   - ajoute ton **vocabulaire** (noms des collègues, entreprise…)
4. Reviens à l'accueil et appuie sur le bouton rouge 🎙️

Les mises à jour s'installent par-dessus l'ancienne version, sans perdre les données.

## 🧠 Moteurs de transcription

| Moteur | Avantages | Prérequis |
|---|---|---|
| **Google Gemini** (par défaut) | Gère bien le code-switching, sépare les intervenants, rédige le compte rendu | Clé API + Internet |
| **Serveur Whisper perso** (`server/`) | Ton propre modèle (ex. Whisper fine-tuné malgache), données chez toi | Un PC/serveur avec Python ou Docker |

### Lancer le serveur Whisper

```bash
cd server
docker build -t resaka-whisper .
docker run -p 8000:8000 -e MODEL=small resaka-whisper
# puis dans l'app : Réglages → Mon serveur Whisper → http://IP_DU_PC:8000
```

Pour utiliser un modèle malgache fine-tuné de Hugging Face :

```bash
pip install ctranslate2 transformers
ct2-transformers-converter --model nlp-mg/whisper-mg --output_dir whisper-mg-ct2 --quantization int8
MODEL=./whisper-mg-ct2 uvicorn app:app --host 0.0.0.0 --port 8000
```

## 🛠️ Développement

```bash
npm install
npm run dev              # version web sur http://localhost:5173
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

Chaque `push` sur `main` compile l'APK via GitHub Actions et le publie dans les Releases.

**Stack** : Vite + JavaScript, Capacitor 8 (Android), AudioWorklet + lamejs (enregistrement MP3 16 kHz mono), IndexedDB, API Gemini (REST).

## 🗺️ Prochaines étapes

- Recevoir directement les notes vocales via le bouton « Partager » de WhatsApp
- Enregistrement en arrière-plan (service Android au premier plan)
- Utiliser les corrections faites dans l'éditeur pour constituer un corpus et fine-tuner un Whisper malgache/français
