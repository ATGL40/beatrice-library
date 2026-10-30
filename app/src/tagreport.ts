import type { Game } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { HIDDEN_GENRES } from "./genres.ts";

// —— 「标签不对？」：详情页里记下一部作品哪些题材标签不对、少了哪些，提交时可以一起发给碧翠子禁书库，
//    只给维护者下次更新资料时改标签用，不公开。纯函数，方便单测 ——

/** 一条标签报告：wrong 不对的题材 id，missing 少了的题材 id，note 一句说明（可以没有），date 日期 */
export interface TagReport { wrong: string[]; missing: string[]; note?: string; date: string }

export const TAG_NOTE_MAX = 200;
const MAX_IDS = 50;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** 默认能留的题材 id：不是不显示的年龄类（数据包里另外写了 hidden 的，在提交时按当时的字典再筛一遍） */
const notHidden = (id: string) => !HIDDEN_GENRES.has(id);

/** 只留字符串、去掉重复，ok 说不行的丢掉 */
const ids = (v: unknown, ok: (id: string) => boolean) =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x.trim() && ok(x)))].slice(0, MAX_IDS);

/** 做一条报告：去掉首尾空白、截到 200 字；不对、少了、说明都空着就是 null（这条删掉） */
export function makeTagReport(wrong: string[], missing: string[], note = "", date = new Date().toISOString().slice(0, 10), ok = notHidden): TagReport | null {
  const w = ids(wrong, ok), m = ids(missing, id => ok(id) && !w.includes(id)), n = note.trim().slice(0, TAG_NOTE_MAX);
  if (!w.length && !m.length && !n) return null;
  const r: TagReport = { wrong: w, missing: m, date };
  if (n) r.note = n;
  return r;
}

/** 数据文件里的 tagReports：{作品 id: 报告}；不是对象的整个当没有，我的游戏、坏的条目、空报告丢掉，不认识的题材 id 和年龄类的去掉 */
export function cleanTagReports(raw: unknown, ok = notHidden): Record<string, TagReport> {
  const out: Record<string, TagReport> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || id.startsWith("local-") || UNSAFE_KEYS.has(id) || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date)) ? String(o.date) : "";
    const r = makeTagReport(o.wrong as string[], o.missing as string[], typeof o.note === "string" ? o.note : "", date, ok);
    if (r) out[id] = r;
  }
  return out;
}

/**
 * 按现在的资料看还算数的部分：不对的只留这部作品现在还带着的标签，少了的只留字典里有（known）、作品现在还没有的；
 * 资料已经改好了（什么都不剩、也没写说明）就是 null
 */
export function currentTagReport(r: TagReport | undefined, g: Game, known: (id: string) => boolean): TagReport | null {
  if (!r) return null;
  const has = new Set(g.genres ?? []);
  return makeTagReport(r.wrong.filter(id => has.has(id)), r.missing.filter(id => known(id) && !has.has(id)), r.note ?? "", r.date, id => known(id) && notHidden(id));
}

/** 要提交的标签报告：只要图鉴里有的作品（我的游戏不算），按现在的资料筛过（见 currentTagReport） */
export function currentTagReports(reports: Record<string, TagReport>, games: Map<string, Game>, known: (id: string) => boolean): Record<string, TagReport> {
  const out: Record<string, TagReport> = {};
  for (const [id, r] of Object.entries(reports)) {
    const g = games.get(id);
    const c = g && g.src !== "local" ? currentTagReport(r, g, known) : null;
    if (c) out[id] = c;
  }
  return out;
}
