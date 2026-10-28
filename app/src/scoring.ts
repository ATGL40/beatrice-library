import type { Game } from "./store.ts";

// —— 排行榜：数据包里的民间榜单，和按「配方」算出来的图鉴综合榜（全是纯函数，方便单测） ——

export type RankingKind = "vote" | "score" | "editor";
export interface RankingItem { rank: number; title: string; zh?: string; rj?: string; url?: string }
export interface Ranking {
  id: string; name: string; source: string; url?: string; year?: number;
  kind?: RankingKind; note?: string; items: RankingItem[];
}
/** 配方里的一项：method 决定怎么算，weight 是比重；其余字段看 method */
export interface ScoringPart {
  key: string; label: string; method: string; weight: number;
  field?: string; count?: string; prior?: number; cap?: number;
}
export interface Scoring { name: string; parts: ScoringPart[] }
export interface PartScore { key: string; label: string; score: number | null }
export interface GameScore { total: number | null; rank: number | null; parts: PartScore[] }

/** 数据包没给配方时用这个 */
export const DEFAULT_SCORING: Scoring = {
  name: "图鉴综合榜",
  parts: [
    { key: "praise", label: "口碑", method: "bayes", field: "rate", count: "rc", prior: 50, weight: 50 },
    { key: "heat", label: "热度", method: "year-percentile", field: "dl", weight: 25 },
    { key: "lists", label: "榜单", method: "rankings", cap: 3, weight: 25 },
  ],
};

/** 只认 https 链接，别的当作没有 */
export const httpsOnly = (u: unknown): string => (typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) ? u : "");

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 数据包里的 rankings 逐条整理：格式不对的丢掉，链接只留 https */
export function cleanRankings(raw: unknown): Ranking[] {
  if (!Array.isArray(raw)) return [];
  const out: Ranking[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || !Array.isArray(r.items)) continue;
    const name = str(r.name, 100);
    if (!name) continue;
    const items: RankingItem[] = [];
    r.items.forEach((it: unknown, i: number) => {
      if (!it || typeof it !== "object") return;
      const x = it as Record<string, unknown>;
      const title = str(x.title, 300);
      if (!title) return;
      const rank = num(x.rank);
      items.push({
        rank: rank !== null && rank >= 1 ? Math.floor(rank) : i + 1,
        title, zh: str(x.zh, 300) || undefined, rj: str(x.rj, 40) || undefined, url: httpsOnly(x.url) || undefined,
      });
    });
    items.sort((a, b) => a.rank - b.rank);
    const year = num(r.year);
    out.push({
      id: str(r.id, 100) || `${name}-${year ?? out.length}`, name, source: str(r.source, 200), url: httpsOnly(r.url) || undefined,
      year: year ?? undefined, kind: ["vote", "score", "editor"].includes(r.kind) ? r.kind : undefined,
      note: str(r.note, 1000) || undefined, items,
    });
  }
  return out;
}

/**
 * 同一个榜单不同年份算一组：名字里写了年份的（「某站 2021年 某榜」）去掉年份再比，
 * 这样数据包把年份写进名字也能按年份切换
 */
export function listGroup(r: Ranking): string {
  if (!r.year) return r.name;
  const plain = r.name.replace(new RegExp(`\\s*${r.year}\\s*年?\\s*`), " ").replace(/\s+/g, " ").trim();
  return plain || r.name;
}

/** 数据包里的 scoring：格式不对就用默认配方；比重不是正数的项丢掉（不认识的 method 留着，算的时候跳过） */
export function cleanScoring(raw: unknown): Scoring {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Scoring).parts)) return DEFAULT_SCORING;
  const r = raw as Record<string, unknown>;
  const parts = (r.parts as unknown[])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map(p => ({
      key: str(p.key, 40), label: str(p.label, 40) || str(p.key, 40), method: str(p.method, 40), weight: num(p.weight) ?? 0,
      field: str(p.field, 40) || undefined, count: str(p.count, 40) || undefined,
      prior: num(p.prior) ?? undefined, cap: num(p.cap) ?? undefined,
    }))
    .filter(p => p.key && p.method && p.weight > 0);
  return parts.length ? { name: str(r.name, 60) || DEFAULT_SCORING.name, parts } : DEFAULT_SCORING;
}

/** v 在 values 里的百分位（0–100）：最小 0、最大 100，相同的取中间；只有一个时算 50 */
export function percentile(v: number, values: number[]): number {
  const n = values.length;
  if (n <= 1) return 50;
  let below = 0, same = 0;
  for (const x of values) { if (x < v) below++; else if (x === v) same++; }
  return ((below + (same - 1) / 2) / (n - 1)) * 100;
}

const field = (g: Game, f?: string): number | null => (f ? num((g as unknown as Record<string, unknown>)[f]) : null);
const yearOf = (g: Game) => (g.date || "").slice(0, 4);
/** 作品的年份数字，没有日期是 0 */
export const yearNum = (g: Game) => Number(yearOf(g)) || 0;
/** 这些作品出现过的年份，新的在前（综合榜按年份细分用） */
export const yearsOf = (gs: Game[]) => [...new Set(gs.map(yearNum).filter(Boolean))].sort((a, b) => b - a);

type Method = (part: ScoringPart, group: Game[], rankings: Ranking[]) => Map<string, number | null>;

/**
 * 每种 method：给同一分类里的作品各算一个 0–100 的分，算不出是 null
 * - bayes：先用同分类的平均分 m 修正（人少的往 m 拉），再换成同分类里的百分位
 * - year-percentile：同分类、同年份里的百分位；同组不到 5 部就在整个分类里比
 * - rankings：每上一个榜加 (N+1-名次)/N，合计除以 cap 再乘 100，最多 100；没上榜是 0
 */
export const METHODS: Record<string, Method> = {
  bayes(part, group) {
    const rated = group.filter(g => field(g, part.field) !== null);
    const m = rated.reduce((s, g) => s + field(g, part.field)!, 0) / (rated.length || 1);
    const prior = part.prior ?? 50;
    const adj = new Map<string, number>();
    for (const g of rated) {
      const rate = field(g, part.field)!, count = field(g, part.count);
      if (count === null || count < 0) continue;
      adj.set(g.id, (prior * m + rate * count) / (prior + count));
    }
    const all = [...adj.values()];
    return new Map(group.map(g => [g.id, adj.has(g.id) ? percentile(adj.get(g.id)!, all) : null]));
  },
  "year-percentile"(part, group) {
    const has = group.filter(g => field(g, part.field) !== null);
    const all = has.map(g => field(g, part.field)!);
    return new Map(group.map(g => {
      const v = field(g, part.field);
      if (v === null) return [g.id, null];
      const same = has.filter(x => yearOf(x) === yearOf(g)).map(x => field(x, part.field)!);
      return [g.id, percentile(v, same.length >= 5 ? same : all)];
    }));
  },
  rankings(part, group, rankings) {
    const sum = new Map<string, number>();
    for (const r of rankings) {
      const n = r.items.length;
      for (const it of r.items) if (it.rj) sum.set(it.rj, (sum.get(it.rj) ?? 0) + (n + 1 - it.rank) / n);
    }
    const cap = part.cap && part.cap > 0 ? part.cap : 3;
    return new Map(group.map(g => [g.id, Math.min(100, ((sum.get(g.id) ?? 0) / cap) * 100)]));
  },
};

/** 配方里软件认得的项（不认识的 method 跳过） */
export const knownParts = (s: Scoring) => s.parts.filter(p => p.method in METHODS);

/** 配方写成一句话：「口碑 50% · 热度 25% · 榜单 25%」 */
export function recipeText(s: Scoring): string {
  const parts = knownParts(s);
  const total = parts.reduce((x, p) => x + p.weight, 0);
  return parts.map(p => `${p.label} ${Math.round((p.weight / total) * 100)}%`).join(" · ");
}

/**
 * 给所有作品打综合分：每个分类各自算、各自排名，开发中的不参与；perCat 为 false 时所有分类放在一起算（「全部」用）。
 * 综合分 = Σ(比重×分) / Σ(有分的项的比重)，算不出（null）的项不进分母；一项都没有就是 null，不排名
 */
export function scoreAll(games: Game[], rankings: Ranking[], scoring: Scoring = DEFAULT_SCORING, perCat = true): Map<string, GameScore> {
  const parts = knownParts(scoring);
  const byCat = new Map<string, Game[]>();
  for (const g of games) {
    if (g.state === "dev") continue;
    const c = perCat ? g.cat || "other" : "";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(g);
  }
  const out = new Map<string, GameScore>();
  for (const group of byCat.values()) {
    const cols = parts.map(p => METHODS[p.method](p, group, rankings));
    for (const g of group) {
      let sum = 0, w = 0;
      const ps = parts.map((p, i) => {
        const s = cols[i].get(g.id) ?? null;
        if (s !== null) { sum += p.weight * s; w += p.weight; }
        return { key: p.key, label: p.label, score: s };
      });
      out.set(g.id, { total: w ? sum / w : null, rank: null, parts: ps });
    }
    const ranked = group.filter(g => out.get(g.id)!.total !== null)
      .sort((a, b) => out.get(b.id)!.total! - out.get(a.id)!.total! || (b.date || "").localeCompare(a.date || ""));
    ranked.forEach((g, i) => (out.get(g.id)!.rank = i + 1));
  }
  return out;
}

/** 「87 · 口碑 92 · 热度 80 · 榜单 70」：算不出的项不写 */
export function scoreText(s: GameScore): string {
  const parts = s.parts.filter(p => p.score !== null).map(p => `${p.label} ${Math.round(p.score!)}`);
  return [s.total === null ? "" : String(Math.round(s.total)), ...parts].filter(Boolean).join(" · ");
}
