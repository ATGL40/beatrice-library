import type { Found, Game, Mark } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { generic } from "./match.ts";
import { fold, scoreFolded } from "./search.ts";

// —— 我的游戏：图鉴里没有、自己添加的游戏（像 Steam 库那样能启动、标记、记时长），也有找游戏文件夹时的候选说明。纯函数，方便单测 ——

/** data.custom 里的一条：名字、分类必有，封面是 custom-covers 里的文件名 */
export interface Custom { title: string; cat: string; circle?: string; date?: string; note?: string; cover?: string; coverVersion?: number }

const PREFIX = "local-";
/** 我的游戏的 id 都是 local- 开头 */
export const isCustomId = (id: string) => id.startsWith(PREFIX);
/** 新 id：local- 加 12 位随机字母数字 */
export function newCustomId(rand: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  return PREFIX + [...rand(12)].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
/** 封面文件名：只认后端复制时起的名字 */
export const COVER_NAME = /^local-[a-z0-9]{1,40}\.(jpg|png|webp)$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** 读进来的 data.custom 整理一遍：id 不对、没有名字的丢掉；不认识的字段照留 */
export function cleanCustom(raw: unknown): Record<string, Custom> {
  const out: Record<string, Custom> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^local-[a-z0-9]{1,40}$/.test(id) || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>, title = str(r.title, 200);
    if (!title) continue;
    out[id] = { ...r, title, cat: str(r.cat, 20) || "other" } as Custom;
    if (typeof r.cover === "string" && !COVER_NAME.test(r.cover)) delete out[id].cover;
    if (!Number.isSafeInteger(r.coverVersion) || (r.coverVersion as number) < 0) delete out[id].coverVersion;
  }
  return out;
}

/** 变成图鉴里的一部作品：来源 local，没有评分、销量和链接，不参与综合榜 */
export function customGame(id: string, c: Custom, coverUrl = ""): Game {
  return {
    id, cat: c.cat || "other", src: "local", state: "released", title: c.title, names: { ja: c.title, zh: "", en: "" }, mt: [],
    circle: c.circle ?? "", date: c.date ?? "", rate: null, dl: null, url: "", cover: coverUrl && c.coverVersion ? `${coverUrl}?v=${c.coverVersion}` : coverUrl, note: c.note ?? "",
  };
}

/** 去掉一部我的游戏的全部资料（标记、关联和游玩记录、梯度表、投票）；返回改好的几样，撤销时整个放回去 */
export function withoutCustom<T extends { custom: Record<string, Custom>; marks: Record<string, unknown>; local: Record<string, unknown>; tiers: Record<string, string[]> }>(d: T, id: string) {
  const drop = <V>(o: Record<string, V>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));
  return {
    custom: drop(d.custom), marks: drop(d.marks), local: drop(d.local),
    tiers: Object.fromEntries(Object.entries(d.tiers).map(([k, ids]) => [k, ids.filter(x => x !== id)])) as T["tiers"],
  };
}

/** 导出评分时：没勾「包含我的游戏」就去掉我的游戏 */
export const exportMarks = (marks: Record<string, Mark>, include: boolean) =>
  include ? marks : Object.fromEntries(Object.entries(marks).filter(([id]) => !isCustomId(id)));

/** 文件夹的名字候选各是什么：文件夹名、外层文件夹、启动程序名，别的就是引擎文件里的标题 */
export function candidateKind(f: Found, c: string): string {
  const parts = f.dir.split(/[\\/]/);
  if (c === parts[parts.length - 1]) return "文件夹名";
  if (parts.includes(c)) return "外层文件夹";
  if (f.exes.some(e => e.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "") === c)) return "启动程序名";
  return "引擎标题";
}

/** 文件夹的全部名字候选（通用词不要） */
export const candidatesOf = (f: Found) => [...new Set([f.name, ...(f.names ?? [])])].filter(c => c && !generic(c));

// 一次扫描里的候选不会变，规范化和候选说明各算一次
const candidateCache = new WeakMap<Found, { text: string; kind: string; folded: string }[]>();
function preparedCandidates(f: Found) {
  let rows = candidateCache.get(f);
  if (!rows) {
    rows = candidatesOf(f).map(text => ({ text, kind: candidateKind(f, text), folded: fold(text) }));
    candidateCache.set(f, rows);
  }
  return rows;
}

/** 拿 q 比文件夹的每个名字候选：最像的那个和分数；都不像是 null */
export function bestCandidate(q: string, f: Found): { text: string; kind: string; score: number } | null {
  let best: { text: string; kind: string; score: number } | null = null;
  const query = fold(q);
  for (const c of preparedCandidates(f)) {
    const s = scoreFolded(query, [c.folded]);
    if (s > 0 && (!best || s > best.score)) best = { text: c.text, kind: c.kind, score: s };
  }
  return best;
}

/** 「添加为我的游戏」时默认的名字：第一个不是通用词的候选，没有就用文件夹名 */
export const defaultTitle = (f: Found) => candidatesOf(f)[0] ?? f.name;
