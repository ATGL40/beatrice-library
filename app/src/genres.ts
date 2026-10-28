import type { Game, GenreDict, Lang } from "./store.ts";

// —— 题材标签：名字按语言取、统计当前分类里有哪些、按选中的标签筛（纯函数，方便单测） ——

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
