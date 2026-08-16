/* Calabash Lab 创业看板 —— 前端逻辑
   数据层：配置 Supabase 后用云端（两人实时同步），否则自动降级为本地 localStorage 预览。
   视图：周视图（日历/时间表）｜ 我的 To Do ｜ 看板 ｜ 集市日历 */

const OWNERS = ["待认领", "Silvia", "Haihong", "共同"];
const PROJECTS = ["Calabash Lab", "炸鸡店(研究)"];
const STATUSES = ["待分配池", "本周进行中", "卡点", "已完成"];
const MILESTONES = { SKU: "SKU体系上线", 社媒: "社媒破粉", 网站: "网站上线" };
const WD = ["一", "二", "三", "四", "五", "六", "日"];
const DEFAULT_CHECKLIST = [
  { n: "找场地 / 预约", done: false },
  { n: "前一晚：上货充电收拾", done: false },
  { n: "当天：摆货", done: false },
  { n: "推销介绍", done: false },
  { n: "收钱结账算账", done: false }
];

const cfg = window.APP_CONFIG || {};
const useCloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_URL.startsWith("http") &&
  cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.length > 20);
let sb = null;
if (useCloud) sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

let tasks = [];
let markets = [];
let metaCache = null;
let identity = localStorage.getItem("identity") || "Silvia";
let currentView = "week";

/* ---------- 工具函数 ---------- */
function isoWeek(d) {
  const date = new Date(d);
  const dayn = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayn + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return date.getFullYear() + "-W" + String(week).padStart(2, "0");
}
function prevWeek(iso) {
  const [y, w] = iso.split("-W"); let Y = +y, W = +w - 1; if (W < 1) { Y--; W = 52; }
  return Y + "-W" + String(W).padStart(2, "0");
}
function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function nextMarketDate() { const d = new Date(); let diff = 6 - d.getDay(); if (diff <= 0) diff += 7; d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10); }
function dateStr(off) { const x = new Date(); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); }
function weekRange(off) { const m = mondayOf(new Date()); const s = addDays(m, off * 7); const e = addDays(m, off * 7 + 6); return `${s.getMonth() + 1}/${s.getDate()}–${e.getMonth() + 1}/${e.getDate()}`; }
function esc(s) { return (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }

/* ---------- 数据层：tasks ---------- */
async function loadTasks() {
  if (useCloud) { const { data, error } = await sb.from("tasks").select("*").order("created_at", { ascending: false }); if (error) throw error; return data || []; }
  return JSON.parse(localStorage.getItem("tasks") || "[]");
}
async function persist(t) {
  if (useCloud) {
    if (t.id) { const { id, ...rest } = t; const { error } = await sb.from("tasks").update(rest).eq("id", id); if (error) throw error; return t; }
    const { id, ...rest } = t; const { data, error } = await sb.from("tasks").insert(rest).select(); if (error) throw error; return data[0];
  }
  let list = JSON.parse(localStorage.getItem("tasks") || "[]");
  if (t.id) list = list.map(x => x.id === t.id ? { ...x, ...t } : x);
  else { t.id = "local_" + Date.now() + Math.random().toString(36).slice(2); list.push(t); }
  localStorage.setItem("tasks", JSON.stringify(list)); return t;
}
async function saveTask(t, skipStreak) {
  const week = isoWeek(new Date());
  t.updated_week = week; t.updated_at = new Date().toISOString();
  await persist(t);
  if (!skipStreak) await bumpStreak(t.owner);
  return t;
}
async function deleteTask(id) {
  if (useCloud) { const { error } = await sb.from("tasks").delete().eq("id", id); if (error) throw error; }
  else { let list = JSON.parse(localStorage.getItem("tasks") || "[]"); list = list.filter(x => x.id !== id); localStorage.setItem("tasks", JSON.stringify(list)); }
}
async function getMeta() {
  const def = { Silvia: { count: 0, lastWeek: "" }, Haihong: { count: 0, lastWeek: "" } };
  if (useCloud) { const { data } = await sb.from("meta").select("value").eq("key", "streaks").single(); return data ? data.value : def; }
  return JSON.parse(localStorage.getItem("streaks") || JSON.stringify(def));
}
async function setMeta(m) { if (useCloud) await sb.from("meta").upsert({ key: "streaks", value: m }); else localStorage.setItem("streaks", JSON.stringify(m)); }
async function bumpStreak(owner) {
  if (!owner || owner === "共同" || owner === "待认领") return;
  const m = await getMeta(); const wk = isoWeek(new Date());
  const s = m[owner] || { count: 0, lastWeek: "" };
  if (s.lastWeek === wk) { /* 本周已记 */ }
  else if (s.lastWeek === prevWeek(wk)) s.count++; else s.count = 1;
  s.lastWeek = wk; m[owner] = s; await setMeta(m);
}
async function markDone(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.status = "已完成"; t.progress = 100;
  try { await saveTask(t); await refresh(); toast("已完成 🎉 创业币 +1"); } catch (e) { toast("保存失败: " + e.message); }
}

/* ---------- 数据层：markets ---------- */
async function loadMarkets() {
  if (useCloud) { const { data, error } = await sb.from("markets").select("*"); if (error) throw error; return data || []; }
  return JSON.parse(localStorage.getItem("markets") || "[]");
}
async function persistMarket(m) {
  if (useCloud) {
    if (m.id) { const { id, ...rest } = m; const { error } = await sb.from("markets").update(rest).eq("id", id); if (error) throw error; return m; }
    const { id, ...rest } = m; const { data, error } = await sb.from("markets").insert(rest).select(); if (error) throw error; return data[0];
  }
  let list = JSON.parse(localStorage.getItem("markets") || "[]");
  if (m.id) list = list.map(x => x.id === m.id ? { ...x, ...m } : x);
  else { m.id = "localm_" + Date.now() + Math.random().toString(36).slice(2); list.push(m); }
  localStorage.setItem("markets", JSON.stringify(list)); return m;
}
async function deleteMarket(id) {
  if (useCloud) { const { error } = await sb.from("markets").delete().eq("id", id); if (error) throw error; }
  else { let list = JSON.parse(localStorage.getItem("markets") || "[]"); list = list.filter(x => x.id !== id); localStorage.setItem("markets", JSON.stringify(list)); }
}

/* ---------- 首次运行预置（建议明细，可增减） ---------- */
async function seedIfEmpty() {
  const existing = await loadTasks();
  if (existing.length > 0) return;
  const d = dateStr;
  const seeds = [
    // —— SKU 体系（预置选项：先“待认领”，讨论后增/删并认领）——
    { project: "Calabash Lab", title: "SKU-1 盘点现有存货（厂家/型号/数量/进货成本清单）", owner: "待认领", status: "待分配池", progress: 0, due: d(3), milestone: "SKU", note: "建议：Haihong 主建，Silvia 定框架" },
    { project: "Calabash Lab", title: "SKU-2 定编码规则（如 CL-RC-001-R）", owner: "待认领", status: "待分配池", progress: 0, due: d(4), milestone: "SKU", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "SKU-3 定数据结构（SKU/名称/厂家/进货价/数量/库位/状态/图片）", owner: "待认领", status: "待分配池", progress: 0, due: d(5), milestone: "SKU", note: "建议：共同" },
    { project: "Calabash Lab", title: "SKU-4 搭建库存台账骨架（Sheets 或看板模块）", owner: "待认领", status: "待分配池", progress: 0, due: d(7), milestone: "SKU", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "SKU-5 录入首批存货数据", owner: "待认领", status: "待分配池", progress: 0, due: d(9), milestone: "SKU", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "SKU-6 设补货触发（低于阈值标“该补货”）", owner: "待认领", status: "待分配池", progress: 0, due: d(11), milestone: "SKU", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "SKU-7 与销售联动（集市卖出扣库存、算账）", owner: "待认领", status: "待分配池", progress: 0, due: d(13), milestone: "SKU", note: "建议：共同" },
    { project: "Calabash Lab", title: "SKU-8 周度库存复盘（准确率、周转率）", owner: "待认领", status: "待分配池", progress: 0, due: d(15), milestone: "SKU", note: "建议：共同" },
    // —— 社媒推广 ——
    { project: "Calabash Lab", title: "社媒-1 定平台与定位（IG/TikTok/FB/小红书 + 内容调性）", owner: "待认领", status: "待分配池", progress: 0, due: d(3), milestone: "社媒", note: "建议：Silvia 主导" },
    { project: "Calabash Lab", title: "社媒-2 账号搭建（注册完善主页、简介、链接）", owner: "待认领", status: "待分配池", progress: 0, due: d(5), milestone: "社媒", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "社媒-3 内容规划（栏目化 + 内容日历）", owner: "待认领", status: "待分配池", progress: 0, due: d(7), milestone: "社媒", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "社媒-4 制作首批内容（手机拍剪 N 条）", owner: "待认领", status: "待分配池", progress: 0, due: d(9), milestone: "社媒", note: "建议：共同" },
    { project: "Calabash Lab", title: "社媒-5 发布节奏（每周 X 条，定谁拍/剪/发）", owner: "待认领", status: "待分配池", progress: 0, due: d(11), milestone: "社媒", note: "建议：共同" },
    { project: "Calabash Lab", title: "社媒-6 互动涨粉（回评论、现场引导关注）", owner: "待认领", status: "待分配池", progress: 0, due: d(13), milestone: "社媒", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "社媒-7 数据复盘（周看粉增/互动，调内容）", owner: "待认领", status: "待分配池", progress: 0, due: d(15), milestone: "社媒", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "社媒-8 引流销售（主页挂购买/集市/网站入口）", owner: "待认领", status: "待分配池", progress: 0, due: d(17), milestone: "社媒", note: "建议：共同" },
    // —— 网站搭建 ——
    { project: "Calabash Lab", title: "网站-1 定目标与范围（展示站 vs 电商站 MVP）", owner: "待认领", status: "待分配池", progress: 0, due: d(6), milestone: "网站", note: "建议：共同" },
    { project: "Calabash Lab", title: "网站-2 选技术（静态站 + 免费托管）", owner: "待认领", status: "待分配池", progress: 0, due: d(8), milestone: "网站", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "网站-3 信息架构（首页/产品/关于/购买指引/联系）", owner: "待认领", status: "待分配池", progress: 0, due: d(10), milestone: "网站", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "网站-4 设计稿（布局草图、配色、移动端）", owner: "待认领", status: "待分配池", progress: 0, due: d(12), milestone: "网站", note: "建议：共同" },
    { project: "Calabash Lab", title: "网站-5 开发页面（搭页面 + 产品展示 + 表单）", owner: "待认领", status: "待分配池", progress: 0, due: d(16), milestone: "网站", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "网站-6 内容填充（产品图、文案，从社媒拉素材）", owner: "待认领", status: "待分配池", progress: 0, due: d(18), milestone: "网站", note: "建议：Silvia" },
    { project: "Calabash Lab", title: "网站-7 部署上线（绑域名可选 + 免费托管）", owner: "待认领", status: "待分配池", progress: 0, due: d(21), milestone: "网站", note: "建议：Haihong" },
    { project: "Calabash Lab", title: "网站-8 推广接入（社媒↔网站互链、集市二维码）", owner: "待认领", status: "待分配池", progress: 0, due: d(23), milestone: "网站", note: "建议：共同" },
    { project: "Calabash Lab", title: "网站-9 维护机制（谁更新、频率）", owner: "待认领", status: "待分配池", progress: 0, due: d(25), milestone: "网站", note: "建议：共同" },
    // —— 炸鸡店（研究，预置选项）——
    { project: "炸鸡店(研究)", title: "炸鸡配方初步研发（第一轮试验）", owner: "待认领", status: "待分配池", progress: 0, due: d(9), note: "建议：Haihong" },
    { project: "炸鸡店(研究)", title: "市场/竞品调研（定价与空白点）", owner: "待认领", status: "待分配池", progress: 0, due: d(10), note: "建议：Silvia" },
    { project: "炸鸡店(研究)", title: "商业计划 / 资金 / 合规初步", owner: "待认领", status: "待分配池", progress: 0, due: d(14), note: "建议：Silvia" }
  ];
  for (const s of seeds) await persist(s);
}
async function seedMarketsIfEmpty() {
  const existing = await loadMarkets();
  if (existing.length > 0) return;
  const seeds = [
    { title: "市中心周末集市（意向，待定日期）", event_date: null, location: "", status: "商榷中", checklist: JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)) },
    { title: "Avondale 夜市", event_date: nextMarketDate(), location: "Avondale", status: "已申请", checklist: JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)) }
  ];
  for (const s of seeds) await persistMarket(s);
}

/* ---------- 渲染：奖励 / 提醒 ---------- */
function rewardHTML() {
  const pool = tasks.filter(t => t.status === "已完成").length;
  const st = metaCache || { Silvia: { count: 0 }, Haihong: { count: 0 } };
  const ms = Object.entries(MILESTONES).map(([k, label]) => {
    const done = tasks.some(t => t.milestone === k && t.status === "已完成");
    return `<div class="chip milestone ${done ? "done" : ""}">${done ? "✓" : "○"} <b>${label}</b></div>`;
  }).join("");
  return `<div class="chip">创业币 <b>${pool}</b></div><div class="chip">${identity} 连续 <b>${st[identity] ? st[identity].count : 0}</b> 周</div>${ms}`;
}
function reminderHTML() {
  const day = new Date().getDay();
  if (![3, 4, 5, 6].includes(day)) return "";
  const wk = isoWeek(new Date());
  const msgs = OWNERS.filter(o => o !== "共同" && o !== "待认领").filter(o =>
    !tasks.some(t => t.owner === o && t.status === "本周进行中" && t.updated_week === wk));
  return msgs.length ? `<div class="reminder">系统提醒：<b>${msgs.join("、")}</b> 本周还没更新进度（周三起触发，非人工催促）。</div>` : "";
}

/* ---------- 渲染：周视图 ---------- */
function dayCard(t) {
  return `<div class="dcard" data-id="${t.id}">
    <label class="ck"><input type="checkbox" data-complete="${t.id}"><span></span></label>
    <div class="dc-body">
      <div class="dc-title">${esc(t.title)}</div>
      <div class="dc-meta"><span class="tag owner ${t.owner==='待认领'?'pending':''}">${esc(t.owner)}</span><span class="tag proj">${esc(t.project)}</span>${t.milestone ? `<span class="tag">★${esc(MILESTONES[t.milestone])}</span>` : ""}</div>
    </div></div>`;
}
function weekBlock(off, label) {
  const mon = mondayOf(new Date());
  let html = `<div class="week-head">${label} · ${weekRange(off)}</div><div class="days">`;
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, off * 7 + i);
    const ds = day.toISOString().slice(0, 10);
    const items = tasks.filter(t => t.due === ds && t.status !== "已完成");
    const done = tasks.filter(t => t.due === ds && t.status === "已完成");
    const cards = items.map(dayCard).join("") +
      done.map(t => `<div class="dcard done"><div class="dc-body"><div class="dc-title">✓ ${esc(t.title)}</div><div class="dc-meta"><span class="tag owner">${esc(t.owner)}</span></div></div></div>`).join("");
    html += `<div class="day"><div class="day-h"><b>周${WD[i]}</b><span>${day.getMonth() + 1}/${day.getDate()}</span></div><div class="day-body">${cards || '<div class="empty">—</div>'}</div></div>`;
  }
  return html + `</div>`;
}
function renderWeek() {
  const mon = mondayOf(new Date());
  const unsched = tasks.filter(t => (!t.due || new Date(t.due) < mon || new Date(t.due) > addDays(mon, 13)) && t.status !== "已完成");
  const uns = unsched.length ? `<div class="unscheduled"><b>未排期（无截止日或超出两周）</b>${unsched.map(t => `<span class="chip">${esc(t.title)} · ${esc(t.owner)}</span>`).join("")}</div>` : "";
  return weekBlock(0, "本周") + weekBlock(1, "下周") + uns;
}

/* ---------- 渲染：我的 To Do ---------- */
function renderMyTodo() {
  const mine = tasks.filter(t => (t.owner === identity || t.owner === "共同") && t.status !== "已完成");
  const done = tasks.filter(t => (t.owner === identity || t.owner === "共同") && t.status === "已完成");
  const ms = Object.entries(MILESTONES).map(([k, label]) => {
    const on = mine.some(t => t.milestone === k);
    const dn = done.some(t => t.milestone === k);
    return `<div class="chip ms ${dn ? "done" : ""}">${dn ? "✓" : (on ? "●" : "○")} ${label}</div>`;
  }).join("");
  const list = arr => arr.length ? arr.map(t => `<div class="todo-item" data-id="${t.id}">
    <label class="ck"><input type="checkbox" data-complete="${t.id}"><span></span></label>
    <div class="ti-body"><div class="ti-title">${esc(t.title)}</div>
    <div class="ti-meta"><span class="tag proj">${esc(t.project)}</span>${t.due ? `<span class="tag due">截止 ${esc(t.due)}</span>` : ""}<span class="bar mini"><i style="width:${t.progress || 0}%"></i></span></div></div></div>`).join("")
    : `<div class="empty">本周暂无待办 🎉</div>`;
  const doneList = done.length ? done.map(t => `<div class="todo-item done"><div class="ti-body"><div class="ti-title">✓ ${esc(t.title)}</div><div class="ti-meta"><span class="tag proj">${esc(t.project)}</span></div></div></div>`).join("")
    : `<div class="empty">还没有完成项</div>`;
  return `<div class="mytodo"><div class="ms-row">${ms}</div>
    <h3>${identity} 的本周待办 <span class="cnt">${mine.length}</span></h3>${list(mine)}
    <h3>已完成 <span class="cnt">${done.length}</span></h3>${doneList}</div>`;
}

/* ---------- 渲染：看板 ---------- */
function cardHTML(t) {
  const over = t.due && t.status !== "已完成" && new Date(t.due) < new Date();
  return `<div class="card s-${esc(t.status)}" data-id="${t.id}">
    <div class="title">${esc(t.title)}</div>
    <div class="meta">
      <span class="tag proj">${esc(t.project)}</span>
      <span class="tag owner ${t.owner==='待认领'?'pending':''}">${esc(t.owner)}</span>
      ${t.due ? `<span class="tag due ${over ? "over" : ""}">截止 ${esc(t.due)}</span>` : ""}
      ${t.milestone ? `<span class="tag">★${esc(MILESTONES[t.milestone])}</span>` : ""}
    </div>
    <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
    <input type="range" min="0" max="100" value="${t.progress || 0}" data-f="progress">
    <div class="acts">
      <select data-f="owner">${OWNERS.map(o => `<option ${o === t.owner ? "selected" : ""}>${o}</option>`).join("")}</select>
      <select data-f="status">${STATUSES.map(s => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input type="date" data-f="due" value="${t.due || ""}">
    </div>
    ${t.blocker ? `<div class="blk">卡点：${esc(t.blocker)}</div>` : ""}
    ${t.note ? `<div class="note">备注：${esc(t.note)}</div>` : ""}
    <div class="acts">
      <button class="btn small ghost" data-act="edit">编辑</button>
      <button class="btn small ghost" data-act="claim">认领</button>
      <button class="btn small ${t.status === "已完成" ? "" : "done"}" data-act="done">${t.status === "已完成" ? "已完成" : "✓完成"}</button>
      <button class="btn small ghost" data-act="del">删除</button>
    </div>
  </div>`;
}
function renderBoard() {
  const proj = document.getElementById("projFilter").value;
  const list = tasks.filter(t => proj === "全部" || t.project === proj);
  return `<div class="board">` + STATUSES.map(s => {
    const col = list.filter(t => t.status === s);
    const hint = s === "待分配池" ? `<div class="col-hint">预置待办选项：讨论后<b>增</b>（＋新建）/<b>删</b>，点卡片【认领】分配给自己 →</div>` : "";
    return `<div class="col"><h2>${s} <span class="cnt">${col.length}</span></h2>${hint}<div class="cards">${col.map(cardHTML).join("") || '<div class="empty">—</div>'}</div></div>`;
  }).join("") + `</div>`;
}

/* ---------- 渲染：集市日历 ---------- */
function marketCard(m) {
  const cl = (m.checklist || []).map((c, i) => `<label class="mck ${c.done ? "done" : ""}"><input type="checkbox" data-mact="check" data-mid="${m.id}" data-idx="${i}" ${c.done ? "checked" : ""}><span>${esc(c.n)}</span></label>`).join("");
  const doneN = (m.checklist || []).filter(c => c.done).length;
  const total = (m.checklist || []).length;
  return `<div class="mcard" data-mid="${m.id}">
    <div class="mc-top">
      <input class="mc-title" data-mact="title" data-mid="${m.id}" value="${esc(m.title)}">
      <button class="btn small ghost" data-mact="del" data-mid="${m.id}">删除</button>
    </div>
    <div class="mc-meta">
      <label>日期<input type="date" data-mact="date" data-mid="${m.id}" value="${m.event_date || ""}"></label>
      <label>状态<select data-mact="status" data-mid="${m.id}"><option ${m.status === "商榷中" ? "selected" : ""}>商榷中</option><option ${m.status === "已申请" ? "selected" : ""}>已申请</option></select></label>
      <label>地点<input data-mact="loc" data-mid="${m.id}" value="${esc(m.location || "")}" placeholder="地点"></label>
    </div>
    <div class="mc-prog">筹备进度 ${doneN}/${total}</div>
    <div class="mc-check">${cl}</div>
    <div class="mc-add"><input id="newItem_${m.id}" placeholder="添加筹备项…"><button class="btn small" data-mact="additem" data-mid="${m.id}">＋</button></div>
  </div>`;
}
function renderMarket() {
  const pending = markets.filter(m => m.status === "商榷中" || !m.event_date);
  const applied = markets.filter(m => m.status === "已申请" && m.event_date).sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  const pHTML = pending.length ? pending.map(marketCard).join("") : '<div class="empty">暂无商榷中的集市</div>';
  const aHTML = applied.length ? applied.map(marketCard).join("") : '<div class="empty">暂无已申请的集市，点右上角“＋ 新增集市”</div>';
  return `<div class="market-view">
    <div class="mv-head"><h3>🟡 商榷中的集市（清单）</h3></div>
    <div class="market-list pending">${pHTML}</div>
    <div class="mv-head"><h3>🟢 已申请的集市（按日期排）</h3><button class="btn small" id="addMarket">＋ 新增集市</button></div>
    <div class="market-list cal">${aHTML}</div>
  </div>`;
}

/* ---------- 总渲染 ---------- */
function render() {
  document.getElementById("reward").innerHTML = rewardHTML();
  document.getElementById("reminderWrap").innerHTML = reminderHTML();
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === currentView));
  const main = document.getElementById("main");
  if (currentView === "week") main.innerHTML = renderWeek();
  else if (currentView === "todo") main.innerHTML = renderMyTodo();
  else if (currentView === "market") main.innerHTML = renderMarket();
  else main.innerHTML = renderBoard();
  document.getElementById("weekLabel").textContent = "本周 " + isoWeek(new Date());
}
async function refresh() { tasks = await loadTasks(); markets = await loadMarkets(); metaCache = await getMeta(); render(); }

/* ---------- 交互：身份 / tab / 过滤器 ---------- */
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => { currentView = b.dataset.view; render(); }));
document.getElementById("idBox").addEventListener("click", e => {
  const b = e.target.closest("button.id"); if (!b) return;
  identity = b.dataset.id; localStorage.setItem("identity", identity);
  document.querySelectorAll("#idBox button.id").forEach(x => x.classList.toggle("active", x.dataset.id === identity));
  render();
});
document.getElementById("projFilter").addEventListener("change", render);

/* ---------- 交互：main 内的任务勾选 / 卡片编辑 ---------- */
document.getElementById("main").addEventListener("change", async e => {
  const mEl = e.target.closest("[data-mact]"); if (mEl) { await handleMarketChange(mEl); return; }
  const cb = e.target.closest("input[data-complete]"); if (cb) { if (cb.checked) await markDone(cb.dataset.complete); }
});
document.getElementById("main").addEventListener("input", async e => {
  const mEl = e.target.closest("[data-mact]"); if (mEl) { await handleMarketInput(mEl, e.target); return; }
  const card = e.target.closest(".card"); if (!card) return;
  const f = e.target.dataset.f; if (!f) return;
  const t = tasks.find(x => x.id === card.dataset.id); if (!t) return;
  let v = e.target.value; if (f === "progress") v = +v;
  t[f] = v;
  try { await saveTask(t); await refresh(); toast("已保存"); } catch (err) { toast("保存失败: " + err.message); }
});
document.getElementById("main").addEventListener("click", async e => {
  if (e.target.id === "addMarket") { openMarketModal(); return; }
  const mEl = e.target.closest("[data-mact]"); if (mEl) { await handleMarketClick(mEl); return; }
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const card = e.target.closest(".card"); const t = tasks.find(x => x.id === card.dataset.id); if (!t) return;
  const act = btn.dataset.act;
  if (act === "del") { if (confirm("删除该任务？")) { await deleteTask(t.id); await refresh(); } }
  if (act === "done") await markDone(t.id);
  if (act === "claim") { t.owner = identity; t.status = "本周进行中"; t.claimed_week = isoWeek(new Date()); if (!t.due) t.due = nextMarketDate(); await saveTask(t); await refresh(); toast(identity + " 已认领"); }
  if (act === "edit") openModal(t);
});

/* ---------- 集市交互处理 ---------- */
async function getMarket(id) { return markets.find(x => x.id === id); }
async function handleMarketClick(el) {
  const id = el.dataset.mid; const act = el.dataset.mact;
  const m = await getMarket(id); if (!m) return;
  if (act === "del") { if (confirm("删除该集市？")) { await deleteMarket(id); await refresh(); toast("已删除"); } }
  if (act === "additem") {
    const inp = document.getElementById("newItem_" + id); const v = (inp.value || "").trim();
    if (!v) return;
    m.checklist = m.checklist || []; m.checklist.push({ n: v, done: false });
    await persistMarket(m); await refresh();
  }
}
async function handleMarketChange(el) {
  const id = el.dataset.mid; const act = el.dataset.mact;
  const m = await getMarket(id); if (!m) return;
  if (act === "check") { const idx = +el.dataset.idx; m.checklist[idx].done = el.checked; await persistMarket(m); await refresh(); }
  if (act === "status") { m.status = el.value; await persistMarket(m); await refresh(); }
  if (act === "date") { m.event_date = el.value || null; await persistMarket(m); await refresh(); }
}
async function handleMarketInput(el) {
  const id = el.dataset.mid; const act = el.dataset.mact;
  const m = await getMarket(id); if (!m) return;
  if (act === "title") { m.title = el.value; await persistMarket(m); }
  if (act === "loc") { m.location = el.value; await persistMarket(m); }
}

/* ---------- 任务模态框 ---------- */
let editingId = "";
function openModal(t) {
  const m = document.getElementById("modal");
  m.classList.add("show");
  document.getElementById("modalTitle").textContent = t ? "编辑任务" : "新建任务";
  document.getElementById("mTitle").value = t ? t.title : "";
  document.getElementById("mProject").value = t ? t.project : "Calabash Lab";
  document.getElementById("mOwner").value = t ? t.owner : "共同";
  document.getElementById("mStatus").value = t ? t.status : "待分配池";
  document.getElementById("mDue").value = t ? (t.due || "") : "";
  document.getElementById("mMilestone").value = t ? (t.milestone || "") : "";
  document.getElementById("mBlocker").value = t ? (t.blocker || "") : "";
  document.getElementById("mNote").value = t ? (t.note || "") : "";
  editingId = t ? t.id : "";
}
document.getElementById("modalCancel").addEventListener("click", () => document.getElementById("modal").classList.remove("show"));
document.getElementById("modalSave").addEventListener("click", async () => {
  const data = {
    title: document.getElementById("mTitle").value.trim(),
    project: document.getElementById("mProject").value,
    owner: document.getElementById("mOwner").value,
    status: document.getElementById("mStatus").value,
    due: document.getElementById("mDue").value || null,
    milestone: document.getElementById("mMilestone").value || null,
    blocker: document.getElementById("mBlocker").value.trim(),
    note: document.getElementById("mNote").value.trim()
  };
  if (!data.title) { toast("请填写任务标题"); return; }
  if (editingId) { const t = tasks.find(x => x.id === editingId); Object.assign(t, data); await saveTask(t); }
  else { await saveTask({ ...data, progress: 0 }); }
  document.getElementById("modal").classList.remove("show"); await refresh(); toast("已保存");
});

/* ---------- 集市模态框 ---------- */
function openMarketModal() {
  document.getElementById("marketModal").classList.add("show");
  document.getElementById("mkTitle").value = "";
  document.getElementById("mkDate").value = nextMarketDate();
  document.getElementById("mkLoc").value = "";
  document.getElementById("mkStatus").value = "商榷中";
}
document.getElementById("mkCancel").addEventListener("click", () => document.getElementById("marketModal").classList.remove("show"));
document.getElementById("mkSave").addEventListener("click", async () => {
  const title = document.getElementById("mkTitle").value.trim();
  if (!title) { toast("请填写集市名称"); return; }
  const m = {
    title,
    event_date: document.getElementById("mkDate").value || null,
    location: document.getElementById("mkLoc").value.trim(),
    status: document.getElementById("mkStatus").value,
    checklist: JSON.parse(JSON.stringify(DEFAULT_CHECKLIST))
  };
  await persistMarket(m);
  document.getElementById("marketModal").classList.remove("show");
  if (currentView !== "market") { currentView = "market"; }
  await refresh(); toast("已新增集市");
});

/* ---------- 启动 ---------- */
(async function init() {
  document.querySelectorAll("#idBox button.id").forEach(b => b.classList.toggle("active", b.dataset.id === identity));
  if (useCloud) toast("云端模式：数据实时同步"); else toast("本地预览模式：填 config.js 接入 Supabase");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try { await seedIfEmpty(); await seedMarketsIfEmpty(); await refresh(); } catch (e) { toast("加载失败: " + e.message); }
})();
