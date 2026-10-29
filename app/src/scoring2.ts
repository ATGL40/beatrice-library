import type { Game } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入
import type { Ranking } from "./scoring.ts";

// —— 综合榜第 2 版（数据包 scoring.version 为 2）：各社区评分合成口碑 + 按时代比的热度 → 综合分 → 固定曲线换成 0–100 的 F，再定档。
//    和资料仓库的参考实现 tools/scoring.py 逐部一致（tests/scoring2.test.mjs 对过）。
//    公共分和档只看数据包（资料 + 已结算的神作名单）；玩家评分（自己和朋友的星级）只是给自己看的修正。全是纯函数，方便单测 ——

type PerSrc<T> = Record<string, T>;
export interface RecipeV2 {
  name: string; version: 2;
  /**
   * 口碑：每个社区评分换成 R（anchors，截到 clamp），证据量 e = 人数 ÷ 基数（R > 50 用 kUp，不然用 k），人数不到 minN 的社区不算；
   * 民间榜单每上一次是一份 R = lists.R、e = lists.e 的证据，最多 lists.max 次；appliesTo[社区] 写了的，只对这些来源的作品算（VNDB 只看商业作；空数组不参与打分：Steam 好评率）；
   * anchorsBySource[社区][作品来源] 写了的，这个来源的作品用这套锚点（Bangumi 按来源分开校准），没写的来源用 anchors[社区]；
   * secondary：本平台的评分算进来时（DLsite 作品的 DLsite、商业作的批評空間），sources 里的社区合起来的证据量最多是
   * maxShareOfNative × 本平台人数 ÷ kUp[本平台]（和本平台评分高低无关），超了按同一个比例缩小；null 是不限
   */
  praise: {
    k: PerSrc<number>; kUp: PerSrc<number>; minN: PerSrc<number>; anchors: PerSrc<[number, number]>;
    anchorsBySource: PerSrc<PerSrc<[number, number]>>; appliesTo: PerSrc<string[]>;
    secondary: { sources: string[]; maxShareOfNative: number } | null;
    clamp: [number, number]; lists: { R: number; e: number; max: number };
  };
  /** 热度（era-median）：和同来源、发售年前后 window 年作品的中位数比，scale 是各来源的刻度；没有人气数的按 missing 算 */
  heat: { method: string; weight: number; window: number; minGroup: number; scale: PerSrc<number>; missing: number; age: { min: number; max: number; exp: number } };
  players: { neutral: number; prior: number; cap: number };
  curve: { on: string; points: [number, number][] };
  bands: [string, number][];
  /** 神作和神作提名以外的作品，F 最高 max */
  cap: { max: number };
  /**
   * 神作提名：曲线分至少 minF0；praiseSources 里某个社区过了 gates.praiseTop 的原始评分线和人数线；
   * 榜 / 玩 / 多（至少两个社区 R ≥ second.R 且 e ≥ second.e）至少 others 项；口碑至少是基准作品 benchmark 的 benchmarkPct。F 固定是 score
   */
  nominee: { score: number; minF0: number; praiseSources: string[]; others: number; second: { R: number; e: number }; benchmark: string; benchmarkPct: number };
  /** praiseTopBySource[社区]：这个社区的口★线按作品来源分开（rating / raters[来源]），没写的来源用 praiseTop */
  gates: {
    praiseTop: { rating: PerSrc<number>; raters: PerSrc<number> };
    praiseTopBySource: PerSrc<{ rating: PerSrc<number>; raters: PerSrc<number> }>;
    community: { minAvg: number; minCount: number };
  };
  /** minScore：神作至少显示这个分；reasonRequired / reasonMinChars：哪种票要写理由、至少几个字 */
  canon: { minScore: number; reasonRequired: string; reasonMinChars: number };
  development: { name: string; field: string };
  /** 冷门佳作榜：配方里有 hiddenGems 才有（cleanHiddenGems 整理），没有是 null */
  hiddenGems: HiddenGems | null;
}
/**
 * 冷门佳作榜：已发售、评分不低于 rating[来源]、打分人数在 raters[来源] = [下限, 上限) 里的作品，
 * 按口碑 P 从高到低，最多 limit 部。只是一个榜单，不改综合分和档
 */
export interface HiddenGems { name: string; rating: PerSrc<number>; raters: PerSrc<[number, number]>; sortBy: "praise"; limit: number }

/** 分数的说明：排行榜综合榜标题下面写长的，详情页分数旁的「?」写短的 */
export const SCORE_NOTE = "分数是汇总各社区玩家评价算出来的参考，不是定论。算法可能出错，也会因为资料不全而偏；评价人数少的作品只会被估高、不会被估低，评价太少的单独列在最后、不打分。分数不高不代表不好玩，口味因人而异——冷门佳作榜里就有很多好作品。";
export const SCORE_NOTE_SHORT = "分数是各社区评价的汇总参考，可能出错；不高不代表不好玩。";
/** 评价不足：参与打分、但没有一个能用的社区评价人数够下限（包括只有 Steam 好评率的）的作品，不打分、不分档，列表里单独放在最后 */
export const THIN_LABEL = "评价不足";
export const THIN_NOTE = "可用的评价太少，暂不打分。";

/** 只给这三个来源的已发售作品打分；热度也只在这三个来源里比 */
export const SCORED = ["dlsite", "commercial", "steam"];
/** 社区评分从哪读：[社区, 字段, 评分, 人数]；DLsite 只读 DLsite 作品的 rate / rc。顺序和 tools/scoring.py 一样（加起来的先后一样） */
const RATINGS: [string, string, string, string][] = [
  ["commercial", "egs", "median", "count"], ["steam", "steam", "positive", "reviews"],
  ["vndb", "vndb", "rating", "votes"], ["bgm", "bgm", "score", "votes"], ["community", "community", "avg", "count"],
];

/** 配方里缺的部分用这些补（数字和资料仓库的 scoring.json 一样） */
export const DEFAULT_V2: RecipeV2 = {
  name: "图鉴综合榜", version: 2,
  praise: {
    k: { dlsite: 1000, commercial: 50, steam: 10000, vndb: 50, bgm: 50, community: 20 },
    kUp: { dlsite: 50, commercial: 10, steam: 10000, vndb: 10, bgm: 10, community: 10 },
    minN: { dlsite: 20, commercial: 10, steam: 30, vndb: 10, bgm: 10, community: 5 },
    anchors: { dlsite: [4.15, 4.9], commercial: [70, 90], steam: [79, 101], vndb: [60.45, 89.75], bgm: [3.77, 8.43], community: [3, 5] },
    anchorsBySource: { bgm: { dlsite: [3.67, 8.33], commercial: [4.87, 8.73], steam: [2.91, 9.39] } },
    appliesTo: { vndb: ["commercial"], steam: [] }, secondary: { sources: ["vndb", "bgm"], maxShareOfNative: 1 },
    clamp: [0, 100], lists: { R: 90, e: 1, max: 2 },
  },
  heat: {
    method: "era-median", weight: 0.15, window: 1, minGroup: 10,
    scale: { dlsite: 0.434067, commercial: 0.444702, steam: 0.617585 }, missing: 0, age: { min: 0.25, max: 1, exp: 0.5 },
  },
  players: { neutral: 3, prior: 3, cap: 10 },
  curve: { on: "composite", points: [[10.295737, 40], [37.96075, 60], [52.046208, 70], [65.647601, 80], [77.840343, 90], [87.250512, 95], [90.14902, 97], [96.050978, 99]] },
  bands: [["神作", 96], ["神作提名", 95], ["超大杯", 85], ["大杯", 70], ["中杯", 0]],
  cap: { max: 94 },
  nominee: { score: 95, minF0: 95, praiseSources: ["dlsite", "commercial", "vndb", "bgm", "community"], others: 1, second: { R: 80, e: 1 }, benchmark: "vndb-v20802", benchmarkPct: 0.9 },
  gates: {
    praiseTop: { rating: { dlsite: 4.84, commercial: 92, vndb: 90.7, bgm: 9 }, raters: { dlsite: 10683, commercial: 876, vndb: 1054, bgm: 218 } },
    praiseTopBySource: { bgm: { rating: { dlsite: 9, commercial: 9.3, steam: 8.7 }, raters: { dlsite: 71, commercial: 2081, steam: 66 } } },
    community: { minAvg: 4.5, minCount: 20 },
  },
  canon: { minScore: 96, reasonRequired: "oppose", reasonMinChars: 20 },
  development: { name: "开发中关注榜", field: "followers" },
  hiddenGems: null,
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && num(v[0]) !== null && num(v[1]) !== null;

/** 按默认配方的形状逐项取：类型对的用数据包的，不对的用默认的；数组另外检查 */
function merge<T>(def: T, raw: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(raw) ? raw : def) as T;
  if (def && typeof def === "object") {
    const r = obj(raw) ?? {};
    const out: Record<string, unknown> = { ...r }; // 按来源的表可以多出别的来源
    for (const [k, v] of Object.entries(def)) out[k] = merge(v, r[k]);
    return out as T;
  }
  return (typeof raw === typeof def && (typeof raw !== "number" || Number.isFinite(raw)) ? raw : def) as T;
}

/** 数据包的 scoring 是第 2 版就整理成能直接用的配方，不是就返回 null（走旧的第 1 版） */
export function cleanRecipeV2(raw: unknown): RecipeV2 | null {
  if (obj(raw)?.version !== 2) return null;
  const r = merge(DEFAULT_V2, raw);
  const pts = r.curve.points.filter(pair).map(p => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  r.curve.points = pts.length >= 2 ? pts : DEFAULT_V2.curve.points;
  const bands = r.bands.filter((b): b is [string, number] => Array.isArray(b) && typeof b[0] === "string" && num(b[1]) !== null);
  r.bands = bands.length ? bands.sort((a, b) => b[1] - a[1]) : DEFAULT_V2.bands;
  const pr = r.praise, def = DEFAULT_V2.praise;
  if (!pair(pr.clamp)) pr.clamp = def.clamp;
  // appliesTo：数据包写了就整个用它的（没写的社区对所有作品都算），值要是来源的数组
  const at = obj(obj(obj(raw)!.praise)?.appliesTo);
  pr.appliesTo = Object.fromEntries(Object.entries(at ?? def.appliesTo)
    .filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every(s => typeof s === "string")));
  // secondary：数据包写了就用它的（null 是不限），没写用默认的；sources 只留字符串，maxShareOfNative 要是非负数
  const sc = obj(obj(raw)!.praise)?.secondary;
  const so = sc === undefined ? def.secondary : obj(sc);
  pr.secondary = so && Array.isArray(so.sources) && (num(so.maxShareOfNative) ?? -1) >= 0
    ? { sources: so.sources.filter((s): s is string => typeof s === "string"), maxShareOfNative: so.maxShareOfNative as number } : null;
  // anchorsBySource、gates.praiseTopBySource：数据包写了就整个用它的（没写的社区、来源用总的锚点和口★线），不对的项不算
  const ab = obj(obj(obj(raw)!.praise)?.anchorsBySource);
  pr.anchorsBySource = Object.fromEntries(Object.entries(ab ?? def.anchorsBySource).flatMap(([s, v]) => {
    const t = Object.entries(obj(v) ?? {}).filter((e): e is [string, [number, number]] => pair(e[1]) && e[1][0] !== e[1][1]);
    return t.length ? [[s, Object.fromEntries(t.map(([src, a]) => [src, [a[0], a[1]] as [number, number]]))]] : [];
  }));
  const tb = obj(obj(obj(raw)!.gates)?.praiseTopBySource);
  r.gates.praiseTopBySource = Object.fromEntries(Object.entries(tb ?? DEFAULT_V2.gates.praiseTopBySource).flatMap(([s, v]) => {
    const rt = obj(obj(v)?.rating) ?? {}, rs = obj(obj(v)?.raters) ?? {};
    const srcs = Object.keys(rt).filter(src => num(rt[src]) !== null && num(rs[src]) !== null);
    return srcs.length ? [[s, { rating: Object.fromEntries(srcs.map(src => [src, rt[src] as number])),
      raters: Object.fromEntries(srcs.map(src => [src, rs[src] as number])) }]] : [];
  }));
  // 基数、下限不是正数的用默认的；锚点不对、或者默认也没有的社区不算
  for (const [src, a] of Object.entries(pr.anchors)) {
    for (const t of ["k", "kUp", "minN"] as const) if (!((num(pr[t][src]) ?? 0) > 0)) pr[t][src] = def[t][src];
    if (!pair(a) || a[0] === a[1] || [pr.k, pr.kUp, pr.minN].some(t => t[src] === undefined)) delete pr.anchors[src];
  }
  r.nominee.praiseSources = r.nominee.praiseSources.filter((s): s is string => typeof s === "string");
  r.version = 2;
  r.hiddenGems = cleanHiddenGems(obj(raw)!.hiddenGems);
  return r;
}

/** 配方里的 hiddenGems：不是对象、一个来源都没写对就是 null（不显示这个榜）；评分线和人数区间要成对，区间要下限小于上限 */
export function cleanHiddenGems(raw: unknown): HiddenGems | null {
  const r = obj(raw);
  if (!r) return null;
  const rating: PerSrc<number> = {}, raters: PerSrc<[number, number]> = {};
  const rt = obj(r.rating) ?? {}, rs = obj(r.raters) ?? {};
  for (const [src, v] of Object.entries(rt)) {
    const n = rs[src];
    if (num(v) !== null && pair(n) && n[0] >= 0 && n[0] < n[1]) { rating[src] = v as number; raters[src] = [n[0], n[1]]; }
  }
  if (!Object.keys(rating).length) return null;
  const limit = num(r.limit);
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name : "冷门佳作榜",
    rating, raters, sortBy: "praise",
    limit: limit !== null && limit >= 1 ? Math.floor(limit) : 100,
  };
}

/** 冷门佳作榜的一行：本来源的评分 x、打分人数 n、口碑 P */
export interface GemRow { g: Game; x: number; n: number; P: number }
/** 选出冷门佳作（不截 limit，筛完分类、年份、来源再截）：P 高的在前，同分发售日新的在前（和资料仓库的说明一致） */
export function hiddenGemRows(games: Iterable<Game>, base: Map<string, Base>, hg: HiddenGems): GemRow[] {
  const rows: GemRow[] = [];
  for (const g of games) {
    const b = base.get(g.id), line = hg.rating[g.src], span = hg.raters[g.src];
    if (g.state === "dev" || !b || line === undefined || !span) continue;
    const { x, n } = signal(g);
    if (x === null || n === null || x < line || n < span[0] || n >= span[1]) continue;
    rows.push({ g, x, n, P: b.P });
  }
  return rows.sort((a, b) => b.P - a.P || (b.g.date || "").localeCompare(a.g.date || ""));
}

/** 数据包里的神作名单 { id: { by: "manual" | "vote", … } }（也认 id 数组）→ id → 来历 */
export function cleanCanon(raw: unknown): Map<string, string> {
  if (Array.isArray(raw)) return new Map(raw.filter((x): x is string => typeof x === "string").map(id => [id, "manual"]));
  return new Map(Object.entries(obj(raw) ?? {}).map(([id, v]) => [id, obj(v)?.by === "vote" ? "vote" : "manual"]));
}

/** v 在升序数组 sv 里的百分位（0–100）：最小 0、最大 100，相同的取中间；只有一个算 50（和 scoring.ts 的 percentile 一样） */
export function pctSorted(v: number, sv: number[]): number {
  const n = sv.length;
  if (n <= 1) return 50;
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sv[m] < v) lo = m + 1; else hi = m; }
  let up = lo, end = n;
  while (up < end) { const m = (up + end) >> 1; if (sv[m] <= v) up = m + 1; else end = m; }
  return ((lo + (up - lo - 1) / 2) / (n - 1)) * 100;
}

/** 本来源的平台信号：x 评分、n 打分人数、h 热度用的人气数（DLsite 销量 / 批評空間人数 / Steam 评测数） */
export function signal(g: Game): { x: number | null; n: number | null; h: number | null } {
  const r = g as unknown as Record<string, unknown>;
  if (g.src === "dlsite") return { x: num(g.rate), n: num(g.rc), h: num(g.dl) };
  if (g.src === "commercial") { const e = obj(r.egs) ?? {}; return { x: num(e.median), n: num(e.count), h: num(e.count) }; }
  if (g.src === "steam") { const e = obj(r.steam) ?? {}; return { x: num(e.positive), n: num(e.reviews), h: num(e.reviews) }; }
  return { x: null, n: null, h: null };
}

/** 作品上每个社区的评分（人数要 > 0）：DLsite、批評空間、Steam、VNDB、Bangumi、我们的社区评分 */
export function ratings(g: Game): { src: string; x: number; n: number }[] {
  const out: { src: string; x: number; n: number }[] = [];
  const add = (src: string, x: unknown, n: unknown) => {
    const a = num(x), b = num(n);
    if (a !== null && b !== null && b > 0) out.push({ src, x: a, n: b });
  };
  if (g.src === "dlsite") add("dlsite", g.rate, g.rc);
  const r = g as unknown as Record<string, unknown>;
  for (const [src, key, xk, nk] of RATINGS) { const v = obj(r[key]) ?? {}; add(src, v[xk], v[nk]); }
  return out;
}

/** 曲线：分段线性，两头取端点的值 */
export function curve(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, f0] = pts[i - 1], [x1, f1] = pts[i];
    if (x <= x1) return x1 > x0 ? f0 + ((f1 - f0) * (x - x0)) / (x1 - x0) : f1;
  }
  return pts[pts.length - 1][1];
}

/** 社区评分 { avg 1–5, count } */
export function communityOf(g: Game): { avg: number; count: number } | null {
  const c = obj((g as unknown as Record<string, unknown>).community);
  const avg = num(c?.avg), count = num(c?.count);
  return avg !== null && count !== null ? { avg, count } : null;
}

/** 神作提名看的四个维度：口★（某个社区过了原始评分线和人数线）、榜、玩（社区评分）、多（两个以上社区都是高分） */
export interface Dims { praiseTop: boolean; lists: boolean; players: boolean; second: boolean }
/** 口碑里的一个社区：评分 x、人数 n、换算后的 R、证据量 e */
export interface Evidence { src: string; x: number; n: number; R: number; e: number }
/**
 * 一部作品的公共部分（每份目录算一次）：P 口碑、E 证据量合计、per 各社区、lists 算进口碑的上榜次数、H 热度（hot：有人气数）、
 * comp 综合分、F 曲线分（还没封顶）、bench：口碑够不够基准作品的 benchmarkPct（没有基准作品时算够）
 */
export interface Base { P: number; E: number; per: Evidence[]; lists: number; H: number; hot: boolean; comp: number; F: number; dims: Dims; bench: boolean }

const DAY = 86400000;
/** YYYY-MM-DD 换成毫秒；不存在的日期（2 月 31 日、13 月、平年 2 月 29 日）是 NaN，不让 Date.UTC 自动顺延 */
export function dateMs(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 时代基准的热度偏移：d = log10(补偿后的人气数) − 同来源、发售年前后 window 年作品的中位数（log10）。
 * 发售不到一年的先 ÷ t^exp（t 是年数，夹在 age.min～age.max；按数据包日期 updated 算）；发售日缺失、不合法或晚于数据包日期的不补偿，
 * 和同来源有发售日的全部作品比。那几年不到 minGroup 部就每次多放宽一年，直到全部年份
 */
export function heatOffsets(works: Game[], rc: RecipeV2, updated = ""): Map<string, number> {
  const hp = rc.heat, now = dateMs(updated);
  const logs = new Map<string, { src: string; y: number | null; x: number }>(), years = new Map<string, [number, number][]>();
  for (const g of works) {
    const h = signal(g).h;
    if (h === null) continue;
    const d = dateMs(g.date || ""), dated = Number.isFinite(d) && d <= now;
    let v = Math.max(h, 1);
    if (dated) {
      const t = Math.round((now - d) / DAY) / 365.25;
      if (t < 1) v /= Math.min(Math.max(t, hp.age.min), hp.age.max) ** hp.age.exp;
    }
    const y = dated ? +g.date.slice(0, 4) : null, x = Math.log10(v);
    logs.set(g.id, { src: g.src, y, x });
    if (y !== null) { if (!years.has(g.src)) years.set(g.src, []); years.get(g.src)!.push([y, x]); }
  }
  const cache = new Map<string, number>();
  const baseline = (src: string, y: number) => {
    const key = `${src}|${y}`;
    if (!cache.has(key)) {
      const ys = years.get(src)!;
      const far = Math.max(...ys.map(([yy]) => Math.abs(yy - y)));
      let vals = ys.map(([, x]) => x);
      for (let w = hp.window; w < far; w++) {
        const near = ys.filter(([yy]) => Math.abs(yy - y) <= w).map(([, x]) => x);
        if (near.length >= hp.minGroup) { vals = near; break; }
      }
      cache.set(key, median(vals));
    }
    return cache.get(key)!;
  };
  const out = new Map<string, number>();
  for (const [id, { src, y, x }] of logs) {
    if (y !== null) out.set(id, x - baseline(src, y));
    else {
      const dated = years.get(src)?.map(([, v]) => v);
      out.set(id, x - median(dated?.length ? dated : [...logs.values()].filter(l => l.src === src).map(l => l.x)));
    }
  }
  return out;
}

/** 民间榜单：作品 id → 上过几次 */
function listHits(rankings: Ranking[]) {
  const m = new Map<string, number>();
  for (const r of rankings) for (const it of r.items) if (it.rj) m.set(it.rj, (m.get(it.rj) ?? 0) + 1);
  return m;
}

/**
 * 本平台至少一半的话语权：本平台（社区名和作品来源相同的那项）算进来时，sec.sources 里的社区证据量合计不超过
 * 上限 = sec.maxShareOfNative × 本平台人数 ÷ kUp[本平台]（只看人数，不看本平台打得高还是低），超了每项乘同一个系数
 * f = 上限 ÷ 合计（直接改 per 里的 e）。没有本平台评分的作品不限
 */
export function capSecondary(per: Evidence[], sec: RecipeV2["praise"]["secondary"], src: string, kUp: PerSrc<number>) {
  const native = per.find(s => s.src === src);
  if (!sec || !native) return;
  const cap = sec.maxShareOfNative * (native.n / kUp[src]);
  let total = 0;
  for (const s of per) if (sec.sources.includes(s.src)) total += s.e;
  if (total <= cap) return;
  const f = cap / total;
  for (const s of per) if (sec.sources.includes(s.src)) s.e = s.e * f;
}

/**
 * 口碑 P = 50 + Σe(R − 50) ÷ (1 + Σe)：每个够人数的社区一份证据，R > 50 时基数小（样本少只许虚高、不许虚低），
 * 上过民间榜单的再加上榜的证据。一个社区都不够人数（评价不足）返回 null
 */
export function praiseOf(g: Game, rc: RecipeV2, hits = 0): { P: number; E: number; per: Evidence[]; lists: number } | null {
  const pr = rc.praise, [lo, hi] = pr.clamp;
  const per: Evidence[] = [];
  for (const { src, x, n } of ratings(g)) {
    const only = pr.appliesTo[src];
    if (!pr.anchors[src] || n < pr.minN[src] || (only && !only.includes(g.src))) continue;
    const a = pr.anchorsBySource[src]?.[g.src] ?? pr.anchors[src];
    const R = Math.min(hi, Math.max(lo, ((x - a[0]) / (a[1] - a[0])) * 100));
    per.push({ src, x, n, R, e: n / (R > 50 ? pr.kUp[src] : pr.k[src]) });
  }
  if (!per.length) return null;
  capSecondary(per, pr.secondary, g.src, pr.kUp);
  let total = 0, E = 0;
  for (const s of per) { total += s.e * (s.R - 50); E += s.e; }
  const c = hits ? Math.min(hits, pr.lists.max) : 0;
  if (c) { total += c * pr.lists.e * (pr.lists.R - 50); E += c * pr.lists.e; }
  return { P: 50 + total / (1 + E), E, per, lists: c };
}

/** 社区 s 对来源 src 的作品的口★线 [评分线, 人数线]：gates.praiseTopBySource 写了这个社区、这个来源就用它，不然用 praiseTop；都没有返回 null */
export function praiseTopLine(rc: RecipeV2, s: string, src: string): [number, number] | null {
  const by = rc.gates.praiseTopBySource[s], top = rc.gates.praiseTop;
  if (by && by.rating[src] !== undefined && by.raters[src] !== undefined) return [by.rating[src], by.raters[src]];
  const x = num(top.rating[s]), n = num(top.raters[s]);
  return x !== null && n !== null ? [x, n] : null;
}

/** 参与打分、但评价不足的作品：已发售的 DLsite / 商业 / Steam 作品，没有算出公共部分 */
export const isThin = (g: Game, base: Map<string, Base>) => g.state !== "dev" && SCORED.includes(g.src) && !base.has(g.id);

/**
 * 每部参与打分、评价够的作品的公共部分：口碑 P（praiseOf）、热度 H = 50 + 35·d ÷ scale[来源]（截到 0–100，没有人气数的按 missing），
 * 综合分 = (1 − heat.weight)·P + heat.weight·H，F = 曲线(综合分)；再算四个维度和基准条件
 */
export function baseScores(games: Game[], rankings: Ranking[], rc: RecipeV2, updated = ""): Map<string, Base> {
  const hits = listHits(rankings);
  const works = games.filter(g => g.state !== "dev" && SCORED.includes(g.src));
  const offsets = heatOffsets(works, rc, updated);
  const { heat, nominee: nm, gates } = rc;
  const out = new Map<string, Base>();
  for (const g of works) {
    const p = praiseOf(g, rc, hits.get(g.id) ?? 0);
    if (!p) continue;
    const d = offsets.get(g.id), scale = num(heat.scale[g.src]);
    const H = d === undefined || !scale ? heat.missing : Math.min(100, Math.max(0, 50 + (35 * d) / scale));
    const comp = (1 - heat.weight) * p.P + heat.weight * H;
    const c = communityOf(g);
    const dims: Dims = {
      praiseTop: p.per.some(s => {
        const line = nm.praiseSources.includes(s.src) ? praiseTopLine(rc, s.src, g.src) : null;
        return !!line && s.x >= line[0] && s.n >= line[1];
      }),
      lists: hits.has(g.id),
      players: !!c && c.avg >= gates.community.minAvg && c.count >= gates.community.minCount,
      second: p.per.filter(s => s.R >= nm.second.R && s.e >= nm.second.e).length >= 2,
    };
    out.set(g.id, { ...p, H, hot: d !== undefined, comp, F: curve(comp, rc.curve.points), dims, bench: true });
  }
  const bench = out.get(nm.benchmark)?.P;
  if (bench !== undefined) for (const b of out.values()) b.bench = b.P >= nm.benchmarkPct * bench;
  return out;
}

/** 玩家评分（1–5 星的票）：Δ = cap · n/(n+prior) · (平均 − neutral)/2；没有票是 0。只是个人修正，不改公共分和档 */
export function playerDelta(votes: number[], p: RecipeV2["players"]): number {
  const vs = votes.filter(v => v >= 1 && v <= 5);
  if (!vs.length) return 0;
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  return ((p.cap * vs.length) / (vs.length + p.prior)) * ((avg - p.neutral) / 2);
}

/** 神作复议的票数（已结算的）：changed 是上次升降的日期 */
export function godvote(g: Game): { support: number; oppose: number; changed: string } {
  const v = obj((g as unknown as Record<string, unknown>).godvote);
  return { support: Math.max(0, num(v?.support) ?? 0), oppose: Math.max(0, num(v?.oppose) ?? 0), changed: typeof v?.changed === "string" ? v.changed : "" };
}

/** 公共分和档 */
export interface Final {
  F: number; band: string;
  /** 排名用：F 相同时按综合分 */
  comp: number; date: string;
  /** 被压下来的话，压到哪条线 */
  capped: number | null;
  /** 神作提名 */
  nominee: boolean;
  /** 神作：manual 名单里人工认定的，vote 投票升上来的 */
  canon: "manual" | "vote" | null;
  /** 有过复议升降（godvote.changed）且现在不是神作：被撤下了 */
  reviewed: boolean;
}

/** 档名：F 往下取整后落在哪一档 */
export function bandOf(f: number, rc: RecipeV2): string {
  const fi = Math.floor(f + 1e-9);
  return rc.bands.find(b => fi >= b[1])?.[0] ?? "";
}

/**
 * 公共分和档，按顺序：
 * 1. 神作（数据包神作名单 canon 里的，名单由资料仓库按投票结算）：F = max(曲线分, canon.minScore)，不封顶；
 * 2. 神作提名（曲线分至少 nominee.minF0、过了口★、榜 / 玩 / 多至少 others 项、口碑够基准）：F = nominee.score；
 * 3. 其他：F 最高 cap.max。评价不足的作品没有 base，返回 null
 */
export function finalOf(g: Game, base: Base | undefined, canon: Map<string, string>, rc: RecipeV2): Final | null {
  if (g.state === "dev" || !base) return null;
  const d = base.dims, F0 = base.F;
  const others = +d.lists + +d.players + +d.second;
  const by = canon.get(g.id) === "vote" ? "vote" : canon.has(g.id) ? "manual" : null;
  const nominee = !by && F0 >= rc.nominee.minF0 && d.praiseTop && others >= rc.nominee.others && base.bench;
  const F = by ? Math.max(F0, rc.canon.minScore) : nominee ? rc.nominee.score : Math.min(F0, rc.cap.max);
  return {
    F, band: bandOf(F, rc), comp: base.comp, date: g.date || "", capped: !by && !nominee && F < F0 ? F : null,
    nominee, canon: by, reviewed: !by && !!godvote(g).changed,
  };
}

/** 名次先后：F 高的在前，同分按综合分，再同分按发售日期新的在前 */
export const cmpFinal = (a: Final, b: Final) => b.F - a.F || b.comp - a.comp || b.date.localeCompare(a.date);
/** 排名：排得上的作品按名次排好 */
export function rankOrder(gs: Game[], fin: (g: Game) => Final | null): Game[] {
  return gs.filter(g => fin(g)).sort((a, b) => cmpFinal(fin(a)!, fin(b)!));
}

/** 开发中关注榜：Ci-en 关注者数在创作者里的百分位（同一个创作者只算一次）；FANBOX 没有数据 */
export interface DevRow { g: Game; followers: number | null; score: number | null }
export function devRows(games: Game[], field = "followers"): DevRow[] {
  const dev = games.filter(g => g.state === "dev" && (g.src === "cien" || g.src === "fanbox"));
  const val = (g: Game) => (g.src === "cien" ? num((g as unknown as Record<string, unknown>)[field]) : null);
  const creators = new Map<string, number>();
  for (const g of dev) { const f = val(g); const c = g.id.slice(g.id.indexOf("-") + 1); if (f !== null && !creators.has(c)) creators.set(c, f); }
  const cv = [...creators.values()].sort((a, b) => a - b);
  return dev.map(g => { const f = val(g); return { g, followers: f, score: f === null ? null : pctSorted(f, cv) }; })
    .sort((a, b) => +(a.score === null) - +(b.score === null) || (b.followers ?? 0) - (a.followers ?? 0));
}
