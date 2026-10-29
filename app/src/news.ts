import type { Game, Mark } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入

// —— 资料更新小结：换了新资料（导入数据包、软件自带的资料更新了）时，和上次看过的资料比，列出跟自己有关的变化（纯函数，方便单测） ——

/**
 * 上次看过的资料的极简快照（存在 data.catalogSeen）：资料日期、revision，和每部作品一个短字符串——
 * 开发中的是 `d:发售日`（没定档是 `d:`），有分数的是 `分数|档`，别的是空字符串。
 * names 只记当时有标记的作品的名字（作品被移出图鉴后还能写出是哪部）。
 * 作品太多（超过 SNAP_MAX）时只记有标记的和开发中的，partial 为 true，下次不算新收录
 */
export interface CatalogSnap {
  updated: string; revision: number;
  games: Record<string, string>;
  names: Record<string, string>;
  partial?: boolean;
}
/** 快照最多记几部（自带资料一千多部，一部二十来个字节） */
export const SNAP_MAX = 20000;

/** 一部作品在快照里的样子 */
export interface SnapEntry { dev: boolean; date: string; score: number | null; band: string }
export function decodeEntry(s: string): SnapEntry {
  if (s.startsWith("d:")) return { dev: true, date: s.slice(2), score: null, band: "" };
  const [n, band = ""] = s.split("|");
  const score = n === "" || !Number.isFinite(Number(n)) ? null : Number(n);
  return { dev: false, date: "", score, band };
}
/** 分数和档：分数取显示的整数（和卡片上的「综合 94」一样） */
export function encodeEntry(g: Game, f: { F: number; band: string } | null): string {
  if (g.state === "dev") return `d:${g.date || ""}`;
  return f ? `${Math.floor(f.F + 1e-9)}|${f.band}` : "";
}

const marked = (m: Mark | undefined) => !!m && !!(m.status || m.fav || m.score || m.note?.trim());

/**
 * 做快照：games 是公共目录里的作品（我的游戏不算），final 取第 2 版配方的分数和档（没有就是 null），name 取显示用的名字
 */
export function makeSnap(
  meta: { updated: string; revision: number }, games: Game[], final: (g: Game) => { F: number; band: string } | null,
  marks: Record<string, Mark>, name: (g: Game) => string,
): CatalogSnap {
  const list = games.filter(g => g.src !== "local");
  const partial = list.length > SNAP_MAX;
  const snap: CatalogSnap = { updated: meta.updated, revision: meta.revision, games: {}, names: {} };
  for (const g of list) {
    const m = marked(marks[g.id]);
    if (partial && !m && g.state !== "dev") continue;
    snap.games[g.id] = encodeEntry(g, final(g));
    if (m) snap.names[g.id] = name(g);
  }
  if (partial) snap.partial = true;
  return snap;
}

/** 数据文件里的 catalogSeen：形状不对就当没有（下次只记快照、不弹小结） */
export function cleanSnap(raw: unknown): CatalogSnap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const games = obj(r.games), names = obj(r.names);
  if (typeof r.updated !== "string" || !games) return null;
  const strings = (o: Record<string, unknown> | null) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => k && k !== "__proto__" && typeof v === "string")) as Record<string, string>;
  const snap: CatalogSnap = { updated: r.updated, revision: Number.isInteger(r.revision) ? (r.revision as number) : 0, games: strings(games), names: strings(names) };
  if (r.partial === true) snap.partial = true;
  return snap;
}

/** 一部作品的分数变化（old / new 没分数是 null，没档是空的） */
export interface ScoreChange { id: string; from: number | null; to: number | null; fromBand: string; toBand: string }
/** 开发中作品的消息：released 是已经发售了，不然是定了（或改了）发售日 */
export interface DevNews { id: string; date: string; released: boolean }
export interface CatalogNews {
  from: string; to: string;
  /** 这次新收录的作品 id（上次的快照不全时不算，是空的） */
  added: string[];
  /** 想玩 / 已有 / 玩过 / 收藏里的作品，分数或档变了 */
  scores: ScoreChange[];
  dev: DevNews[];
  /** 移出图鉴的、我标记过的作品：id 和上次记下的名字 */
  removed: { id: string; name: string }[];
}

/** 资料比上次的新：先比日期，同一天比 revision */
export const newerThan = (a: { updated: string; revision: number }, b: { updated: string; revision: number }) =>
  a.updated > b.updated || (a.updated === b.updated && a.revision > b.revision);

/** 新旧两份快照比一比；marks 是现在的标记（列表里的作品看分数变化，标记过的看有没有被移出） */
export function diffSnaps(old: CatalogSnap, now: CatalogSnap, marks: Record<string, Mark>): CatalogNews {
  const label = (s: CatalogSnap) => `${s.updated}${s.revision ? `（${s.revision}）` : ""}`;
  const news: CatalogNews = { from: label(old), to: label(now), added: [], scores: [], dev: [], removed: [] };
  if (!old.partial && !now.partial) news.added = Object.keys(now.games).filter(id => !(id in old.games));
  for (const [id, s] of Object.entries(now.games)) {
    if (!(id in old.games)) continue;
    const a = decodeEntry(old.games[id]), b = decodeEntry(s);
    if (a.dev) {
      if (!b.dev) news.dev.push({ id, date: "", released: true });
      else if (b.date && b.date !== a.date) news.dev.push({ id, date: b.date, released: false });
      continue;
    }
    const m = marks[id];
    const onList = !!m && (m.status === "want" || m.status === "have" || m.status === "played" || m.fav);
    if (!onList || b.dev || (a.score === null && b.score === null)) continue;
    if (a.score !== b.score || a.band !== b.band) news.scores.push({ id, from: a.score, to: b.score, fromBand: a.band, toBand: b.band });
  }
  for (const id of Object.keys(old.games)) {
    if (!(id in now.games) && marked(marks[id])) news.removed.push({ id, name: old.names[id] || id });
  }
  return news;
}

/** 有没有值得说的 */
export const hasNews = (n: CatalogNews) => !!(n.added.length || n.scores.length || n.dev.length || n.removed.length);

/** 分数变化写成一句：「综合 90 → 92 · 大杯 → 超大杯」，没分数写「—」，档没变不写 */
export function scoreChangeText(c: ScoreChange) {
  const n = (x: number | null) => (x === null ? "—" : String(x));
  const parts = [c.from !== c.to ? `综合 ${n(c.from)} → ${n(c.to)}` : ""];
  if (c.fromBand !== c.toBand) parts.push(`${c.fromBand || "无档"} → ${c.toBand || "无档"}`);
  return parts.filter(Boolean).join(" · ");
}
