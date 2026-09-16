"""Groq Whisper STT (버튼 녹음 → text). 그래프 밖 전처리."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=False)


def _client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key or api_key.startswith("your_"):
        raise RuntimeError(
            "vibe_todo/.env 에 유효한 GROQ_API_KEY 가 필요합니다."
        )
    return Groq(api_key=api_key)


def transcribe_audio(data: bytes, filename: str = "recording.webm") -> str:
    if not data:
        raise ValueError("오디오 데이터가 비어 있습니다.")
    model = os.getenv("GROQ_STT_MODEL", "whisper-large-v3").strip()
    client = _client()
    transcription = client.audio.transcriptions.create(
        file=(filename, data),
        model=model,
        language="ko",
        response_format="text",
    )
    if isinstance(transcription, str):
        text = transcription
    else:
        text = getattr(transcription, "text", str(transcription))
    text = (text or "").strip()
    if not text:
        raise ValueError("음성이 인식되지 않았습니다.")
    return text
