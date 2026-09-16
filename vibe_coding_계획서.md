# 인생네칸 · 바이브코딩 과제 계획서 (현행)

**제품명:** 인생네칸  
**부제:** Speak it. Sort it. Do it.  
**대상:** 기존 학회원 (LangGraph 에이전트 노드 ≥ 2)  
**형태:** 로컬 FastAPI 웹 — 브라우저에서 사용 (터미널은 서버 기동만)  
**LLM / STT:** Groq만 (`vibe_todo/.env`, 수업용 OpenAI 키와 분리)  
**코드 위치:** `APPS_2026_2/vibe_todo/`  
**문서 성격:** 아래 = **현재 구현된 기능·에이전트 흐름의 단일 기준** (누적 부록 없음)

---

## 1. 한 줄 정의

사용자가 **뇌 덤프**(글 또는 녹음→텍스트)를 넣으면 LangGraph가  
**정리 → 분류 → 다듬기 → Delegate 답장 → Reality Check**를 거친 뒤,  
브라우저에서 **Do / Schedule / Delegate / Delete / 완료한 일**과 **Calendar**로 관리한다.  
새 덤프를 추가해도 **기존 목록은 유지**되고, 분면·날짜·완료는 **Matrix에서 사람이 바로 고친다**.

---

## 2. 배경 · 과제 충족

| 문제 | 인생네칸의 답 |
|---|---|
| 글을 잘 못 씀 | 완벽한 문장 없이 뇌 덤프·녹음만 |
| 우선순위가 안 보임 | Eisenhower → Do / Schedule / Delegate / Delete |
| 자동 분류와 개인 가치가 어긋남 | **드래그앤드롭**으로 블록 이동 |
| 날짜 휴리스틱이 틀릴 수 있음 | Matrix 카드의 **날짜 input**으로 직접 수정 |
| Do 과다·번아웃 | **Reality Check** (Do ≥ 3 → 2개만 남기고 나머지 Schedule 권고) |
| 큰 일 시작 막막 | Do **시작하기(2분 컷)** → Friction Breaker 3스텝 |
| 자잘한 부탁 부담 | Delegate **답장 템플릿** 1줄 |
| Delete·완료가 시야를 어지럽힘 | **더보기 / 접기**로 기본 숨김 |
| 다시 덤프하면 목록이 날아감 | TODO 만들기 = **기존 목록에 추가**(덮어쓰기 아님) |
| 끝난 일 정리 | 카드 오른쪽 **체크** → **완료한 일** 블록 |
| 기존 회원: 에이전트 ≥ 2 | **그래프 5노드** + **온디맨드 Friction** (총 6 Agent) |

**에이전트성:** 한 번의 챗이 아니라, **Role / Goal / Backstory / Task**가 고정된 노드가 순서대로 State를 갱신한다.

---

## 3. 실행 방법

```bash
# 저장소 루트
source .venv/bin/activate
pip install -r vibe_todo/requirements.txt
uvicorn vibe_todo.main:app --reload --host 127.0.0.1 --port 8000
```

브라우저: http://127.0.0.1:8000

### API 키

| 파일 | 변수 | 용도 |
|---|---|---|
| 루트 `.env` | `OPENAI_API_KEY` | Week0 등 **수업** (인생네칸 미사용) |
| `vibe_todo/.env` | `GROQ_API_KEY` | **이 과제 전용** |
| `vibe_todo/.env` | `GROQ_LLM_MODEL` | 기본 `openai/gpt-oss-20b` (계정별 확인) |
| `vibe_todo/.env` | `GROQ_STT_MODEL` | 기본 `whisper-large-v3` |

발급: https://console.groq.com → API Keys. 템플릿: `vibe_todo/.env.example`

---

## 4. 전체 동작 한눈에 (사람 ↔ AI)

```text
[브라우저 Matrix]
  뇌 덤프 입력 또는 녹음
       │
       ▼
  (선택) POST /api/transcribe  ← Groq Whisper (그래프 밖)
       │  텍스트를 textarea에 채움
       ▼
  TODO 만들기 → POST /api/todo
       │
       ▼
  ┌──────── LangGraph (5노드 순차) ────────┐
  │ 1 extract_tasks      정리              │
  │ 2 classify_tasks     분류 (4분면)      │
  │ 3 polish_tasks       title 다듬기      │
  │ 4 annotate_delegate  Delegate 답장     │
  │ 5 reality_check      Do 용량 권고      │
  └────────────────────────────────────────┘
       │
       ▼
  프론트: 새 카드를 **기존 tasks에 append**
       + inferDate()로 date 추정 (에이전트 아님)
       + localStorage 저장
       │
       ├─ Reality Check 패널 → 사람이 적용/유지
       ├─ 드래그로 블록 변경
       ├─ 날짜 input으로 일정 수정  ← Matrix에서 HITL 역할
       ├─ 체크 → 완료한 일
       ├─ Do: 시작하기(2분 컷) → POST /api/breakdown (Friction Agent)
       └─ Calendar 탭: 같은 목록을 날짜별로 확인
```

**날짜는 어느 Agent도 담당하지 않는다.**  
`static/app.js`의 `inferDate()`가 제목·이유·분면으로 추정하고, **Matrix 카드의 날짜 칸**에서 사람이 고친다. Calendar는 그 결과를 보여 주는 뷰다.

---

## 5. 사용자 흐름 (데모 순서)

1. 인생네칸 접속 → 뇌 덤프 입력 또는 **녹음** → 필요 시 문장 수정  
2. **TODO 만들기** → 그래프 실행 → 네 블록에 카드 **추가**(이전 카드 유지)  
3. Do가 많으면 **Reality Check** → 권장안 적용 또는 그대로 두기  
4. 카드 **⠿** 드래그로 블록 변경  
5. 카드 **날짜**를 Matrix에서 직접 수정 (Calendar에 반영)  
6. Do **시작하기(2분 컷)** → 마이크로 스텝 3개  
7. Delegate **답장 템플릿** 확인  
8. Delete · 완료한 일 → **더보기 / 접기**  
9. 카드 오른쪽 **체크** → **완료한 일**로 이동 (다시 체크하면 복귀)  
10. **Calendar** 탭 → 날짜별 미완료 할 일 확인  

---

## 6. 제품 UI (구현 기준)

### 6-1. 브랜드·레이아웃

- 타이틀 **인생네칸**, 부제 Speak it. Sort it. Do it.  
- Fraunces / Syne · 블록별 그라데이션  
- 하단 탭: **Matrix** | **Calendar**  
- **세로 스택:** Do → Schedule → Delegate → Delete → **완료한 일**  
  (2×2 축 그리드 없음)

### 6-2. 네 분면 (자동 분류 기준)

| quadrant 코드 | UI | 설명 |
|---|---|---|
| `important_urgent` | **Do** | 지금 당장 해야하는 중요한 일 |
| `important_not_urgent` | **Schedule** | 장기 성공에 중요하지만 당장 할 필요는 없는 일 |
| `not_important_urgent` | **Delegate** | 빨리 해야하지만 크게 중요하지 않은 일 |
| `not_important_not_urgent` | **Delete** | 방해되거나 불필요한 일 |

색 힌트(분류 Agent): 초록 Do · 주황 Schedule · 파랑 Delegate · 빨강 Delete

### 6-3. Matrix 탭 — 현재 기능 전부

| 기능 | 동작 |
|---|---|
| 뇌 덤프 | textarea, 최대 2000자 |
| 녹음 | MediaRecorder → `/api/transcribe` → textarea |
| TODO 만들기 | `/api/todo` → **기존 목록에 append** (덮어쓰기 아님) |
| 드래그앤드롭 | 카드 ⠿ → **블록 전체**에 drop → quadrant·flags 갱신 |
| 날짜 수정 | 카드 `date` input (Matrix에서 수정 = Calendar 반영) |
| 날짜 자동 추정 | `inferDate()`: 오늘/내일/모레/주말 키워드, 없으면 Do·Delegate=오늘, Schedule=+3일, Delete=빈 값 |
| Do · 2분 컷 | `/api/breakdown` → `micro_steps` 3개 |
| Delegate · 템플릿 | `reply_template` 카드 하단 |
| Delete · 더보기/접기 | 항목 있을 때만 버튼 · 기본 숨김 |
| 완료 체크 | 카드 오른쪽 체크 → **완료한 일** · ✓ 다시 누르면 원래 분면으로 |
| 완료한 일 · 더보기/접기 | Delete와 동일 UX · 체크 직후 펼침 |
| Reality Check | Do ≥ 3 시 패널 · 적용 시 일부 Do→Schedule |
| 저장 | `localStorage` 키 `insaengnekan.tasks.v1` |

### 6-4. Calendar 탭

- 월간 달력 · 미완료·날짜 있는 날에 dot  
- 선택한 날의 **미완료** 할 일 리스트 (블록 태그)  
- Matrix와 **동일 저장소** — 날짜 수정은 Matrix(또는 카드 date)에서

### 6-5. UI에 없는 것

- 단계별 State JSON 패널 (제거됨)  
- Calendar 전용 HITL / AI 재배치 API  
- 로그인 · DB · 파일 업로드 STT · 스트리밍 STT  

---

## 7. API (구현)

| Method | Path | 설명 |
|---|---|---|
| GET | `/` | 인생네칸 페이지 |
| POST | `/api/todo` | `{ raw_text }` → `polished`, `steps`, `reality_check`, `error` |
| POST | `/api/transcribe` | 오디오 → `{ text }` |
| POST | `/api/breakdown` | `{ title, reason? }` → `{ steps: string[3] }` |

---

## 8. LangGraph · Agent 전체 흐름

### 8-1. 파이프라인 (이해하기)

```text
입력: raw_text 만 (STT는 그래프 밖)

START
  │
  ▼
① extract_tasks        「정리」
  입력: raw_text
  출력: task_candidates[]     ← 행동 단위 후보만. 분면·날짜 없음
  │
  ▼
② classify_tasks       「분류」
  입력: task_candidates (+ raw_text 맥락)
  출력: classified[]          ← quadrant, importance, urgency, reason
  │
  ▼
③ polish_tasks         「다듬기」
  입력: classified
  출력: polished[]            ← title만 짧은 동사구로. 개수·분면 불변
  │
  ▼
④ annotate_delegate    「Delegate 답장」
  입력: polished 중 Delegate만
  출력: polished[]            ← reply_template 채움
  │
  ▼
⑤ reality_check        「현실 직시」
  입력: polished의 Do 목록
  출력: reality_check         ← polished는 안 바꿈. 권고만
  │
  ▼
END → 프론트가 polished를 화면에 추가

[버튼 전용 · 그래프 밖]
  Do 카드 「시작하기(2분 컷)」
    → POST /api/breakdown
    → breakdown_friction 「Friction Breaker」
    → steps[3] → 해당 카드 micro_steps
```

### 8-2. State

```text
BrainDumpState
├── raw_text
├── task_candidates      # ①
├── classified           # ②
├── polished             # ③④
├── reality_check        # ⑤
└── error
```

### 8-3. TaskItem

**서버(그래프):** `id`, `title`, `reason`, `quadrant`, `importance`, `urgency`, `reply_template`, `micro_steps`  
**클라이언트 추가:** `date`, `createdAt`, `done`, `completedAt` (+ 드래그 시 reason에 이동 흔적)

### 8-4. RealityCheck

- 트리거: Do 개수 ≥ `DO_CAPACITY`(3)  
- 출력: `message`, `keep_ids`(권장 2), `move_ids`, `do_count`  
- UI에서 **권장안 적용** 클릭 시에만 Schedule로 이관 (완료(`done`) 항목은 제외)

### 8-5. 안정성

- Groq 호출 최대 3회 재시도  
- extract JSON 실패 시 로컬 문장 분할 폴백  
- 한국어 오류 메시지 (연결 / 한도 / 키 / JSON)

---

## 9. Agent별 Role / Goal / Backstory / Task

공통: Role·Goal·Backstory → 시스템 프롬프트 · Task → 유저 프롬프트 (`prompts.py`)

### 9-1. `extract_tasks` — 정리 Agent

| | |
|---|---|
| **Role** | 뇌 덤프를 **행동 단위**로 쪼개는 생산성 코치 (우선순위 판단 아님) |
| **Goal** | Produce — `task_candidates` 목록 |
| **Backstory** | 잡담·끝난 일 제거, 중복 합침, 기한 힌트 보존, 중요/긴급 **부여 금지** |
| **Task** | `raw_text` → `{ "task_candidates": [...] }` |
| **State** | `raw_text` → `task_candidates` |
| **하지 않음** | 분류, 미화, 일정 |

### 9-2. `classify_tasks` — 분류 Agent

| | |
|---|---|
| **Role** | 아이젠하워 중요×긴급 분석가 |
| **Goal** | Deliver — 후보마다 quadrant + reason |
| **Backstory** | 마감→긴급, 성과·관계→중요, 자잘→Delegate, “하면 기분만”→Delete, 애매하면 Schedule |
| **Task** | `{ "classified": [ TaskItem, ... ] }` |
| **State** | `task_candidates` → `classified` |
| **하지 않음** | 후보 추가/삭제, title 전면 재작성 |

### 9-3. `polish_tasks` — 다듬기 Agent

| | |
|---|---|
| **Role** | 실행 문장 에디터 |
| **Goal** | Optimize — `title`만 짧은 동사구 |
| **Backstory** | “~하기” 한 행동, id·분면·reason·개수 불변 |
| **Task** | `{ "polished": [ TaskItem ] }` (title만 변경) |
| **State** | `classified` → `polished` |

### 9-4. `annotate_delegate` — Delegate 답장 Agent

| | |
|---|---|
| **Role** | 정중한 미루기·거절 메시지 카피 |
| **Goal** | Deliver — Delegate마다 `reply_template` 1줄 |
| **Backstory** | 관계 유지 + 시간 방어, 한 문장 구어체 |
| **Task** | `{ "templates": [{ "id", "reply_template" }] }` → polished 병합 |
| **State** | `polished` (Delegate만 보강) |
| **UI** | Delegate 카드 “답장 템플릿” |

### 9-5. `reality_check` — Reality Check Agent

| | |
|---|---|
| **Role** | 하루 Do 용량 코치 |
| **Goal** | Optimize — Do 과다 시 keep 2 / move 권고 |
| **Backstory** | 하루 Do 2개 권장, 3개 이상 경고, 비난 없이 |
| **Task** | Do 목록 → `{ message, keep_ids, move_ids }` |
| **State** | `polished` → `reality_check` (**목록은 자동 변경 안 함**) |
| **UI** | 패널 → 사람 승인 후 Schedule 이관 |

### 9-6. `breakdown_friction` — Friction Breaker (온디맨드)

| | |
|---|---|
| **Role** | 2분 컷 마찰 제거 코치 |
| **Goal** | Produce — 시작용 마이크로 스텝 3개 |
| **Backstory** | PPT 제목만 쓰기 수준, 완성·제출 단계 금지 |
| **호출** | Do **시작하기(2분 컷)** → `/api/breakdown` |
| **그래프** | 노드로 묶지 않음 |

### 9-7. Agent 한눈에

| 순서 | Agent | Goal | 출력 |
|---|---|---|---|
| ① | 정리 | Produce | `task_candidates` |
| ② | 분류 | Deliver | `classified` |
| ③ | 다듬기 | Optimize | `polished` (title) |
| ④ | Delegate 답장 | Deliver | `reply_template` |
| ⑤ | Reality Check | Optimize | `reality_check` |
| (버튼) | Friction | Produce | `steps[3]` |

| 담당 아님 (프론트) | 위치 |
|---|---|
| 날짜 추정·수정 | `app.js` `inferDate` + Matrix date input |
| 목록 누적·완료·DnD | `app.js` + `localStorage` |
| STT | `stt.py` / `/api/transcribe` |

---

## 10. 기술 스택 · 파일

```text
vibe_todo/
├── .env / .env.example
├── README.md
├── vibe_coding_계획서.md     ← 본 문서
├── requirements.txt
├── main.py                   FastAPI
├── graph.py                  5노드 + breakdown_friction
├── prompts.py
├── schemas.py                DO_CAPACITY=3 등
├── stt.py
└── static/
    ├── index.html
    ├── app.js                누적·DnD·완료·날짜·Calendar
    └── style.css
```

---

## 11. 발표에서 말할 것

1. **문제:** 글 못 써도 뇌 덤프·녹음으로 할 일 추출  
2. **Agentic:** 5노드 순차 State + Friction 온디맨드, Role/Goal/Backstory/Task  
3. **사람 개입:** Reality Check 승인 · 드래그 재분류 · **Matrix에서 날짜 수정** · 완료 체크  
4. **목록:** 덤프를 여러 번 해도 **누적 TODO**  
5. **스택:** FastAPI 로컬, Groq, LangGraph  
6. **미구현(의도적):** Calendar용 AI 재배치 API, 서버 DB, Week3급 HITL 루프  

---

## 12. 의도적 제외

OpenAI API · DB/로그인 · 모바일 앱 · STT 파일 업로드 · 스트리밍 STT · 병렬/조건 분기 그래프 · Calendar HITL API · 터미널 CLI 앱

---

## 13. 완료 기준 체크 (현행 코드 대조)

### Agent / 백엔드
- [x] LangGraph **5노드** 순차 (extract → classify → polish → annotate_delegate → reality_check)
- [x] Friction **온디맨드** `/api/breakdown`
- [x] Role / Goal / Backstory / Task (`prompts.py`)
- [x] Groq LLM + Whisper (`vibe_todo/.env`, 수업 OpenAI와 분리)
- [x] 재시도 · extract 폴백 · 한국어 오류 메시지

### Matrix UI
- [x] 세로 블록 Do / Schedule / Delegate / Delete / **완료한 일**
- [x] 녹음 → STT → textarea
- [x] TODO 만들기 = **기존 목록에 추가**
- [x] 드래그앤드롭 재분류 (빈 Delegate 포함 블록 드롭)
- [x] Delete · 완료한 일 **더보기/접기**
- [x] 카드 오른쪽 **완료 체크** ↔ 복귀
- [x] Do 2분 컷 · Delegate 답장 템플릿 · Reality Check
- [x] **Matrix에서 날짜 수정** (Calendar 연동)
- [x] `inferDate` 휴리스틱 (Agent 아님)

### Calendar / 저장
- [x] 월 달력 + 일별 리스트 (미완료 기준)
- [x] `localStorage` (`insaengnekan.tasks.v1`)

### 문서
- [x] 본 계획서 = 위 기능·Agent 흐름의 현행 단일 기준
