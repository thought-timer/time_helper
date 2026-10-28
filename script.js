/* =========================================================
   생각 기록 타이머 - script.js

   [코드 구조]
   1. 상수 / 저장소(localStorage) 도우미
   2. 상태(state) 불러오기
   3. 타이머 로직      ← 공부 공간
   4. 생각 메모        ← 생각 보관 공간
   5. 카테고리 관리
   6. 공부 기록
   7. 화면 그리기(render)
   8. 이벤트 연결 & 시작
   9. 앞으로 만들 기능 (TODO)
   ========================================================= */


/* ---------- 1. 상수 / 저장소 도우미 ---------- */

// localStorage에 저장할 때 쓰는 이름(key)
const KEYS = {
  timer: 'ttt.timer',
  memos: 'ttt.memos',
  categories: 'ttt.categories',
  records: 'ttt.records',
  pomodoro: 'ttt.pomodoro',
};

// 뽀모도로 기본 시간(분) — 사용자가 화면에서 바꾸면 localStorage에 저장됨
const DEFAULT_POMODORO = { focus: 25, break: 5 };
const POMO_LIMIT = { focus: [1, 120], break: [1, 60] }; // 입력할 수 있는 범위(분)

const DEFAULT_CATEGORIES = ['할 일', '아이디어', '궁금한 것', '기타'];

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // 저장된 값이 깨졌으면 기본값 사용
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// 메모 · 기록마다 붙이는 고유 번호
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}


/* ---------- 2. 상태(state) ---------- */

// 타이머 상태의 기본 모양
function defaultTimer() {
  return {
    active: false,     // 공부 세션 진행 중인지 (시작 ~ 종료 사이). true면 보관함 잠김
    running: false,    // 지금 시간이 흐르고 있는지 (일시정지면 false)
    mode: 'normal',    // 'normal' | 'pomodoro'
    phase: 'focus',    // 뽀모도로 구간: 'focus' | 'break'
    phaseStart: null,  // 현재 구간을 (다시) 시작한 시각 (Date.now())
    phaseElapsed: 0,   // 일시정지 전까지 쌓인 시간(ms)
    studiedMs: 0,      // 뽀모도로에서 끝난 집중 구간들의 합
    sessionStart: null,// 이번 공부를 처음 시작한 시각
    goal: '',          // 공부 목표
    resumeId: null,    // 기록을 눌러 이어서 하는 중이면 그 기록의 id
    resumeBase: 0,     // 이어서 할 때, 이전까지 공부한 시간(ms)
  };
}

let timer = { ...defaultTimer(), ...load(KEYS.timer, {}) };
let memos = load(KEYS.memos, []);                       // [{ id, text, category, createdAt }]
let categories = load(KEYS.categories, DEFAULT_CATEGORIES);
// [{ id, date, studyMs, mode, goal, endedAt }] — 예전 기록에 id가 없으면 붙여 줌
let records = load(KEYS.records, []).map((r) => (r.id ? r : { ...r, id: makeId() }));
save(KEYS.records, records);
let selectedCategory = categories[0];                   // 메모 입력할 때 지금 선택된 카테고리
let historyView = 'month';                              // 기록 자세히 보기: 'month' | 'year'
let historyCursor = new Date();                         // 기록 자세히 보기: 지금 보고 있는 달/연도
let pomoSetting = { ...DEFAULT_POMODORO, ...load(KEYS.pomodoro, {}) }; // { focus: 분, break: 분 }

const saveTimer = () => save(KEYS.timer, timer);

// 뽀모도로 구간 길이(ms)
// 테스트할 때는 '* 60 * 1000'을 '* 1000'으로 바꾸면 분 대신 초 단위로 빨리 확인할 수 있음
function phaseLength(phase) {
  return pomoSetting[phase] * 60 * 1000;
}


/* ---------- 3. 타이머 로직 ----------
   [핵심] 1초마다 숫자를 1씩 더하지 않고,
   "시작한 시각"을 저장해 두고 (지금 시각 - 시작 시각)으로 계산한다.
   → 창을 닫았다 다시 열어도, 탭이 느려져도 시간이 정확하게 이어짐.
*/

// 현재 구간에서 흐른 시간(ms)
function phaseElapsed() {
  const runningPart = timer.running ? Date.now() - timer.phaseStart : 0;
  return timer.phaseElapsed + runningPart;
}

// 이번 세션에서 실제로 공부한 시간(ms) — 뽀모도로 휴식 시간은 제외
function totalStudyMs() {
  if (timer.mode === 'normal') return phaseElapsed();
  return timer.studiedMs + (timer.phase === 'focus' ? phaseElapsed() : 0);
}

function startTimer() {
  if (timer.running) return;

  if (!timer.active) {               // 새로운 공부 시작
    timer.active = true;
    timer.sessionStart = Date.now();
    timer.goal = $('goalInput').value.trim();
    timer.phase = 'focus';
    timer.phaseElapsed = 0;
    timer.studiedMs = 0;
  }
  timer.running = true;              // 시작 또는 이어하기
  timer.phaseStart = Date.now();

  saveTimer();
  renderAll();
}

function pauseTimer() {
  if (!timer.running) return;
  timer.phaseElapsed = phaseElapsed(); // 지금까지 흐른 시간을 확정해서 저장
  timer.running = false;
  timer.phaseStart = null;
  saveTimer();
  renderTimer();
}

function stopTimer() {
  if (!timer.active) return;
  if (!confirm('공부를 종료하고 기록을 저장할까요?')) return;

  advancePomodoro();
  const studied = totalStudyMs();             // 이어서 한 경우 이전 시간까지 포함
  const added = studied - timer.resumeBase;   // 이번에 새로 공부한 시간
  const resumed = Boolean(timer.resumeId);
  const memoCount = countSessionMemos();

  if (added >= 1000) saveRecord(studied, added);

  timer = { ...defaultTimer(), mode: timer.mode }; // 모드는 유지하고 초기화
  saveTimer();
  $('goalInput').value = '';

  renderAll(); // 보관함 잠금이 풀리면서 목록이 보임
  const done = resumed
    ? `이번에 ${fmtDuration(added)}, 모두 ${fmtDuration(studied)} 공부했어요.`
    : `${fmtDuration(studied)} 공부했어요.`;
  showToast('timerToast', `수고했어요! ${done} 보관함에서 생각 ${memoCount}개를 확인해 보세요.`);
}

// 뽀모도로: 구간 시간이 다 되면 집중 ↔ 휴식 전환
// 창을 오래 닫아 두었다면 여러 구간이 지났을 수 있어서 while로 처리
function advancePomodoro() {
  if (timer.mode !== 'pomodoro' || !timer.running) return false;

  let elapsed = phaseElapsed();
  let changed = false;

  while (elapsed >= phaseLength(timer.phase)) {
    const len = phaseLength(timer.phase);
    if (timer.phase === 'focus') timer.studiedMs += len;
    timer.phase = timer.phase === 'focus' ? 'break' : 'focus';
    elapsed -= len;
    changed = true;
  }

  if (changed) {
    timer.phaseElapsed = 0;
    timer.phaseStart = Date.now() - elapsed; // 남은 시간만큼 이미 흐른 것으로
    saveTimer();
  }
  return changed;
}

// 0.25초마다 화면 갱신
function tick() {
  if (advancePomodoro()) {
    showToast('timerToast',
      timer.phase === 'break'
        ? `집중 끝! ${pomoSetting.break}분 쉬어 가요 ☕`
        : '휴식 끝! 다시 집중해 볼까요 📚');
  }
  renderTimer();
}


/* ---------- 4. 생각 메모 ---------- */

function addMemo(text, category) {
  memos.push({
    id: makeId(),
    text,
    category,
    createdAt: Date.now(),
  });
  save(KEYS.memos, memos);
}

function deleteMemo(id) {
  memos = memos.filter((m) => m.id !== id);
  save(KEYS.memos, memos);
}

// 이번 공부 세션 동안 적은 메모 개수
function countSessionMemos() {
  if (!timer.sessionStart) return 0;
  return memos.filter((m) => m.createdAt >= timer.sessionStart).length;
}


/* ---------- 5. 카테고리 관리 ---------- */

function addCategory(name) {
  if (!name || categories.includes(name)) return false;
  categories.push(name);
  save(KEYS.categories, categories);
  return true;
}

function removeCategory(name) {
  if (categories.length <= 1) {
    alert('카테고리는 최소 1개가 있어야 해요.');
    return;
  }
  categories = categories.filter((c) => c !== name);
  save(KEYS.categories, categories);
}


/* ---------- 6. 공부 기록 ---------- */

// 공부를 끝낼 때 기록 저장
// - 오늘 기록을 이어서 했다면: 그 기록의 시간을 늘림
// - 새로 시작한 공부라면: 새 기록 추가
//   (이어서 하던 중 자정이 지나 날짜가 바뀐 경우에도 날짜별 합계가 맞도록 '새로 공부한 시간'만 새 기록에 저장)
function saveRecord(studied, added) {
  const today = dateKey(new Date(timer.sessionStart));
  const old = records.find((r) => r.id === timer.resumeId);

  if (old && old.date === today) {
    old.studyMs = studied;
    old.endedAt = Date.now();
  } else {
    records.push({
      id: makeId(),
      date: today,
      studyMs: added,
      mode: timer.mode,
      goal: timer.goal,
      endedAt: Date.now(),
    });
  }
  save(KEYS.records, records);
}

// 기록을 눌러 그 공부를 이어서 하기 — 목표 · 모드는 그대로, 시간은 기록된 시간부터 이어짐
// (오늘 기록만 이어서 할 수 있음)
function resumeRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r || r.date !== dateKey(new Date())) return;
  if (timer.active) {
    showToast('timerToast', '진행 중인 공부를 먼저 종료해 주세요.');
    return;
  }
  if (!confirm(`'${r.goal || '목표 없음'}' 공부를 이어서 할까요?`)) return;

  const now = Date.now();
  timer = {
    ...defaultTimer(),
    active: true,
    running: true,
    mode: r.mode,
    goal: r.goal,
    sessionStart: now,
    phaseStart: now,
    resumeId: r.id,
    resumeBase: r.studyMs,
  };
  if (r.mode === 'normal') timer.phaseElapsed = r.studyMs; // 일반: 시계가 기록된 시간부터 이어서 흐름
  else timer.studiedMs = r.studyMs;                        // 뽀모도로: 누적 공부 시간에 더해 새 집중 구간 시작

  saveTimer();
  closeDrawer(false);
  renderAll();
  showToast('timerToast', `${fmtDuration(r.studyMs)}부터 이어서 공부를 시작했어요.`);
}

// 날짜별 공부 시간 합계 { '2026-10-25': 3600000, ... }
function sumByDate() {
  const sums = {};
  records.forEach((r) => { sums[r.date] = (sums[r.date] || 0) + r.studyMs; });
  return sums;
}


/* ---------- 7. 화면 그리기(render) ---------- */

const $ = (id) => document.getElementById(id);

// 요소 만들기 도우미 (사용자 글은 textContent로 넣어서 안전하게)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

function fmtClock(ms, withHours = true, roundUp = false) {
  const s = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return withHours ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m + h * 60)}:${pad(sec)}`;
}

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}초`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 내 컴퓨터 시간 기준 날짜 문자열 (toISOString은 UTC라 한국 시간과 어긋날 수 있음)
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimers = {};
function showToast(id, msg) {
  const box = $(id);
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimers[id]);
  toastTimers[id] = setTimeout(() => box.classList.remove('show'), 3500);
}

// ① 타이머
function renderTimer() {
  const isPomo = timer.mode === 'pomodoro';
  let label;
  let clock;

  if (isPomo) {
    const remain = Math.max(0, phaseLength(timer.phase) - phaseElapsed());
    clock = fmtClock(remain, false, true);      // 남은 시간 (25:00 → 00:00)
    label = timer.phase === 'focus' ? '집중' : '휴식';
  } else {
    clock = fmtClock(phaseElapsed());           // 흐른 시간 (00:00:00 →)
    label = '공부 중';
  }
  if (!timer.active) label = '대기 중';
  else if (!timer.running) label += ' · 일시정지';

  $('phaseLabel').textContent = label;
  $('timeText').textContent = clock;
  $('studyTotal').textContent =
    isPomo && timer.active ? `누적 공부 ${fmtClock(totalStudyMs())}` : '';
  $('timerSection').dataset.phase = timer.active ? timer.phase : 'idle';

  $('startBtn').disabled = timer.running;
  $('startBtn').textContent = timer.active && !timer.running ? '이어하기' : '시작';
  $('pauseBtn').disabled = !timer.running;
  $('stopBtn').disabled = !timer.active;

  // 공부 중에는 모드 / 목표 변경 불가
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === timer.mode);
    btn.disabled = timer.active;
  });
  $('goalInput').disabled = timer.active;
  if (timer.active) $('goalInput').value = timer.goal;

  // 뽀모도로 시간 설정칸: 뽀모도로 모드에서만 보이고, 공부 중에는 바꿀 수 없음
  $('pomoSettings').hidden = !isPomo;
  $('focusMin').disabled = timer.active;
  $('breakMin').disabled = timer.active;

  document.title = timer.active ? `${clock} · 생각 기록 타이머` : '생각 기록 타이머';
}

// ② 카테고리 (입력 버튼, 필터, 관리 목록)
function renderCategories() {
  // 선택돼 있던 카테고리가 삭제됐으면 첫 번째 카테고리로
  if (!categories.includes(selectedCategory)) selectedCategory = categories[0];

  // 메모 입력용 카테고리 버튼 — 누른 버튼 하나만 선택(active) 상태
  const buttons = $('categoryButtons');
  buttons.replaceChildren();
  categories.forEach((c) => {
    const btn = el('button', 'cat-btn', c);
    btn.type = 'button';                 // form 안에 있어도 저장(submit)되지 않게
    btn.dataset.select = c;
    const selected = c === selectedCategory;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', selected);
    buttons.append(btn);
  });

  const filter = $('filterSelect');
  const prevFilter = filter.value || 'all';
  filter.replaceChildren(new Option('전체', 'all'), ...categories.map((c) => new Option(c, c)));
  filter.value = prevFilter === 'all' || categories.includes(prevFilter) ? prevFilter : 'all';

  const list = $('categoryList');
  list.replaceChildren();
  categories.forEach((c) => {
    const li = el('li', 'chip', c);
    const x = el('button', 'chip-x', '×');
    x.dataset.cat = c;
    x.title = `${c} 삭제`;
    li.append(x);
    list.append(li);
  });
}

// 메모 한 개 (withDelete: 오른쪽 창에서만 삭제 버튼 표시 / withDate: 미리보기에는 날짜도 표시)
function memoItem(m, { withDelete = false, withDate = false } = {}) {
  const li = el('li', 'memo-item');
  const meta = el('div', 'memo-meta');
  const d = new Date(m.createdAt);
  const when = withDate ? `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(m.createdAt)}` : fmtTime(m.createdAt);
  meta.append(el('span', 'chip', m.category), el('span', 'memo-time', when));
  li.append(meta, el('p', 'memo-text', m.text));
  if (withDelete) {
    const del = el('button', 'del-btn', '삭제');
    del.dataset.id = m.id;
    li.append(del);
  }
  return li;
}

// ③ 보관함 — 공부 중(active)이면 잠금, 끝나면 공개
//    메인 화면에는 최근 3개만, 전체 목록은 오른쪽 창에
function renderVault() {
  const locked = timer.active;
  document.querySelectorAll('.locked-count').forEach((n) => { n.textContent = countSessionMemos(); });
  $('vaultCount').textContent = locked ? '' : `${memos.length}개`;

  $('vaultPreviewLocked').hidden = !locked;
  $('vaultPreview').hidden = locked;
  $('vaultLocked').hidden = !locked;
  $('vaultList').hidden = locked;
  $('filterSelect').disabled = locked;
  $('vaultTotal').textContent = '';
  if (locked) return;

  renderVaultPreview();
  renderVaultList();
}

// 메인 화면: 최근 3개 미리보기 + 전체 보기 버튼
function renderVaultPreview() {
  const box = $('vaultPreview');
  box.replaceChildren();
  if (memos.length === 0) {
    box.append(el('p', 'empty', '보관된 생각이 없어요.'));
    return;
  }
  const latest = [...memos].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const ul = el('ul', 'memo-list');
  latest.forEach((m) => ul.append(memoItem(m, { withDate: true })));
  box.append(ul);

  if (memos.length > 3) {
    const more = el('button', 'more-btn', `전체 ${memos.length}개 보기 ›`);
    more.type = 'button';
    more.addEventListener('click', openVault);
    box.append(more);
  }
}

// 오른쪽 창: 날짜별로 묶은 전체 목록 + 카테고리 필터 + 삭제
function renderVaultList() {
  const filter = $('filterSelect').value;
  const list = memos
    .filter((m) => filter === 'all' || m.category === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  $('vaultTotal').textContent = `${list.length}개`;

  const box = $('vaultList');
  box.replaceChildren();
  if (list.length === 0) {
    box.append(el('p', 'empty', '보관된 생각이 없어요.'));
    return;
  }

  let currentDate = null;
  let ul;
  list.forEach((m) => {
    const d = dateKey(new Date(m.createdAt));
    if (d !== currentDate) {          // 날짜가 바뀌면 새 묶음 시작
      currentDate = d;
      box.append(el('h3', 'date-head', d));
      ul = el('ul', 'memo-list');
      box.append(ul);
    }
    ul.append(memoItem(m, { withDelete: true }));
  });
}

// ④ 공부 기록 — 오늘 합계 + 최근 7일 막대그래프 + 오늘 세션 목록
function renderRecords() {
  const sums = sumByDate();
  const today = dateKey(new Date());
  $('todayTotal').textContent = fmtDuration(sums[today] || 0);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const max = Math.max(1, ...days.map((d) => sums[dateKey(d)] || 0));
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  const chart = $('weekChart');
  chart.replaceChildren();
  days.forEach((d) => {
    const ms = sums[dateKey(d)] || 0;
    const col = el('div', 'bar-col');
    if (dateKey(d) === today) col.classList.add('today');

    const bar = el('div', 'bar');
    bar.style.height = `${(ms / max) * 100}%`;
    bar.title = fmtDuration(ms);
    const wrap = el('div', 'bar-wrap');
    wrap.append(bar);

    col.append(
      el('span', 'bar-value', ms === 0 ? '' : ms < 60000 ? '1분 미만' : `${Math.round(ms / 60000)}분`),
      wrap,
      el('span', 'bar-label', WEEK[d.getDay()]),
    );
    chart.append(col);
  });

  const list = $('recordList');
  list.replaceChildren();
  const todays = records.filter((r) => r.date === today).sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
  if (todays.length === 0) {
    list.append(el('li', 'empty', '오늘은 아직 기록이 없어요.'));
  }
  todays.forEach((r) => list.append(recordItem(r)));
}

// 공부 기록 한 줄
// - 오늘 기록: 버튼으로 만들어서 누르면 그 공부를 이어서 시작 (공부 중에는 누를 수 없음)
// - 전날 이전 기록: 이어하기 없이 내용만 표시
function recordItem(r, { withDate = false } = {}) {
  const li = el('li');
  const canResume = r.date === dateKey(new Date());

  const [, m, d] = r.date.split('-');
  const meta = `${withDate ? `${Number(m)}/${Number(d)} · ` : ''}${r.mode === 'pomodoro' ? '뽀모도로' : '일반'} · ${fmtDuration(r.studyMs)}`;

  if (!canResume) {
    const row = el('div', 'record-item static');
    row.append(el('span', 'record-goal', r.goal || '목표 없음'), el('span', 'record-meta', meta));
    li.append(row);
    return li;
  }

  const btn = el('button', 'record-item');
  btn.type = 'button';
  btn.dataset.recordId = r.id;
  btn.disabled = timer.active;
  btn.title = timer.active ? '공부 중에는 이어하기를 할 수 없어요' : '눌러서 이어서 공부하기';
  btn.append(
    el('span', 'record-goal', r.goal || '목표 없음'),
    el('span', 'record-play', '▶ 이어하기'),
    el('span', 'record-meta', meta),
  );
  li.append(btn);
  return li;
}

// 연간 그래프 막대 위에 쓰는 짧은 시간 (예: 33시간, 45분)
function fmtShort(ms) {
  const h = Math.round(ms / 3600000);
  return h >= 1 ? `${h}시간` : `${Math.round(ms / 60000)}분`;
}

// ⑤ 기록 자세히 보기 — 월간(일별 막대) / 연간(월별 막대)
function renderHistory() {
  const sums = sumByDate();
  const y = historyCursor.getFullYear();
  const mo = historyCursor.getMonth();          // 0 = 1월
  const now = new Date();
  const isMonth = historyView === 'month';
  const bars = [];                               // { label, title, ms, isNow }

  if (isMonth) {
    $('periodLabel').textContent = `${y}년 ${mo + 1}월`;
    const lastDay = new Date(y, mo + 1, 0).getDate(); // 이번 달 마지막 날 (28~31)
    for (let d = 1; d <= lastDay; d++) {
      const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
      bars.push({
        label: d === 1 || d % 5 === 0 ? String(d) : '', // 글자가 겹치지 않게 1, 5, 10…만 표시
        title: `${mo + 1}월 ${d}일`,
        ms: sums[key] || 0,
        isNow: key === dateKey(now),
      });
    }
  } else {
    $('periodLabel').textContent = `${y}년`;
    for (let m = 0; m < 12; m++) {
      const prefix = `${y}-${pad(m + 1)}-`;
      let ms = 0;
      for (const key in sums) if (key.startsWith(prefix)) ms += sums[key];
      bars.push({
        label: `${m + 1}월`,
        title: `${y}년 ${m + 1}월`,
        ms,
        isNow: y === now.getFullYear() && m === now.getMonth(),
      });
    }
  }

  // 요약: 총 시간 / 공부한 날 수 / 공부한 날 기준 하루 평균
  const periodPrefix = isMonth ? `${y}-${pad(mo + 1)}-` : `${y}-`;
  let total = 0;
  let days = 0;
  for (const key in sums) {
    if (key.startsWith(periodPrefix)) { total += sums[key]; days++; }
  }
  $('statTotal').textContent = fmtDuration(total);
  $('statDays').textContent = `${days}일`;
  $('statAvg').textContent = days ? fmtDuration(total / days) : '-';
  $('historyEmpty').hidden = total > 0;

  // 이번 달(올해)보다 미래로는 못 넘어가게
  $('nextPeriod').disabled = isMonth
    ? y === now.getFullYear() && mo === now.getMonth()
    : y === now.getFullYear();

  document.querySelectorAll('.hist-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === historyView);
  });

  // 막대그래프 (오늘 화면의 7일 그래프와 같은 모양을 재사용)
  const max = Math.max(1, ...bars.map((b) => b.ms));
  const chart = $('historyChart');
  chart.dataset.view = historyView;
  chart.replaceChildren();
  bars.forEach((b) => {
    const col = el('div', 'bar-col');
    if (b.isNow) col.classList.add('today');
    col.title = `${b.title}: ${fmtDuration(b.ms)}`; // 마우스를 올리면 정확한 시간 표시

    const bar = el('div', 'bar');
    bar.style.height = `${(b.ms / max) * 100}%`;
    const wrap = el('div', 'bar-wrap');
    wrap.append(bar);

    // 연간은 막대가 12개라 위에 시간을 적고, 월간은 31개라 생략
    const value = !isMonth && b.ms ? fmtShort(b.ms) : '';
    col.append(el('span', 'bar-value', value), wrap, el('span', 'bar-label', b.label));
    chart.append(col);
  });

  // 월간 보기: 그 달의 기록 목록 (최근 것부터, 누르면 이어서 공부)
  $('historyListBox').hidden = !isMonth;
  if (isMonth) {
    const list = $('historyList');
    list.replaceChildren();
    const monthRecords = records
      .filter((r) => r.date.startsWith(periodPrefix))
      .sort((a, b) => b.endedAt - a.endedAt);
    if (monthRecords.length === 0) list.append(el('li', 'empty', '이 달에는 기록이 없어요.'));
    monthRecords.forEach((r) => list.append(recordItem(r, { withDate: true })));
  }
}

// ---------- 옆에서 열리는 창 열기 / 닫기 (한 번에 하나만 열림) ----------
let openedDrawer = null;   // 지금 열린 창
let drawerOpener = null;   // 창을 연 버튼 (닫으면 다시 이 버튼으로 포커스)

function openDrawer(id, opener) {
  closeDrawer(false);
  $(id).classList.add('open');
  $('drawerBackdrop').classList.add('open');
  document.body.classList.add('no-scroll'); // 뒤쪽 화면 스크롤 막기
  openedDrawer = id;
  drawerOpener = opener;
  $(id).querySelector('.icon-close').focus();
}

function closeDrawer(restoreFocus = true) {
  if (!openedDrawer) return;
  $(openedDrawer).classList.remove('open');
  $('drawerBackdrop').classList.remove('open');
  document.body.classList.remove('no-scroll');
  if (restoreFocus && drawerOpener) drawerOpener.focus();
  openedDrawer = null;
}

// 왼쪽 창: 공부 기록 자세히 보기
function openHistory() {
  const now = new Date();
  historyCursor = new Date(now.getFullYear(), now.getMonth(), 1); // 열 때마다 이번 달부터
  renderHistory();
  openDrawer('historyDrawer', $('openHistory'));
}

// 오른쪽 창: 생각 보관함 전체 보기
function openVault() {
  renderVault();
  openDrawer('vaultDrawer', $('openVault'));
}

// step: -1 = 이전, +1 = 다음
function moveHistory(step) {
  const y = historyCursor.getFullYear();
  const mo = historyCursor.getMonth();
  historyCursor = historyView === 'month'
    ? new Date(y, mo + step, 1)   // 12월 + 1 → 다음 해 1월로 자동 계산됨
    : new Date(y + step, mo, 1);
  renderHistory();
}

// 뽀모도로 시간 입력칸에 저장된 값 채우기
// (renderTimer는 0.25초마다 실행되므로, 입력 중인 값이 지워지지 않게 따로 분리)
function renderPomoSettings() {
  $('focusMin').value = pomoSetting.focus;
  $('breakMin').value = pomoSetting.break;
}

// 입력한 시간 저장 — 범위를 벗어나거나 비어 있으면 가까운 값으로 맞춤
function updatePomoSetting(phase, input) {
  const [min, max] = POMO_LIMIT[phase];
  let value = Math.round(Number(input.value));
  if (!Number.isFinite(value) || value < min) value = input.value === '' ? DEFAULT_POMODORO[phase] : min;
  if (value > max) value = max;

  pomoSetting[phase] = value;
  save(KEYS.pomodoro, pomoSetting);
  renderPomoSettings();
  renderTimer();
}

function renderAll() {
  renderCategories();
  renderPomoSettings();
  renderTimer();
  renderVault();
  renderRecords();
}


/* ---------- 8. 이벤트 연결 & 시작 ---------- */

// 타이머 버튼
$('startBtn').addEventListener('click', startTimer);
$('pauseBtn').addEventListener('click', pauseTimer);
$('stopBtn').addEventListener('click', stopTimer);

// 모드 선택 (공부 중이 아닐 때만)
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (timer.active) return;
    timer.mode = btn.dataset.mode;
    timer.phase = 'focus';
    saveTimer();
    renderTimer();
  });
});

// 뽀모도로 집중 / 휴식 시간 설정 (입력칸에서 벗어나거나 Enter를 누르면 저장)
$('focusMin').addEventListener('change', (e) => updatePomoSetting('focus', e.target));
$('breakMin').addEventListener('change', (e) => updatePomoSetting('break', e.target));

// 메모 저장
$('memoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('memoInput').value.trim();
  if (!text) return;

  addMemo(text, selectedCategory);
  $('memoInput').value = '';
  showToast('memoToast', timer.active ? '보관했어요. 다시 공부로 돌아가요! 📚' : '보관했어요.');
  renderVault();
  $('memoInput').focus();
});

// Enter = 저장, Shift+Enter = 줄바꿈
// isComposing: 한글 입력 중(조합 중)에 Enter가 두 번 처리되는 문제 방지
$('memoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('memoForm').requestSubmit();
  }
});

// 카테고리 버튼 선택 → 고른 뒤 바로 입력할 수 있게 메모 칸으로 커서 이동
$('categoryButtons').addEventListener('click', (e) => {
  const cat = e.target.dataset.select;
  if (!cat) return;
  selectedCategory = cat;
  renderCategories();
  $('memoInput').focus();
});

// 카테고리 추가 / 삭제
$('categoryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('categoryInput').value.trim();
  if (addCategory(name)) {
    $('categoryInput').value = '';
    renderCategories();
  }
});

$('categoryList').addEventListener('click', (e) => {
  const cat = e.target.dataset.cat;
  if (!cat) return;
  removeCategory(cat);
  renderCategories();
  renderVault();
});

// 보관함 필터 / 메모 삭제
$('filterSelect').addEventListener('change', renderVault);

$('vaultList').addEventListener('click', (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (!confirm('이 생각을 삭제할까요? (처리 완료)')) return;
  deleteMemo(id);
  renderVault();
});

// 옆 창 열기 / 닫기 — × 버튼, 바깥 어두운 곳 클릭, Esc 키로 닫힘
$('openHistory').addEventListener('click', openHistory);
$('openVault').addEventListener('click', openVault);
$('closeHistory').addEventListener('click', () => closeDrawer());
$('closeVault').addEventListener('click', () => closeDrawer());
$('drawerBackdrop').addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// 공부 기록을 누르면 이어서 공부 (메인 화면 오늘 기록 / 왼쪽 창 이 달의 기록)
['recordList', 'historyList'].forEach((id) => {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-record-id]');
    if (btn && !btn.disabled) resumeRecord(btn.dataset.recordId);
  });
});

// 공부 기록 창: 이전 / 다음 기간, 월간 / 연간 전환
$('prevPeriod').addEventListener('click', () => moveHistory(-1));
$('nextPeriod').addEventListener('click', () => moveHistory(1));
document.querySelectorAll('.hist-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    historyView = tab.dataset.view;
    renderHistory();
  });
});

// 시작!
renderAll();
setInterval(tick, 250);


/* ---------- 9. 앞으로 만들 기능 (개발 일정 기준) ----------

   TODO(11월 초) 하루 목표 시간
     - localStorage에 'ttt.dailyGoal' (분 단위) 저장
     - renderRecords()에서 오늘 합계 / 목표 비율을 진행 막대로 표시

   TODO(11월 초) 기록 파일로 저장하기
     function exportRecords() {
       const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
       const a = document.createElement('a');
       a.href = URL.createObjectURL(blob);
       a.download = `study-records-${dateKey(new Date())}.json`;
       a.click();
     }

   TODO(11월 말) 사용 후기 반영 — 불편한 점 수정
*/
