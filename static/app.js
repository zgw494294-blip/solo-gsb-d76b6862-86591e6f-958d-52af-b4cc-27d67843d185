"use strict";

const MAX_RUNNERS = 3;
const MAX_RECORDS = 40;
const GATE_LABELS = { S: "起点 S", M: "中途门 M", F: "终点 F" };

const runnerRows = document.getElementById("runner-rows");
const recordRows = document.getElementById("record-rows");
const addRunnerBtn = document.getElementById("add-runner");
const addRecordBtn = document.getElementById("add-record");
const recordCount = document.getElementById("record-count");
const form = document.getElementById("judge-form");
const errorBox = document.getElementById("error-box");
const pendingHint = document.getElementById("pending-hint");
const resultsBox = document.getElementById("results");

/* ---------- 行管理 ---------- */

function runnerRowHtml(index, value = "") {
  return `
    <div class="runner-row" data-index="${index}">
      <span class="row-index">选手 ${index}</span>
      <input type="number" min="1" step="1" class="runner-number" value="${escapeAttr(value)}" placeholder="正整数编号" />
      <button type="button" class="btn danger remove-runner" ${index === 1 ? "hidden" : ""}>删除</button>
    </div>`;
}

function recordRowHtml() {
  return `
    <tr class="record-row">
      <td><input type="text" class="rec-id" placeholder="唯一 ID" /></td>
      <td><input type="number" min="1" step="1" class="rec-runner" placeholder="选手编号" /></td>
      <td>
        <select class="rec-gate">
          <option value="">选择门</option>
          <option value="S">S 起点</option>
          <option value="M">M 中途门</option>
          <option value="F">F 终点</option>
        </select>
      </td>
      <td><input type="number" min="0" step="1" class="rec-time" placeholder="非负秒" /></td>
      <td><button type="button" class="btn danger remove-record">×</button></td>
    </tr>`;
}

function addRunnerRow(value) {
  if (runnerRows.children.length >= MAX_RUNNERS) return;
  runnerRows.insertAdjacentHTML("beforeend", runnerRowHtml(runnerRows.children.length + 1, value));
  refreshRunnerButtons();
}

function refreshRunnerButtons() {
  [...runnerRows.children].forEach((row, i) => {
    row.dataset.index = i + 1;
    row.querySelector(".row-index").textContent = `选手 ${i + 1}`;
    const btn = row.querySelector(".remove-runner");
    btn.hidden = runnerRows.children.length === 1;
  });
  addRunnerBtn.disabled = runnerRows.children.length >= MAX_RUNNERS;
}

function addRecordRow() {
  if (recordRows.children.length >= MAX_RECORDS) return;
  recordRows.insertAdjacentHTML("beforeend", recordRowHtml());
  refreshRecordCount();
}

function refreshRecordCount() {
  recordCount.textContent = `${recordRows.children.length} / ${MAX_RECORDS}`;
  addRecordBtn.disabled = recordRows.children.length >= MAX_RECORDS;
}

addRunnerBtn.addEventListener("click", () => {
  addRunnerRow();
  onInputChanged();
});
addRecordBtn.addEventListener("click", () => {
  addRecordRow();
  onInputChanged();
});

runnerRows.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-runner")) {
    e.target.closest(".runner-row").remove();
    refreshRunnerButtons();
    onInputChanged();
  }
});
recordRows.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-record")) {
    e.target.closest(".record-row").remove();
    refreshRecordCount();
    onInputChanged();
  }
});

/* ---------- 输入修改后自动重算 ---------- */

// 每次修改递增版本号：只有版本仍最新的响应才允许更新结果或错误，
// 过期的成功与失败一律丢弃，不得覆盖较新状态。
let inputVersion = 0;
let debounceTimer = null;
const DEBOUNCE_MS = 350; // 合并连续编辑为一次重算

function clearOutcome() {
  // 每次修改立即清掉旧结果与旧错误。
  resultsBox.innerHTML = "";
  errorBox.hidden = true;
  renderedLapKeys = []; // 结果区已清空，旧的趟键索引全部失效
}

function onInputChanged() {
  inputVersion += 1;
  // 先按当前输入即时丢弃绑定已失效的复核：不必、也不能等到合法裁决返回。
  pruneReviewsByBindings();
  clearOutcome();
  pendingHint.hidden = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runAdjudication();
  }, DEBOUNCE_MS);
}

form.addEventListener("input", onInputChanged);
form.addEventListener("change", onInputChanged);

/* ---------- 收集与提交 ---------- */

function collectPayload() {
  const runners = [...runnerRows.querySelectorAll(".runner-row")]
    .map((row) => row.querySelector(".runner-number").value.trim())
    .filter((v) => v !== "")
    .map((v) => ({ number: v }));

  const records = [...recordRows.querySelectorAll(".record-row")].map((row) => ({
    id: row.querySelector(".rec-id").value.trim(),
    runner: row.querySelector(".rec-runner").value.trim(),
    gate: row.querySelector(".rec-gate").value,
    time: row.querySelector(".rec-time").value.trim(),
  }));

  return {
    standards: {
      smMin: document.getElementById("smMin").value.trim(),
      smMax: document.getElementById("smMax").value.trim(),
      mfMin: document.getElementById("mfMin").value.trim(),
      mfMax: document.getElementById("mfMax").value.trim(),
    },
    runners,
    records,
  };
}

async function runAdjudication() {
  const version = inputVersion;
  let resp;
  let data;
  try {
    resp = await fetch("/api/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload()),
    });
    data = await resp.json();
  } catch (err) {
    if (version !== inputVersion) return; // 过期的失败不得覆盖较新状态
    pendingHint.hidden = true;
    resultsBox.innerHTML = "";
    showError(`无法连接裁决服务：${err.message}`);
    return;
  }
  if (version !== inputVersion) return; // 过期的成功同样丢弃
  pendingHint.hidden = true;
  if (!resp.ok || !data.ok) {
    // 非法输入：清空结果区，只显示错误（不展示部分结果）。
    resultsBox.innerHTML = "";
    showError(data.error || "裁决失败");
  } else {
    errorBox.hidden = true;
    renderResults(data.result);
  }
}

// 手动裁决按钮仍然可用：跳过防抖立即重算，等待期间不锁定任何输入。
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingHint.hidden = false;
  runAdjudication();
});

function showError(msg) {
  errorBox.textContent = `⚠ ${msg}`;
  errorBox.hidden = false;
}

/* ---------- 人工复核（仅本次页面会话，不上传、不影响裁决） ---------- */

// 复核绑定具体的“趟”：选手编号 + 三条记录的 ID/门/秒数 + 该趟两段耗时 + 两段耗时区间，
// 不按趟序号或记录行号定位。仅保存在页面内存中，刷新页面即全部清除。
const reviews = new Map(); // key -> { status: "pending"|"pass"|"doubt", note: string }
const REVIEW_STATUSES = { pending: "未复核", pass: "通过", doubt: "存疑" };
const MAX_REVIEW_NOTE = 200;
// 最近一次渲染的趟绑定键（与 DOM 中 data-key-index 一一对应），仅供保存时回查。
let renderedLapKeys = [];

function currentStandards() {
  return ["smMin", "smMax", "mfMin", "mfMax"].map((id) =>
    Number(document.getElementById(id).value.trim())
  );
}

function lapReviewKey(runner, lap, standards) {
  return JSON.stringify([
    runner,
    [lap.start.id, "S", lap.start.time],
    [lap.middle.id, "M", lap.middle.time],
    [lap.finish.id, "F", lap.finish.time],
    lap.smTime,
    lap.mfTime,
    standards,
  ]);
}

// 即时剪枝：任一绑定值改变、绑定记录或选手被删除（含当前输入非法、尚在防抖、
// 请求在途的情形），对应复核此刻就丢弃；之后改回或过期响应返回也不会恢复。
// 只逐条核对绑定本身：重排记录、增删改无关记录的趟不受影响，保留原状态与备注。
function pruneReviewsByBindings() {
  const standards = currentStandards();

  const runnerNumbers = new Set(
    [...runnerRows.querySelectorAll(".runner-number")]
      .map((el) => el.value.trim())
      .filter((v) => v !== "")
      .map(Number)
  );

  // 以记录 ID 为索引：绑定按 ID 定位，ID 缺失即记录被删除；
  // 同一 ID 出现多行时无法唯一定位原记录，同样视为绑定失效。
  const recordsById = new Map();
  const duplicatedIds = new Set();
  for (const row of recordRows.querySelectorAll(".record-row")) {
    const id = row.querySelector(".rec-id").value.trim();
    if (id === "") continue;
    if (recordsById.has(id)) {
      duplicatedIds.add(id);
      continue;
    }
    recordsById.set(id, {
      runner: row.querySelector(".rec-runner").value.trim(),
      gate: row.querySelector(".rec-gate").value,
      time: row.querySelector(".rec-time").value.trim(),
    });
  }

  const intText = (v) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const recordMatches = (rec, gate, time) =>
    rec !== undefined &&
    rec.gate === gate &&
    intText(rec.time) === time;

  for (const key of [...reviews.keys()]) {
    let parts;
    try {
      parts = JSON.parse(key);
    } catch (err) {
      reviews.delete(key); // 结构不符的键一律视为失效
      continue;
    }
    const [
      runner,
      [sId, sGate, sTime],
      [mId, mGate, mTime],
      [fId, fGate, fTime],
      smTime,
      mfTime,
      boundStandards,
    ] = parts;

    let valid =
      JSON.stringify(boundStandards) === JSON.stringify(standards) &&
      runnerNumbers.has(runner) &&
      !duplicatedIds.has(sId) &&
      !duplicatedIds.has(mId) &&
      !duplicatedIds.has(fId) &&
      sId !== mId &&
      sId !== fId &&
      mId !== fId &&
      recordMatches(recordsById.get(sId), sGate, sTime) &&
      recordMatches(recordsById.get(mId), mGate, mTime) &&
      recordMatches(recordsById.get(fId), fGate, fTime);

    if (valid) {
      // 绑定记录的选手编号必须仍是该选手；门/秒数不变时两段耗时自然不变，
      // 这里仍显式核对一次，避免任何不一致的键残留。
      const sRec = recordsById.get(sId);
      const mRec = recordsById.get(mId);
      const fRec = recordsById.get(fId);
      valid =
        intText(sRec.runner.trim()) === runner &&
        intText(mRec.runner.trim()) === runner &&
        intText(fRec.runner.trim()) === runner &&
        mTime - sTime === smTime &&
        fTime - mTime === mfTime;
    }

    if (!valid) reviews.delete(key);
  }
}

function reviewCurrentText(saved) {
  const status = saved ? saved.status : "pending";
  const note = saved ? saved.note : "";
  const base = `当前：${REVIEW_STATUSES[status]}`;
  return note ? `${base}（备注：${escapeHtml(note)}）` : base;
}

function reviewBoxHtml(keyIndex, saved) {
  const status = saved ? saved.status : "pending";
  const note = saved ? saved.note : "";
  const options = Object.entries(REVIEW_STATUSES)
    .map(
      ([value, label]) => `
      <label class="review-option">
        <input type="radio" name="review-status-${keyIndex}" value="${value}" ${
        value === status ? "checked" : ""
      } /> ${label}
      </label>`
    )
    .join("");
  return `
  <div class="review-box" data-key-index="${keyIndex}">
    <div class="review-head">
      <span class="review-label">人工复核</span>
      <span class="review-current">${reviewCurrentText(saved)}</span>
      <span class="review-scope">仅本次页面会话保留，刷新即清除</span>
    </div>
    <div class="review-status-row">${options}</div>
    <textarea class="review-note" rows="2" maxlength="${MAX_REVIEW_NOTE}" placeholder="备注（至多 ${MAX_REVIEW_NOTE} 字；选择“存疑”时必填）">${escapeHtml(note)}</textarea>
    <div class="review-actions">
      <button type="button" class="btn secondary review-save">保存复核</button>
      <span class="review-error" hidden></span>
    </div>
  </div>`;
}

// 保存复核：校验失败时不写入，保持原复核内容不变。
resultsBox.addEventListener("click", (e) => {
  if (!e.target.classList.contains("review-save")) return;
  const box = e.target.closest(".review-box");
  const key = renderedLapKeys[Number(box.dataset.keyIndex)];
  if (key === undefined) return; // 结果区已被更新的渲染替换
  const checked = box.querySelector("input[type=radio]:checked");
  const status = checked ? checked.value : "pending";
  const note = box.querySelector(".review-note").value;
  const errEl = box.querySelector(".review-error");

  const fail = (msg) => {
    errEl.textContent = `⚠ ${msg}；已保留原复核内容`;
    errEl.hidden = false;
  };
  if (note.length > MAX_REVIEW_NOTE) {
    fail(`备注至多 ${MAX_REVIEW_NOTE} 字`);
    return;
  }
  if (status === "doubt" && note.trim() === "") {
    fail("选择“存疑”必须填写非空备注");
    return;
  }
  reviews.set(key, { status, note });
  errEl.hidden = true;
  box.querySelector(".review-current").innerHTML = reviewCurrentText({ status, note });
});

/* ---------- 结果渲染 ---------- */

function gateChip(gate, id, time) {
  return `<span class="chip ${gate}">
    <span class="chip-id">${escapeHtml(id)}</span>
    <span class="chip-t">${GATE_LABELS[gate]} · ${time} 秒</span>
  </span>`;
}

function renderResults(result) {
  const standards = currentStandards();
  const keyOf = (runner, lap) => lapReviewKey(runner, lap, standards);

  // 合法裁决到达后再按最新采纳集合剪枝：处理“绑定本身没变、但该趟不再被最新
  // 合法裁决采纳”的情形；绑定值改变/记录或选手删除已在输入变更瞬间即时丢弃，
  // 过期响应因版本号守卫根本到不了这里，无法恢复被丢弃的复核。
  const adopted = new Set();
  for (const r of result.runners) {
    for (const lap of r.laps) adopted.add(keyOf(r.runner, lap));
  }
  for (const key of [...reviews.keys()]) {
    if (!adopted.has(key)) reviews.delete(key);
  }

  renderedLapKeys = [];
  resultsBox.innerHTML = result.runners
    .map((r) => {
      const badge =
        r.lapCount === 0
          ? `<span class="badge zero">0 次完整计次</span>`
          : `<span class="badge ok">${r.lapCount} 次完整计次</span>`;
      const meta =
        r.lapCount === 0
          ? `<span class="result-meta">无完整计次</span>`
          : `<span class="result-meta">各趟用时之和：${r.totalTime} 秒</span>`;

      const lapsHtml =
        r.lapCount === 0
          ? `<div class="zero-note">该选手没有符合两段耗时区间的完整一趟，计 0 次；全部感应记录列入未采纳。</div>`
          : r.laps
              .map((lap, i) => {
                renderedLapKeys.push(keyOf(r.runner, lap));
                const reviewHtml = reviewBoxHtml(
                  renderedLapKeys.length - 1,
                  reviews.get(renderedLapKeys[renderedLapKeys.length - 1])
                );
                return `
                <div class="lap-item">
                  <div class="lap-title">第 ${i + 1} 趟 · 总用时 ${lap.totalTime} 秒</div>
                  <div class="lap-chain">
                    ${gateChip("S", lap.start.id, lap.start.time)}
                    <span class="arrow">— ${lap.smTime} 秒 →</span>
                    ${gateChip("M", lap.middle.id, lap.middle.time)}
                    <span class="arrow">— ${lap.mfTime} 秒 →</span>
                    ${gateChip("F", lap.finish.id, lap.finish.time)}
                  </div>
                  <div class="seg-times">
                    起点→中途门 <strong>${lap.smTime}</strong> 秒，
                    中途门→终点 <strong>${lap.mfTime}</strong> 秒
                  </div>
                  ${reviewHtml}
                </div>`;
              })
              .join("");

      const unusedHtml =
        r.unused.length === 0
          ? `<span class="empty-line">（无未采纳记录）</span>`
          : r.unused
              .map(
                (u) =>
                  `<span class="chip-mini ${u.gate}">${GATE_LABELS[u.gate]} · ${escapeHtml(
                    u.id
                  )} · ${u.time} 秒</span>`
              )
              .join("");

      return `
      <section class="result-card">
        <div class="result-head">
          <h3>选手 ${r.runner}</h3>
          ${badge}
          ${meta}
        </div>
        <div>${lapsHtml}</div>
        <div class="subsection">
          <h4>未采纳记录（该选手输入但未进入任何一趟）</h4>
          ${unusedHtml}
        </div>
      </section>`;
    })
    .join("");
}

/* ---------- 工具 ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ---------- 示例 / 清空 ---------- */

const SAMPLE = {
  smMin: "10",
  smMax: "60",
  mfMin: "10",
  mfMax: "60",
  runners: [{ number: "101" }, { number: "102" }],
  records: [
    { id: "a1", runner: "101", gate: "S", time: "0" },
    { id: "b1", runner: "101", gate: "M", time: "12" },
    { id: "c1", runner: "101", gate: "F", time: "25" },
    { id: "a2", runner: "101", gate: "S", time: "30" },
    { id: "b2", runner: "101", gate: "M", time: "45" },
    { id: "c2", runner: "101", gate: "F", time: "58" },
    { id: "x1", runner: "101", gate: "M", time: "200" },
    { id: "x2", runner: "101", gate: "S", time: "31" },
    { id: "d1", runner: "102", gate: "S", time: "5" },
    { id: "e1", runner: "102", gate: "M", time: "15" },
    { id: "f1", runner: "102", gate: "F", time: "25" },
  ],
};

function loadSample() {
  reviews.clear(); // 载入示例同时清掉全部复核记录
  document.getElementById("smMin").value = SAMPLE.smMin;
  document.getElementById("smMax").value = SAMPLE.smMax;
  document.getElementById("mfMin").value = SAMPLE.mfMin;
  document.getElementById("mfMax").value = SAMPLE.mfMax;

  runnerRows.innerHTML = "";
  SAMPLE.runners.forEach((r) => addRunnerRow(r.number));
  refreshRunnerButtons();

  recordRows.innerHTML = "";
  SAMPLE.records.forEach(() => addRecordRow());
  [...recordRows.querySelectorAll(".record-row")].forEach((row, i) => {
    const rec = SAMPLE.records[i];
    row.querySelector(".rec-id").value = rec.id;
    row.querySelector(".rec-runner").value = rec.runner;
    row.querySelector(".rec-gate").value = rec.gate;
    row.querySelector(".rec-time").value = rec.time;
  });
  refreshRecordCount();

  onInputChanged(); // 载入示例后按当前完整输入自动重算
}

function clearAll() {
  // 递增版本号并取消待发的重算：之后在途请求返回也不得恢复结果或错误。
  inputVersion += 1;
  reviews.clear(); // 清空同时清掉全部复核记录
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  document.getElementById("smMin").value = "";
  document.getElementById("smMax").value = "";
  document.getElementById("mfMin").value = "";
  document.getElementById("mfMax").value = "";
  runnerRows.innerHTML = "";
  addRunnerRow();
  recordRows.innerHTML = "";
  addRecordRow();
  clearOutcome(); // 同时清掉结果与错误
  pendingHint.hidden = true;
}

document.getElementById("sample-btn").addEventListener("click", loadSample);
document.getElementById("clear-btn").addEventListener("click", clearAll);

/* ---------- 初始行 ---------- */
addRunnerRow();
addRecordRow();
addRecordRow();
refreshRunnerButtons();
refreshRecordCount();
