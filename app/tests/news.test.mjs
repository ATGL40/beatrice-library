import test from "node:test";
import assert from "node:assert/strict";
import { cleanSnap, decodeEntry, diffSnaps, encodeEntry, hasNews, makeSnap, newerThan, scoreChangeText, SNAP_MAX } from "../src/news.ts";

const g = (id, more = {}) => ({ id, src: "dlsite", state: "released", date: "2024-01-01", title: id, ...more });
const finals = { A: { F: 94.99999999999, band: "超大杯" }, B: { F: 70.2, band: "大杯" } };
const fin = x => finals[x.id] ?? null;
const meta = (updated, revision = 0) => ({ updated, revision });

test("快照的一部作品：开发中记发售日，有分数记显示的整数分和档，别的是空字符串；读回来一样", () => {
  assert.equal(encodeEntry(g("A"), finals.A), "95|超大杯"); // 94.99999999999 显示成 95，和卡片上一样
  assert.equal(encodeEntry(g("B"), finals.B), "70|大杯");
  assert.equal(encodeEntry(g("C"), null), "");
  assert.equal(encodeEntry(g("D", { state: "dev", date: "" }), null), "d:");
  assert.equal(encodeEntry(g("E", { state: "dev", date: "2026-12-01" }), null), "d:2026-12-01");
  assert.deepEqual(decodeEntry("95|超大杯"), { dev: false, date: "", score: 95, band: "超大杯" });
  assert.deepEqual(decodeEntry(""), { dev: false, date: "", score: null, band: "" });
  assert.deepEqual(decodeEntry("d:2026-12-01"), { dev: true, date: "2026-12-01", score: null, band: "" });
  assert.deepEqual(decodeEntry("x|y"), { dev: false, date: "", score: null, band: "y" });
});

test("做快照：我的游戏不算，名字只记有标记的作品；作品太多时只记有标记的和开发中的，标上 partial", () => {
  const games = [g("A"), g("B"), g("C"), g("D", { state: "dev", date: "" }), g("local-x", { src: "local" })];
  const marks = { B: { status: "want", fav: false, score: 0 }, C: { status: "", fav: false, score: 0, note: "  " }, "local-x": { status: "have", fav: false, score: 0 } };
  const s = makeSnap(meta("2026-10-29", 1), games, fin, marks, x => `名字${x.id}`);
  assert.deepEqual(s, { updated: "2026-10-29", revision: 1, games: { A: "95|超大杯", B: "70|大杯", C: "", D: "d:" }, names: { B: "名字B" } });
  const many = Array.from({ length: SNAP_MAX + 1 }, (_, i) => g(`R${i}`));
  many.push(g("DEV", { state: "dev" }));
  const p = makeSnap(meta("x"), many, () => null, { R5: { status: "", fav: true, score: 0 } }, x => x.id);
  assert.equal(p.partial, true);
  assert.deepEqual(Object.keys(p.games).sort(), ["DEV", "R5"]);
});

test("数据文件里的快照：形状不对当没有，坏条目丢掉", () => {
  assert.equal(cleanSnap(undefined), null);
  assert.equal(cleanSnap([]), null);
  assert.equal(cleanSnap({ updated: 5, games: {} }), null);
  assert.equal(cleanSnap({ updated: "2026-01-01", games: [] }), null);
  const raw = JSON.parse('{"updated":"2026-01-01","revision":"2","games":{"A":"","B":5,"__proto__":"x"},"names":"坏","partial":true}');
  assert.deepEqual(cleanSnap(raw), { updated: "2026-01-01", revision: 0, games: { A: "" }, names: {}, partial: true });
});

test("新旧比较：先比日期，同一天比 revision", () => {
  assert.ok(newerThan(meta("2026-10-30"), meta("2026-10-29", 3)));
  assert.ok(newerThan(meta("2026-10-29", 2), meta("2026-10-29", 1)));
  assert.ok(!newerThan(meta("2026-10-29", 1), meta("2026-10-29", 1)));
  assert.ok(!newerThan(meta("2026-10-28", 9), meta("2026-10-29")));
});

test("小结：新收录、列表里作品的分数和档变化、开发中作品的消息、移出图鉴的标记过的作品", () => {
  const old = {
    updated: "2026-10-01", revision: 0, names: { GONE: "旧名字", GONE2: "没标记了" },
    games: { A: "90|大杯", B: "80|大杯", C: "70|中杯", D: "", E: "d:", F: "d:2026-11-01", G: "d:2026-11-01", H: "d:", GONE: "", GONE2: "", I: "60|中杯" },
  };
  const now = {
    updated: "2026-10-29", revision: 1, names: {},
    games: { A: "92|超大杯", B: "80|大杯", C: "75|中杯", D: "50|中杯", E: "", F: "d:2026-12-01", G: "d:2026-11-01", H: "d:", I: "", NEW1: "", NEW2: "d:" },
  };
  const marks = {
    A: { status: "want", fav: false, score: 0 }, B: { status: "have", fav: false, score: 0 },
    C: { status: "", fav: true, score: 0 }, D: { status: "played", fav: false, score: 0 },
    I: { status: "", fav: false, score: 5 }, // 只打了星、不在列表里：不算
    GONE: { status: "", fav: false, score: 3 }, GONE2: { status: "", fav: false, score: 0 },
  };
  const n = diffSnaps(old, now, marks);
  assert.equal(n.from, "2026-10-01");
  assert.equal(n.to, "2026-10-29 · 修订 1");
  assert.deepEqual(n.version, { updated: "2026-10-29", revision: 1 });
  assert.deepEqual(n.added, ["NEW1", "NEW2"]);
  assert.deepEqual(n.scores, [
    { id: "A", from: 90, to: 92, fromBand: "大杯", toBand: "超大杯" },
    { id: "C", from: 70, to: 75, fromBand: "中杯", toBand: "中杯" },
    { id: "D", from: null, to: 50, fromBand: "", toBand: "中杯" },
  ]);
  assert.deepEqual(n.dev, [{ id: "E", date: "", released: true }, { id: "F", date: "2026-12-01", released: false }]);
  assert.deepEqual(n.removed, [{ id: "GONE", name: "旧名字" }]);
  assert.ok(hasNews(n));
  assert.ok(!hasNews(diffSnaps(now, now, marks)));
  // 上次的快照不全时不算新收录
  assert.deepEqual(diffSnaps({ ...old, partial: true }, now, marks).added, []);
});

test("分数变化写成一句：没分数写「—」，档没变不写档", () => {
  assert.equal(scoreChangeText({ from: 90, to: 92, fromBand: "大杯", toBand: "超大杯" }), "综合 90 → 92 · 大杯 → 超大杯");
  assert.equal(scoreChangeText({ from: 70, to: 75, fromBand: "中杯", toBand: "中杯" }), "综合 70 → 75");
  assert.equal(scoreChangeText({ from: null, to: 50, fromBand: "", toBand: "中杯" }), "综合 — → 50 · 无档 → 中杯");
  assert.equal(scoreChangeText({ from: 80, to: 80, fromBand: "超大杯", toBand: "大杯" }), "超大杯 → 大杯");
});
