/* 最小 DOM/事件 stub：加载真实 static/app.js，端到端验证复核即时失效逻辑。 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------------- mini DOM ---------------- */

class TokenList {
  constructor() { this._s = new Set(); }
  add(...names) { names.forEach((n) => n && this._s.add(n)); }
  remove(n) { this._s.delete(n); }
  contains(n) { return this._s.has(n); }
  [Symbol.iterator]() { return this._s[Symbol.iterator](); }
}

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.classList = new TokenList();
    this.dataset = {};
    this.id = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this._text = "";
    this._html = "";
    this._listeners = new Map();
    this.name = "";
    this.type = "";
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(html) {
    this._html = html;
    if (html === "") this.children = [];
    // 结果区写入的是渲染字符串（测试直接断言其内容），不解析。
  }
  get innerHTML() { return this._html; }
  appendChild(c) {
    if (c.parent) c.parent._remove(c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  _remove(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }
  remove() { if (this.parent) { this.parent._remove(this); this.parent = null; } }
  insertAdjacentHTML(_pos, html) { parseHtml(html).forEach((n) => this.appendChild(n)); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(evt) {
    let node = this;
    if (!evt.target) evt.target = this;
    if (!evt.preventDefault) evt.preventDefault = () => {};
    // evt.target 始终是派发事件的元素；listener 的 this 沿冒泡链路变化。
    while (node) {
      const fns = node._listeners.get(evt.type) || [];
      for (const fn of fns) fn.call(node, evt);
      node = node.parent;
    }
  }
  _descendants(out = []) {
    for (const c of this.children) { out.push(c); c._descendants(out); }
    return out;
  }
  matches(sel) {
    let s = sel.trim();
    const checked = s.endsWith(":checked");
    if (checked) s = s.slice(0, -":checked".length);
    let m = s.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\])?$/);
    if (s.startsWith(".") || s.startsWith("#")) m = null;
    if (s.startsWith(".")) {
      if (checked && !this.checked) return false;
      return this.classList.contains(s.slice(1));
    }
    if (s.startsWith("#")) return this.id === s.slice(1);
    if (!m) return false;
    const [, tag, attr, val] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (attr) {
      const actual = attr === "class" ? [...this.classList].join(" ") : this.attrs[attr] ?? this[attr];
      if (val !== undefined && String(actual) !== val) return false;
      if (val === undefined && actual === undefined) return false;
    }
    if (checked && !this.checked) return false;
    return true;
  }
  querySelector(sel) { return this._descendants().find((n) => n.matches(sel)); }
  querySelectorAll(sel) { return this._descendants().filter((n) => n.matches(sel)); }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  }
}

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);

function parseHtml(html) {
  const root = new El("#root");
  const stack = [root];
  const tokenRe = /<\/?[a-zA-Z][\w-]*(?:[^<>]*?)\/?>|[^<]+/g;
  let tok;
  while ((tok = tokenRe.exec(html))) {
    const t = tok[0];
    if (t[0] !== "<") continue;
    const closing = t[1] === "/";
    const selfClose = t.endsWith("/>");
    const nameM = t.match(/^<\/?([\w-]+)/);
    const tag = nameM[1].toLowerCase();
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    const attrRe = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
    let am;
    const attrSrc = t.slice(1 + tag.length, selfClose ? -2 : t.endsWith(">") ? -1 : t.length);
    void attrSrc;
    const raw = t.replace(/^<\/?[\w-]+/, "").replace(/\/?>$/, "");
    while ((am = attrRe.exec(raw))) {
      const [, k, v] = am;
      if (!k || k === "/") continue;
      if (v === undefined) { el.attrs[k] = true; continue; }
      el.attrs[k] = v;
      if (k === "class") v.split(/\s+/).forEach((c) => c && el.classList.add(c));
      else if (k === "id") el.id = v;
      else if (k.startsWith("data-")) el.dataset[k.slice(5)] = v;
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = true;
      else if (k === "hidden") el.hidden = true;
      else if (k === "name") el.name = v;
      else if (k === "type") el.type = v;
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
  }
  return root.children;
}

/* ---------------- document stub ---------------- */

const byId = new Map();
function mk(id, tag = "div") { const e = new El(tag); e.id = id; byId.set(id, e); return e; }

const form = mk("judge-form", "form");
const runnerRows = mk("runner-rows");
const recordRows = mk("record-rows");
const addRunner = mk("add-runner", "button");
const addRecord = mk("add-record", "button");
mk("record-count", "span");
mk("error-box"); mk("pending-hint");
const results = mk("results");
for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) mk(id, "input");
mk("sample-btn", "button"); mk("clear-btn", "button");

// 静态层级：所有控件挂在 form 下，输入事件可冒泡到 form 监听器（与真实 DOM 一致）。
for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) form.appendChild(byId.get(id));
form.appendChild(runnerRows);
form.appendChild(recordRows);

global.document = {
  getElementById: (id) => byId.get(id),
};

/* ---------------- fetch stub（可切换：合法 / 422 / 挂起） ---------------- */

function lap(runner, s, m, f, st, mt, ft) {
  return {
    start: { id: s, time: st }, middle: { id: m, time: mt }, finish: { id: f, time: ft },
    smTime: mt - st, mfTime: ft - mt, totalTime: ft - st,
  };
}
const validResult = {
  runners: [
    { runner: 101, lapCount: 1, totalTime: 22, laps: [lap(101, "a1", "b1", "c1", 0, 12, 22)], unused: [] },
  ],
};
const twoLapResult = {
  runners: [
    { runner: 101, lapCount: 1, totalTime: 22, laps: [lap(101, "a1", "b1", "c1", 0, 12, 22)], unused: [] },
    { runner: 102, lapCount: 1, totalTime: 20, laps: [lap(102, "d1", "e1", "f1", 5, 15, 25)], unused: [] },
  ],
};

const server = { mode: "valid", result: validResult, hold: null };
global.fetch = async (_url, opts) => {
  JSON.parse(opts.body); // 前端始终发送合法 JSON
  if (server.mode === "invalid") {
    return { ok: false, status: 422, json: async () => ({ ok: false, error: "模拟非法输入" }) };
  }
  if (server.mode === "hold") {
    const data = await server.hold;
    return { ok: true, status: 200, json: async () => data };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: server.result }) };
};

/* ---------------- 加载真实 app.js ---------------- */

new Function(fs.readFileSync(path.join(__dirname, "static", "app.js"), "utf8"))();

/* ---------------- 测试辅助 ---------------- */

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { failures++; console.error("  ✗", msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (id) => byId.get(id);
function setVal(id, v) { $(id).value = v; }
function fire(el, type) { el.dispatchEvent({ type, preventDefault() {}, target: el }); }
async function flush(n = 5) { for (let i = 0; i < n; i++) await tick(); }

function setRow(ids, runner, gate, time) {
  const rows = recordRows.querySelectorAll(".record-row");
  for (const row of rows) {
    if (row.querySelector(".rec-id").value === "") {
      row.querySelector(".rec-id").value = ids;
      row.querySelector(".rec-runner").value = runner;
      row.querySelector(".rec-gate").value = gate;
      row.querySelector(".rec-time").value = time;
      return row;
    }
  }
  throw new Error("no empty row");
}
function findRow(id) {
  return recordRows.querySelectorAll(".record-row").find((r) => r.querySelector(".rec-id").value === id);
}
function removeRow(id) {
  const row = findRow(id);
  fire(row.querySelector(".remove-record"), "click");
}
function rowOf(id) { return findRow(id); }

// 通过真实的 resultsBox click 监听保存复核。
function saveReview(keyIndex, status, note) {
  const box = new El("div");
  box.classList.add("review-box");
  box.dataset.keyIndex = String(keyIndex);
  const radio = { value: status };
  const noteEl = { value: note };
  const errEl = { hidden: false, textContent: "" };
  const current = { innerHTML: "" };
  box.querySelector = (sel) => {
    if (sel === "input[type=radio]:checked") return radio;
    if (sel === ".review-note") return noteEl;
    if (sel === ".review-error") return errEl;
    if (sel === ".review-current") return current;
    return undefined;
  };
  const btn = new El("button");
  btn.classList.add("btn", "review-save");
  box.appendChild(btn);
  results.appendChild(box);
  fire(btn, "click");
  box.parent = null;
  return current.innerHTML;
}
async function adjudicate() { fire(form, "submit"); await flush(); }
const rendered = () => results.innerHTML;
const fresh = (note) =>
  !rendered().includes(note) && rendered().includes("当前：未复核");

/* ---------------- 场景 ---------------- */

async function main() {
  // 初始合法输入：区间 10~60 / 10~60，选手 101，一趟 a1-b1-c1。
  setVal("smMin", "10"); setVal("smMax", "60"); setVal("mfMin", "10"); setVal("mfMax", "60");
  runnerRows.querySelector(".runner-number").value = "101";
  for (let i = 0; i < 6; i++) fire(addRecord, "click");
  setRow("a1", "101", "S", "0");
  setRow("b1", "101", "M", "12");
  setRow("c1", "101", "F", "22");
  await adjudicate();
  assert(rendered().includes("a1"), "初始合法裁决已渲染");

  console.log("保存复核（通过 + 备注）");
  saveReview(0, "pass", "已核对OK");
  await adjudicate();
  assert(rendered().includes("已核对OK") && rendered().includes("当前：通过"), "复核已保存并渲染");

  console.log("场景1：清空下限→422非法→改回，旧复核不得恢复");
  server.mode = "invalid";
  setVal("smMin", "");
  fire($("smMin"), "input");
  await adjudicate();
  assert(rendered() === "" && !$("error-box").hidden, "非法响应：只显示错误、无部分结果");
  setVal("smMin", "10");
  fire($("smMin"), "input");
  server.mode = "valid";
  await adjudicate();
  assert(fresh("已核对OK"), "改回合法后该趟显示未复核、空备注");

  console.log("场景2：防抖提交前改动绑定值立即改回");
  saveReview(0, "pass", "备注B");
  rowOf("b1").querySelector(".rec-time").value = "99";
  fire(rowOf("b1").querySelector(".rec-time"), "input"); // 此刻即应丢弃
  rowOf("b1").querySelector(".rec-time").value = "12";
  fire(rowOf("b1").querySelector(".rec-time"), "input"); // 改回不恢复
  await adjudicate();
  assert(fresh("备注B"), "防抖前瞬时改回，旧复核仍被丢弃");

  console.log("场景3：请求在途时改动再改回，过期响应不得恢复");
  saveReview(0, "doubt", "备注C");
  let resolveHold;
  server.hold = new Promise((res) => { resolveHold = res; });
  server.mode = "hold";
  fire(form, "submit"); // 请求在途
  setVal("smMin", "5");
  fire($("smMin"), "input"); // 绑定已变 → 立即丢弃
  setVal("smMin", "10");
  fire($("smMin"), "input"); // 改回
  resolveHold({ ok: true, result: validResult }); // 旧响应回来
  await flush();
  server.mode = "valid";
  await adjudicate();
  assert(fresh("备注C"), "在途请求的旧响应未恢复被丢弃的复核");

  console.log("场景4：重排 / 增删改无关记录，绑定未变且仍采纳 → 保留");
  saveReview(0, "pass", "保留备注D");
  const a1 = rowOf("a1");
  recordRows.appendChild(a1); // 重排到末尾
  fire(a1.querySelector(".rec-id"), "input");
  fire(addRecord, "click");
  setRow("z9", "101", "S", "900");
  fire(findRow("z9").querySelector(".rec-id"), "input");
  await adjudicate();
  assert(rendered().includes("保留备注D"), "重排+新增无关记录后保留");
  findRow("z9").querySelector(".rec-time").value = "901";
  fire(findRow("z9").querySelector(".rec-time"), "change");
  await adjudicate();
  assert(rendered().includes("保留备注D"), "修改无关记录后保留");
  removeRow("z9");
  await adjudicate();
  assert(rendered().includes("保留备注D"), "删除无关记录后保留");

  console.log("场景5：删除绑定记录后即使补回同编号也不恢复");
  removeRow("c1");
  fire(addRecord, "click");
  setRow("c1", "101", "F", "22"); // 改回
  fire(findRow("c1").querySelector(".rec-id"), "input");
  await adjudicate();
  assert(fresh("保留备注D"), "绑定记录被删即丢弃，补回不恢复");

  console.log("场景6：删除绑定选手后即使补回同编号也不恢复");
  saveReview(0, "pass", "备注E");
  fire(addRunner, "click");
  [...runnerRows.querySelectorAll(".runner-number")].find((e) => e.value === "").value = "102";
  fire(runnerRows, "input");
  const r101 = [...runnerRows.querySelectorAll(".runner-row")].find(
    (r) => r.querySelector(".runner-number").value === "101"
  );
  fire(r101.querySelector(".remove-runner"), "click");
  fire(addRunner, "click");
  [...runnerRows.querySelectorAll(".runner-number")].find((e) => e.value === "").value = "101";
  fire(runnerRows, "input");
  await adjudicate();
  assert(fresh("备注E"), "绑定选手被删即丢弃，补回同编号不恢复");

  console.log("场景7：逐趟独立失效——改一条趟的绑定不影响另一趟");
  // 重建为两名选手各一趟。
  fire(addRecord, "click");
  setRow("d1", "102", "S", "5");
  setRow("e1", "102", "M", "15");
  setRow("f1", "102", "F", "25");
  server.result = twoLapResult;
  await adjudicate();
  saveReview(0, "pass", "第一趟备注");
  saveReview(1, "doubt", "第二趟备注");
  await adjudicate();
  assert(rendered().includes("第一趟备注") && rendered().includes("第二趟备注"), "两趟复核均保存");
  rowOf("b1").querySelector(".rec-time").value = "13";
  fire(rowOf("b1").querySelector(".rec-time"), "input"); // 只动第一趟
  rowOf("b1").querySelector(".rec-time").value = "12";
  fire(rowOf("b1").querySelector(".rec-time"), "input");
  await adjudicate();
  assert(!rendered().includes("第一趟备注"), "被改绑定的第一趟丢弃");
  assert(rendered().includes("第二趟备注"), "第二趟复核保留");

  console.log("场景8：区间绑定值改变但趟仍被合法裁决采纳，仍须丢弃；改回不恢复");
  saveReview(0, "pass", "区间备注F");
  setVal("smMin", "5"); // sm=12 仍落在 5~60，趟依旧被采纳
  fire($("smMin"), "input");
  await adjudicate();
  assert(!rendered().includes("区间备注F"), "区间下限改变即丢弃（即使趟仍采纳）");
  setVal("smMin", "10");
  fire($("smMin"), "input");
  await adjudicate();
  assert(fresh("区间备注F"), "区间改回后旧复核不恢复");

  console.log("场景9：真实防抖计时路径（不手动提交），瞬时改回后自动重算也不恢复");
  saveReview(0, "pass", "防抖备注G");
  rowOf("b1").querySelector(".rec-time").value = "14";
  fire(rowOf("b1").querySelector(".rec-time"), "input");
  rowOf("b1").querySelector(".rec-time").value = "12";
  fire(rowOf("b1").querySelector(".rec-time"), "input");
  await new Promise((r) => setTimeout(r, 450)); // 超过 350ms 防抖，自动提交一次
  await flush();
  assert(fresh("防抖备注G"), "防抖自动重算后显示未复核、空备注");

  console.log("场景10：填入示例清除全部复核；清空立即清除结果且不发请求");
  saveReview(0, "pass", "示例前备注");
  let fetchCount = 0;
  const origFetch = global.fetch;
  global.fetch = (...a) => { fetchCount++; return origFetch(...a); };
  fire($("sample-btn"), "click");
  await new Promise((r) => setTimeout(r, 450));
  await flush();
  assert(!rendered().includes("示例前备注"), "填入示例后旧备注消失");
  const sampleFetched = fetchCount;
  fire($("clear-btn"), "click");
  await flush();
  assert(rendered() === "" && $("error-box").hidden, "清空后结果与错误立即消失");
  assert(fetchCount === sampleFetched, "清空不会再发请求（在途版本守卫之外的防抖已取消）");

  console.log(failures === 0 ? "\nALL FRONTEND SCENARIOS PASSED" : `\n${failures} ASSERTION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
