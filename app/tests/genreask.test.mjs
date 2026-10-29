import test from "node:test";
import assert from "node:assert/strict";
import { askTags } from "../src/genreask.ts";

const counts = [["a", 9], ["b", 8], ["c", 7], ["d", 6]];
const names = id => ({ a: ["触手", "触手", "Tentacles"], b: ["学园"], c: ["NTR"], d: ["百合", "百合", "Yuri"] })[id];

test("没搜索：部数最多的 top 个，已经选了但不在里面的接在后面（资料里没有的不列）", () => {
  assert.deepEqual(askTags(counts, [], "", names, 2), ["a", "b"]);
  assert.deepEqual(askTags(counts, ["d", "zz", "a"], "", names, 2), ["a", "b", "d"]);
  assert.deepEqual(askTags([], ["a"], "", names), []);
});

test("搜索：三种语言的名字和 id 都能搜，不分大小写，最多 max 个", () => {
  assert.deepEqual(askTags(counts, [], "yuri", names), ["d"]);
  assert.deepEqual(askTags(counts, [], " 触 ", names), ["a"]);
  assert.deepEqual(askTags(counts, [], "c", names), ["a", "c"]); // Tentacles 里有 c，id c
  assert.deepEqual(askTags(counts, [], "c", names, 30, 1), ["a"]);
  assert.deepEqual(askTags(counts, [], "没有", names), []);
});