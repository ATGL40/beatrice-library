import test from "node:test";
import assert from "node:assert/strict";
import { activeBands, bandKeyOf, bandOptions, cleanBandSel, countBands } from "../src/bands.ts";
import { cleanRecipeV2, THIN_LABEL, THIN_NOTE } from "../src/scoring2.ts";

const BANDS = [["神作", 96], ["神作提名", 95], ["超大杯", 85], ["大杯", 70], ["中杯", 0]];

test("筛选项：每一档带分数范围（最高 96+、单个分数、区间、最低 <70），最后是评价不足", () => {
  assert.deepEqual(bandOptions(BANDS), [
    { key: "神作", range: "96+", title: "综合 96 分及以上" },
    { key: "神作提名", range: "95", title: "综合 95 分" },
    { key: "超大杯", range: "85–94", title: "综合 85–94 分" },
    { key: "大杯", range: "70–84", title: "综合 70–84 分" },
    { key: "中杯", range: "<70", title: "综合 70 分以下" },
    { key: THIN_LABEL, range: "", title: THIN_NOTE },
  ]);
  // 配方的默认档（整理过、分数线高的在前）和上面一样
  assert.deepEqual(bandOptions(cleanRecipeV2({ version: 2 }).bands).map(o => o.key + o.range), ["神作96+", "神作提名95", "超大杯85–94", "大杯70–84", "中杯<70", THIN_LABEL]);
  // 只有一档：只写「0+」；没有档：只剩评价不足
  assert.deepEqual(bandOptions([["全部", 0]]).map(o => o.range), ["0+", ""]);
  assert.deepEqual(bandOptions([]).map(o => o.key), [THIN_LABEL]);
});

test("作品落在哪一项：有档用档名，评价不足的是评价不足，没有档也不算评价不足的（开发中、我的游戏）是空的", () => {
  assert.equal(bandKeyOf({ band: "超大杯" }, false), "超大杯");
  assert.equal(bandKeyOf(null, true), THIN_LABEL);
  assert.equal(bandKeyOf(null, false), "");
  assert.equal(bandKeyOf({ band: "" }, false), "");
});

test("起作用的选择：只算现在的筛选项里有的，一个都没有就不筛", () => {
  const opts = bandOptions(BANDS);
  assert.equal(activeBands([], opts), null);
  assert.equal(activeBands(["旧档名"], opts), null);
  assert.deepEqual([...activeBands(["大杯", "旧档名", THIN_LABEL], opts)], ["大杯", THIN_LABEL]);
  assert.equal(activeBands(["大杯"], []), null); // 第 1 版配方没有档：不筛
});

test("部数：按 key 数，空的（没有档）不算", () => {
  assert.deepEqual([...countBands(["大杯", "", "大杯", THIN_LABEL, "神作"])], [["大杯", 2], [THIN_LABEL, 1], ["神作", 1]]);
  assert.equal(countBands([]).size, 0);
});

test("数据文件里的 ui.bands：只留字符串、去重；不是数组就是没选", () => {
  assert.deepEqual(cleanBandSel(["大杯", 3, null, "大杯", "中杯"]), ["大杯", "中杯"]);
  assert.deepEqual(cleanBandSel(undefined), []);
  assert.deepEqual(cleanBandSel("大杯"), []);
  assert.deepEqual(cleanBandSel({ 0: "大杯" }), []);
});
