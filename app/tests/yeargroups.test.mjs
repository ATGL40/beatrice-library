import test from "node:test";
import assert from "node:assert/strict";
import { groupByYear, yearJumps, yearKey, NO_YEAR, DEV_GROUP } from "../src/yeargroups.ts";

const g = (id, date, extra = {}) => ({ id, date, state: "released", ...extra });
const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
const byScore = (a, b) => b.s - a.s;
const ids = groups => groups.map(([k, gs]) => [k, gs.map(x => x.id)]);

test("分组的键：开发中单独一组，没有发售日的是「年份不明」", () => {
  assert.equal(yearKey(g("a", "2024-05-01")), "2024");
  assert.equal(yearKey(g("b", "")), NO_YEAR);
  assert.equal(yearKey(g("c", "2026-01-01", { state: "dev" })), DEV_GROUP);
});

test("年份新的在前，年份不明、开发中放最后；每年里按选的排序排", () => {
  const list = [g("a", "2021-03-01", { s: 1 }), g("b", "", { s: 9 }), g("c", "2024-01-01", { s: 2 }), g("d", "2021-12-01", { s: 5 }),
    g("e", "2027-01-01", { state: "dev", s: 0 }), g("f", "2024-06-01", { s: 1 })];
  assert.deepEqual(ids(groupByYear(list, byDate)), [["2024", ["f", "c"]], ["2021", ["d", "a"]], [NO_YEAR, ["b"]], [DEV_GROUP, ["e"]]]);
  // 按综合分这类排序：年份的顺序不变，年内按分数
  assert.deepEqual(ids(groupByYear(list, byScore)), [["2024", ["c", "f"]], ["2021", ["d", "a"]], [NO_YEAR, ["b"]], [DEV_GROUP, ["e"]]]);
  assert.deepEqual(groupByYear([], byDate), []);
});

test("和以前的「按年份」一样：按发售日排时分组后的顺序就是整列按日期排的顺序", () => {
  const list = Array.from({ length: 50 }, (_, i) => g(`x${i}`, i % 7 ? `20${10 + (i * 7) % 15}-0${1 + i % 9}-1${i % 10}` : ""));
  const flat = groupByYear(list, byDate).flatMap(([, gs]) => gs.map(x => x.id));
  assert.deepEqual(flat, [...list].sort(byDate).map(x => x.id));
});

test("年份跳转条：每组一个按钮，带部数，「年份不明」写成「未知」", () => {
  const groups = groupByYear([g("a", "2026-01-01"), g("b", "2026-02-01"), g("c", "2005-01-01"), g("d", "")], byDate);
  assert.deepEqual(yearJumps(groups), [{ key: "2026", label: "2026", n: 2 }, { key: "2005", label: "2005", n: 1 }, { key: NO_YEAR, label: "未知", n: 1 }]);
});
