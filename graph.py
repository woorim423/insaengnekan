"""LangGraph: extract → classify → polish → annotate_delegate → reality_check."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langgraph.graph import END, START, StateGraph

from vibe_todo.prompts import (
    CLASSIFY_SYSTEM,
    CLASSIFY_TASK,
    DELEGATE_SYSTEM,
    DELEGATE_TASK,
    EXTRACT_SYSTEM,
    EXTRACT_TASK,
    FRICTION_SYSTEM,
    FRICTION_TASK,
    POLISH_SYSTEM,
    POLISH_TASK,
    REALITY_SYSTEM,
    REALITY_TASK,
)
from vibe_todo.schemas import (
    DO_CAPACITY,
    VALID_QUADRANTS,
    BrainDumpState,
    RealityCheck,
    TaskItem,
)

_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=False)

MAX_RAW_CHARS = 2000
KEEP_LIMIT = 2


def _get_llm(*, temperature: float) -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key or api_key.startswith("your_"):
        raise RuntimeError(
            "vibe_todo/.env 에 유효한 GROQ_API_KEY 가 필요합니다."
        )
    model = os.getenv("GROQ_LLM_MODEL", "openai/gpt-oss-20b").strip()
    return ChatGroq(
        model=model,
        temperature=temperature,
        api_key=api_key,
        max_retries=2,
    )


def _extract_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", cleaned)
        if not match:
            raise
        return json.loads(match.group(0))


def _is_retryable_error(exc: BaseException) -> bool:
    name = type(exc).__name__
    if name in {
        "APIConnectionError",
        "APITimeoutError",
        "RateLimitError",
        "InternalServerError",
        "ServiceUnavailableError",
    }:
        return True
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "connection" in text


def _format_node_error(node: str, exc: BaseException) -> str:
    name = type(exc).__name__
    if "APIConnection" in name or "connection" in str(exc).lower():
        return (
            f"{node} 실패: Groq 서버 연결이 끊겼습니다. "
            "인터넷 확인 후 10초 뒤 다시 시도해 주세요."
        )
    if "RateLimit" in name or "429" in str(exc):
        return f"{node} 실패: Groq 요청 한도입니다. 1~2분 후 다시 시도해 주세요."
    if isinstance(exc, json.JSONDecodeError):
        return f"{node} 실패: 모델 응답 형식(JSON)을 읽지 못했습니다."
    if "Invalid API Key" in str(exc) or "401" in str(exc):
        return f"{node} 실패: vibe_todo/.env 의 GROQ_API_KEY 를 확인해 주세요."
    return f"{node} 실패: {name}"


def _fallback_candidates(raw_text: str) -> list[str]:
    """LLM JSON 실패 시 최소한의 로컬 분할 (정리 노드 폴백)."""
    chunks = re.split(r"[\n\r]+|(?<=[\.!?])\s+|(?:\s+그리고\s+|\s+하고\s+|\s+또\s+)", raw_text)
    out: list[str] = []
    for chunk in chunks:
        text = chunk.strip(" ·-•")
        if len(text) >= 3:
            out.append(text)
    return out[:20]


def _invoke_json(system: str, user: str, *, temperature: float) -> Any:
    last_exc: BaseException | None = None
    for attempt in range(3):
        try:
            llm = _get_llm(temperature=temperature)
            response = llm.invoke(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]
            )
            content = response.content
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") if isinstance(part, dict) else str(part)
                    for part in content
                )
            return _extract_json(str(content))
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < 2 and _is_retryable_error(exc):
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("LLM 호출 실패")


def _task(
    *,
    id: str,
    title: str,
    quadrant: str,
    importance: bool,
    urgency: bool,
    reason: str,
    reply_template: str | None = None,
    micro_steps: list[str] | None = None,
) -> TaskItem:
    item: TaskItem = {
        "id": id,
        "title": title,
        "quadrant": quadrant,  # type: ignore[typeddict-item]
        "importance": importance,
        "urgency": urgency,
        "reason": reason,
    }
    if reply_template is not None:
        item["reply_template"] = reply_template
    if micro_steps is not None:
        item["micro_steps"] = micro_steps
    return item


def _normalize_quadrant(item: dict[str, Any]) -> TaskItem:
    importance = bool(item.get("importance"))
    urgency = bool(item.get("urgency"))
    quadrant = str(item.get("quadrant", "")).strip()
    if quadrant not in VALID_QUADRANTS:
        if importance and urgency:
            quadrant = "important_urgent"
        elif not importance and urgency:
            quadrant = "not_important_urgent"
        elif importance and not urgency:
            quadrant = "important_not_urgent"
        else:
            quadrant = "not_important_not_urgent"
    if quadrant == "important_urgent":
        importance, urgency = True, True
    elif quadrant == "important_not_urgent":
        importance, urgency = True, False
    elif quadrant == "not_important_urgent":
        importance, urgency = False, True
    else:
        importance, urgency = False, False

    return _task(
        id=str(item.get("id") or "t0"),
        title=str(item.get("title") or "").strip(),
        quadrant=quadrant,
        importance=importance,
        urgency=urgency,
        reason=str(item.get("reason") or "").strip(),
        reply_template=item.get("reply_template"),
        micro_steps=item.get("micro_steps"),
    )


def extract_tasks(state: BrainDumpState) -> dict[str, Any]:
    raw_text = (state.get("raw_text") or "").strip()[:MAX_RAW_CHARS]
    if not raw_text:
        return {"task_candidates": [], "error": "입력이 비어 있습니다."}
    try:
        data = _invoke_json(
            EXTRACT_SYSTEM,
            EXTRACT_TASK.format(raw_text=raw_text),
            temperature=0.1,
        )
        if isinstance(data, list):
            candidates = [str(x).strip() for x in data if str(x).strip()]
        else:
            candidates = [
                str(x).strip()
                for x in data.get("task_candidates", [])
                if str(x).strip()
            ]
        return {"task_candidates": candidates, "error": None}
    except json.JSONDecodeError:
        fallback = _fallback_candidates(raw_text)
        if fallback:
            return {
                "task_candidates": fallback,
                "error": None,
            }
        return {
            "task_candidates": [],
            "error": "정리 노드 실패: 모델 응답 형식(JSON)을 읽지 못했습니다.",
        }
    except Exception as exc:  # noqa: BLE001
        fallback = _fallback_candidates(raw_text)
        if fallback and _is_retryable_error(exc):
            return {
                "task_candidates": fallback,
                "error": (
                    "Groq 연결이 불안정해 로컬 분할로 후보를 만들었습니다. "
                    "가능하면 잠시 후 다시 시도하세요."
                ),
            }
        return {
            "task_candidates": [],
            "error": _format_node_error("정리 노드", exc),
        }


def classify_tasks(state: BrainDumpState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    candidates = state.get("task_candidates") or []
    if not candidates:
        return {
            "classified": [],
            "error": "추출된 할 일 후보가 없습니다.",
        }
    try:
        data = _invoke_json(
            CLASSIFY_SYSTEM,
            CLASSIFY_TASK.format(
                raw_text=state.get("raw_text", ""),
                task_candidates=json.dumps(candidates, ensure_ascii=False),
            ),
            temperature=0.1,
        )
        raw_items = data if isinstance(data, list) else data.get("classified", [])
        classified: list[TaskItem] = []
        for index, item in enumerate(raw_items, start=1):
            if not isinstance(item, dict):
                continue
            if "title" not in item and index - 1 < len(candidates):
                item = {**item, "title": candidates[index - 1]}
            if "id" not in item:
                item = {**item, "id": f"t{index}"}
            normalized = _normalize_quadrant(item)
            if normalized["title"]:
                classified.append(normalized)
        if not classified:
            return {
                "classified": [],
                "error": "분류 결과를 파싱하지 못했습니다.",
            }
        return {"classified": classified, "error": None}
    except Exception as exc:  # noqa: BLE001
        return {
            "classified": [],
            "error": f"분류 노드 실패: {type(exc).__name__}",
        }


def polish_tasks(state: BrainDumpState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    classified = state.get("classified") or []
    if not classified:
        return {"polished": [], "error": "분류된 할 일이 없습니다."}
    try:
        data = _invoke_json(
            POLISH_SYSTEM,
            POLISH_TASK.format(
                classified=json.dumps(classified, ensure_ascii=False)
            ),
            temperature=0.3,
        )
        raw_items = data if isinstance(data, list) else data.get("polished", [])
        polished: list[TaskItem] = []
        for index, original in enumerate(classified):
            item = raw_items[index] if index < len(raw_items) else {}
            if not isinstance(item, dict):
                item = {}
            title = str(item.get("title") or original["title"]).strip()
            polished.append(
                _task(
                    id=original["id"],
                    title=title or original["title"],
                    quadrant=original["quadrant"],
                    importance=original["importance"],
                    urgency=original["urgency"],
                    reason=original["reason"],
                )
            )
        return {"polished": polished, "error": None}
    except Exception as exc:  # noqa: BLE001
        return {
            "polished": classified,
            "error": f"다듬기 노드 실패(분류 결과로 대체): {type(exc).__name__}",
        }


def annotate_delegate(state: BrainDumpState) -> dict[str, Any]:
    """Delegate 카드용 정중 미루기/거절 1줄 템플릿."""
    if state.get("error") and not (state.get("polished") or []):
        return {}
    polished = list(state.get("polished") or [])
    delegates = [t for t in polished if t["quadrant"] == "not_important_urgent"]
    if not delegates:
        return {"polished": polished}

    try:
        payload = [
            {"id": t["id"], "title": t["title"], "reason": t["reason"]}
            for t in delegates
        ]
        data = _invoke_json(
            DELEGATE_SYSTEM,
            DELEGATE_TASK.format(
                delegate_tasks=json.dumps(payload, ensure_ascii=False)
            ),
            temperature=0.4,
        )
        templates = {
            str(row.get("id")): str(row.get("reply_template") or "").strip()
            for row in (data.get("templates") or [])
            if isinstance(row, dict)
        }
        updated: list[TaskItem] = []
        for task in polished:
            if task["id"] in templates and templates[task["id"]]:
                updated.append({**task, "reply_template": templates[task["id"]]})
            elif task["quadrant"] == "not_important_urgent":
                updated.append(
                    {
                        **task,
                        "reply_template": (
                            f"지금은 급한 일이 있어 "
                            f"‘{task['title']}’은(는) 조금 미뤄도 될까요?"
                        ),
                    }
                )
            else:
                updated.append(task)
        return {"polished": updated}
    except Exception:  # noqa: BLE001
        updated = []
        for task in polished:
            if task["quadrant"] == "not_important_urgent":
                updated.append(
                    {
                        **task,
                        "reply_template": (
                            f"오늘은 여유를 내기 어려워 "
                            f"‘{task['title']}’은(는) 다음에 해도 괜찮을까요?"
                        ),
                    }
                )
            else:
                updated.append(task)
        return {"polished": updated}


def reality_check_node(state: BrainDumpState) -> dict[str, Any]:
    """Do 용량 초과 시 권고안 생성 (State 강제 변경은 사용자 승인 후 UI에서)."""
    polished = list(state.get("polished") or [])
    do_tasks = [t for t in polished if t["quadrant"] == "important_urgent"]
    do_count = len(do_tasks)

    empty: RealityCheck = {
        "triggered": False,
        "message": "",
        "keep_ids": [],
        "move_ids": [],
        "do_count": do_count,
        "keep_limit": KEEP_LIMIT,
    }
    if do_count < DO_CAPACITY:
        return {"reality_check": empty}

    try:
        payload = [
            {"id": t["id"], "title": t["title"], "reason": t["reason"]}
            for t in do_tasks
        ]
        data = _invoke_json(
            REALITY_SYSTEM,
            REALITY_TASK.format(
                threshold=DO_CAPACITY,
                keep_limit=KEEP_LIMIT,
                do_tasks=json.dumps(payload, ensure_ascii=False),
            ),
            temperature=0.2,
        )
        ids = {t["id"] for t in do_tasks}
        keep_ids = [i for i in data.get("keep_ids", []) if i in ids][:KEEP_LIMIT]
        move_ids = [i for i in data.get("move_ids", []) if i in ids]
        if len(keep_ids) < KEEP_LIMIT:
            for task in do_tasks:
                if task["id"] not in keep_ids:
                    keep_ids.append(task["id"])
                if len(keep_ids) >= KEEP_LIMIT:
                    break
        if not move_ids:
            move_ids = [t["id"] for t in do_tasks if t["id"] not in keep_ids]
        message = str(data.get("message") or "").strip()
        if not message:
            message = (
                f"오늘 Do가 {do_count}개입니다. 가장 치명적인 "
                f"{KEEP_LIMIT}개만 남기고 나머지는 Schedule로 옮기는 걸 권장합니다."
            )
        check: RealityCheck = {
            "triggered": True,
            "message": message,
            "keep_ids": keep_ids,
            "move_ids": move_ids,
            "do_count": do_count,
            "keep_limit": KEEP_LIMIT,
        }
        return {"reality_check": check}
    except Exception as exc:  # noqa: BLE001
        keep_ids = [t["id"] for t in do_tasks[:KEEP_LIMIT]]
        move_ids = [t["id"] for t in do_tasks[KEEP_LIMIT:]]
        check = {
            "triggered": True,
            "message": (
                f"오늘 Do가 {do_count}개라 번아웃 위험이 큽니다. "
                f"치명적 {KEEP_LIMIT}개만 남기고 나머지는 Schedule로 "
                f"옮기는 것을 권장합니다. ({type(exc).__name__})"
            ),
            "keep_ids": keep_ids,
            "move_ids": move_ids,
            "do_count": do_count,
            "keep_limit": KEEP_LIMIT,
        }
        return {"reality_check": check}


def breakdown_friction(title: str, reason: str = "") -> list[str]:
    """버튼 클릭 시 독립 호출: 2분 컷 마이크로 스텝 3개."""
    data = _invoke_json(
        FRICTION_SYSTEM,
        FRICTION_TASK.format(title=title, reason=reason or "(없음)"),
        temperature=0.4,
    )
    steps = [str(s).strip() for s in (data.get("steps") or []) if str(s).strip()]
    return steps[:3]


def build_graph():
    builder = StateGraph(BrainDumpState)
    builder.add_node("extract_tasks", extract_tasks)
    builder.add_node("classify_tasks", classify_tasks)
    builder.add_node("polish_tasks", polish_tasks)
    builder.add_node("annotate_delegate", annotate_delegate)
    builder.add_node("reality_check", reality_check_node)
    builder.add_edge(START, "extract_tasks")
    builder.add_edge("extract_tasks", "classify_tasks")
    builder.add_edge("classify_tasks", "polish_tasks")
    builder.add_edge("polish_tasks", "annotate_delegate")
    builder.add_edge("annotate_delegate", "reality_check")
    builder.add_edge("reality_check", END)
    return builder.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


def run_brain_dump(raw_text: str) -> BrainDumpState:
    graph = get_graph()
    initial: BrainDumpState = {
        "raw_text": raw_text.strip()[:MAX_RAW_CHARS],
        "task_candidates": [],
        "classified": [],
        "polished": [],
        "reality_check": None,
        "error": None,
    }
    result = graph.invoke(initial)
    return result  # type: ignore[return-value]
