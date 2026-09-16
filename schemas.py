"""TaskItem, State, API 요청/응답 스키마."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

from pydantic import BaseModel, Field

Quadrant = Literal[
    "important_urgent",
    "important_not_urgent",
    "not_important_urgent",
    "not_important_not_urgent",
]

DO_CAPACITY = 3  # Reality Check 기준: Do가 이 개수 이상이면 경고

QUADRANT_LABELS: dict[str, str] = {
    "important_urgent": "Do",
    "important_not_urgent": "Schedule",
    "not_important_urgent": "Delegate",
    "not_important_not_urgent": "Delete",
}

QUADRANT_COLORS: dict[str, str] = {
    "important_urgent": "green",
    "important_not_urgent": "orange",
    "not_important_urgent": "blue",
    "not_important_not_urgent": "red",
}

QUADRANT_META: dict[str, dict[str, str]] = {
    "important_urgent": {
        "label": "Do",
        "color": "green",
        "hint": "지금 당장 해야하는 중요한 일",
    },
    "important_not_urgent": {
        "label": "Schedule",
        "color": "orange",
        "hint": "장기 성공에 중요하지만 당장 할 필요는 없는 일",
    },
    "not_important_urgent": {
        "label": "Delegate",
        "color": "blue",
        "hint": "빨리 해야하지만 크게 중요하지 않은 일",
    },
    "not_important_not_urgent": {
        "label": "Delete",
        "color": "red",
        "hint": "방해되거나 불필요한 일",
    },
}

VALID_QUADRANTS = set(QUADRANT_LABELS)


class TaskItem(TypedDict):
    id: str
    title: str
    quadrant: Quadrant
    importance: bool
    urgency: bool
    reason: str
    reply_template: NotRequired[str | None]
    micro_steps: NotRequired[list[str]]


class RealityCheck(TypedDict):
    triggered: bool
    message: str
    keep_ids: list[str]
    move_ids: list[str]
    do_count: int
    keep_limit: int


class BrainDumpState(TypedDict):
    raw_text: str
    task_candidates: list[str]
    classified: list[TaskItem]
    polished: list[TaskItem]
    reality_check: NotRequired[RealityCheck | None]
    error: NotRequired[str | None]


class TodoRequest(BaseModel):
    raw_text: str = Field(..., min_length=1, max_length=2000)


class TaskItemModel(BaseModel):
    id: str
    title: str
    quadrant: Quadrant
    importance: bool
    urgency: bool
    reason: str
    reply_template: str | None = None
    micro_steps: list[str] = Field(default_factory=list)


class RealityCheckModel(BaseModel):
    triggered: bool
    message: str
    keep_ids: list[str]
    move_ids: list[str]
    do_count: int
    keep_limit: int = 2


class TodoSteps(BaseModel):
    task_candidates: list[str]
    classified: list[TaskItemModel]
    polished: list[TaskItemModel]


class TodoResponse(BaseModel):
    polished: list[TaskItemModel]
    steps: TodoSteps
    reality_check: RealityCheckModel | None = None
    error: str | None = None


class TranscribeResponse(BaseModel):
    text: str
    error: str | None = None


class BreakdownRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    reason: str = ""


class BreakdownResponse(BaseModel):
    steps: list[str]
    error: str | None = None
