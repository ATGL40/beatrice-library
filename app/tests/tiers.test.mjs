import test from "node:test";
import assert from "node:assert/strict";
import { cleanTiers, emptyTiers, mergeTiers, moveInTier, placeInTier, removeFromTiers, tierOf } from "../src/tiers.ts";
import { cleanMarks, filterMarks, makeMarksFile, marksHtml, mergeMine, parseMarksFile, tierText, withTiers } from "../src/marks.ts";

const ALL = ["want", "have", "played", "fav", "score", "note", "tier"];
const t0 = () => ({ ...emptyTiers(), hang: ["a", "b"], npc: ["c"] });

test("放进、移到别的档、放在某部前面、移出", () => {
  let t = placeInTier(emptyTiers(), "x", "top");
  assert.deepEqual(t.top, ["x"]);
  t = placeInTier(t0(), "c", "hang", "b");          // 从 NPC 拿到夯，放在 b 前面
  assert.deepEqual(t.hang, ["a", "c", "b"]);
  assert.deepEqual(t.npc, []);
  t = placeInTier(t, "a", "hang");                   // 同一档里拖到末尾
  assert.deepEqual(t.hang, ["c", "b", "a"]);
  assert.deepEqual(removeFromTiers(t, "b").hang, ["c", "a"]);
  assert.deepEqual(tierOf(t, "b"), { tier: "hang", pos: 2 });
  assert.equal(tierOf(t, "zzz"), null);
});

test("上移下移：到头不动；跳过看不到的（别的分类）", () => {
  const t = { ...emptyTiers(), top: ["a", "hidden", "b"] };
  assert.deepEqual(moveInTier(t, "b", -1, id => id !== "hidden").top, ["b", "hidden", "a"]);
  assert.deepEqual(moveInTier(t, "a", -1).top, ["a", "hidden", "b"]);
  assert.deepEqual(moveInTier(t, "a", 1).top, ["hidden", "a", "b"]);
  assert.equal(moveInTier(t, "nope", 1), t);
});

test("整理：重复 id 只留第一次，坏数据丢掉；旧数据没有 tiers 时是五个空档", () => {
  const t = cleanTiers({ hang: ["a", "a", 3, ""], top: ["a", "b"], la: "x", other: ["z"] });
  assert.deepEqual(t, { hang: ["a"], top: ["b"], elite: [], npc: [], la: [] });
  assert.deepEqual(cleanTiers(undefined), emptyTiers());
  assert.deepEqual(cleanTiers(null), emptyTiers());
});

test("合并档位：只补没分档的，按对方的档和顺序接在末尾，已分在别档的算冲突", () => {
  const r = mergeTiers(t0(), [["n2", "top", 2], ["n1", "top", 1], ["a", "la", 1], ["b", "hang", 9], ["n3", "hang", 5]]);
  assert.deepEqual(r.tiers.top, ["n1", "n2"]);
  assert.deepEqual(r.tiers.hang, ["a", "b", "n3"]);
  assert.deepEqual(r.added.sort(), ["n1", "n2", "n3"]);
  assert.equal(r.conflicts, 1); // a 自己在夯、对方在拉完了
});

test("导出带上 tier 和 tierPos；不选「梯度」就不带", () => {
  const marks = { a: { status: "played", fav: false, score: 5 } };
  const tiers = { ...emptyTiers(), hang: ["x", "a"] };
  const file = makeMarksFile(withTiers(marks, tiers), ALL, [], "我", "2026-10-27");
  assert.deepEqual(file.marks.a, { status: "played", fav: false, score: 5, tier: "hang", tierPos: 2 });
  assert.deepEqual(file.marks.x, { status: "", fav: false, score: 0, tier: "hang", tierPos: 1 }); // 只分了档也导出
  const noTier = filterMarks(withTiers(marks, tiers), ALL.filter(k => k !== "tier"), []);
  assert.equal(noTier.x, undefined);
  assert.equal("tier" in noTier.a, false);
  assert.deepEqual(marks.a, { status: "played", fav: false, score: 5 }); // 不改自己的标记
  const back = parseMarksFile(marksHtml(file, id => ({ name: id, orig: "" }), "碧翠子禁书库"));
  assert.equal(back.marks.a.tier, "hang");
});

test("导入清洗：档位不合法就丢，序号不合法当 1；显示成「夯 第 2」", () => {
  const m = cleanMarks({ a: { tier: "hang", tierPos: 2 }, b: { tier: "god", score: 3 }, c: { tier: "la", tierPos: -4 } });
  assert.equal(tierText(m.a), "夯 第 2");
  assert.equal(m.b.tier, undefined);
  assert.equal(m.c.tierPos, 1);
});

test("「这是我的」合并：档位进梯度表不进标记；已分档的不动", () => {
  const mine = { a: { status: "played", fav: false, score: 4 } };
  const tiers = { ...emptyTiers(), top: ["k"] };
  const r = mergeMine(mine, {
    a: { status: "played", tier: "hang", tierPos: 1 },
    k: { tier: "la", tierPos: 1 },
    n: { tier: "top", tierPos: 3, score: 2 },
  }, undefined, tiers);
  assert.deepEqual(r.tiers.hang, ["a"]);
  assert.deepEqual(r.tiers.top, ["k", "n"]);
  assert.equal("tier" in r.marks.a, false);
  assert.deepEqual(r.marks.n, { status: "", fav: false, score: 2 });
  assert.equal(r.marks.k, undefined); // 只有档位、没有别的内容，不新建标记
  assert.equal(r.conflicts, 1);        // k 自己在顶级
  assert.equal(r.filled, 2);           // a（补了档）和 n
  assert.deepEqual(tiers.top, ["k"]);  // 不改原来的梯度表
});
