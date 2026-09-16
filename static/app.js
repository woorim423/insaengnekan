const STORAGE_KEY = "insaengnekan.tasks.v1";
const LEGACY_STORAGE_KEY = "dump2do.tasks.v1";

const rawTextEl = document.getElementById("raw-text");
const recordBtn = document.getElementById("record-btn");
const todoBtn = document.getElementById("todo-btn");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const realityPanel = document.getElementById("reality-panel");
const realityMessage = document.getElementById("reality-message");
const deleteToggleBtn = document.getElementById("delete-toggle");
const doneToggleBtn = document.getElementById("done-toggle");
const calGrid = document.getElementById("cal-grid");
const calTitle = document.getElementById("cal-title");
const dayTitle = document.getElementById("day-title");
const dayCount = document.getElementById("day-count");
const dayList = document.getElementById("day-list");
const dayEmpty = document.getElementById("day-empty");

const QUADRANT_CLASS = {
  important_urgent: "q-do",
  important_not_urgent: "q-schedule",
  not_important_urgent: "q-delegate",
  not_important_not_urgent: "q-delete",
};

const QUADRANT_LABEL = {
  important_urgent: "Do",
  important_not_urgent: "Schedule",
  not_important_urgent: "Delegate",
  not_important_not_urgent: "Delete",
};

/** 중요도 순 (낮을수록 먼저) */
const QUADRANT_ORDER = {
  important_urgent: 0,
  important_not_urgent: 1,
  not_important_urgent: 2,
  not_important_not_urgent: 3,
};

const QUADRANTS = Object.keys(QUADRANT_CLASS);

let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let recording = false;
let tasks = loadTasks().map((t) => ({
  ...t,
  done: Boolean(t.done),
}));
let pendingReality = null;
let deleteSectionOpen = false;
let doneSectionOpen = false;
let viewYear;
let viewMonth;
let selectedDate;

const today = startOfDay(new Date());
viewYear = today.getFullYear();
viewMonth = today.getMonth();
selectedDate = formatDate(today);

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function loadTasks() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function quadrantFlags(quadrant) {
  switch (quadrant) {
    case "important_urgent":
      return { importance: true, urgency: true };
    case "important_not_urgent":
      return { importance: true, urgency: false };
    case "not_important_urgent":
      return { importance: false, urgency: true };
    default:
      return { importance: false, urgency: false };
  }
}

function inferDate(text, quadrant) {
  const source = `${text || ""}`;
  const base = startOfDay(new Date());

  if (/오늘|tonight|today/i.test(source)) return formatDate(base);
  if (/모레/.test(source)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }
  if (/내일|tomorrow/i.test(source)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (/이번\s*주말|주말/.test(source)) {
    const d = new Date(base);
    const day = d.getDay();
    const add = day === 6 ? 0 : (6 - day + 7) % 7 || 6;
    d.setDate(d.getDate() + add);
    return formatDate(d);
  }

  if (quadrant === "important_urgent" || quadrant === "not_important_urgent") {
    return formatDate(base);
  }
  if (quadrant === "important_not_urgent") {
    const d = new Date(base);
    d.setDate(d.getDate() + 3);
    return formatDate(d);
  }
  return "";
}

/** 제목·이유에서 간단 시각 추정 (HH:MM). 없으면 "" */
function inferTime(text) {
  const source = `${text || ""}`;
  const hm = source.match(/\b([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\b/);
  if (hm) {
    return `${String(hm[1]).padStart(2, "0")}:${hm[2]}`;
  }
  const ampm = source.match(/(오전|오후|am|pm)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/i);
  if (ampm) {
    let h = Number(ampm[2]);
    const m = ampm[3] != null ? Number(ampm[3]) : 0;
    const isPm = /오후|pm/i.test(ampm[1]);
    if (isPm && h < 12) h += 12;
    if (!isPm && /오전|am/i.test(ampm[1]) && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  const kor = source.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (kor) {
    const h = Number(kor[1]);
    const m = kor[2] != null ? Number(kor[2]) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return "";
}

function compareDayTasks(a, b) {
  const aTime = a.time || "";
  const bTime = b.time || "";
  const aHas = Boolean(aTime);
  const bHas = Boolean(bTime);
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas && aTime !== bTime) return aTime.localeCompare(bTime);
  const aq = QUADRANT_ORDER[a.quadrant] ?? 9;
  const bq = QUADRANT_ORDER[b.quadrant] ?? 9;
  if (aq !== bq) return aq - bq;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function clearBoard() {
  QUADRANTS.forEach((q) => {
    const list = boardEl.querySelector(`[data-q="${q}"] .cards`);
    if (list) list.innerHTML = "";
  });
  const doneList = boardEl.querySelector(".done-cards");
  if (doneList) doneList.innerHTML = "";
}

function updateCollapsibleSection({
  count,
  toggleBtn,
  cards,
  block,
  isOpen,
  setOpen,
  openLabel = "접기",
  closedLabel = "더보기",
}) {
  if (!toggleBtn) return isOpen;

  if (count === 0) {
    toggleBtn.hidden = true;
    setOpen(false);
    if (cards) {
      cards.hidden = true;
      cards.setAttribute("aria-hidden", "true");
    }
    block?.classList.remove("is-expanded");
    return false;
  }

  toggleBtn.hidden = false;
  toggleBtn.textContent = isOpen ? openLabel : closedLabel;
  toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (cards) {
    cards.hidden = !isOpen;
    cards.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }
  block?.classList.toggle("is-expanded", isOpen);
  return isOpen;
}

function updateDeleteSection() {
  const deleteCount = tasks.filter(
    (t) => t.quadrant === "not_important_not_urgent" && !t.done
  ).length;
  deleteSectionOpen = updateCollapsibleSection({
    count: deleteCount,
    toggleBtn: deleteToggleBtn,
    cards: boardEl.querySelector(".delete-cards"),
    block: boardEl.querySelector('[data-q="not_important_not_urgent"]'),
    isOpen: deleteSectionOpen,
    setOpen: (v) => {
      deleteSectionOpen = v;
    },
  });
}

function updateDoneSection() {
  const doneCount = tasks.filter((t) => t.done).length;
  doneSectionOpen = updateCollapsibleSection({
    count: doneCount,
    toggleBtn: doneToggleBtn,
    cards: boardEl.querySelector(".done-cards"),
    block: boardEl.querySelector('[data-section="done"]'),
    isOpen: doneSectionOpen,
    setOpen: (v) => {
      doneSectionOpen = v;
    },
    openLabel: "Less",
    closedLabel: "More",
  });
}

function setTaskDone(taskId, done) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || Boolean(task.done) === done) return;
  task.done = done;
  task.completedAt = done ? Date.now() : null;
  saveTasks();
  if (done) doneSectionOpen = true;
  renderBoard();
  renderCalendar();
  renderDayList();
  setStatus(done ? "Moved to Done." : "Restored to your list.");
}

function moveTaskToQuadrant(taskId, newQuadrant) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.done || task.quadrant === newQuadrant) return;

  const flags = quadrantFlags(newQuadrant);
  task.quadrant = newQuadrant;
  task.importance = flags.importance;
  task.urgency = flags.urgency;

  const tag = `(드래그로 ${QUADRANT_LABEL[newQuadrant]} 이동)`;
  if (!(task.reason || "").includes(tag)) {
    task.reason = `${task.reason || ""} ${tag}`.trim();
  }

  if (newQuadrant !== "not_important_urgent") {
    task.reply_template = null;
  } else if (!task.reply_template) {
    task.reply_template = `지금은 일정이 있어 '${task.title}'은(는) 조금 뒤에 해도 될까요?`;
  }

  if (newQuadrant !== "important_urgent") {
    task.micro_steps = [];
  }

  saveTasks();
  renderBoard();
  renderCalendar();
  renderDayList();
  setStatus(`${QUADRANT_LABEL[newQuadrant]}(으)로 옮겼습니다.`);
}

function setupDragAndDrop() {
  boardEl.addEventListener("dragstart", (event) => {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;
    const li = handle.closest("li[data-task-id]");
    if (!li) return;
    li.classList.add("is-dragging");
    event.dataTransfer.setData("text/plain", li.dataset.taskId);
    event.dataTransfer.effectAllowed = "move";
  });

  boardEl.addEventListener("dragend", (event) => {
    const li = event.target.closest("li[data-task-id]");
    if (li) li.classList.remove("is-dragging");
    boardEl
      .querySelectorAll(".drop-zone.is-over, .block.drop-target.is-over")
      .forEach((el) => el.classList.remove("is-over"));
  });

  function dropBlockFromEvent(event) {
    return event.target.closest(".block[data-q]");
  }

  boardEl.addEventListener("dragover", (event) => {
    const block = dropBlockFromEvent(event);
    if (!block) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    block.classList.add("drop-target", "is-over");
    const list = block.querySelector(".cards.drop-zone");
    if (list) list.classList.add("is-over");
  });

  boardEl.addEventListener("dragleave", (event) => {
    const block = dropBlockFromEvent(event);
    if (!block) return;
    const related = event.relatedTarget;
    if (related && block.contains(related)) return;
    block.classList.remove("is-over");
    block.querySelector(".cards.drop-zone")?.classList.remove("is-over");
  });

  boardEl.addEventListener("drop", (event) => {
    const block = dropBlockFromEvent(event);
    if (!block) return;
    event.preventDefault();
    block.classList.remove("is-over");
    block.querySelector(".cards.drop-zone")?.classList.remove("is-over");
    const newQuadrant = block.dataset.q;
    const taskId = event.dataTransfer.getData("text/plain");
    if (newQuadrant && taskId) {
      moveTaskToQuadrant(taskId, newQuadrant);
    }
  });
}

async function requestBreakdown(item, button, padEl, listEl, toggleBtn) {
  button.disabled = true;
  button.textContent = "만드는 중…";
  try {
    const res = await fetch("/api/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title, reason: item.reason || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(
        Array.isArray(detail)
          ? detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
          : detail || "마이크로 스텝 생성 실패"
      );
    }
    item.micro_steps = data.steps || [];
    item.micro_open = true;
    saveTasks();
    listEl.innerHTML = "";
    item.micro_steps.forEach((step) => {
      const stepLi = document.createElement("li");
      stepLi.textContent = step;
      listEl.appendChild(stepLi);
    });
    padEl.hidden = false;
    padEl.classList.remove("is-collapsed");
    if (toggleBtn) {
      toggleBtn.textContent = "접기";
      toggleBtn.setAttribute("aria-expanded", "true");
    }
    button.textContent = "다시 만들기";
  } catch (err) {
    setStatus(err.message || String(err), true);
    button.textContent = item.micro_steps?.length
      ? "다시 만들기"
      : "시작하기(2분 컷)";
  } finally {
    button.disabled = false;
  }
}

function syncMicroPad(item, padEl, toggleBtn) {
  const open = item.micro_open !== false;
  padEl.classList.toggle("is-collapsed", !open);
  toggleBtn.textContent = open ? "접기" : "펼치기";
  toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderBoard() {
  clearBoard();

  tasks.forEach((item) => {
    const list = item.done
      ? boardEl.querySelector(".done-cards")
      : boardEl.querySelector(`[data-q="${item.quadrant}"] .cards`);
    if (!list) return;

    const li = document.createElement("li");
    li.dataset.taskId = item.id;
    if (item.done) li.classList.add("is-done");
    li.innerHTML = `
      <span class="drag-handle" draggable="true" title="드래그해서 이동">⠿</span>
      <div class="card-body">
        <p class="card-title"></p>
        <p class="card-reason"></p>
        <div class="card-actions"></div>
        <div class="micro-pad" hidden>
          <div class="micro-pad-head">
            <span class="micro-pad-label">2-min notepad</span>
            <button type="button" class="micro-toggle">접기</button>
          </div>
          <ol class="micro-steps"></ol>
        </div>
        <div class="card-template" hidden>
          <strong>답장 템플릿</strong>
          <span class="template-text"></span>
        </div>
        <div class="card-meta">
          <label class="card-date">날짜
            <input type="date" class="input-date" />
          </label>
          <label class="card-date">시간
            <input type="time" class="input-time" />
          </label>
        </div>
      </div>
      <button type="button" class="check-btn" title="${
        item.done ? "Restore" : "Mark done"
      }" aria-label="${item.done ? "Restore task" : "Mark as done"}"></button>
    `;

    li.querySelector(".card-title").textContent = item.title;
    const reasonEl = li.querySelector(".card-reason");
    if (item.done) {
      const from = QUADRANT_LABEL[item.quadrant] || "";
      reasonEl.textContent = from
        ? `${item.reason || ""} · from ${from}`.trim()
        : item.reason || "";
    } else {
      reasonEl.textContent = item.reason || "";
    }

    const checkBtn = li.querySelector(".check-btn");
    checkBtn.textContent = item.done ? "✓" : "";
    checkBtn.classList.toggle("is-checked", Boolean(item.done));
    checkBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setTaskDone(item.id, !item.done);
    });

    if (item.done) {
      const handle = li.querySelector(".drag-handle");
      handle.removeAttribute("draggable");
      handle.style.visibility = "hidden";
    }

    const actions = li.querySelector(".card-actions");
    const microPad = li.querySelector(".micro-pad");
    const microList = li.querySelector(".micro-steps");
    const microToggle = li.querySelector(".micro-toggle");

    if (!item.done && item.quadrant === "important_urgent") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-btn";
      btn.textContent = item.micro_steps?.length
        ? "다시 만들기"
        : "시작하기(2분 컷)";
      btn.addEventListener("click", () =>
        requestBreakdown(item, btn, microPad, microList, microToggle)
      );
      actions.appendChild(btn);

      if (item.micro_steps?.length) {
        item.micro_steps.forEach((step) => {
          const stepLi = document.createElement("li");
          stepLi.textContent = step;
          microList.appendChild(stepLi);
        });
        microPad.hidden = false;
        if (item.micro_open === undefined) item.micro_open = true;
        syncMicroPad(item, microPad, microToggle);
      }

      microToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!item.micro_steps?.length) return;
        item.micro_open = item.micro_open === false ? true : false;
        saveTasks();
        syncMicroPad(item, microPad, microToggle);
      });
    }

    if (
      !item.done &&
      item.quadrant === "not_important_urgent" &&
      item.reply_template
    ) {
      const box = li.querySelector(".card-template");
      box.hidden = false;
      box.querySelector(".template-text").textContent = item.reply_template;
    }

    const dateInput = li.querySelector(".input-date");
    dateInput.value = item.date || "";
    dateInput.addEventListener("change", () => {
      item.date = dateInput.value;
      saveTasks();
      renderCalendar();
      renderDayList();
    });

    const timeInput = li.querySelector(".input-time");
    timeInput.value = item.time || "";
    timeInput.addEventListener("change", () => {
      item.time = timeInput.value || "";
      saveTasks();
      renderCalendar();
      renderDayList();
    });

    list.appendChild(li);
  });

  boardEl.hidden = tasks.length === 0;
  updateDeleteSection();
  updateDoneSection();
}

function showReality(check) {
  pendingReality = check;
  if (!check?.triggered) {
    realityPanel.hidden = true;
    return;
  }
  realityMessage.textContent = check.message;
  realityPanel.hidden = false;
}

function applyReality() {
  if (!pendingReality?.triggered) return;
  const move = new Set(pendingReality.move_ids || []);
  tasks = tasks.map((task) => {
    if (task.done || !move.has(task.id)) return task;
    return {
      ...task,
      quadrant: "important_not_urgent",
      importance: true,
      urgency: false,
      reason: `${task.reason || ""} (Reality Check로 Schedule 이관)`.trim(),
      micro_steps: [],
      date:
        task.date ||
        (() => {
          const d = startOfDay(new Date());
          d.setDate(d.getDate() + 3);
          return formatDate(d);
        })(),
    };
  });
  saveTasks();
  pendingReality = null;
  realityPanel.hidden = true;
  renderBoard();
  renderCalendar();
  renderDayList();
  setStatus("권장안을 적용했습니다. 일부 Do가 Schedule로 옮겨졌습니다.");
}

function dismissReality() {
  pendingReality = null;
  realityPanel.hidden = true;
  setStatus("Do 목록을 그대로 유지합니다.");
}

function renderCalendar() {
  const first = new Date(viewYear, viewMonth, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  calTitle.textContent = first.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const dated = {};
  tasks.forEach((t) => {
    if (!t.date || t.done) return;
    const rank = QUADRANT_ORDER[t.quadrant] ?? 9;
    if (dated[t.date] == null || rank < dated[t.date]) {
      dated[t.date] = rank;
    }
  });
  calGrid.innerHTML = "";

  const prevDays = new Date(viewYear, viewMonth, 0).getDate();
  for (let i = startPad - 1; i >= 0; i -= 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell muted";
    cell.textContent = String(prevDays - i);
    cell.disabled = true;
    calGrid.appendChild(cell);
  }

  const DOT_CLASS = ["dot-do", "dot-schedule", "dot-delegate", "dot-delete"];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateObj = new Date(viewYear, viewMonth, day);
    const key = formatDate(dateObj);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell";
    cell.textContent = String(day);
    if (key === formatDate(today)) cell.classList.add("is-today");
    if (key === selectedDate) cell.classList.add("is-selected");
    if (dated[key] != null) {
      const dot = document.createElement("span");
      dot.className = `cal-dot ${DOT_CLASS[dated[key]] || "dot-schedule"}`;
      cell.appendChild(dot);
    }
    cell.addEventListener("click", () => {
      selectedDate = key;
      renderCalendar();
      renderDayList();
    });
    calGrid.appendChild(cell);
  }
}

function renderDayList() {
  const dateObj = parseDateKey(selectedDate);
  dayTitle.textContent = dateObj.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const items = tasks
    .filter((t) => t.date === selectedDate && !t.done)
    .slice()
    .sort(compareDayTasks);
  dayCount.textContent = String(items.length);
  dayList.innerHTML = "";
  dayEmpty.hidden = items.length > 0;

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = QUADRANT_CLASS[item.quadrant] || "q-schedule";
    li.innerHTML = `
      <div class="day-top">
        <span class="tag"></span>
        <span class="time"></span>
      </div>
      <span class="title"></span>
      <span class="reason"></span>
    `;
    li.querySelector(".tag").textContent = QUADRANT_LABEL[item.quadrant] || "";
    li.querySelector(".time").textContent = item.time || "";
    li.querySelector(".title").textContent = item.title;
    li.querySelector(".reason").textContent = item.reason || "";
    dayList.appendChild(li);
  });
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("is-active", el.id === `view-${name}`);
  });
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  if (name === "calendar") {
    renderCalendar();
    renderDayList();
  }
}

async function createTodo() {
  const rawText = rawTextEl.value.trim();
  if (!rawText) {
    setStatus("텍스트를 입력하거나 녹음해 주세요.", true);
    return;
  }

  todoBtn.disabled = true;
  recordBtn.disabled = true;
  setStatus("에이전트 실행 중… (정리 → 분류 → 다듬기 → Delegate/Reality)");

  try {
    const res = await fetch("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
        : detail || "TODO 생성에 실패했습니다.";
      throw new Error(message);
    }

    deleteSectionOpen = false;
    const stamped = Date.now();
    const polished = data.polished || [];
    const idMap = {};
    const newTasks = polished.map((item, index) => {
      const oldId = item.id || `t${index + 1}`;
      const newId = `t${stamped}_${index + 1}`;
      idMap[oldId] = newId;
      return {
        ...item,
        id: newId,
        done: false,
        completedAt: null,
        reply_template: item.reply_template || null,
        micro_steps: item.micro_steps || [],
        date: inferDate(`${item.title} ${item.reason}`, item.quadrant),
        time: inferTime(`${item.title} ${item.reason}`),
        createdAt: stamped,
      };
    });

    tasks = [...tasks, ...newTasks];
    saveTasks();
    renderBoard();

    const reality = data.reality_check
      ? {
          ...data.reality_check,
          keep_ids: (data.reality_check.keep_ids || []).map(
            (id) => idMap[id] || id
          ),
          move_ids: (data.reality_check.move_ids || []).map(
            (id) => idMap[id] || id
          ),
        }
      : null;
    showReality(reality);
    renderCalendar();
    renderDayList();

    const activeCount = tasks.filter((t) => !t.done).length;
    if (data.error) {
      setStatus(`완료 (경고: ${data.error}) · 목록 ${activeCount}개`);
    } else if (reality?.triggered) {
      setStatus(
        `추가됨 ${newTasks.length}개 · 목록 ${activeCount}개 · Reality Check 확인`
      );
    } else {
      setStatus(`추가됨 ${newTasks.length}개 · 전체 ${activeCount}개`);
    }
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    todoBtn.disabled = false;
    recordBtn.disabled = false;
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("이 브라우저는 마이크 녹음을 지원하지 않습니다.", true);
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : undefined;
    mediaRecorder = mime
      ? new MediaRecorder(mediaStream, { mimeType: mime })
      : new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.onstop = onRecordingStop;

    mediaRecorder.start();
    recording = true;
    recordBtn.textContent = "중지";
    recordBtn.classList.add("recording");
    setStatus("녹음 중… 다시 누르면 종료합니다.");
  } catch (err) {
    setStatus("마이크 권한이 필요합니다. 브라우저에서 허용해 주세요.", true);
  }
}

async function onRecordingStop() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
  chunks = [];
  if (!blob.size) {
    setStatus("녹음 데이터가 비어 있습니다.", true);
    return;
  }

  setStatus("음성 인식 중…");
  todoBtn.disabled = true;
  recordBtn.disabled = true;

  try {
    const form = new FormData();
    form.append("file", blob, "recording.webm");
    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
        : detail || "음성 인식에 실패했습니다.";
      throw new Error(message);
    }
    const text = (data.text || "").trim();
    if (!text) throw new Error("음성이 인식되지 않았습니다.");
    rawTextEl.value = rawTextEl.value.trim()
      ? `${rawTextEl.value.trim()}\n${text}`
      : text;
    setStatus("녹음 내용을 입력칸에 넣었습니다. 고친 뒤 TODO 만들기를 누르세요.");
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    todoBtn.disabled = false;
    recordBtn.disabled = false;
  }
}

function stopRecording() {
  recording = false;
  recordBtn.textContent = "녹음";
  recordBtn.classList.remove("recording");
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording();
  else startRecording();
});

todoBtn.addEventListener("click", createTodo);
document.getElementById("reality-apply").addEventListener("click", applyReality);
document.getElementById("reality-keep").addEventListener("click", dismissReality);

deleteToggleBtn.addEventListener("click", () => {
  deleteSectionOpen = !deleteSectionOpen;
  updateDeleteSection();
});

doneToggleBtn.addEventListener("click", () => {
  doneSectionOpen = !doneSectionOpen;
  updateDoneSection();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("cal-prev").addEventListener("click", () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  renderCalendar();
});

document.getElementById("cal-next").addEventListener("click", () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  renderCalendar();
});

setupDragAndDrop();

if (tasks.length) {
  renderBoard();
}
renderCalendar();
renderDayList();
