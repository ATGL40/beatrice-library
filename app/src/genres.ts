import type { Game, GenreDict, Lang } from "./store.ts";

// —— 题材标签：名字按语言取、统计当前分类里有哪些、按选中的标签筛（纯函数，方便单测） ——

/**
 * 不显示的年龄类题材（DLsite 题材 id）：资料仓库会去掉它们，这里给旧的、别人做的数据包兜底。
 * 206 少女 / Girl、210 少年 / Boy、211 ショタ / 正太 / Shota、504 おねショタ / 姐姐×正太、531 つるぺたババア / 萝老太婆 / Petite Baba。
 * 数据包题材字典里写了 hidden: true 的也一样不显示（见 catalog.ts 的 hiddenGenreIds）
 */
export const HIDDEN_GENRES: ReadonlySet<string> = new Set(["206", "210", "211", "504", "531"]);

/** 题材名字：按设置的语言取，没有就用日文；字典里没有这个 id 就显示 id */
export const genreName = (dict: GenreDict, id: string, lang: Lang) => dict[id]?.[lang] || dict[id]?.ja || id;

/** 这些作品里出现过的题材和部数，部数多的在前（一样多按 id） */
export function countGenres(games: Iterable<Game>): [string, number][] {
  const n = new Map<string, number>();
  for (const g of games) for (const id of g.genres ?? []) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** 选了标签时只留同时带上全部选中标签的作品；没有题材资料的作品不算 */
export const hasGenres = (g: Game, selected: Iterable<string>) => [...selected].every(id => g.genres?.includes(id));

/** 「不看」：带上任何一个不看的题材就不显示（不显示的题材 hiddenGenres 也算，存着的「不看」照旧筛）；没有题材资料的作品不受影响 */
export function hasAnyGenre(g: Game, ids: Iterable<string>): boolean {
  if (!g.genres?.length && !g.hiddenGenres?.length) return false;
  for (const id of ids) if (g.genres?.includes(id) || g.hiddenGenres?.includes(id)) return true;
  return false;
}

/** 题材窗口里一个标签的状态：不选 ""、只看 only、不看 not */
export type GenreState = "" | "only" | "not";
/** 点一下：不选 → 只看 → 不看 → 不选 */
export const nextGenreState = (s: GenreState): GenreState => (s === "" ? "only" : s === "only" ? "not" : "");
