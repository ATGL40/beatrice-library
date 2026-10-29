import type { Black, Game } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { NOTE_MAX } from "./marks.ts";

// —— 黑榜：自己不推荐的作品（只在本机，提交时可以带上），和数据包里「多人拉黑」的标注（纯函数，方便单测）——

/** 黑榜理由最长几个字（和神作复议票的理由一样） */
export const BLACK_REASON_MAX = NOTE_MAX;
/** 「多人拉黑」小标签鼠标停上去的说明 */
export const FLAG_NOTE = "很多玩家把它加进了黑榜；只代表他们的看法，不影响分数";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 能不能放进黑榜：我的游戏不在公共目录里，不能 */
export const canBlacklist = (g: Game) => g.src !== "local";

/** 数据文件里的 blacklist：{作品 id: {reason?}}；不是对象的整个当没有，坏的条目丢掉，不认识的字段照留，理由不是文字的去掉 */
export function cleanBlacklist(raw: unknown): Record<string, Black> {
  const out: Record<string, Black> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!id || !isObj(v) || id === "__proto__") continue;
    const b = { ...v } as Black;
    if (b.reason !== undefined && typeof b.reason !== "string") delete b.reason;
    out[id] = b;
  }
  return out;
}

/** 数据包给的社区黑榜：flagged 是 true、人数是正整数时返回人数（显示「多人拉黑 · N 人」），不然 null */
export function flaggedCount(g: Game): number | null {
  const v = (g as unknown as Record<string, unknown>).blacklist;
  if (!isObj(v) || v.flagged !== true) return null;
  return Number.isInteger(v.count) && (v.count as number) >= 1 ? (v.count as number) : null;
}
