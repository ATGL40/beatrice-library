import type { Black, Game, Mark } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入

// —— 今天玩什么：从想玩和已有里随便挑一部（纯函数，方便单测） ——

/** 能挑的：想玩、已有里的，不含玩过的、黑榜里的、开发中的；inCat 是当前分类 */
export function todayCandidates(games: Iterable<Game>, marks: Record<string, Mark>, blacklist: Record<string, Black>, inCat: (g: Game) => boolean): Game[] {
  return [...games].filter(g => {
    const s = marks[g.id]?.status;
    return (s === "want" || s === "have") && !Object.prototype.hasOwnProperty.call(blacklist, g.id) && g.state !== "dev" && inCat(g);
  });
}

/** 随便挑一部；not 是刚才那部，不止一部能挑时不再挑它 */
export function pickOne<T>(list: T[], not?: T, rand: () => number = Math.random): T | null {
  const pool = list.length > 1 && not !== undefined ? list.filter(x => x !== not) : list;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] : null;
}
