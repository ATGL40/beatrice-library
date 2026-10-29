import type { Game } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入
import type { Ranking } from "./scoring.ts";

// —— 综合榜第 2 版（数据包 scoring.version 为 2）：口碑 + 热度（+ 社区评分）→ 综合分 → 固定曲线换成 0–100 的 F，再按门槛定档。
//    公共分和档只看数据包（资料 + 已结算的神作名单）；玩家评分（自己和朋友的星级）只是给自己看的修正。全是纯函数，方便单测 ——

type PerSrc<T> = Record<string, T>;
/** 一道门槛：没过（口碑维度 + 热 / 榜 / 玩 至少 others 项）的，F 最高 capTo */
export interface TierGate { band: string; praise: string; others: number; capTo: number }
export interface RecipeV2 {
  name: string; version: 2;
  praise: { k: PerSrc<number>; anchors: PerSrc<[number, number]> };
  heat: { method: string; weight: number; minGroup: number; anchors: PerSrc<[number, number]>; age: { min: number; max: number; exp: number } };
  players: { neutral: number; prior: number; cap: number };
  community: { minCount: number; prior: number; weight: number };
  curve: { on: string; points: [number, number][] };
  bands: [string, number][];
  /** 神作和神作提名以外的作品，F 最高 max */
  cap: { max: number };
  /** 神作提名：曲线分至少 minF0、过了全部门槛，并且过了 praise 指定的口碑维度、热 / 榜 / 玩至少 others 项；F 固定是 score */
  nominee: { praise: string; others: number; score: number; minF0: number };
  gates: {
    praise: { rating: PerSrc<number>; raters: PerSrc<number> };
    praiseTop: { rating: PerSrc<number>; raters: PerSrc<number> };
    heat: { min: number }; lists: { also: boolean }; community: { minAvg: number; minCount: number };
    tiers: TierGate[];
  };
  /** minScore：神作至少显示这个分；reasonRequired / reasonMinChars：哪种票要写理由、至少几个字 */
  canon: { minScore: number; reasonRequired: string; reasonMinChars: number };
  development: { name: string; field: string };
  /** 冷门佳作榜：配方里有 hiddenGems 才有（cleanHiddenGems 整理），没有是 null */
  hiddenGems: HiddenGems | null;
}
/**
 * 冷门佳作榜：已发售、评分不低于 rating[来源]、打分人数在 raters[来源] = [下限, 上限) 里的作品，
 * 按口碑分 Q（评分换算后、人数少的往中间拉）从高到低，最多 limit 部。只是一个榜单，不改综合分和档
 */
export interface HiddenGems { name: string; rating: PerSrc<number>; raters: PerSrc<[number, number]>; sortBy: "praise"; limit: number }

/** 分数的说明：排行榜综合榜标题下面写长的，详情页分数旁的「?」写短的 */
export const SCORE_NOTE = "分数是汇总各社区玩家评价算出来的参考，不是定论。算法可能出错，也会因为资料不全而偏；评价少的作品会被往中间拉。分数不高不代表不好玩，口味因人而异——冷门佳作榜里就有很多好作品。";
export const SCORE_NOTE_SHORT = "分数是各社区评价的汇总参考，可能出错；不高不代表不好玩。";

/** 配方里缺的部分用这些补（数字和资料仓库的 scoring.json 一样） */
export const DEFAULT_V2: RecipeV2 = {
  name: "图鉴综合榜", version: 2,
  praise: { k: { dlsite: 100, commercial: 30, steam: 200 }, anchors: { dlsite: [4.15, 4.9], commercial: [70, 89], steam: [79, 101] } },
  heat: { method: "abs-log", weight: 0.25, minGroup: 10, anchors: { dlsite: [3.55, 4.8], commercial: [1.7, 3.3], steam: [2.05, 4.1] }, age: { min: 0.25, max: 1, exp: 0.5 } },
  players: { neutral: 3, prior: 3, cap: 10 },
  community: { minCount: 20, prior: 20, weight: 0.25 },
  curve: { on: "composite", points: [[-41.648331, 40], [33.495033, 60], [50.227019, 70], [65.292801, 80], [78.436517, 90], [90.222694, 95], [93.144961, 97], [133.860303, 99]] },
  bands: [["神作", 96], ["神作提名", 95], ["杰作", 90], ["优秀", 80], ["良好", 70], ["一般", 60], ["平平", 0]],
  cap: { max: 94 },
  nominee: { praise: "praiseTop", others: 1, score: 95, minF0: 95 },
  gates: {
    praise: { rating: { dlsite: 4.75, commercial: 85, steam: 94 }, raters: { dlsite: 1000, commercial: 300, steam: 2000 } },
    praiseTop: { rating: { dlsite: 4.84, commercial: 92, steam: 97 }, raters: { dlsite: 10683, commercial: 876, steam: 4108 } },
    heat: { min: 85 }, lists: { also: false }, community: { minAvg: 4.5, minCount: 20 },
    tiers: [{ band: "杰作", praise: "praise", others: 1, capTo: 89 }],
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
  r.gates.tiers = r.gates.tiers.filter(t => obj(t) && typeof t.band === "string" && typeof t.praise === "string" && num(t.others) !== null && num(t.capTo) !== null);
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

/** 冷门佳作榜的一行：评分 x、打分人数 n、口碑分 Q */
export interface GemRow { g: Game; x: number; n: number; Q: number }
/** 选出冷门佳作（不截 limit，筛完分类、年份、来源再截）：Q 高的在前，同分发售日新的在前（和资料仓库的说明一致） */
export function hiddenGemRows(games: Iterable<Game>, base: Map<string, Base>, hg: HiddenGems): GemRow[] {
  const rows: GemRow[] = [];
  for (const g of games) {
    const b = base.get(g.id), line = hg.rating[g.src], span = hg.raters[g.src];
    if (g.state === "dev" || !b || line === undefined || !span) continue;
    const { x, n } = signal(g);
    if (x === null || n === null || x < line || n < span[0] || n >= span[1]) continue;
    rows.push({ g, x, n, Q: b.Q });
  }
  return rows.sort((a, b) => b.Q - a.Q || (b.g.date || "").localeCompare(a.g.date || ""));
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

/** 平台信号：x 评分、n 打分人数、h 热度用的数（DLsite 销量 / 批評空間人数 / Steam 评测数） */
export function signal(g: Game): { x: number | null; n: number | null; h: number | null } {
  const r = g as unknown as Record<string, unknown>;
  if (g.src === "dlsite") return { x: num(g.rate), n: num(g.rc), h: num(g.dl) };
  if (g.src === "commercial") { const e = obj(r.egs) ?? {}; return { x: num(e.median), n: num(e.count), h: num(e.count) }; }
  if (g.src === "steam") { const e = obj(r.steam) ?? {}; return { x: num(e.positive), n: num(e.reviews), h: num(e.reviews) }; }
  return { x: null, n: null, h: null };
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

/** 五个维度：口（口碑过线）、口★（顶尖口碑）、热、榜、玩 */
export interface Dims { praise: boolean; praiseTop: boolean; heat: boolean; lists: boolean; players: boolean }
/** 一部作品的公共部分（每份目录算一次）：F 是曲线给的分（还没封顶） */
export interface Base { R: number; Q: number; H: number; hot: boolean; C: number | null; comp: number; F: number; dims: Dims }

const DAY = 86400000;
/** YYYY-MM-DD 换成毫秒；不存在的日期（2 月 31 日、13 月、平年 2 月 29 日）是 NaN，不让 Date.UTC 自动顺延 */
export function dateMs(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
}

/**
 * 每部已发售、有平台评分的作品：
 * R = 评分按本平台锚点线性换成 0–100（不截断）；Q = 50 + n/(n+k)·(R−50)；
 * H = 热度（abs-log：L = log10(max(h,1) / t^exp)，t 是发售后的年数（按数据包日期 updated 算），夹在 age.min～age.max，
 *     发售日缺失、不合法或晚于数据包日期时不补偿（t^exp 当 1），再按锚点换成 0–100；
 *     year-percentile：同来源同年份里的百分位，同组不到 minGroup 部就和同来源全部比）；没有热度数据的算 50，拿不到「热」；
 * 社区评分人数够 minCount 时和 Q 混合：口碑 = (1−w)·Q + w·C，C = 50 + c/(c+prior)·((平均−1)·25 − 50)；
 * 综合分 = (1−heat.weight)·口碑 + heat.weight·H；F = 曲线(综合分)（curve.on 是 percentile 时先换成在全部作品里的百分位）
 */
export function baseScores(games: Game[], rankings: Ranking[], rc: RecipeV2, updated = ""): Map<string, Base> {
  const listed = new Set<string>();
  for (const r of rankings) for (const it of r.items) if (it.rj) listed.add(it.rj);
  const released = games.filter(g => g.state !== "dev");
  const sig = new Map(released.map(g => [g.id, signal(g)]));
  const rated = released.filter(g => {
    const s = sig.get(g.id)!;
    return s.x !== null && s.n !== null && s.n > 0 && pair(rc.praise.anchors[g.src]);
  });
  const { heat, community: cm } = rc;
  // year-percentile 用：同来源（已发售、有热度数据的）全部年份 / 同年份，升序
  const groups = new Map<string, number[]>();
  if (heat.method === "year-percentile") {
    for (const g of released) {
      const h = sig.get(g.id)!.h;
      if (h === null) continue;
      for (const k of [g.src, `${g.src}|${(g.date || "").slice(0, 4)}`]) { if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(h); }
    }
    for (const v of groups.values()) v.sort((a, b) => a - b);
  }
  const now = dateMs(updated);
  const heatOf = (g: Game): [number, boolean] => {
    const h = sig.get(g.id)!.h;
    if (h === null) return [50, false];
    if (heat.method === "year-percentile") {
      const same = groups.get(`${g.src}|${(g.date || "").slice(0, 4)}`)!;
      return [pctSorted(h, same.length >= heat.minGroup ? same : groups.get(g.src)!), true];
    }
    const a = heat.anchors[g.src], d = dateMs(g.date || "");
    if (!pair(a) || a[1] === a[0]) return [50, false];
    const t = Number.isFinite(d) && d <= now ? Math.min(Math.max(Math.round((now - d) / DAY) / 365.25, heat.age.min), heat.age.max) : 1;
    const L = Math.log10(Math.max(h, 1) / t ** heat.age.exp);
    return [Math.min(100, Math.max(0, (100 * (L - a[0])) / (a[1] - a[0]))), true];
  };
  const out = new Map<string, Base>();
  const G = rc.gates;
  const line = (gate: { rating: PerSrc<number>; raters: PerSrc<number> }, src: string, x: number, n: number) =>
    x >= (num(gate.rating[src]) ?? Infinity) && n >= (num(gate.raters[src]) ?? Infinity);
  for (const g of rated) {
    const { x, n } = sig.get(g.id) as { x: number; n: number };
    const [lo, hi] = rc.praise.anchors[g.src], k = num(rc.praise.k[g.src]) ?? 0;
    const R = ((x - lo) / (hi - lo)) * 100;
    const Q = 50 + (n / (n + k)) * (R - 50);
    const [H, hot] = heatOf(g);
    const c = communityOf(g);
    const C = c && c.count >= cm.minCount ? 50 + (c.count / (c.count + cm.prior)) * ((c.avg - 1) * 25 - 50) : null;
    const praise = C === null ? Q : (1 - cm.weight) * Q + cm.weight * C;
    const comp = (1 - heat.weight) * praise + heat.weight * H;
    const also = (g as unknown as { also?: unknown }).also;
    const dims: Dims = {
      praise: line(G.praise, g.src, x, n),
      praiseTop: line(G.praiseTop, g.src, x, n),
      heat: hot && H >= G.heat.min,
      lists: listed.has(g.id) || (G.lists.also && Array.isArray(also) && also.length > 0),
      players: !!c && c.avg >= G.community.minAvg && c.count >= G.community.minCount,
    };
    out.set(g.id, { R, Q, H, hot, C, comp, F: 0, dims });
  }
  const comps = rc.curve.on === "percentile" ? [...out.values()].map(b => b.comp).sort((a, b) => a - b) : [];
  for (const b of out.values()) b.F = curve(rc.curve.on === "percentile" ? pctSorted(b.comp, comps) : b.comp, rc.curve.points);
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
 * 2. 神作提名（曲线分至少 nominee.minF0，过了全部门槛，并且过了 nominee.praise 的口碑维度、热 / 榜 / 玩至少 others 项）：F = nominee.score；
 * 3. 其他：没过的门槛 F 最高 capTo，再整体最高 cap.max
 */
export function finalOf(g: Game, base: Base | undefined, canon: Map<string, string>, rc: RecipeV2): Final | null {
  if (g.state === "dev" || !base) return null;
  const d = base.dims, F0 = base.F;
  const others = +d.heat + +d.lists + +d.players;
  const pass = (praise: string, n: number) => !!d[praise as keyof Dims] && others >= n;
  const tiersOk = rc.gates.tiers.map(t => pass(t.praise, t.others));
  const by = canon.get(g.id) === "vote" ? "vote" : canon.has(g.id) ? "manual" : null;
  const nominee = !by && F0 >= rc.nominee.minF0 && tiersOk.every(Boolean) && pass(rc.nominee.praise, rc.nominee.others);
  let F = F0;
  if (by) F = Math.max(F0, rc.canon.minScore);
  else if (nominee) F = rc.nominee.score;
  else {
    rc.gates.tiers.forEach((t, i) => { if (!tiersOk[i]) F = Math.min(F, t.capTo); });
    F = Math.min(F, rc.cap.max);
  }
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
