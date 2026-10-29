import test from "node:test";
import assert from "node:assert/strict";
import { pickOne, todayCandidates } from "../src/today.ts";

const g = (id, more = {}) => ({ id, cat: "adv", state: "released", ...more });
const games = [g("WANT"), g("HAVE", { cat: "slg" }), g("PLAYED"), g("BLACK"), g("DEV", { state: "dev" }), g("NONE"), g("FAV")];
const marks = {
  WANT: { status: "want", fav: false, score: 0 }, HAVE: { status: "have", fav: false, score: 0 }, PLAYED: { status: "played", fav: false, score: 0 },
  BLACK: { status: "want", fav: false, score: 0 }, DEV: { status: "want", fav: false, score: 0 }, FAV: { status: "", fav: true, score: 5 },
};

test("能挑的：想玩、已有里的；玩过的、黑榜里的、开发中的、只收藏的不算；看当前分类", () => {
  const ids = l => l.map(x => x.id);
  assert.deepEqual(ids(todayCandidates(games, marks, { BLACK: {} }, () => true)), ["WANT", "HAVE"]);
  assert.deepEqual(ids(todayCandidates(games, marks, { BLACK: {} }, x => x.cat === "slg")), ["HAVE"]);
  assert.deepEqual(todayCandidates(games, {}, {}, () => true), []);
});

test("随便挑：按随机数取；换一个时不再挑刚才那部（只剩一部时照样是它）；空的是 null", () => {
  const list = ["a", "b", "c"];
  assert.equal(pickOne(list, undefined, () => 0), "a");
  assert.equal(pickOne(list, undefined, () => 0.99), "c");
  assert.equal(pickOne(list, undefined, () => 1), "c"); // 随机数到不了 1，到了也不越界
  for (const r of [0, 0.5, 0.99]) assert.notEqual(pickOne(list, "b", () => r), "b");
  assert.equal(pickOne(["a"], "a"), "a");
  assert.equal(pickOne([], undefined), null);
});
