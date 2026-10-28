import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeGame } from "../src/catalog.ts";
import { baseScores, cleanCanon, cleanRecipeV2, curve, dateMs, devRows, DEFAULT_V2, finalOf, godvote, pctSorted, playerDelta, rankOrder, signal } from "../src/scoring2.ts";

const rc = cleanRecipeV2({ version: 2 });
const game = (id, o = {}) => normalizeGame({ id, cat: "f-rpg", src: "dlsite", date: "2024-01-01", ...o });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("配方：不是第 2 版返回 null；缺的、类型不对的用默认补；曲线点按 x 排好", () => {
  assert.equal(cleanRecipeV2({ parts: [] }), null);
  assert.equal(cleanRecipeV2(null), null);
  const r = cleanRecipeV2({ version: 2, heat: { weight: "x", method: "year-percentile" }, curve: { points: [[50, 70], [0, 40], ["a", 1]] } });
  assert.equal(r.heat.weight, 0.25);
  assert.equal(r.heat.method, "year-percentile");
  assert.deepEqual(r.curve.points, [[0, 40], [50, 70]]);
  assert.deepEqual(r.praise.anchors.dlsite, [4.15, 4.9]);
  assert.equal(cleanRecipeV2({ version: 2, curve: { points: [[1, 1]] } }).curve.points, DEFAULT_V2.curve.points);
});

test("神作名单：对象或数组都认", () => {
  assert.deepEqual([...cleanCanon({ a: {}, b: { by: "vote" } })], [["a", "manual"], ["b", "vote"]]);
  assert.deepEqual([...cleanCanon(["a", 1])], [["a", "manual"]]);
  assert.equal(cleanCanon(null).size, 0);
});

test("百分位（二分）：和旧算法一样，最小 0、最大 100、相同取中间", () => {
  assert.equal(pctSorted(1, [1, 2, 3]), 0);
  assert.equal(pctSorted(3, [1, 2, 3]), 100);
  assert.equal(pctSorted(2, [1, 2, 2, 3]), 50);
  assert.equal(pctSorted(7, [7]), 50);
});

test("曲线：分段线性，两头取端点", () => {
  const pts = [[0, 40], [50, 70], [100, 99]];
  assert.equal(curve(-5, pts), 40);
  assert.equal(curve(25, pts), 55);
  assert.equal(curve(200, pts), 99);
});

test("信号：DLsite 用 rate / rc / dl，商业用 egs，Steam 用 steam，别的来源没有", () => {
  assert.deepEqual(signal(game("a", { rate: 4.5, rc: 10, dl: 100 })), { x: 4.5, n: 10, h: 100 });
  assert.deepEqual(signal(game("b", { src: "commercial", egs: { median: 80, count: 300 } })), { x: 80, n: 300, h: 300 });
  assert.deepEqual(signal(game("c", { src: "steam", steam: { positive: 95, reviews: 5000 } })), { x: 95, n: 5000, h: 5000 });
  assert.deepEqual(signal(game("d", { src: "fanza", rate: 4 })), { x: null, n: null, h: null });
});

test("R / Q / H / 综合分：按配方算（绝对热度按数据包日期算年数）", () => {
  const g = game("a", { rate: 4.6, rc: 100, dl: 10000, date: "2020-10-28" });
  const b = baseScores([g], [], rc, "2026-10-28").get("a");
  const R = ((4.6 - 4.15) / (4.9 - 4.15)) * 100;
  near(b.R, R);
  near(b.Q, 50 + (100 / 200) * (R - 50));
  near(b.H, ((4 - 3.55) / (4.8 - 3.55)) * 100); // 老作品不按年数修正：log10(10000) = 4
  assert.equal(b.hot, true);
  near(b.comp, 0.75 * b.Q + 0.25 * b.H);
  near(b.F, curve(b.comp, rc.curve.points));
  // 半年前发售的新作按在售时间放大
  const young = baseScores([game("y", { rate: 4.6, rc: 100, dl: 10000, date: "2026-04-28" })], [], rc, "2026-10-28").get("y");
  assert.ok(young.H > b.H);
  // 没有热度数据：热度按 50，拿不到「热」；发售日缺失或晚于数据包日期：照算热度，但不按在售时间放大；没有评分人数不打分
  const gs = [game("n", { rate: 4.6, rc: 100 }), game("d", { rate: 4.6, rc: 100, dl: 10000, date: "" }),
    game("f", { rate: 4.6, rc: 100, dl: 10000, date: "2027-01-01" }), game("x", { rate: 4.6, dl: 5 })];
  const m = baseScores(gs, [], rc, "2026-10-28");
  assert.equal(m.get("n").H, 50); assert.equal(m.get("n").hot, false);
  near(m.get("d").H, b.H); assert.equal(m.get("d").hot, true);
  near(m.get("f").H, b.H);
  assert.equal(m.has("x"), false);
});

test("同年百分位热度：同来源同年份够 minGroup 部才在年内比", () => {
  const r = cleanRecipeV2({ version: 2, heat: { method: "year-percentile", minGroup: 3 } });
  const gs = [1, 2, 3].map(i => game(`a${i}`, { rate: 4.5, rc: 50, dl: i * 100, date: "2020-01-01" }))
    .concat([game("b", { rate: 4.5, rc: 50, dl: 1000, date: "2021-01-01" })]);
  const m = baseScores(gs, [], r);
  assert.equal(m.get("a3").H, 100);
  assert.equal(m.get("b").H, 100); // 2021 只有 1 部：和同来源全部比
  assert.equal(m.get("a1").H, 0);
});

test("社区评分：人数够才并进口碑，并且能给「玩」", () => {
  const few = baseScores([game("a", { rate: 4.5, rc: 100, community: { avg: 5, count: 5 } })], [], rc).get("a");
  assert.equal(few.C, null); assert.equal(few.dims.players, false);
  const many = baseScores([game("a", { rate: 4.5, rc: 100, community: { avg: 5, count: 20 } })], [], rc).get("a");
  near(many.C, 50 + (20 / 40) * 50);
  near(many.comp, 0.75 * (0.75 * many.Q + 0.25 * many.C) + 0.25 * many.H);
  assert.equal(many.dims.players, true);
});

test("维度：口、口★（按固定线）、榜（只看民间榜单，also 要配方打开才算）", () => {
  const gs = [game("top", { rate: 4.9, rc: 20000 }), game("p", { rate: 4.8, rc: 1500, also: ["steam"] })];
  const m = baseScores(gs, [{ items: [{ rj: "top", rank: 1 }] }], rc);
  assert.deepEqual(m.get("top").dims, { praise: true, praiseTop: true, heat: false, lists: true, players: false });
  assert.equal(m.get("p").dims.praise, true); assert.equal(m.get("p").dims.praiseTop, false); assert.equal(m.get("p").dims.lists, false);
  const r = cleanRecipeV2({ version: 2, gates: { lists: { also: true } } });
  assert.equal(baseScores(gs, [], r).get("p").dims.lists, true);
});

const base = (F, dims = {}, comp = 0) => ({ R: 0, Q: 0, H: 0, hot: false, C: null, comp, F,
  dims: { praise: false, praiseTop: false, heat: false, lists: false, players: false, ...dims } });
const fin = (F, dims, o = {}, canon = {}) => finalOf(game("w", o), base(F, dims), cleanCanon(canon), rc);
const TOP = { praise: true, praiseTop: true, heat: true };

test("分档：没过杰作门槛（口碑 + 热 / 榜 / 玩一项）最高 89；其余最高 94", () => {
  assert.equal(fin(92, {}).F, 89); assert.equal(fin(92, {}).band, "优秀"); assert.equal(fin(92, {}).capped, 89);
  assert.equal(fin(92, { praise: true }).F, 89); // 口碑够、但热 / 榜 / 玩一项都没有
  assert.equal(fin(89.5, {}).F, 89);
  const ok = fin(92, { praise: true, heat: true });
  assert.equal(ok.band, "杰作"); assert.equal(ok.F, 92); assert.equal(ok.capped, null);
  const high = fin(98, { praise: true, lists: true });
  assert.equal(high.F, 94); assert.equal(high.band, "杰作"); assert.equal(high.capped, 94);
  assert.equal(fin(75, {}).band, "良好");
});

test("神作提名：曲线分 ≥ 95、口★ + 一项、过了杰作门槛，固定 95", () => {
  const a = fin(97, TOP);
  assert.equal(a.nominee, true); assert.equal(a.band, "神作提名"); assert.equal(a.F, 95); assert.equal(a.capped, null);
  assert.equal(fin(94.9, TOP).nominee, false); assert.equal(fin(94.9, TOP).F, 94);
  assert.equal(fin(97, { praise: true, praiseTop: true }).nominee, false); // 热 / 榜 / 玩一项都没有
  assert.equal(fin(97, { praiseTop: true, heat: true }).nominee, false); // 没过杰作门槛（口）
});

test("神作：只看数据包的神作名单（投票由资料仓库结算），不封顶、至少 96；被撤下的写经复议调整", () => {
  const m = fin(90, {}, {}, { w: { by: "manual" } });
  assert.equal(m.band, "神作"); assert.equal(m.canon, "manual"); assert.equal(m.F, 96); assert.equal(m.nominee, false);
  assert.equal(fin(99, {}, {}, { w: { by: "manual" } }).F, 99);
  assert.equal(fin(97, TOP, {}, { w: { by: "vote" } }).canon, "vote");
  assert.equal(fin(97, TOP, {}, ["w"]).canon, "manual");
  const down = fin(97, TOP, { godvote: { support: 5, oppose: 40, changed: "2026-11-01" } });
  assert.equal(down.canon, null); assert.equal(down.reviewed, true); assert.equal(down.band, "神作提名");
  assert.deepEqual(godvote(game("x", { godvote: { support: -3, oppose: "a" } })), { support: 0, oppose: 0, changed: "" });
});

test("玩家评分：Δ = cap·n/(n+prior)·(平均−3)/2，不是 1–5 的不算", () => {
  assert.equal(playerDelta([], rc.players), 0);
  near(playerDelta([5], rc.players), (10 * 1) / 4);
  near(playerDelta([5, 5, 5], rc.players), (10 * 3) / 6);
  near(playerDelta([1, 0, 9], rc.players), -(10 * 1) / 4);
  assert.equal(finalOf(game("o"), undefined, new Map(), rc), null);
  assert.equal(finalOf(game("dev", { state: "dev" }), base(90), new Map(), rc), null);
});

test("排名：分高的在前，同分按综合分，再同分按发售日期新的在前", () => {
  const gs = [game("a", { date: "2020-01-01" }), game("b", { date: "2022-01-01" }), game("c"), game("d")];
  const f = { a: { F: 89, comp: 70, date: "2020-01-01" }, b: { F: 89, comp: 70, date: "2022-01-01" }, c: null, d: { F: 89, comp: 75, date: "" } };
  assert.deepEqual(rankOrder(gs, g => f[g.id]).map(g => g.id), ["d", "b", "a"]);
});

test("开发中关注榜：Ci-en 按关注者百分位，FANBOX 排后面", () => {
  const gs = [game("cien-1", { src: "cien", state: "dev", followers: 100 }), game("cien-2", { src: "cien", state: "dev", followers: 900 }),
    game("fanbox-x", { src: "fanbox", state: "dev" }), game("cien-3", { src: "cien", state: "dev" })];
  const rows = devRows(gs);
  assert.deepEqual(rows.map(r => r.g.id), ["cien-2", "cien-1", "fanbox-x", "cien-3"]);
  assert.equal(rows[0].score, 100); assert.equal(rows[2].score, null);
});

// 和资料仓库的参考实现（tools/scoring.py）对一遍：公开数据包的作品 + 配方，期望值和名次都来自它
test("和 Python 参考实现一致：每部的 F、档、神作提名、名次", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/scoring-v2-pack.json", import.meta.url), "utf8"));
  const games = fx.games.map(g => normalizeGame(g));
  const r = cleanRecipeV2(fx.recipe), canon = cleanCanon(fx.canon);
  const b = baseScores(games, [{ items: fx.listed.map(rj => ({ rj })) }], r, fx.updated);
  const fins = new Map(games.map(g => [g.id, finalOf(g, b.get(g.id), canon, r)]));
  const order = rankOrder(games, g => fins.get(g.id)).map(g => g.id);
  let same = 0;
  for (const [id, F, band] of fx.expect) { const f = fins.get(id); if (f && Math.abs(f.F - F) < 1e-4 && f.band === band) same++; }
  assert.equal(same, fx.expect.length, `${same}/${fx.expect.length} 一致`);
  assert.deepEqual(order, fx.expect.map(e => e[0]));
  const pick = band => fx.expect.filter(e => e[2] === band).map(e => e[0]);
  assert.deepEqual(pick("神作"), ["vndb-v20802"]);
  assert.deepEqual(pick("神作提名").sort(), ["RJ201109", "RJ237469", "RJ297120", "vndb-v20431"]);
});

test("日期：不存在的日期（2 月 31 日、平年 2 月 29 日、13 月）是 NaN，不给新作补偿", () => {
  assert.equal(dateMs("2024-02-29"), Date.UTC(2024, 1, 29));
  assert.equal(dateMs("2026-04-01"), Date.UTC(2026, 3, 1));
  for (const s of ["2026-02-31", "2023-02-29", "2026-13-01", "2026-00-10", "2026-04-00", "2026-4-1", ""]) assert.ok(Number.isNaN(dateMs(s)), s);
  // 审查给的例子：非法日期和没写日期一样，热度不按在售时间放大
  const o = { rate: 4.8, rc: 2000, dl: 30000 };
  const m = baseScores([game("bad", { ...o, date: "2026-02-31" }), game("none", { ...o, date: "" }), game("ok", { ...o, date: "2026-03-03" })], [], rc, "2026-04-01");
  near(m.get("bad").H, m.get("none").H);
  assert.ok(m.get("ok").H > m.get("bad").H);
});
