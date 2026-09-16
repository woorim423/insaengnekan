# 인생네칸 — Speak it. Sort it. Do it.

개인 바이브코딩 과제. 뇌 덤프(텍스트/녹음) → LangGraph → Do/Schedule/Delegate/Delete.  
로컬 FastAPI 웹. **OpenAI 없이 Groq만** 사용합니다.

수업 자료 루트 `.env`(OPENAI)와 분리. 키는 **`vibe_todo/.env`**만 씁니다.

## 실행

```bash
# 저장소 루트에서
source .venv/bin/activate
pip install -r vibe_todo/requirements.txt
uvicorn vibe_todo.main:app --reload --host 127.0.0.1 --port 8000
```

브라우저: http://127.0.0.1:8000

### 같은 Wi‑Fi의 다른 PC / 모바일

`127.0.0.1`은 **이 컴퓨터에서만** 열립니다. 다른 기기에서 보려면:

```bash
uvicorn vibe_todo.main:app --reload --host 0.0.0.0 --port 8000
```

맥에서 IP 확인: `ipconfig getifaddr en0` (예: `192.168.0.12`)  
다른 PC·폰 브라우저: `http://192.168.0.12:8000`  
(방화벽에서 8000 허용 필요할 수 있음. 녹음은 HTTP+사설IP에서 막힐 수 있음.)

## API 키

1. https://console.groq.com 에서 API Key 발급  
2. `vibe_todo/.env`의 `GROQ_API_KEY=`에 붙여 넣기  

## 주요 기능

- Matrix / Calendar 탭
- Delegate 답장 템플릿 · Delete 더보기 · Do 시작하기(2분 컷)
- Reality Check (Do ≥ 3 → Schedule 이관 권고)
- 녹음 → STT → 입력칸

## 구성

| 파일 | 역할 |
|---|---|
| `graph.py` | extract → classify → polish → annotate_delegate → reality_check |
| `stt.py` | 녹음 → Groq Whisper → text |
| `main.py` | `/api/todo`, `/api/transcribe`, `/api/breakdown` |
| `static/` | 인생네칸 UI |
| `vibe_coding_계획서.md` | 설계 (§16 누적 기능) |
