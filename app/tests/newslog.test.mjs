import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addRecord, cleanChangelog, cleanHistory, HISTORY_MAX, RECORD_LIST_MAX, toRecord, versionLabel, versionList } from "../src/news.ts";
import { normalizeCatalog } from "../src/catalog.ts";

const v = (updated, revision = 0) => ({ updated, revision });

test("版本的写法：没有修订号只写日期", () => {
  assert.equal(versionLabel(v("2026-10-29", 1)), "2026-10-29 · 修订 1");
  assert.equal(versionLabel(v("2026-10-27")), "2026-10-27");
});

test("数据包的更新说明：不是数组当没有，坏条目和空说明丢掉，同一个版本只留第一条", () => {
  assert.deepEqual(cleanChangelog(undefined), []);
  assert.deepEqual(cleanChangelog({ updated: "2026-10-29" }), []);
  const raw = [
    { updated: "2026-10-29", revision: 1, notes: ["移出 19 部", "  ", 5] },
    { updated: "2026-10-29", revision: 1, notes: ["重复的"] },
    { updated: "2026-10-28", revision: "3", notes: ["坏的修订号"] },
    { updated: "10-28", revision: 0, notes: ["坏的日期"] },
    { updated: "2026-10-28", revision: 3, notes: [] },
    { updated: "2026-10-27", revision: 0, notes: ["第一版"], extra: 1 },
    null,
  ];
  assert.deepEqual(cleanChangelog(raw), [
    { updated: "2026-10-29", revision: 1, notes: ["移出 19 部"] },
    { updated: "2026-10-27", revision: 0, notes: ["第一版"] },
  ]);
});

test("软件自带的资料带着更新说明，最新一条就是这份资料的版本", () => {
  const cat = normalizeCatalog(JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
  const log = cleanChangelog(cat.changelog);
  assert.ok(log.length >= 3);
  assert.deepEqual({ updated: log[0].updated, revision: log[0].revision }, { updated: cat.updated, revision: cat.revision });
  assert.ok(log.some(e => e.updated === "2026-10-27"));
  assert.ok(log.every(e => e.notes.length));
});

test("存成记录：新收录只记部数，每类最多 50 部，名字取当时的", () => {
  const n = {
    from: "2026-10-28 · 修订 3", to: "2026-10-29 · 修订 1", version: v("2026-10-29", 1), added: ["N1", "N2", "N3"],
    scores: Array.from({ length: RECORD_LIST_MAX + 5 }, (_, i) => ({ id: `S${i}`, from: 80, to: 82, fromBand: "大杯", toBand: "大杯" })),
    dev: [{ id: "D1", date: "2026-12-01", released: false }], removed: [{ id: "GONE", name: "旧名字" }],
  };
  const r = toRecord(n, id => `名字${id}`);
  assert.equal(r.updated, "2026-10-29");
  assert.equal(r.revision, 1);
  assert.equal(r.from, "2026-10-28 · 修订 3");
  assert.equal(r.added, 3);
  assert.equal(r.scores.length, RECORD_LIST_MAX);
  assert.equal(r.names.S0, "名字S0");
  assert.equal(r.names.D1, "名字D1");
  assert.deepEqual(r.removed, [{ id: "GONE", name: "旧名字" }]);
  // 读回来一样；坏的条目和项丢掉
  assert.deepEqual(cleanHistory(JSON.parse(JSON.stringify([r]))), [r]);
  assert.deepEqual(cleanHistory("x"), []);
  const bad = cleanHistory([{ updated: "2026-10-29", revision: 0, added: -1, scores: [{ id: "A", from: "1", to: 2, fromBand: "", toBand: "" }, { id: "B", from: null, to: 3, fromBand: "", toBand: "中杯" }], dev: [{ id: 5 }], removed: "x", names: { A: 1, B: "b" } }, { revision: 1 }]);
  assert.deepEqual(bad, [{ updated: "2026-10-29", revision: 0, from: "", added: 0, scores: [{ id: "B", from: null, to: 3, fromBand: "", toBand: "中杯" }], dev: [], removed: [], names: { B: "b" } }]);
});

test("加记录：同一个版本换成新的，新的在前，最多 20 条", () => {
  const rec = (u, r, added = 0) => ({ updated: u, revision: r, from: "", added, scores: [], dev: [], removed: [], names: {} });
  let h = [];
  h = addRecord(h, rec("2026-10-28", 3));
  h = addRecord(h, rec("2026-10-29", 1));
  h = addRecord(h, rec("2026-10-28", 3, 7));
  assert.deepEqual(h.map(versionLabel), ["2026-10-29 · 修订 1", "2026-10-28 · 修订 3"]);
  assert.equal(h[1].added, 7);
  for (let i = 1; i <= 30; i++) h = addRecord(h, rec(`2027-01-${String(i).padStart(2, "0")}`, 0));
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0].updated, "2027-01-30");
});

test("能选的版本：现在的、更新说明里的、存过记录的，新的在前、不重复", () => {
  const list = versionList([v("2026-10-29", 1), v("2026-10-27")], [v("2026-11-02"), v("2026-10-29", 1)], v("2026-11-02"));
  assert.deepEqual(list.map(versionLabel), ["2026-11-02", "2026-10-29 · 修订 1", "2026-10-27"]);
  assert.deepEqual(versionList([], []), []);
});
