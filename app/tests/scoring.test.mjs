import test from "node:test";
import assert from "node:assert/strict";
import { cleanRankings, cleanScoring, DEFAULT_SCORING, percentile, recipeText, scoreAll, scoreText } from "../src/scoring.ts";

const game = (id, o = {}) => ({ id, cat: "f-rpg", state: "released", title: id, names: { ja: id, zh: id, en: id }, mt: [],
  circle: "", date: "2020-01-01", rate: null, dl: null, url: "", cover: "", note: "", ...o });
const only = (method, extra = {}) => ({ name: "t", parts: [{ key: "x", label: "X", method, weight: 1, ...extra }] });

test("百分位：最小 0、最大 100、相同取中间、只有一个算 50", () => {
  assert.equal(percentile(1, [1, 2, 3]), 0);
  assert.equal(percentile(3, [1, 2, 3]), 100);
  assert.equal(percentile(2, [1, 2, 2, 3]), 50);
  assert.equal(percentile(7, [7]), 50);
});

test("贝叶斯修正：打分的人少、分数高的会被拉低", () => {
  const gs = [
    game("few", { rate: 5.0, rc: 2 }),     // 2 个人打 5 分
    game("many", { rate: 4.8, rc: 2000 }), // 2000 个人打 4.8
    game("low", { rate: 3.0, rc: 500 }),
    game("mid", { rate: 4.0, rc: 500 }),
    game("nocount", { rate: 5.0 }),        // 没有打分人数：这一项算不出
  ];
  const s = scoreAll(gs, [], only("bayes", { field: "rate", count: "rc", prior: 50 }));
  assert.ok(s.get("many").parts[0].score > s.get("few").parts[0].score);
  assert.equal(s.get("many").parts[0].score, 100);
  assert.equal(s.get("low").parts[0].score, 0);
  assert.equal(s.get("nocount").parts[0].score, null);
  assert.equal(s.get("nocount").total, null);
  assert.equal(s.get("nocount").rank, null);
});

test("同年百分位；同年不到 5 部时在整个分类里比", () => {
  const y2020 = [1, 2, 3, 4, 5].map(i => game(`a${i}`, { date: "2020-05-01", dl: i * 100 }));
  const y2021 = [game("b1", { date: "2021-01-01", dl: 50 }), game("b2", { date: "2021-01-01", dl: 1000 })];
  const s = scoreAll([...y2020, ...y2021], [], only("year-percentile", { field: "dl" }));
  assert.equal(s.get("a5").parts[0].score, 100); // 2020 年里最高
  assert.equal(s.get("a1").parts[0].score, 0);
  // 2021 年只有 2 部：在全部 7 部里比，1000 最高、50 最低
  assert.equal(s.get("b2").parts[0].score, 100);
  assert.equal(s.get("b1").parts[0].score, 0);
});

test("榜单加分：(N+1-名次)/N，除以 cap 再乘 100，最多 100；没上榜是 0 不是 null", () => {
  const gs = [game("A"), game("B"), game("C")];
  const list = (id, rjs) => ({ id, name: id, source: "", items: rjs.map((rj, i) => ({ rank: i + 1, title: rj, rj })) });
  const r = [list("l1", ["A", "B"]), list("l2", ["A"]), list("l3", ["A"]), list("l4", ["A"])];
  const s = scoreAll(gs, r, only("rankings", { cap: 3 }));
  assert.equal(s.get("A").parts[0].score, 100); // 1 + 1 + 1 + 1 = 4 > cap 3
  assert.equal(Math.round(s.get("B").parts[0].score * 100) / 100, 16.67); // (2+1-2)/2 = 0.5 → 0.5/3
  assert.equal(s.get("C").parts[0].score, 0);
});

test("综合分：算不出的项不进分母；开发中的不参与；每个分类各自排名", () => {
  const gs = [
    game("p", { rate: 4.5, rc: 100, dl: 10 }),
    game("q", { rate: 4.0, rc: 100, dl: 20 }),
    game("r", { dl: 30 }),                         // 没有评分：只有热度和榜单
    game("dev", { state: "dev", rate: 5, rc: 999, dl: 99 }),
    game("m1", { cat: "m-rpg", dl: 5 }),
  ];
  const s = scoreAll(gs, [], DEFAULT_SCORING);
  const r = s.get("r");
  assert.equal(r.parts.find(p => p.key === "praise").score, null);
  // 只有热度（25）和榜单（25，0 分）：(25×100 + 25×0) / 50 = 50
  assert.equal(r.total, 50);
  assert.equal(s.has("dev"), false);
  assert.equal(s.get("m1").rank, 1);
  assert.deepEqual(["p", "q", "r"].map(id => s.get(id).rank).sort(), [1, 2, 3]);
  assert.match(scoreText(r), /^50 · 热度 100 · 榜单 0$/);
});

test("「全部」：所有分类放在一起算、一起排名，开发中的照样不参与", () => {
  const gs = [
    game("f1", { dl: 10 }), game("f2", { dl: 30 }),
    game("m1", { cat: "m-rpg", dl: 20 }),
    game("dev", { cat: "m-rpg", state: "dev", dl: 99 }),
  ];
  const sc = only("year-percentile", { field: "dl" });
  const per = scoreAll(gs, [], sc), all = scoreAll(gs, [], sc, false);
  assert.equal(per.get("m1").rank, 1); // 按分类：男主 RPG 里只有它
  assert.deepEqual(["f2", "m1", "f1"].map(id => all.get(id).rank), [1, 2, 3]);
  assert.equal(all.get("m1").total, 50);
  assert.equal(all.has("dev"), false);
});

test("不认识的 method 跳过，不报错，也不进说明", () => {
  const sc = { name: "x", parts: [{ key: "a", label: "怪", method: "magic", weight: 90 }, { key: "h", label: "热度", method: "year-percentile", field: "dl", weight: 10 }] };
  const s = scoreAll([game("a", { dl: 1 }), game("b", { dl: 2 })], [], cleanScoring(sc));
  assert.equal(s.get("b").total, 100);
  assert.equal(s.get("b").parts.length, 1);
  assert.equal(recipeText(cleanScoring(sc)), "热度 100%");
});

test("没有 scoring 或格式不对时用默认配方", () => {
  assert.equal(cleanScoring(undefined), DEFAULT_SCORING);
  assert.equal(cleanScoring({ parts: "x" }), DEFAULT_SCORING);
  assert.equal(cleanScoring({ parts: [{ key: "a", method: "bayes", weight: 0 }] }), DEFAULT_SCORING);
  assert.equal(recipeText(DEFAULT_SCORING), "口碑 50% · 热度 25% · 榜单 25%");
});

test("整理榜单：丢掉坏条目，链接只留 https，没写名次按顺序", () => {
  const r = cleanRankings([
    { id: "x", name: "某榜", source: "某站", url: "http://not-https.example", year: 2024, kind: "vote",
      items: [{ title: "二", rank: 2, url: "javascript:alert(1)" }, { title: "一", rank: 1, rj: "RJ1", url: "https://ok.example/1" }, { rank: 3 }, "坏"] },
    { name: "没有条目" },
    "坏的",
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, undefined);
  assert.deepEqual(r[0].items.map(i => [i.rank, i.title, i.url]), [[1, "一", "https://ok.example/1"], [2, "二", undefined]]);
  assert.deepEqual(cleanRankings(undefined), []);
});

import { listGroup } from "../src/scoring.ts";

test("榜单分组：名字里写了年份的去掉年份再比", () => {
  const r = (name, year) => ({ id: "x", name, source: "", year, items: [] });
  assert.equal(listGroup(r("ErogameScape 2021年 中央値順（18禁・同人）", 2021)), "ErogameScape 中央値順（18禁・同人）");
  assert.equal(listGroup(r("VNDB 2024年 评分排行（含H内容）", 2024)), "VNDB 评分排行（含H内容）");
  assert.equal(listGroup(r("某站年度投票", 2025)), "某站年度投票");
  assert.equal(listGroup(r("2023 Awards", 2023)), "Awards");
  assert.equal(listGroup(r("没有年份", undefined)), "没有年份");
  assert.equal(listGroup(r("2021", 2021)), "2021"); // 去掉年份就空了：保留原名
});
