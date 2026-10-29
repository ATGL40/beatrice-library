import { THIN_LABEL, type RecipeV2 } from "./scoring2.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { esc } from "./text.ts";

// —— 「分数是怎么算的」：综合榜标题下、分数筛选那一排、详情页分数旁都能一键打开的同一个说明（纯函数，方便单测）。
//    数字都从数据包的配方里取，配方里没有的就不写数字；不写公式，不点基准作品的名字 ——

/** 打开说明的按钮：带 data-score-help 的都行（library.ts 在 document 上统一接） */
export const HELP_LINK = (text = "分数是怎么算的") => `<button type="button" class="help-link" data-score-help>${esc(text)}</button>`;

/** 说明里提到的社区评分叫什么 */
const SRC_TEXT: Record<string, string> = {
  dlsite: "DLsite 星级", commercial: "批评空间", bgm: "Bangumi", vndb: "VNDB", community: "大家在本软件里提交的星级", steam: "Steam 好评率",
};
/** 作品来源叫什么（「商业作还看 VNDB」） */
const WORK_TEXT: Record<string, string> = { commercial: "商业作", dlsite: "DLsite 作品", steam: "Steam 作品" };
const CN = "零一二三四五六七八九十";

/** 0.9 → 「九成」，不是整成的写百分比 */
const share = (x: number) => { const p = Math.round(x * 100); return p % 10 === 0 && p > 0 && p <= 100 ? `${CN[p / 10]}成` : `${p}%`; };

/** 1. 看什么：哪些社区的评分对所有作品都算，哪些只对某些来源算，哪些只显示不算分 */
function sourcesText(rc: RecipeV2) {
  const pr = rc.praise, all: string[] = [], some: string[] = [], none: string[] = [];
  for (const s of Object.keys(pr.anchors)) {
    const only = pr.appliesTo[s];
    if (!only) all.push(SRC_TEXT[s] ?? s);
    else if (only.length) some.push(`${only.map(w => WORK_TEXT[w] ?? w).join("、")}还看 ${SRC_TEXT[s] ?? s}`);
    else none.push(SRC_TEXT[s] ?? s);
  }
  const sec = pr.secondary;
  // 本平台评分至少占多少：外站合起来最多是本平台的 maxShareOfNative 倍
  const native = sec && sec.maxShareOfNative >= 0
    ? (sec.maxShareOfNative === 1 ? "作品自己平台的评分至少占一半" : `作品自己平台的评分至少占 ${Math.round(100 / (1 + sec.maxShareOfNative))}%`) : "";
  return [
    `主要看玩家打的分——${all.join("、")}${some.length ? `，${some.join("，")}` : ""}。`,
    native ? `${native}。` : "",
    pr.lists.max > 0 ? "上过民间榜单算一份好评。" : "",
    none.length ? `${none.join("、")}不算分，只显示作参考。` : "",
  ].join("");
}

/** 4. 档位：「神作（人工认定或大家投票）› 神作提名 95 › 超大杯 85–94 › 大杯 70–84 › 中杯 70 以下」 */
function bandsText(rc: RecipeV2) {
  const b = rc.bands;
  return b.map(([name, lo], i) => {
    if (i === 0) return `${name}（人工认定或大家投票）`;
    const hi = b[i - 1][1] - 1;
    return lo <= 0 ? `${name} ${hi + 1} 以下` : lo === hi ? `${name} ${lo}` : lo < hi ? `${name} ${lo}–${hi}` : name;
  }).join(" › ");
}

/** 整个说明的 HTML；rc 是第 2 版配方（没有就只写不带数字的几条） */
export function scoreHelpHtml(rc: RecipeV2 | null): string {
  const sec = (title: string, body: string) => (body ? `<section><h3>${esc(title)}</h3><p>${esc(body)}</p></section>` : "");
  const heat = rc ? rc.heat.weight : null;
  const nominee = rc && rc.bands.length >= 2
    ? `神作提名由算法提名：分数够高、口碑够硬，还要达到基准作品口碑的${share(rc.nominee.benchmarkPct)}；大家投票够了升为神作。` : "";
  return [
    `<div class="score-warn" role="note"><b>算法可能出错，分不高不代表不好玩，自己喜欢最重要。</b></div>`,
    rc ? sec("看什么", sourcesText(rc)) : sec("看什么", "主要看各社区玩家打的分，评分高、评价人数多的作品分数高。"),
    heat === null ? "" : sec("销量", heat > 0 ? `销量只占一小部分（约 ${Math.round(heat * 100)}%），而且只和同时期的作品比。` : "不看销量。"),
    sec("评价少的作品", `评价少的作品只会被估高、不会被压低；评价太少的不打分，放在「${THIN_LABEL}」。`),
    rc && rc.bands.length ? sec("档位", `${bandsText(rc)}。${nominee}`) : "",
    sec("黑榜", "黑榜和「多人拉黑」不影响分数，只是标注。"),
  ].join(""); // 最后的「想参与」和提交按钮写在 index.html 里（按钮由 submit.ts 绑定）
}
