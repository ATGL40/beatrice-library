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
  /** 旧版本、新版本的写法（见 versionLabel）；version 是新版本 */
  from: string; to: string; version: Version;
  /** 这次新收录的作品 id（上次的快照不全时不算，是空的） */
  added: string[];
  /** 想玩 / 已有 / 玩过 / 收藏里的作品，分数或档变了 */
  scores: ScoreChange[];
  dev: DevNews[];
  /** 移出图鉴的、我标记过的作品：id 和上次记下的名字 */
  removed: { id: string; name: string }[];
}

/** 资料的一个版本：日期和同一天的修订号 */
export interface Version { updated: string; revision: number }
/** 版本的写法：「2026-10-29」「2026-10-29 · 修订 1」 */
export const versionLabel = (v: Version) => `${v.updated}${v.revision ? ` · 修订 ${v.revision}` : ""}`;
/** 资料比上次的新：先比日期，同一天比 revision */
export const newerThan = (a: Version, b: Version) =>
  a.updated > b.updated || (a.updated === b.updated && a.revision > b.revision);

/** 新旧两份快照比一比；marks 是现在的标记（列表里的作品看分数变化，标记过的看有没有被移出） */
export function diffSnaps(old: CatalogSnap, now: CatalogSnap, marks: Record<string, Mark>): CatalogNews {
  const news: CatalogNews = { from: versionLabel(old), to: versionLabel(now), version: { updated: now.updated, revision: now.revision }, added: [], scores: [], dev: [], removed: [] };
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

// —— 资料更新记录：数据包里我们写的更新说明（changelog），和每次更新时算出的「你的变化」（存在 data.catalogHistory） ——

/** 数据包 changelog 里的一条：这个版本改了什么（给玩家看的几句话） */
export interface ChangelogEntry extends Version { notes: string[] }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isVersion = (v: Record<string, unknown>) => typeof v.updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.updated) && Number.isInteger(v.revision) && (v.revision as number) >= 0;
const newestFirst = (a: Version, b: Version) => (newerThan(a, b) ? -1 : newerThan(b, a) ? 1 : 0);

/** 数据包的 changelog：不是数组当没有，坏条目丢掉，说明只留非空文字，同一个版本只留第一条 */
export function cleanChangelog(raw: unknown): ChangelogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChangelogEntry[] = [], seen = new Set<string>();
  for (const e of raw) {
    if (!isObj(e) || !isVersion(e) || !Array.isArray(e.notes)) continue;
    const notes = e.notes.filter((s): s is string => typeof s === "string" && !!s.trim());
    const v = { updated: e.updated as string, revision: e.revision as number }, key = versionLabel(v);
    if (!notes.length || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...v, notes });
  }
  return out;
}

/** 存下来的一次更新（data.catalogHistory 的一条）：新版本、从哪个版本更新的、新收录几部、你的变化，和这些作品当时的名字 */
export interface NewsRecord extends Version {
  from: string; added: number;
  scores: ScoreChange[]; dev: DevNews[]; removed: { id: string; name: string }[];
  names: Record<string, string>;
}
/** 最多存几次更新；每类最多存几部（小结里也只列这么多） */
export const HISTORY_MAX = 20;
export const RECORD_LIST_MAX = 50;

/** 一次更新的小结存成记录：作品多的只留前 RECORD_LIST_MAX 部（新收录只记部数），名字取当时的 */
export function toRecord(n: CatalogNews, name: (id: string) => string): NewsRecord {
  const scores = n.scores.slice(0, RECORD_LIST_MAX), dev = n.dev.slice(0, RECORD_LIST_MAX);
  const names: Record<string, string> = {};
  for (const x of [...scores, ...dev]) names[x.id] = name(x.id);
  return { ...n.version, from: n.from, added: n.added.length, scores, dev, removed: n.removed.slice(0, RECORD_LIST_MAX), names };
}

/** 加一条记录：同一个版本的换成新的，新的在前，最多 HISTORY_MAX 条 */
export function addRecord(history: NewsRecord[], rec: NewsRecord): NewsRecord[] {
  return [rec, ...history.filter(r => versionLabel(r) !== versionLabel(rec))].sort(newestFirst).slice(0, HISTORY_MAX);
}

/** 数据文件里的 catalogHistory：不是数组当没有，坏条目丢掉（各列表里坏的项也丢掉），最多 HISTORY_MAX 条 */
export function cleanHistory(raw: unknown): NewsRecord[] {
  if (!Array.isArray(raw)) return [];
  const list = <T>(v: unknown, ok: (x: Record<string, unknown>) => boolean) => (Array.isArray(v) ? v.filter(x => isObj(x) && typeof x.id === "string" && ok(x)) as T[] : []);
  const numOrNull = (v: unknown) => v === null || typeof v === "number";
  const out: NewsRecord[] = [];
  for (const r of raw) {
    if (!isObj(r) || !isVersion(r)) continue;
    const names = isObj(r.names) ? Object.fromEntries(Object.entries(r.names).filter(([k, v]) => k !== "__proto__" && typeof v === "string")) as Record<string, string> : {};
    out.push({
      updated: r.updated as string, revision: r.revision as number,
      from: typeof r.from === "string" ? r.from : "", added: Number.isInteger(r.added) && (r.added as number) > 0 ? (r.added as number) : 0,
      scores: list<ScoreChange>(r.scores, x => numOrNull(x.from) && numOrNull(x.to) && typeof x.fromBand === "string" && typeof x.toBand === "string"),
      dev: list<DevNews>(r.dev, x => typeof x.date === "string" && typeof x.released === "boolean"),
      removed: list<{ id: string; name: string }>(r.removed, x => typeof x.name === "string"),
      names,
    });
  }
  return out.slice(0, HISTORY_MAX);
}

/** 「资料更新记录」里能选的版本：现在的、更新说明里有的、存过记录的，新的在前、不重复 */
export function versionList(changelog: Version[], history: Version[], current?: Version): Version[] {
  const all = new Map<string, Version>();
  for (const v of [...(current ? [current] : []), ...changelog, ...history]) {
    const key = versionLabel(v);
    if (!all.has(key)) all.set(key, { updated: v.updated, revision: v.revision });
  }
  return [...all.values()].sort(newestFirst);
}
