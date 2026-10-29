import test from "node:test";
import assert from "node:assert/strict";
import { debounce, renderBatches, setHtml } from "../src/performance.ts";
import { fold, gameSearchTexts, score, scoreFolded } from "../src/search.ts";
import { bestCandidate, cleanCustom, customGame } from "../src/custom.ts";
import { matchFolder } from "../src/match.ts";
import { emptyTiers, mergeTiers, placeInTier, removeFromTiers, tierOf } from "../src/tiers.ts";
import { pctSorted } from "../src/scoring2.ts";
import { submissionLists, submissionState } from "../src/submission.ts";
import { makeSubmission } from "../src/marks.ts";

test("防抖：120 ms 内只执行最后一次，取消后不再执行", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [], run = debounce(x => calls.push(x));
  run("a"); t.mock.timers.tick(100); run("ab");
  t.mock.timers.tick(119); assert.deepEqual(calls, []);
  t.mock.timers.tick(1); assert.deepEqual(calls, ["ab"]);
  run("abc"); run.cancel(); t.mock.timers.tick(120);
  assert.deepEqual(calls, ["ab"]);
  run("d"); t.mock.timers.tick(120); assert.deepEqual(calls, ["ab", "d"]);
});

function frames() {
  let id = 0;
  const pending = new Map();
  return {
    schedule: run => { pending.set(++id, run); return id; },
    cancel: id => pending.delete(id),
    flush: () => { while (pending.size) { const [id, run] = pending.entries().next().value; pending.delete(id); run(); } },
  };
}

test("分帧追加：首段立即可用，后续不重画旧行、不遗漏末段", () => {
  const f = frames(), parts = [];
  renderBatches([1, 2, 3, 4, 5], p => parts.push(p), 2, f.schedule, f.cancel);
  assert.deepEqual(parts, [[1, 2]]);
  f.flush(); assert.deepEqual(parts, [[1, 2], [3, 4], [5]]);
  renderBatches([], () => assert.fail("空列表不用追加"), 2, f.schedule, f.cancel);
});

test("切换筛选或关闭窗口：旧批次不能混进新列表，重开从首段开始", () => {
  const f = frames(), rows = [];
  const stop = renderBatches([1, 2, 3], p => rows.push(...p), 1, f.schedule, f.cancel);
  stop(); stop(); rows.length = 0;
  renderBatches([4, 5], p => rows.push(...p), 1, f.schedule, f.cancel);
  f.flush(); assert.deepEqual(rows, [4, 5]);
});

test("跳到后面：flush(n) 马上补齐前 n 项，剩下的照旧分帧，不重复、不遗漏", () => {
  const f = frames(), rows = [];
  const job = renderBatches([1, 2, 3, 4, 5, 6, 7], p => rows.push(...p), 2, f.schedule, f.cancel);
  assert.deepEqual(rows, [1, 2]);
  job.flush(5); assert.deepEqual(rows, [1, 2, 3, 4, 5]);
  job.flush(3); assert.deepEqual(rows, [1, 2, 3, 4, 5]); // 已经画过的不再画
  f.flush(); assert.deepEqual(rows, [1, 2, 3, 4, 5, 6, 7]);
  const all = [], j2 = renderBatches([1, 2, 3, 4], p => all.push(...p), 1, f.schedule, f.cancel);
  j2.flush(); f.flush(); assert.deepEqual(all, [1, 2, 3, 4]); // 全部补齐后不再排下一帧
  const none = [], j3 = renderBatches([1, 2, 3], p => none.push(...p), 1, f.schedule, f.cancel);
  j3(); j3.flush(); assert.deepEqual(none, [1]); // 取消后不补
});

test("局部 HTML：未变化时保留节点，外部改动后可恢复原内容", () => {
  let html = "", writes = 0;
  const el = { get innerHTML() { return html; }, set innerHTML(x) { html = x; writes++; } };
  setHtml(el, "封面"); setHtml(el, "封面"); assert.equal(writes, 1);
  html = "按钮已改字"; setHtml(el, "封面"); assert.equal(writes, 2);
  setHtml(el, "新封面"); assert.equal(html, "新封面");
});

test("缓存候选：多次查询只读取一次名字，新扫描对象重新准备", () => {
  let reads = 0;
  const f = { name: "Velmorin", get names() { reads++; return ["Game", "魔法少女"]; }, dir: "D:/Velmorin", exes: [], rj: null };
  assert.equal(bestCandidate("vel", f).score, 100);
  assert.equal(bestCandidate("少女", f).text, "魔法少女");
  assert.equal(reads, 1);
  assert.equal(bestCandidate("少女", { ...f, names: ["新游戏"] }), null);
});

test("自动识别缓存 norm：重复匹配保留结果，新扫描名字生效", () => {
  let reads = 0;
  const g = { id: "g", title: "Velmorin Saga", names: {} };
  const f = { name: "Velmorin Saga v1.2", get names() { reads++; return []; }, dir: "D:/games/Velmorin Saga v1.2", exes: [], rj: null };
  assert.equal(matchFolder(f, [g], {}).game, g);
  assert.equal(matchFolder(f, [g], {}).game, g);
  assert.equal(reads, 1);
  assert.equal(matchFolder({ ...f, name: "Other Name", names: [] }, [g], {}).game, null);
});

test("搜索预处理保持空词、三语、错字和最高候选的分数", () => {
  const texts = ["ミルフェリア", "霜月少女星环璃娜雅", "Magical Girl Mirephonia", "Velmorin"];
  for (const q of ["", "！", "みる", "霜星璃", "Mirefonia", "Velmorni", "xyz", "girl"])
    assert.equal(scoreFolded(fold(q), texts.map(fold)), score(q, texts));
});

test("作品搜索缓存不重复读取，新作品对象及时换词", () => {
  let reads = 0;
  const g = { get title() { reads++; return "Ｍｉｒａ"; }, names: { ja: "Ｍｉｒａ" }, circle: "社团" };
  const texts = gameSearchTexts(g);
  assert.equal(gameSearchTexts(g), texts); assert.equal(reads, 1);
  assert.deepEqual(texts, ["mira", "社团"]);
  assert.deepEqual(gameSearchTexts({ ...g, title: "新名字", names: {} }), ["新名字", "社团"]);
});

test("同扩展名封面版本能持久保存，旧数据兼容、坏版本丢弃", () => {
  const first = { title: "我的", cat: "adv", cover: "local-a.png", coverVersion: 10 };
  const saved = cleanCustom(JSON.parse(JSON.stringify({ "local-a": first })))["local-a"];
  assert.equal(customGame("local-a", saved, "asset://local-a.png").cover, "asset://local-a.png?v=10");
  assert.equal(customGame("local-a", { ...saved, coverVersion: 11 }, "asset://local-a.png").cover, "asset://local-a.png?v=11");
  assert.equal(customGame("local-a", { title: "旧数据", cat: "adv" }, "asset://old.png").cover, "asset://old.png");
  for (const coverVersion of ["1", -1, 1.5, Infinity])
    assert.equal(cleanCustom({ "local-a": { ...first, coverVersion } })["local-a"].coverVersion, undefined);
});

test("梯度索引在移动、删除后更新，原表和撤销位置保持不变", () => {
  const old = placeInTier(emptyTiers(), "a", "hang");
  assert.deepEqual(tierOf(old, "a"), { tier: "hang", pos: 1 });
  const next = placeInTier(old, "a", "top");
  assert.deepEqual(tierOf(next, "a"), { tier: "top", pos: 1 });
  assert.equal(tierOf(removeFromTiers(next, "a"), "a"), null);
  assert.deepEqual(tierOf(old, "a"), { tier: "hang", pos: 1 });
});

test("合并时索引随追加更新：同一新 id 不重复添加、跨档计冲突", () => {
  const result = mergeTiers(emptyTiers(), [["a", "top", 1], ["a", "top", 2], ["a", "la", 1], ["b", "top", 3]]);
  assert.deepEqual(result.tiers.top, ["a", "b"]);
  assert.deepEqual(result.tiers.la, []);
  assert.equal(result.conflicts, 1);
  assert.deepEqual(tierOf(result.tiers, "b"), { tier: "top", pos: 2 });
});

test("百分位的二分上界和旧公式一致，包括大量相同值", () => {
  const old = (v, sv) => {
    if (sv.length <= 1) return 50;
    let lo = sv.findIndex(x => x >= v); if (lo < 0) lo = sv.length;
    let up = lo; while (up < sv.length && sv[up] === v) up++;
    return (lo + (up - lo - 1) / 2) / (sv.length - 1) * 100;
  };
  for (const sv of [[], [2], [1, 2, 2, 4], Array(1650).fill(3)])
    for (const v of [0, 1, 2, 3, 4, 5]) assert.equal(pctSorted(v, sv), old(v, sv));
});

test("提交列表只访问有标记 / 资格的 id，输入校验覆盖未渲染票", () => {
  const games = new Map(["a", "b", "c", "local-x"].map(id => [id, { id, src: id.startsWith("local") ? "local" : "dlsite" }]));
  games.values = () => assert.fail("不能遍历全部作品");
  const marks = { a: { score: 4 }, b: { score: 5 }, missing: { score: 3 }, "local-x": { score: 5 } };
  const finals = new Map([["b", { F: 95, comp: 90, date: "" }], ["c", { F: 96, comp: 90, date: "" }]]);
  const lists = submissionLists(games, marks, ["b", "c"], finals, g => g.id);
  assert.deepEqual(lists.rated.map(g => g.id), ["b", "a"]);
  assert.deepEqual(lists.votes.map(g => g.id), ["c", "b"]);
  const votes = { b: { vote: "support" }, c: { vote: "oppose", reason: "短" }, a: { vote: "support" } };
  const rule = { required: "oppose", min: 20 }, skip = new Set(["b"]);
  let s = submissionState(lists, marks, votes, skip, rule);
  assert.deepEqual(s.ratings, { a: 4 }); assert.deepEqual(s.votes, { b: votes.b });
  assert.ok(s.problems.has("c")); // c 可以还没画到，仍然阻止导出
  votes.c.reason = "理由".repeat(10);
  s = submissionState(lists, marks, votes, skip, rule);
  assert.equal(s.problems.size, 0);
  const file = makeSubmission("0.3.0", "date", s.ratings, s.votes, rule);
  assert.deepEqual(file.votes, { c: votes.c, b: votes.b });
  delete votes.b; assert.equal(Object.keys(submissionState(lists, marks, votes, skip, rule).votes).length, 1);
});
