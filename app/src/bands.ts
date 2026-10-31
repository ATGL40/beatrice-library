import { THIN_LABEL, THIN_NOTE, type Final } from "./scoring2.ts"; // 带 .ts 后缀，node 单测才能直接载入

// —— 图鉴的分数筛选：按综合榜的档（神作、神作提名、超大杯……）加「评价不足」筛（纯函数，方便单测） ——

/** 一个筛选项：key 是档名（也是按钮上的字），range 是写在名字后面的分数范围，title 是鼠标停上去的说明 */
export interface BandOption { key: string; range: string; title: string }

/**
 * 筛选项：配方里的每一档（分数线高的在前，见 cleanRecipeV2），最后是「评价不足」。
 * 范围按相邻两档的分数线算：最高一档写「96+」，最低一档写「<70」，只有一个分数的写「95」
 */
export function bandOptions(bands: [string, number][]): BandOption[] {
  const out = bands.map(([key, lo], i): BandOption => {
    const hi = i ? bands[i - 1][1] - 1 : Infinity;
    const [range, words] = !i ? [`${lo}+`, `${lo} 分及以上`]
      : lo <= 0 ? [`<${hi + 1}`, `${hi + 1} 分以下`]
      : lo === hi ? [`${lo}`, `${lo} 分`]
      : lo < hi ? [`${lo}–${hi}`, `${lo}–${hi} 分`] : ["", ""];
    return { key, range, title: words ? `综合 ${words}` : key };
  });
  return [...out, { key: THIN_LABEL, range: "", title: THIN_NOTE }];
}

/** 一部作品落在哪个筛选项：有档的是档名，评价不足的是「评价不足」；开发中、国产、我的游戏这些没有档也不算评价不足的是空的（选了分数档时不显示） */
export const bandKeyOf = (f: Final | null, thin: boolean) => f?.band || (thin ? THIN_LABEL : "");

/** 真正起作用的选择：存着的里面，现在的筛选项里还有的那些（换了数据包、档名变了的不算）；一个都没有就是 null，不筛 */
export function activeBands(saved: readonly string[], options: BandOption[]): Set<string> | null {
  const keys = new Set(options.map(o => o.key));
  const on = new Set(saved.filter(k => keys.has(k)));
  return on.size ? on : null;
}

/** 每个筛选项有几部（作品给的是 bandKeyOf 算出的 key，空的不算） */
export function countBands(keys: Iterable<string>): Map<string, number> {
  const n = new Map<string, number>();
  for (const k of keys) if (k) n.set(k, (n.get(k) ?? 0) + 1);
  return n;
}

/** 数据文件里的 ui.bands：只留字符串、去掉重复；不是数组就是没选 */
export const cleanBandSel = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string"))] : []);
