"""FastAPI: 정적 UI + /api/todo + /api/transcribe + /api/breakdown."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from vibe_todo.graph import breakdown_friction, run_brain_dump
from vibe_todo.schemas import (
    BreakdownRequest,
    BreakdownResponse,
    RealityCheckModel,
    TodoRequest,
    TodoResponse,
    TodoSteps,
    TranscribeResponse,
)
from vibe_todo.stt import transcribe_audio

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="인생네칸", version="1.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/todo", response_model=TodoResponse)
def create_todo(body: TodoRequest) -> TodoResponse:
    raw = body.raw_text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="raw_text가 비어 있습니다.")
    try:
        result = run_brain_dump(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"그래프 실행 실패: {type(exc).__name__}",
        ) from exc

    error = result.get("error")
    polished = result.get("polished") or []
    classified = result.get("classified") or []
    candidates = result.get("task_candidates") or []
    reality = result.get("reality_check")

    if error and not polished and not classified:
        raise HTTPException(status_code=502, detail=error)

    reality_model = None
    if reality and reality.get("triggered"):
        reality_model = RealityCheckModel(**reality)

    return TodoResponse(
        polished=polished,
        steps=TodoSteps(
            task_candidates=candidates,
            classified=classified,
            polished=polished,
        ),
        reality_check=reality_model,
        error=error,
    )


@app.post("/api/breakdown", response_model=BreakdownResponse)
def create_breakdown(body: BreakdownRequest) -> BreakdownResponse:
    try:
        steps = breakdown_friction(body.title, body.reason)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"마이크로 스텝 생성 실패: {type(exc).__name__}",
        ) from exc
    if len(steps) < 3:
        raise HTTPException(
            status_code=502,
            detail="마이크로 스텝을 충분히 만들지 못했습니다.",
        )
    return BreakdownResponse(steps=steps)


@app.post("/api/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)) -> TranscribeResponse:
    data = await file.read()
    filename = file.filename or "recording.webm"
    try:
        text = transcribe_audio(data, filename=filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"음성 인식 실패: {type(exc).__name__}",
        ) from exc
    return TranscribeResponse(text=text)
