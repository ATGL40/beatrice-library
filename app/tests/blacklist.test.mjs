import test from "node:test";
import assert from "node:assert/strict";
import { BLACK_REASON_MAX, canBlacklist, cleanBlacklist, FLAG_NOTE, flaggedCount } from "../src/blacklist.ts";
import { makeSubmission, NOTE_MAX } from "../src/marks.ts";
import { submissionLists, submissionState } from "../src/submission.ts";
import { normalizeGame } from "../src/catalog.ts";

test("数据文件里的黑榜：不是对象当没有，坏条目丢掉，不认识的字段照留，理由不是文字的去掉", () => {
  assert.deepEqual(cleanBlacklist(undefined), {});
  assert.deepEqual(cleanBlacklist([{ reason: "x" }]), {});
  assert.deepEqual(cleanBlacklist("RJ1"), {});
  const raw = JSON.parse('{"RJ1": {"reason": "太长了", "later": 1}, "RJ2": {}, "RJ3": "x", "RJ4": null, "RJ5": {"reason": 5}, "__proto__": {"reason": "坏"}}');
  assert.deepEqual(cleanBlacklist(raw), { RJ1: { reason: "太长了", later: 1 }, RJ2: {}, RJ5: {} });
  assert.equal(BLACK_REASON_MAX, NOTE_MAX);
});

test("我的游戏不能放进黑榜", () => {
  assert.ok(canBlacklist({ id: "RJ1", src: "dlsite" }));
  assert.ok(!canBlacklist({ id: "local-1", src: "local" }));
});

test("多人拉黑：数据包写了 flagged 和人数才显示人数；数据包整理时字段照留", () => {
  const g = normalizeGame({ id: "RJ1", blacklist: { count: 7, flagged: true, settled: "2026-11-01" } });
  assert.equal(flaggedCount(g), 7);
  assert.equal(flaggedCount({ id: "a", blacklist: { count: 3, flagged: false } }), null);
  assert.equal(flaggedCount({ id: "a", blacklist: { count: 0, flagged: true } }), null);
  assert.equal(flaggedCount({ id: "a", blacklist: { count: "9", flagged: true } }), null);
  assert.equal(flaggedCount({ id: "a", blacklist: { count: 9, flagged: "true" } }), null);
  assert.equal(flaggedCount({ id: "a" }), null);
  assert.match(FLAG_NOTE, /不影响分数/);
});

test("提交文件的黑榜：只带 reason（去空白、截长、空的不写），我的游戏不算，没有黑榜就没有这个字段，version 还是 1", () => {
  const f = makeSubmission("0.3.0", "2026-10-29", { RJ1: 4 }, {}, undefined, {
    RJ2: { reason: "  剧情烂尾  ", note: "不该带上", later: 1 }, RJ3: {}, RJ4: { reason: "   " }, "local-a": { reason: "我的游戏" }, RJ5: { reason: "长".repeat(NOTE_MAX + 5) },
  });
  assert.equal(f.version, 1);
  assert.deepEqual(Object.keys(f.blacklist), ["RJ2", "RJ3", "RJ4", "RJ5"]);
  assert.deepEqual(f.blacklist.RJ2, { reason: "剧情烂尾" });
  assert.deepEqual(f.blacklist.RJ3, {});
  assert.deepEqual(f.blacklist.RJ4, {});
  assert.equal(f.blacklist.RJ5.reason.length, NOTE_MAX);
  assert.ok(!("blacklist" in makeSubmission("0.3.0", "d", { RJ1: 4 }, {})));
  assert.ok(!("blacklist" in makeSubmission("0.3.0", "d", { RJ1: 4 }, {}, undefined, { "local-a": {} })));
});

test("提交窗口的黑榜：只列目录里有的、不是我的游戏的作品，按名字排；取消勾选的不提交", () => {
  const games = new Map([["b", { id: "b", src: "dlsite" }], ["a", { id: "a", src: "steam" }], ["local-x", { id: "local-x", src: "local" }]]);
  const blacklist = { b: { reason: "理由" }, a: {}, "local-x": {}, gone: {} };
  const lists = submissionLists(games, {}, [], new Map(), g => g.id, blacklist);
  assert.deepEqual(lists.black.map(g => g.id), ["a", "b"]);
  const rule = { required: "oppose", min: 20 };
  assert.deepEqual(submissionState(lists, {}, {}, new Set(), rule, blacklist).blacklist, { a: {}, b: { reason: "理由" } });
  assert.deepEqual(submissionState(lists, {}, {}, new Set(), rule, blacklist, new Set(["b"])).blacklist, { a: {} });
  // 旧的调用方式（不传黑榜）照常：没有黑榜
  assert.deepEqual(submissionLists(games, {}, [], new Map(), g => g.id).black, []);
  assert.deepEqual(submissionState({ rated: [], votes: [] }, {}, {}, new Set(), rule).blacklist, {});
});
