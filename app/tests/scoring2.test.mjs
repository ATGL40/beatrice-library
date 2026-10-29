import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCatalog, normalizeGame } from "../src/catalog.ts";
import { cleanRankings } from "../src/scoring.ts";
import { baseScores, cleanCanon, cleanHiddenGems, cleanRecipeV2, curve, dateMs, devRows, DEFAULT_V2, finalOf, godvote, heatOffsets, hiddenGemRows, isThin, pctSorted, playerDelta, praiseOf, praiseTopLine, rankOrder, ratings, signal } from "../src/scoring2.ts";

const rc = cleanRecipeV2({ version: 2 });
const game = (id, o = {}) => normalizeGame({ id, cat: "f-rpg", src: "dlsite", date: "2024-01-01", ...o });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const R = x => ((x - 4.15) / (4.9 - 4.15)) * 100; // DLsite 评分换成 R（默认锚点）

test("配方：不是第 2 版返回 null；缺的、类型不对的用默认补；曲线点按 x 排好；锚点不对的社区不算", () => {
  assert.equal(cleanRecipeV2({ parts: [] }), null);
  assert.equal(cleanRecipeV2(null), null);
  const r = cleanRecipeV2({ version: 2, heat: { weight: "x" }, curve: { points: [[50, 70], [0, 40], ["a", 1]] },
    praise: { anchors: { vndb: [70, 70], bgm: "x", foo: [1, 2] }, k: { dlsite: -1 } } });
  assert.equal(r.heat.weight, 0.15);
  assert.equal(r.heat.method, "era-median");
  assert.deepEqual(r.curve.points, [[0, 40], [50, 70]]);
  assert.deepEqual(r.praise.anchors.dlsite, [4.15, 4.9]);
  assert.equal(r.praise.k.dlsite, 1000); // 不是正数：用默认的
  assert.equal(r.praise.anchors.vndb, undefined); // 低 = 高
  assert.deepEqual(r.praise.anchors.bgm, DEFAULT_V2.praise.anchors.bgm); // 类型不对：用默认的
  assert.equal(r.praise.anchors.foo, undefined); // 默认里也没有基数：不算
  assert.equal(cleanRecipeV2({ version: 2, curve: { points: [[1, 1]] } }).curve.points, DEFAULT_V2.curve.points);
  assert.deepEqual(rc.bands.map(b => b[0]), ["神作", "神作提名", "超大杯", "大杯", "中杯"]);
});

test("神作名单：对象或数组都认", () => {
  assert.deepEqual([...cleanCanon({ a: {}, b: { by: "vote" } })], [["a", "manual"], ["b", "vote"]]);
  assert.deepEqual([...cleanCanon(["a", 1])], [["a", "manual"]]);
  assert.equal(cleanCanon(null).size, 0);
});

test("百分位（二分）：最小 0、最大 100、相同取中间", () => {
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

test("信号和社区评分：本来源的 x / n / h；口碑读 DLsite、批評空間、Steam、VNDB、Bangumi、社区评分", () => {
  assert.deepEqual(signal(game("a", { rate: 4.5, rc: 10, dl: 100 })), { x: 4.5, n: 10, h: 100 });
  assert.deepEqual(signal(game("b", { src: "commercial", egs: { median: 80, count: 300 } })), { x: 80, n: 300, h: 300 });
  assert.deepEqual(signal(game("c", { src: "steam", steam: { positive: 95, reviews: 5000 } })), { x: 95, n: 5000, h: 5000 });
  assert.deepEqual(signal(game("d", { src: "fanza", rate: 4 })), { x: null, n: null, h: null });
  const g = game("e", { rate: 4.5, rc: 100, vndb: { id: "v1", rating: 80, votes: 30 }, bgm: { id: 2, score: 7.5, votes: 0 }, community: { avg: 4, count: 6 } });
  assert.deepEqual(ratings(g), [{ src: "dlsite", x: 4.5, n: 100 }, { src: "vndb", x: 80, n: 30 }, { src: "community", x: 4, n: 6 }]);
  assert.deepEqual(ratings(game("f", { src: "commercial", rate: 4.5, rc: 100 })), []); // DLsite 的分只认 DLsite 作品
});

test("口碑：不对称收缩——人少的高分很快升上去，人少的低分很难压下来", () => {
  const hi = praiseOf(game("hi", { rate: 4.9, rc: 100 }), rc), lo = praiseOf(game("lo", { rate: 4.15, rc: 100 }), rc);
  near(hi.P, 50 + (100 / 50) * 50 / (1 + 100 / 50)); // R 100，e = 100 ÷ kUp 50 = 2
  near(lo.P, 50 - (100 / 1000) * 50 / (1 + 100 / 1000)); // R 0，e = 100 ÷ k 1000 = 0.1
  assert.ok(hi.P - 50 > 7 * (50 - lo.P));
  // 评分超出锚点的截到 0–100；R 正好 50 不加不减
  near(praiseOf(game("x", { rate: 5, rc: 100 }), rc).P, hi.P);
  near(praiseOf(game("m", { rate: (4.15 + 4.9) / 2, rc: 5000 }), rc).P, 50);
  // Steam 好评率不参与打分（appliesTo 是空数组）；配方打开时两个方向都是 10000
  const sg = game("s", { src: "steam", steam: { positive: 101, reviews: 10000 } });
  assert.equal(praiseOf(sg, rc), null);
  const on = cleanRecipeV2({ version: 2, praise: { appliesTo: { vndb: ["commercial"] } } });
  near(praiseOf(sg, on).P, 75);
  near(praiseOf(game("s0", { src: "steam", steam: { positive: 57, reviews: 10000 } }), on).P, 25);
});

test("口碑：几个社区的证据加起来；民间榜单每次一份 R 90 的证据，最多两次", () => {
  const g = game("a", { rate: 4.6, rc: 500, bgm: { id: 1, score: 9, votes: 20 } }); // Bangumi 高过上锚：R 截到 100
  const p = praiseOf(g, rc, 3);
  const e1 = 500 / 50, R1 = R(4.6), e2 = 20 / 10;
  near(p.P, 50 + (e1 * (R1 - 50) + e2 * 50 + 2 * 40) / (1 + e1 + e2 + 2));
  near(p.E, e1 + e2 + 2);
  assert.equal(p.lists, 2);
  assert.deepEqual(p.per.map(s => s.src), ["dlsite", "bgm"]);
  // 社区评分（3 星→0、5 星→100）也是同一个公式，5 人起算
  const c = praiseOf(game("c", { rate: 4.6, rc: 500, community: { avg: 5, count: 5 } }), rc);
  near(c.P, 50 + (e1 * (R1 - 50) + (5 / 10) * 50) / (1 + e1 + 5 / 10));
  assert.equal(praiseOf(game("c4", { rate: 4.6, rc: 500, community: { avg: 5, count: 4 } }), rc).per.length, 1);
});

test("appliesTo：VNDB 只对商业作算，Steam 好评率不算（字段都留着）；数据包可以改", () => {
  const v = { id: "v1", rating: 95, votes: 100 };
  const dl = game("d", { rate: 4.6, rc: 500, vndb: v }), st = game("s", { src: "steam", steam: { positive: 90, reviews: 500 }, vndb: v });
  const co = game("c", { src: "commercial", egs: { median: 80, count: 100 }, vndb: v });
  assert.deepEqual(rc.praise.appliesTo, { vndb: ["commercial"], steam: [] });
  near(praiseOf(dl, rc).P, praiseOf(game("d0", { rate: 4.6, rc: 500 }), rc).P);
  assert.equal(praiseOf(st, rc), null); // 只有 Steam 好评率（和不算的 VNDB）：评价不足
  assert.deepEqual(praiseOf({ ...st, bgm: { id: 1, score: 7, votes: 30 } }, rc).per.map(s => s.src), ["bgm"]); // Steam 作品靠 Bangumi 打分
  assert.deepEqual(praiseOf(co, rc).per.map(s => s.src), ["commercial", "vndb"]);
  assert.ok(ratings(dl).some(s => s.src === "vndb")); // 资料里的字段还在
  // 只有 VNDB 够人数的 DLsite 作品：评价不足
  const only = game("o", { rate: 4.6, rc: 5, vndb: v });
  assert.equal(praiseOf(only, rc), null);
  // 数据包的 appliesTo 整个替换默认的：写成空对象就对所有作品都算
  const all = cleanRecipeV2({ version: 2, praise: { appliesTo: {} } });
  assert.deepEqual(praiseOf(dl, all).per.map(s => s.src), ["dlsite", "vndb"]);
  assert.deepEqual(praiseOf(st, all).per.map(s => s.src), ["steam", "vndb"]);
  assert.deepEqual(cleanRecipeV2({ version: 2, praise: { appliesTo: { bgm: "x", vndb: ["commercial", "steam"] } } }).praise.appliesTo, { vndb: ["commercial", "steam"] });
});

test("anchorsBySource：Bangumi 按作品来源各用一套锚点，没写的来源用总锚点；数据包可以改", () => {
  const bgm = { id: 1, score: 7.5, votes: 100 };
  const R = (x, [lo, hi]) => Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100));
  const by = rc.praise.anchorsBySource.bgm;
  assert.deepEqual(Object.keys(by).sort(), ["commercial", "dlsite", "steam"]);
  const rOf = (g, r = rc) => praiseOf(g, r).per.find(s => s.src === "bgm").R;
  near(rOf(game("d", { bgm })), R(7.5, by.dlsite));
  near(rOf(game("c", { src: "commercial", bgm })), R(7.5, by.commercial));
  near(rOf(game("s", { src: "steam", bgm })), R(7.5, by.steam));
  assert.ok(rOf(game("c", { src: "commercial", bgm })) < rOf(game("d", { bgm }))); // 同样 7.5 分，商业作的 R 低（Bangumi 给商业作的分普遍高）
  // 数据包的表整个替换默认的：没写的来源用 anchors.bgm；写成空对象就都用总锚点；不对的锚点不算
  const one = cleanRecipeV2({ version: 2, praise: { anchorsBySource: { bgm: { dlsite: [5, 9], steam: [7, 7], fanza: "x" } } } });
  assert.deepEqual(one.praise.anchorsBySource, { bgm: { dlsite: [5, 9] } });
  near(rOf(game("d", { bgm }), one), 62.5);
  near(rOf(game("c", { src: "commercial", bgm }), one), R(7.5, DEFAULT_V2.praise.anchors.bgm));
  const none = cleanRecipeV2({ version: 2, praise: { anchorsBySource: {} } });
  assert.deepEqual(none.praise.anchorsBySource, {});
  near(rOf(game("s", { src: "steam", bgm }), none), R(7.5, DEFAULT_V2.praise.anchors.bgm));
  // 总锚点里没有这个社区的，按来源的表也不让它算
  const off = cleanRecipeV2({ version: 2, praise: { anchors: { bgm: [5, 5] } } });
  assert.equal(praiseOf(game("d", { rate: 4.6, rc: 500, bgm }), off).per.some(s => s.src === "bgm"), false);
});

test("本平台至少一半的话语权：VNDB、Bangumi 合起来的证据量不超过 本平台人数 ÷ kUp（不看本平台打得高低）", () => {
  const Rof = (x, [lo, hi]) => Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100));
  const P = per => 50 + per.reduce((a, s) => a + s.e * (s.R - 50), 0) / (1 + per.reduce((a, s) => a + s.e, 0));
  assert.deepEqual(rc.praise.secondary, { sources: ["vndb", "bgm"], maxShareOfNative: 1 });
  // 猫娘乐园 4 的样子：DLsite 4.85 / 831 人，Bangumi 6.1 / 643 票（略高于中位数，R > 50 用 kUp，e 64 远大于 DLsite 的 16.6）
  const cat = praiseOf(game("cat", { rate: 4.85, rc: 831, bgm: { id: 1, score: 6.1, votes: 643 } }), rc);
  const eN = 831 / 50;
  near(cat.per[0].e, eN);
  near(cat.per[1].e, eN); // 缩到和 DLsite 一样多
  near(cat.P, P([{ e: eN, R: Rof(4.85, [4.15, 4.9]) }, { e: eN, R: Rof(6.1, rc.praise.anchorsBySource.bgm.dlsite) }]));
  assert.ok(cat.P > 70);
  // 樱之刻 的样子：批評空間 92 / 1397，VNDB 87.1 / 1117，Bangumi 8.1 / 3562：两个按同一个比例缩，合计 = 批評空間的 e
  const sk = praiseOf(game("sk", { src: "commercial", egs: { median: 92, count: 1397 }, vndb: { id: "v1", rating: 87.1, votes: 1117 }, bgm: { id: 2, score: 8.1, votes: 3562 } }), rc);
  const [co, vn, bg] = sk.per;
  near(co.e, 1397 / 10);
  near(vn.e + bg.e, co.e, 1e-9);
  near(vn.e / bg.e, (1117 / 10) / (3562 / 10));
  // 本平台人少又打得低（R ≤ 50，自己的 e 按 k 算得很小）：上限还是 人数 ÷ kUp，不会把往上拉的外站评分压没
  // 再来！孕育！的样子：批評空間 75 / 30 人（R 25，e 0.6），VNDB 83.5 / 81 票，Bangumi 6.7 / 143 票
  const zr = praiseOf(game("zr", { src: "commercial", egs: { median: 75, count: 30 }, vndb: { id: "v2", rating: 83.5, votes: 81 }, bgm: { id: 7, score: 6.7, votes: 143 } }), rc);
  near(zr.per[0].e, 30 / 50);
  near(zr.per[1].e + zr.per[2].e, 30 / 10);
  near(zr.per[1].e / zr.per[2].e, (81 / 10) / (143 / 50)); // Bangumi R ≤ 50 用 k
  assert.ok(zr.P > 55); // 按本平台 e 当上限时只有 48.8
  // 冬旅 的样子：批評空間 76 / 391（R 30），VNDB 73.7 / 327，Bangumi 7.2 / 1060（R > 50）：合计 = 391 ÷ 10
  const ft = praiseOf(game("ft", { src: "commercial", egs: { median: 76, count: 391 }, vndb: { id: "v3", rating: 73.7, votes: 327 }, bgm: { id: 8, score: 7.2, votes: 1060 } }), rc);
  near(ft.per[0].e, 391 / 50);
  near(ft.per[1].e + ft.per[2].e, 391 / 10);
  // 本平台评分高低不影响上限：同样人数、打高打低，外站的 e 一样
  const hiLo = m => praiseOf(game("h", { src: "commercial", egs: { median: m, count: 391 }, bgm: { id: 8, score: 7.2, votes: 1060 } }), rc).per[1].e;
  near(hiLo(60), hiLo(95));
  // 没超的不动；没有本平台评分（Steam 作品、DLsite 人数不够）的不限；民间榜单和社区评分不算在里面
  near(praiseOf(game("ok", { rate: 4.6, rc: 1000, bgm: { id: 3, score: 7, votes: 100 } }), rc).per[1].e, 10);
  near(praiseOf(game("st", { src: "steam", steam: { positive: 90, reviews: 500 }, bgm: { id: 4, score: 7, votes: 300 } }), rc).per[0].e, 30);
  near(praiseOf(game("few", { rate: 4.6, rc: 10, bgm: { id: 5, score: 7, votes: 300 } }), rc).per[0].e, 30);
  const cm = praiseOf(game("cm", { rate: 4.6, rc: 100, community: { avg: 5, count: 40 } }), rc, 2);
  near(cm.per[1].e, 4);
  near(cm.E, 2 + 4 + 2);
  // 连续：Bangumi 票数跨过上限前后，口碑只差一点点
  const at = v => praiseOf(game("c", { rate: 4.6, rc: 500, bgm: { id: 6, score: 8, votes: v } }), rc).P;
  assert.ok(Math.abs(at(99.999) - at(100)) < 1e-3 && Math.abs(at(100.001) - at(100)) < 1e-9); // 上限在 100 票（e 10 = DLsite 的 500 ÷ 50）
  near(at(100), at(5000)); // 封顶以后再多票也一样
  // 数据包可以关掉（null）或改倍数
  const off = cleanRecipeV2({ version: 2, praise: { secondary: null } });
  assert.equal(off.praise.secondary, null);
  near(praiseOf(game("cat", { rate: 4.85, rc: 831, bgm: { id: 1, score: 6.1, votes: 643 } }), off).per[1].e, 64.3);
  const half = cleanRecipeV2({ version: 2, praise: { secondary: { sources: ["bgm", 3], maxShareOfNative: 0.5 } } });
  assert.deepEqual(half.praise.secondary, { sources: ["bgm"], maxShareOfNative: 0.5 });
  near(praiseOf(game("cat", { rate: 4.85, rc: 831, bgm: { id: 1, score: 6.1, votes: 643 } }), half).per[1].e, eN / 2);
});

test("praiseTopBySource：Bangumi 的口★线按作品来源分开，没写的来源用 praiseTop", () => {
  const r = cleanRecipeV2({ version: 2, gates: { praiseTop: { rating: { bgm: 9 }, raters: { bgm: 200 } },
    praiseTopBySource: { bgm: { rating: { dlsite: 8.5, steam: 8 }, raters: { dlsite: 50, steam: "x" } } } } });
  assert.deepEqual(r.gates.praiseTopBySource, { bgm: { rating: { dlsite: 8.5 }, raters: { dlsite: 50 } } });
  assert.deepEqual(praiseTopLine(r, "bgm", "dlsite"), [8.5, 50]);
  assert.deepEqual(praiseTopLine(r, "bgm", "commercial"), [9, 200]);
  assert.deepEqual(praiseTopLine(r, "vndb", "dlsite"), [90.7, 1054]); // 没有按来源的表：用 praiseTop（缺的用默认补）
  assert.equal(praiseTopLine(r, "steam", "steam"), null); // 都没写：没有口★线
  const gs = [game("d", { rate: 4.6, rc: 500, bgm: { id: 1, score: 8.6, votes: 60 } }),
    game("c", { src: "commercial", egs: { median: 80, count: 100 }, bgm: { id: 2, score: 8.6, votes: 60 } }),
    game("c2", { src: "commercial", egs: { median: 80, count: 100 }, bgm: { id: 3, score: 9.1, votes: 300 } })];
  const m = baseScores(gs, [], r);
  assert.deepEqual(gs.map(g => m.get(g.id).dims.praiseTop), [true, false, true]);
  // 默认配方：三个来源都有
  assert.deepEqual(Object.keys(rc.gates.praiseTopBySource.bgm.rating).sort(), ["commercial", "dlsite", "steam"]);
});

test("评价不足：每个社区都不到人数下限的不打分、不分档，单独一组", () => {
  const gs = [game("few", { rate: 4.9, rc: 19, dl: 100 }), game("ok", { rate: 4.9, rc: 20, dl: 100 }),
    game("st", { src: "steam", steam: { positive: 99, reviews: 90000 } }), game("eg", { src: "commercial", egs: { median: 90, count: 9 } }),
    game("none", { rate: null, rc: null, dl: 100 }), game("dev", { state: "dev", rate: 4.9, rc: 5 }), game("fz", { src: "fanza" }),
    game("vn", { src: "commercial", egs: { median: 90, count: 9 }, vndb: { id: "v9", rating: 80, votes: 10 } })];
  const b = baseScores(gs, [], rc, "2026-10-28");
  assert.deepEqual([...b.keys()].sort(), ["ok", "vn"]); // vn：批評空間人数不够，VNDB 够
  assert.deepEqual(gs.filter(g => isThin(g, b)).map(g => g.id), ["few", "st", "eg", "none"]); // 开发中、不打分的来源不算
  assert.equal(finalOf(gs[0], b.get("few"), new Map(), rc), null);
  // 上过榜单也不算一个社区：评价不足照样不打分
  assert.equal(baseScores([gs[0]], [{ items: [{ rj: "few", rank: 1 }] }], rc, "2026-10-28").size, 0);
});

test("热度：和同来源、前后一年作品的中位数比；没有人气数的按 0 算（缺资料不加分）", () => {
  const sales = [100, 1000, 10000];
  const gs = sales.map((dl, i) => game(`a${i}`, { rate: 4.5, rc: 100, dl, date: "2020-06-01" }))
    .concat([game("nodl", { rate: 4.5, rc: 100, date: "2020-06-01" })]);
  const r = cleanRecipeV2({ version: 2, heat: { minGroup: 3 } });
  const b = baseScores(gs, [], r, "2026-10-28");
  near(b.get("a1").H, 50); // 中位数
  near(b.get("a2").H, Math.min(100, 50 + (35 * 1) / r.heat.scale.dlsite)); // 高一个数量级（截到 100）
  near(b.get("a0").H, Math.max(0, 50 - (35 * 1) / r.heat.scale.dlsite));
  assert.equal(b.get("nodl").H, 0); assert.equal(b.get("nodl").hot, false);
  near(b.get("a1").comp, 0.85 * b.get("a1").P + 0.15 * 50);
  near(b.get("a1").F, curve(b.get("a1").comp, r.curve.points));
});

test("热度的时代基准：前后一年不够 minGroup 部就放宽；一部爆款几乎不动别人的热度", () => {
  const r = cleanRecipeV2({ version: 2, heat: { minGroup: 3 } });
  const gs = [["2016", 100], ["2016", 200], ["2016", 400], ["2020", 10000], ["2021", 20000], ["2022", 40000]]
    .map(([y, dl], i) => game(`g${i}`, { rate: 4.5, rc: 100, dl, date: `${y}-03-01` }));
  const d = heatOffsets(gs, r, "2026-10-28");
  near(d.get("g1"), 0); // 2016 年自己就有 3 部
  near(d.get("g4"), 0); // 2020–2022 年
  near(d.get("g3"), Math.log10(10000) - Math.log10(20000));
  // 2018 年只有一部：放宽到 ±2 年（2016、2020）才够 3 部
  const lone = game("lone", { rate: 4.5, rc: 100, dl: 1000, date: "2018-03-01" });
  near(heatOffsets([...gs, lone], r, "2026-10-28").get("lone"), Math.log10(1000) - Math.log10(400));
  // 爆款：同年再加一部 1000 倍销量的，同年别的作品的中位数只挪一位
  const big = game("big", { rate: 4.5, rc: 100, dl: 1e8, date: "2021-03-01" });
  const d2 = heatOffsets([...gs, big], r, "2026-10-28");
  assert.ok(Math.abs(d2.get("g4") - d.get("g4")) <= Math.log10(40000 / 20000) / 2 + 1e-12);
});

test("热度：不到一年的新作按在售时间放大；非法、缺失或晚于数据包日期的发售日不放大、和同来源全部比", () => {
  const r = cleanRecipeV2({ version: 2, heat: { minGroup: 1, window: 1 } });
  const base = [100, 1000, 10000].map((dl, i) => game(`o${i}`, { rate: 4.5, rc: 100, dl, date: "2025-10-01" }));
  const young = game("y", { rate: 4.5, rc: 100, dl: 1000, date: "2026-07-31" }); // 0.25 年：÷ 0.5
  const d = heatOffsets([...base, young], r, "2026-10-28");
  near(d.get("y") - d.get("o1"), Math.log10(2)); // 同一年同一个基准，只差 ÷ 0.25^0.5
  for (const date of ["2026-02-31", "", "2027-01-01", "2023-02-29"]) {
    const g = game("bad", { rate: 4.5, rc: 100, dl: 1000, date });
    const all = heatOffsets([...base, g], r, "2026-10-28");
    near(all.get("bad"), 0); // 和有发售日的全部（100、1000、10000）的中位数 1000 比，不放大
  }
  assert.ok(Number.isNaN(dateMs("2026-02-31")));
  assert.equal(dateMs("2024-02-29"), Date.UTC(2024, 1, 29));
  for (const s of ["2023-02-29", "2026-13-01", "2026-00-10", "2026-04-00", "2026-4-1", ""]) assert.ok(Number.isNaN(dateMs(s)), s);
});

test("维度：口★ 只认 praiseSources 里的社区（Steam 不算）；榜；玩；多（两个社区都高分且证据够）", () => {
  const gs = [game("top", { rate: 4.9, rc: 20000 }), game("p", { rate: 4.8, rc: 1500 }),
    game("st", { src: "steam", steam: { positive: 99, reviews: 90000 } }),
    game("two", { rate: 4.8, rc: 1500, bgm: { id: 1, score: 8.5, votes: 10 }, community: { avg: 4.6, count: 20 } })];
  const r = cleanRecipeV2({ version: 2, praise: { appliesTo: {} }, gates: { praiseTop: { rating: { dlsite: 4.84, steam: 97 }, raters: { dlsite: 10683, steam: 4108 } } } });
  const m = baseScores(gs, [{ items: [{ rj: "top", rank: 1 }] }], r);
  assert.deepEqual(m.get("top").dims, { praiseTop: true, lists: true, players: false, second: false });
  assert.equal(m.get("p").dims.praiseTop, false);
  assert.equal(m.get("st").dims.praiseTop, false); // 配方打开 Steam 时，过了线也不能提名
  assert.deepEqual(m.get("two").dims, { praiseTop: false, lists: false, players: true, second: true });
  assert.equal(m.get("p").dims.second, false);
});

const base = (F, dims = {}, o = {}) => ({ P: 90, E: 1, per: [], lists: 0, H: 0, hot: false, comp: 0, F, bench: true,
  dims: { praiseTop: false, lists: false, players: false, second: false, ...dims }, ...o });
const fin = (F, dims, o = {}, canon = {}, b = {}) => finalOf(game("w", o), base(F, dims, b), cleanCanon(canon), rc);
const TOP = { praiseTop: true, lists: true };

test("分档：没有门槛，非提名最高 94；超大杯 85–94、大杯 70–84、中杯 70 以下", () => {
  const a = fin(98, {});
  assert.equal(a.F, 94); assert.equal(a.band, "超大杯"); assert.equal(a.capped, 94);
  assert.equal(fin(85, {}).band, "超大杯"); assert.equal(fin(84.99, {}).band, "大杯");
  assert.equal(fin(70, {}).band, "大杯"); assert.equal(fin(69.9, {}).band, "中杯");
  assert.equal(fin(90, {}).capped, null);
});

test("神作提名：曲线分 ≥ 95、口★、榜 / 玩 / 多一项、口碑够基准，固定 95", () => {
  const a = fin(97, TOP);
  assert.equal(a.nominee, true); assert.equal(a.band, "神作提名"); assert.equal(a.F, 95); assert.equal(a.capped, null);
  assert.equal(fin(94.9, TOP).nominee, false); assert.equal(fin(94.9, TOP).F, 94);
  assert.equal(fin(97, { praiseTop: true }).nominee, false); // 榜 / 玩 / 多一项都没有
  assert.equal(fin(97, { praiseTop: true, second: true }).nominee, true);
  assert.equal(fin(97, { lists: true, players: true }).nominee, false); // 没有口★
  assert.equal(fin(97, TOP, {}, {}, { bench: false }).nominee, false); // 口碑不到基准的 90%
});

test("基准条件：口碑至少是基准作品的 benchmarkPct；基准作品不在资料里就不看这一条", () => {
  const mk = (id, rate) => game(id, { rate, rc: 20000 });
  const gs = [mk("bench", 4.9), mk("close", 4.85), mk("far", 4.6)];
  const r = cleanRecipeV2({ version: 2, nominee: { benchmark: "bench", benchmarkPct: 0.9 } });
  const m = baseScores(gs, [], r);
  const P = id => m.get(id).P;
  assert.equal(m.get("bench").bench, true);
  assert.equal(m.get("close").bench, P("close") >= 0.9 * P("bench")); assert.equal(m.get("close").bench, true);
  assert.equal(m.get("far").bench, false);
  const none = baseScores(gs, [], cleanRecipeV2({ version: 2, nominee: { benchmark: "nope" } }));
  assert.ok([...none.values()].every(b => b.bench));
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

const GEMS = { name: "冷门佳作榜", rating: { dlsite: 4.70, commercial: 85, steam: 94 }, raters: { dlsite: [50, 1000], commercial: [30, 300], steam: [100, 2000] }, sortBy: "praise", limit: 100 };

test("冷门佳作榜配方：没写就没有这个榜；评分线和人数区间成对才算；limit 默认 100", () => {
  assert.equal(rc.hiddenGems, null);
  const r = cleanRecipeV2({ version: 2, hiddenGems: GEMS });
  assert.deepEqual(r.hiddenGems, GEMS);
  assert.equal(cleanHiddenGems({ rating: { dlsite: 4.7 } }), null); // 没有人数区间
  assert.equal(cleanHiddenGems({ rating: { dlsite: 4.7 }, raters: { dlsite: [100, 50] } }), null); // 下限不小于上限
  assert.equal(cleanHiddenGems("x"), null);
  const h = cleanHiddenGems({ name: "", rating: { dlsite: 4.7, steam: "x" }, raters: { dlsite: [50, 1000], steam: [1, 2] }, limit: -3 });
  assert.deepEqual(h, { name: "冷门佳作榜", rating: { dlsite: 4.7 }, raters: { dlsite: [50, 1000] }, sortBy: "praise", limit: 100 });
});

test("冷门佳作榜：评分过线、人数在 [下限, 上限) 里的已发售作品，按口碑 P 排", () => {
  const gs = [
    game("RJ-a", { rate: 4.80, rc: 900 }), // 人数多，口碑高
    game("RJ-b", { rate: 4.90, rc: 60 }), // 评分更高但人数少
    game("RJ-edge-lo", { rate: 4.70, rc: 50 }), // 两个边界都算
    game("RJ-many", { rate: 4.95, rc: 1000 }), // 人数到上限就不算冷门
    game("RJ-few", { rate: 4.95, rc: 49 }),
    game("RJ-low", { rate: 4.69, rc: 500 }),
    game("RJ-dev", { rate: 4.9, rc: 500, state: "dev" }),
    game("vndb-1", { src: "commercial", egs: { median: 88, count: 120 } }),
    game("vndb-2", { src: "commercial", egs: { median: 88, count: 300 } }),
    game("steam-1", { src: "steam", steam: { positive: 96, reviews: 1500 } }),
    game("cien-1", { src: "cien", followers: 100 }),
  ];
  const base = baseScores(gs, [], rc, "2026-10-28");
  const rows = hiddenGemRows(gs, base, GEMS);
  const ids = rows.map(r => r.g.id);
  assert.deepEqual(new Set(ids), new Set(["RJ-a", "RJ-b", "RJ-edge-lo", "vndb-1"])); // 只有 Steam 好评率的作品评价不足，不进榜
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].P >= rows[i].P);
  assert.ok(ids.indexOf("RJ-a") < ids.indexOf("RJ-b"));
  const a = rows.find(r => r.g.id === "RJ-a");
  assert.equal(a.x, 4.8); assert.equal(a.n, 900); assert.equal(a.P, base.get("RJ-a").P);
  // 不改综合分：同样的作品算出来的 base 和有没有这个榜无关
  assert.deepEqual(baseScores(gs, [], cleanRecipeV2({ version: 2, hiddenGems: GEMS }), "2026-10-28"), base);
});

// 和资料仓库的参考实现（tools/scoring.py）对一遍：软件自带的目录 public/catalog.json，期望值是那边 --dump 出来的
test("和 Python 参考实现一致：自带目录每部的分、档、口碑、热度、名次，评价不足的作品", () => {
  const raw = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8"));
  const fx = JSON.parse(readFileSync(new URL("./fixtures/scoring-expect.json", import.meta.url), "utf8"));
  const cat = normalizeCatalog(raw);
  assert.equal(`${cat.updated} r${cat.revision}`, `${fx.updated} r${fx.revision}`, "期望值和自带目录不是同一版：重新跑 tools/scoring.py --dump");
  const r = cleanRecipeV2(cat.scoring), canon = cleanCanon(cat.canon);
  const b = baseScores(cat.games, cleanRankings(cat.rankings), r, cat.updated);
  const fins = new Map(cat.games.map(g => [g.id, finalOf(g, b.get(g.id), canon, r)]));
  const order = rankOrder(cat.games, g => fins.get(g.id)).map(g => g.id);
  const bad = fx.ranked.filter(([id, F, band, P, H]) => {
    const f = fins.get(id), x = b.get(id);
    return !f || Math.abs(f.F - F) > 1e-6 || f.band !== band || Math.abs(x.P - P) > 1e-6 || Math.abs(x.H - H) > 1e-6;
  });
  assert.deepEqual(bad.slice(0, 5), [], `${fx.ranked.length - bad.length}/${fx.ranked.length} 一致`);
  assert.deepEqual(order, fx.ranked.map(e => e[0]));
  assert.deepEqual(cat.games.filter(g => isThin(g, b)).map(g => g.id), fx.insufficient);
  const pick = band => fx.ranked.filter(e => e[2] === band).map(e => e[0]);
  assert.deepEqual(pick("神作"), ["vndb-v20802"]);
  assert.deepEqual(pick("神作提名").sort(), ["RJ201109", "RJ237469", "RJ297120", "vndb-v20431"]);
  // 配方是数据包里的那份，不是默认值碰巧一样
  assert.deepEqual(r.curve.points, raw.scoring.curve.points);
  assert.deepEqual(DEFAULT_V2.curve.points, raw.scoring.curve.points, "DEFAULT_V2 要和资料仓库的 scoring.json 一样");
  assert.deepEqual(DEFAULT_V2.heat.scale, raw.scoring.heat.scale);
  assert.deepEqual(DEFAULT_V2.praise.anchorsBySource, raw.scoring.praise.anchorsBySource);
  assert.deepEqual(DEFAULT_V2.gates.praiseTopBySource, raw.scoring.gates.praiseTopBySource);
});
