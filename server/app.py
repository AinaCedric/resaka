"""
Serveur de transcription Resaka (compatible API OpenAI /v1/audio/transcriptions)
basé sur faster-whisper. Permet d'utiliser un modèle Whisper malgache fine-tuné.

Lancement :
    pip install -r requirements.txt
    MODEL=small uvicorn app:app --host 0.0.0.0 --port 8000
Variables :
    MODEL     nom faster-whisper (tiny, small, medium, large-v3…) ou dossier CTranslate2 converti
    LANGUAGE  code langue forcé (ex. "mg"), vide = détection auto
    DEVICE    "cuda" ou "cpu" (défaut : auto)
    API_KEY   si défini, exige l'en-tête Authorization: Bearer <API_KEY>
"""
import os
import tempfile

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL = os.getenv("MODEL", "small")
LANGUAGE = os.getenv("LANGUAGE") or None
DEVICE = os.getenv("DEVICE", "auto")
API_KEY = os.getenv("API_KEY")
INITIAL_PROMPT = os.getenv(
    "INITIAL_PROMPT",
    "Fivoriana: miresaka amin'ny teny malagasy sy frantsay. Réunion : budget, valider, la semaine prochaine.",
)

compute = "float16" if DEVICE == "cuda" else "int8"
model = WhisperModel(MODEL, device=DEVICE, compute_type=compute if DEVICE != "auto" else "default")

app = FastAPI(title="Resaka Whisper")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "language": LANGUAGE or "auto"}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form("whisper-1", alias="model"),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
    response_format: str = Form("verbose_json"),
    authorization: str | None = Header(None),
):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Clé invalide")
    suffix = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        segments, info = model.transcribe(
            path,
            language=language or LANGUAGE,
            initial_prompt=prompt or INITIAL_PROMPT,
            vad_filter=True,
            beam_size=5,
        )
        segs = [
            {"id": i, "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
            for i, s in enumerate(segments)
        ]
    finally:
        os.unlink(path)
    text = " ".join(s["text"] for s in segs)
    if response_format == "text":
        return text
    return {"text": text, "language": info.language, "duration": info.duration, "segments": segs}
