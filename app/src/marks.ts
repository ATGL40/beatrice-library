import type { Friend, Kind, Mark, Vote } from "./store.ts";
import { esc } from "./text.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { isTier, mergeTiers, TIER_LABEL, TIER_KEYS, type TierKey, type Tiers } from "./tiers.ts";
import { cleanReports, type RecogReport } from "./recog.ts";
import { cleanTagReports, type TagReport } from "./tagreport.ts";

// 评分文件里的标记：导出时按选的类型和作品过滤，导入时清洗别人文件里的内容（不碰 Tauri，方便单测）
export const NOTE_MAX = 2000;
const STATUSES = ["want", "have", "played"];
const STATUS_TEXT: Record<string, string> = { want: "想玩", have: "已有", played: "玩过" };

export const FILE_KIND = "beatrice-marks";
// 改名前（v0.2.x）导出的文件用旧名字，照样能导入
const OLD_KIND = "galshelf-marks";
export interface MarksFile { kind: string; version: number; name: string; exported: string; marks: Record<string, Mark> }

/** 只留下选了的几类；什么都不剩就返回 null */
export function pickMark(m: Mark, kinds: Kind[]): Mark | null {
  const out: Mark = {
    status: m.status && kinds.includes(m.status as Kind) ? m.status : "",
    fav: !!m.fav && kinds.includes("fav"),
    score: kinds.includes("score") ? m.score || 0 : 0,
  };
  const note = kinds.includes("note") ? (m.note ?? "").trim() : "";
  if (note) out.note = note;
  if (kinds.includes("tier") && isTier(m.tier)) { out.tier = m.tier; out.tierPos = m.tierPos; }
  return out.status || out.fav || out.score || out.note || out.tier ? out : null;
}

/** 导出前把梯度表的档位并进标记：每部分了档的作品带上 tier 和 tierPos（档内第几，从 1 开始） */
export function withTiers(marks: Record<string, Mark>, tiers: Tiers): Record<string, Mark> {
  const out: Record<string, Mark> = { ...marks };
  for (const k of TIER_KEYS) {
    tiers[k].forEach((id, i) => (out[id] = { ...(out[id] ?? { status: "", fav: false, score: 0 }), tier: k, tierPos: i + 1 }));
  }
  return out;
}

/** 按类型过滤后还有内容的作品（不管 skip），给导出窗口列出来 */
export function exportable(marks: Record<string, Mark>, kinds: Kind[]): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const [id, m] of Object.entries(marks)) {
    const p = pickMark(m, kinds);
    if (p) out[id] = p;
  }
  return out;
}

/** 真正导出的：再去掉取消勾选的作品 */
export function filterMarks(marks: Record<string, Mark>, kinds: Kind[], skip: string[]): Record<string, Mark> {
  const out = exportable(marks, kinds);
  for (const id of skip) delete out[id];
  return out;
}

/** 不认识的字段：只留基本类型，字符串截短，最多留这么多个 */
export const EXTRA_MAX = 20, EXTRA_TEXT_MAX = 200;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KNOWN_FIELDS = new Set(["status", "fav", "score", "note", "tier", "tierPos"]);

/**
 * 别人文件里的标记逐条清洗：认识的字段按规则（合法的状态、收藏、0–5 星、评论截到 NOTE_MAX 字），
 * 不认识的字段原样留着，但只留字符串 / 数字 / 布尔（字符串截到 EXTRA_TEXT_MAX 字），不留对象和数组
 */
export function cleanMarks(raw: unknown, known?: (id: string) => boolean): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || UNSAFE_KEYS.has(id) || (known && !known(id))) continue;
    const r = v as Record<string, unknown>;
    const m: Mark = {
      status: typeof r.status === "string" && STATUSES.includes(r.status) ? (r.status as Mark["status"]) : "",
      fav: r.fav === true,
      score: Number.isInteger(r.score) && (r.score as number) >= 0 && (r.score as number) <= 5 ? (r.score as number) : 0,
    };
    const note = typeof r.note === "string" ? r.note.trim().slice(0, NOTE_MAX) : "";
    if (note) m.note = note;
    if (isTier(r.tier)) {
      m.tier = r.tier;
      m.tierPos = Number.isInteger(r.tierPos) && (r.tierPos as number) >= 1 ? (r.tierPos as number) : 1;
    }
    const extra = Object.entries(r)
      .filter(([k, x]) => !KNOWN_FIELDS.has(k) && !UNSAFE_KEYS.has(k) && ["string", "number", "boolean"].includes(typeof x))
      .slice(0, EXTRA_MAX);
    for (const [k, x] of extra) (m as unknown as Record<string, unknown>)[k.slice(0, 50)] = typeof x === "string" ? x.slice(0, EXTRA_TEXT_MAX) : x;
    if (m.status || m.fav || m.score || m.note || m.tier) out[id] = m;
  }
  return out;
}

/** 别人标记里的档位，写成「夯 第 2」 */
export const tierText = (m: Mark) => (isTier(m.tier) ? `${TIER_LABEL[m.tier]} 第 ${m.tierPos ?? 1}` : "");

// —— 评分文件：.json 只给软件读；.html 浏览器能直接看，软件读里面那段 JSON ——

/** html 版：独立页面（不引用外部资源），软件要的数据原样放在 #beatrice-marks 里 */
export function marksHtml(file: MarksFile, names: (id: string) => { name: string; orig: string }, app: string): string {
  const rows = Object.entries(file.marks)
    .map(([id, m]) => ({ id, m, ...names(id) }))
    .sort((a, b) => (b.m.score || 0) - (a.m.score || 0) || a.name.localeCompare(b.name))
    .map(({ m, name, orig }) => `<li>
  <div class="head"><b>${esc(name)}</b>${m.score ? `<span class="stars">${"★".repeat(m.score)}<i>${"★".repeat(5 - m.score)}</i></span>` : ""}${m.status ? `<span class="tag">${esc(STATUS_TEXT[m.status])}</span>` : ""}${m.fav ? `<span class="fav">♥</span>` : ""}${m.tier ? `<span class="tag">${esc(tierText(m))}</span>` : ""}</div>
  ${orig && orig !== name ? `<div class="orig">${esc(orig)}</div>` : ""}
  ${m.note ? `<p>${esc(m.note)}</p>` : ""}
</li>`).join("\n");
  // JSON 里的 < 写成 \u003c，免得提前结束 script 标签
  const json = JSON.stringify(file).replace(/</g, "\\u003c");
  const n = Object.keys(file.marks).length;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(file.name)}的黄油评分 · ${esc(app)}</title>
<style>
:root { --bg: #f6f3f7; --panel: #fff; --ink: #241d2b; --muted: #6e6578; --line: #e2dbe7; --accent: #b2265a; --gold: #c98a12; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #17121b; --panel: #221b28; --ink: #efe8f3; --muted: #a79cb1; --line: #382e40; --accent: #ef6f9c; --gold: #e8b041; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; padding: 24px 16px 48px; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 20px; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
li { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.head b { overflow-wrap: anywhere; }
.stars { color: var(--gold); letter-spacing: 1px; white-space: nowrap; }
.stars i { font-style: normal; color: var(--line); }
.tag { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; color: var(--muted); }
.fav { color: var(--accent); }
.orig { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
footer { color: var(--muted); font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<main>
<h1>${esc(file.name)}的评分</h1>
<p class="sub">${esc(file.exported)} 导出 · 共 ${n} 部</p>
<ul>
${rows}
</ul>
<footer>用${esc(app)}导出。在${esc(app)}的「设置 → 导入评分文件」里选这个文件，就能把这些评分加进去。</footer>
</main>
<script type="application/json" id="${FILE_KIND}">${json}</script>
</body>
</html>
`;
}

/** 要导出的评分文件：只有名字、日期和过滤后的标记，不带任何设置和路径 */
export function makeMarksFile(marks: Record<string, Mark>, kinds: Kind[], skip: string[], name: string, exported: string): MarksFile {
  return { kind: FILE_KIND, version: 1, name, exported, marks: filterMarks(marks, kinds, skip) };
}

/** 别人的评分文件变成一条「朋友」记录：只有 id、名字和清洗过的标记，文件里别的内容一概不收 */
export function friendFromFile(file: MarksFile, id: string, fallbackName: string, known?: (id: string) => boolean) {
  const name = String(file.name || fallbackName).slice(0, 20);
  return { id, name, marks: cleanMarks(file.marks, known) };
}

/** 加一条朋友记录；已经有同名的朋友就更新他的评分（id 不变），不重复加。返回新的列表和是不是更新 */
export function upsertFriend(friends: Friend[], f: Friend): { friends: Friend[]; updated: boolean } {
  const i = friends.findIndex(x => x.name === f.name);
  if (i < 0) return { friends: [...friends, f], updated: false };
  return { friends: friends.map((x, j) => (j === i ? { ...x, marks: f.marks } : x)), updated: true };
}

/** 读评分文件（.json 或 .html），不是碧翠子禁书库导出的就抛错 */
export function parseMarksFile(text: string): MarksFile {
  const t = text.replace(/^\uFEFF/, "").trim();
  let file: MarksFile | null = null;
  try {
    if (t.startsWith("{")) file = JSON.parse(t);
    else {
      const m = t.match(/<script[^>]*\bid=["']?(?:beatrice|galshelf)-marks["']?[^>]*>([\s\S]*?)<\/script>/i);
      if (m) file = JSON.parse(m[1]);
    }
  } catch { /* 下面统一报错 */ }
  if (!file || (file.kind !== FILE_KIND && file.kind !== OLD_KIND) || !file.marks || typeof file.marks !== "object") throw new Error("不是碧翠子禁书库导出的评分文件");
  if (typeof file.version === "number" && file.version > 1) throw new Error("这个评分文件是新版本的软件导出的，要新版本的软件才能导入");
  return file;
}

// —— 「这是我的」：把评分文件合并进自己的标记，已有的为准 ——

/** 这个字段在自己这边算不算「空着」：状态 ""、没收藏、0 星、评论只有空白、不认识的字段不存在 */
function isEmpty(key: string, v: unknown): boolean {
  if (key === "status") return !v;
  if (key === "fav") return v !== true;
  if (key === "score") return !v;
  if (key === "note") return typeof v !== "string" || !v.trim();
  return v === undefined;
}

/**
 * 把文件里的标记（先经过 cleanMarks）逐部、逐字段合并进 mine：自己空着的字段用文件里的补上，
 * 自己有值的保留，文件里的值不一样就算一处冲突；自己还没标记的作品整条加进来。不改动 mine 本身。
 * filled 是补上了内容的作品数，conflicts 是冲突的字段数
 */
export function mergeMine(mine: Record<string, Mark>, incoming: unknown, known?: (id: string) => boolean, tiers?: Tiers) {
  const marks: Record<string, Mark> = { ...mine };
  const touched = new Set<string>();
  const tierEntries: [string, TierKey, number][] = [];
  let conflicts = 0;
  for (const [id, all] of Object.entries(cleanMarks(incoming, known))) {
    // 档位不放进标记里，单独补进梯度表
    const { tier, tierPos, ...theirs } = all;
    if (tier) tierEntries.push([id, tier, tierPos ?? 1]);
    const hasContent = theirs.status || theirs.fav || theirs.score || theirs.note;
    const cur = mine[id];
    if (!cur) { if (hasContent) { marks[id] = theirs; touched.add(id); } continue; }
    const next = { ...cur } as Record<string, unknown>;
    let changed = false;
    for (const [k, v] of Object.entries(theirs)) {
      if (isEmpty(k, v)) continue; // 文件里这项本身是空的，没什么可补
      if (isEmpty(k, next[k])) { next[k] = v; changed = true; }
      else if (next[k] !== v) conflicts++;
    }
    if (changed) { marks[id] = next as unknown as Mark; touched.add(id); }
  }
  // 自己没分档的才补，接在那一档末尾，按对方的档内顺序
  const merged = tiers ? mergeTiers(tiers, tierEntries) : null;
  merged?.added.forEach(id => touched.add(id));
  return { marks, tiers: merged?.tiers ?? tiers, filled: touched.size, conflicts: conflicts + (merged?.conflicts ?? 0) };
}

// —— 提交给碧翠子禁书库：只有作品 id、星级和神作复议票（理由），没有名字、评论和别的标记 ——

export const SUBMIT_KIND = "beatrice-ratings-submission";
/** 收提交的邮箱；软件只会把这个地址的 mailto 链接交给系统（用户点了才开），别的 mailto 一概不开 */
export const SUBMIT_MAIL = "beatrice2library@gmail.com";
/** 能交给系统打开的链接：https，或者写给 SUBMIT_MAIL 的 mailto */
export const okLink = (u: string) => /^https:\/\/[^\s]+$/i.test(u) || okMail(u);
/** 写给 SUBMIT_MAIL 的 mailto：最多带一个 subject（不能再加 to、cc、bcc 这些），解码后也不能有控制字符 */
function okMail(u: string) {
  const head = `mailto:${SUBMIT_MAIL}`, rest = u.slice(head.length);
  if (!u.startsWith(head) || !/^(\?subject=[^&?#=\s]*)?$/.test(rest)) return false;
  try { return !/[\x00-\x1f\x7f]/.test(decodeURIComponent(rest)); } catch { return false; }
}
/** 哪种票要写理由（oppose 反对 / all 都要 / none 都不用）、至少几个字；数据包的配方 canon 里可以改 */
export interface ReasonRule { required: string; min: number }
export const REASON_RULE: ReasonRule = { required: "oppose", min: 20 };
/** 这张票的问题（理由不够长）；没问题是 "" */
export function voteProblem(v: Vote, rule = REASON_RULE): string {
  const need = rule.required === "all" || (rule.required === "oppose" && v.vote === "oppose");
  return need && [...(v.reason ?? "").trim()].length < rule.min ? `${v.vote === "oppose" ? "反对" : "这张票"}要写理由，至少 ${rule.min} 字` : "";
}

/**
 * 提交文件：星级只留 1–5 的整数，票只留支持 / 反对且没问题的，我的游戏不算；理由去掉首尾空白、截到 NOTE_MAX 字，空的不写。
 * 黑榜 {作品 id: {reason?}}：只带 reason 一个字段，理由的规则和票一样（可以不写）；有内容才写 blacklist 字段，version 还是 1（旧的结算脚本不看这个字段）。
 * 识别报告 recognition：「认错了」时记下的（见 recog.ts），只留白名单里的字段、再脱敏一遍；有内容才写。
 * 标签报告 tags {作品 id: {wrong, missing, note?, date}}：「标签不对？」记下的（见 tagreport.ts），我的游戏、年龄类题材去掉；有内容才写
 */
export function makeSubmission(app: string, catalog: string, ratings: Record<string, number>, votes: Record<string, Vote>, rule = REASON_RULE,
  blacklist: Record<string, { reason?: string }> = {}, recognition: RecogReport[] = [], tags: Record<string, TagReport> = {}) {
  const r: Record<string, number> = {}, v: Record<string, Vote> = {};
  // 我的游戏（local- 开头）只在本机，不提交
  for (const [id, s] of Object.entries(ratings)) if (Number.isInteger(s) && s >= 1 && s <= 5 && !id.startsWith("local-")) r[id] = s;
  for (const [id, x] of Object.entries(votes)) {
    if (id.startsWith("local-") || (x?.vote !== "support" && x?.vote !== "oppose") || voteProblem(x, rule)) continue;
    const reason = (x.reason ?? "").trim().slice(0, NOTE_MAX);
    v[id] = reason ? { vote: x.vote, reason } : { vote: x.vote };
  }
  const b: Record<string, { reason?: string }> = {};
  for (const [id, x] of Object.entries(blacklist)) {
    if (id.startsWith("local-")) continue;
    const reason = typeof x?.reason === "string" ? x.reason.trim().slice(0, NOTE_MAX) : "";
    b[id] = reason ? { reason } : {};
  }
  const rec = cleanReports(recognition), t = cleanTagReports(tags);
  return { kind: SUBMIT_KIND, version: 1, app, catalog, ratings: r, votes: v, ...(Object.keys(b).length ? { blacklist: b } : {}), ...(rec.length ? { recognition: rec } : {}),
    ...(Object.keys(t).length ? { tags: t } : {}) };
}
