import type { Game } from "./store.ts";

// —— 图鉴按年份分组和年份跳转条（纯函数，方便单测）——

export const NO_YEAR = "年份不明";
export const DEV_GROUP = "开发中";

/** 作品放在哪一组：开发中的单独一组，没有发售日的放「年份不明」 */
export const yearKey = (g: Game) => (g.state === "dev" ? DEV_GROUP : (g.date || "").slice(0, 4) || NO_YEAR);

/** 按年份分组：新的年份在前，「年份不明」「开发中」放最后；每组里按 cmp 排（cmp 就是排序下拉框选的那种） */
export function groupByYear(list: Game[], cmp: (a: Game, b: Game) => number): [string, Game[]][] {
  const groups = new Map<string, Game[]>();
  for (const g of list) {
    const k = yearKey(g);
    const gs = groups.get(k);
    if (gs) gs.push(g); else groups.set(k, [g]);
  }
  const last = (k: string) => (k === DEV_GROUP ? 2 : k === NO_YEAR ? 1 : 0);
  return [...groups]
    .sort(([a], [b]) => last(a) - last(b) || b.localeCompare(a))
    .map(([k, gs]) => [k, gs.sort(cmp)]);
}

/** 年份跳转条上的按钮：每组一个，顺序和分组一样；「年份不明」写成「未知」 */
export const yearJumps = (groups: [string, Game[]][]) =>
  groups.map(([key, gs]) => ({ key, label: key === NO_YEAR ? "未知" : key, n: gs.length }));
