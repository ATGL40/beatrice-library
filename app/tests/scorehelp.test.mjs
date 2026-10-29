import test from "node:test";
import assert from "node:assert/strict";
import { scoreHelpHtml } from "../src/scorehelp.ts";
import { cleanRecipeV2, DEFAULT_V2 } from "../src/scoring2.ts";

const text = html => html.replace(/<[^>]+>/g, "");

test("分数是怎么算的：默认配方的数字都从配方里来，不写基准作品", () => {
  const t = text(scoreHelpHtml(cleanRecipeV2({ version: 2 })));
  assert.match(t, /^算法可能出错，分不高不代表不好玩，自己喜欢最重要。/);
  assert.match(t, /主要看玩家打的分——DLsite 星级、批评空间、Bangumi、大家在本软件里提交的星级，商业作还看 VNDB。/);
  assert.match(t, /作品自己平台的评分至少占一半。上过民间榜单算一份好评。Steam 好评率不算分，只显示作参考。/);
  assert.match(t, /销量只占一小部分（约 15%），而且只和同时期的作品比。/);
  assert.match(t, /评价少的作品只会被估高、不会被压低；评价太少的不打分，放在「评价不足」。/);
  assert.match(t, /神作（人工认定或大家投票） › 神作提名 95 › 超大杯 85–94 › 大杯 70–84 › 中杯 70 以下。/);
  assert.match(t, /达到基准作品口碑的九成/);
  assert.match(t, /黑榜和「多人拉黑」不影响分数/);
  assert.ok(!t.includes(DEFAULT_V2.nominee.benchmark) && !t.includes("兰斯"));
});

test("分数是怎么算的：配方变了数字跟着变；没有的部分不写数字", () => {
  const rc = cleanRecipeV2({ version: 2, heat: { weight: 0.2 }, nominee: { benchmarkPct: 0.85 }, bands: [["神作", 97], ["神作提名", 96], ["好", 80], ["一般", 0]] });
  rc.praise.secondary = null;
  rc.praise.lists.max = 0;
  const t = text(scoreHelpHtml(rc));
  assert.match(t, /约 20%/);
  assert.match(t, /基准作品口碑的85%/);
  assert.match(t, /神作（人工认定或大家投票） › 神作提名 96 › 好 80–95 › 一般 80 以下/);
  assert.ok(!t.includes("至少占") && !t.includes("民间榜单"));
  assert.match(text(scoreHelpHtml(cleanRecipeV2({ version: 2, heat: { weight: 0 } }))), /不看销量/);
  // 第 1 版配方（没有 v2）：只写不带数字的几条
  const v1 = text(scoreHelpHtml(null));
  assert.match(v1, /算法可能出错/);
  assert.ok(!/\d/.test(v1), v1);
});
