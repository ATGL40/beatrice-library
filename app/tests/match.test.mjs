import test from "node:test";
import assert from "node:assert/strict";
import { generic, matchFolder, norm, planScan, under } from "../src/match.ts";

const game = (id, title, o = {}) => ({ id, cat: "f-rpg", state: "released", src: "dlsite", title, names: { ja: title, zh: "", en: "" }, mt: [],
  circle: "", date: "2020-01-01", rate: null, dl: null, url: "", cover: "", note: "", ...o });
const games = [
  game("RJ111111", "Velmorin ヴェルモリン"),
  game("RJ222222", "友達100人できるかな？"),
  game("RJ333333", "近所の人妻", { names: { ja: "近所の人妻", zh: "", en: "Kinjo no Hitozuma" } }),
  game("RJ444444", "聖なる剣と魔法少女"),
  game("RJ555555", "Pray Game ～前編～"),
  game("RJ666666", "Pray Game ～後編～"),
  game("RJ777777", "2048"),
  game("RJ888888", "怠け怪獣姫は働きたくない", { names: { ja: "怠け怪獣姫は働きたくない", zh: "", en: "Kaiju Princess" } }),
  game("RJ999999", "美少女万華鏡 -理と迷宮の少女-"),
  game("RJ000001", "勇者さま、ゆうべはお楽しみでしたねっ!", { names: { ja: "勇者さま、ゆうべはお楽しみでしたねっ!", zh: "", en: "Great Hero, Last Night Was Fun, Wasn't It?" } }),
  game("RJ000002", "タナトス-Thanatos-"),
  game("RJ000003", "lesson"),
];
/** 扫描结果：names 不给就只有文件夹名 */
const found = (name, names = [name], o = {}) => ({ dir: `X:\\${name}`, name, names, rj: null, exes: [`X:\\${name}\\Game.exe`], ...o });
const id = m => m.game?.id ?? null;

test("通用词：引擎文件夹、架构、版本号、纯数字、太短的", () => {
  for (const g of ["Game", "www", "PC", "x64", "rpgmv-game", "v1.0", "ver1.2", "1546", "2.25", "a", ""]) assert.ok(generic(g), g);
  for (const ok of ["Velmorin", "R-3189", "蝴蝶公主", "ab"]) assert.ok(!generic(ok), ok);
});

test("包装层：外层文件夹名也在候选里，能按它认出", () => {
  // 2502-1207/蝴蝶公主/Game.exe 这种：候选 = [文件夹, 包装层, exe 名]
  const f = found("Velmorin", ["www", "Velmorin", "RPG", "Game"]);
  assert.equal(id(matchFolder(f, games, {})), "RJ111111");
  // 候选全是通用词时认不出
  assert.equal(id(matchFolder(found("1546", ["1546", "Game"]), games, {})), null);
});

test("exe 名和引擎标题也拿来比对", () => {
  assert.equal(id(matchFolder(found("4440", ["4440", "Kinjo no Hitozuma"]), games, {})), "RJ333333");
  assert.equal(id(matchFolder(found("100个朋友", ["100个朋友", "友達100人できるかな？"]), games, {})), "RJ222222");
  // Game.ini / package.json 读出的标题
  assert.equal(id(matchFolder(found("Ace", ["Ace", "Game", "聖なる剣と魔法少女"]), games, {})), "RJ444444");
});

test("RJ 号：候选里任何地方的 RJ 号；纯 6～8 位数字只在图鉴里有这个号时算", () => {
  assert.equal(id(matchFolder(found("whatever", ["whatever", "rj111111_x"]), games, {})), "RJ111111");
  assert.equal(id(matchFolder(found("222222"), games, {})), "RJ222222");
  assert.equal(id(matchFolder(found("01412576"), games, {})), null); // 图鉴里没有 RJ01412576
  assert.equal(id(matchFolder(found("x", ["x"], { rj: "RJ333333" }), games, {})), "RJ333333");
});

test("分不清就不自动关联，只给 guess；纯数字的作品名不参与", () => {
  // 前后编的主标题一样：最长匹配并列 → 不关联，guess 是其中一部
  const m = matchFolder(found("Pray Game 汉化"), games, {});
  assert.equal(m.game, null);
  assert.ok(["RJ555555", "RJ666666"].includes(m.guess.id));
  // 写全了就能分清
  assert.equal(id(matchFolder(found("Pray Game ～後編～ v1.2"), games, {})), "RJ666666");
  // 作品名「2048」是纯数字，文件夹里有 2048 也不算
  assert.equal(id(matchFolder(found("backup 2048"), games, {})), null);
  // 完全没有像的：没有 guess
  assert.equal(matchFolder(found("随便的东西"), games, {}).guess, undefined);
});

test("单个词只能整个对上、还得够长；续作、同系列另一部只算「可能是」", () => {
  // 「hero」这种短词到处都是：不关联，也不当 guess
  assert.deepEqual(matchFolder(found("heroes"), games, {}), { game: null });
  assert.deepEqual(matchFolder(found("CN_NyotaikaHeroTorishimari"), games, {}), { game: null });
  // 够长的单词整个对上才算
  assert.equal(id(matchFolder(found("Velmorin"), games, {})), "RJ111111");
  assert.equal(matchFolder(found("GoodbyeVelmorin"), games, {}).game, null);
  // Kaiju Princess 2 是续作：只给 guess
  const seq = matchFolder(found("暴食公主", ["暴食公主", "Kaiju Princess 2 v1.04"]), games, {});
  assert.equal(seq.game, null); assert.equal(seq.guess.id, "RJ888888");
  assert.equal(id(matchFolder(found("Kaiju Princess v1.04"), games, {})), "RJ888888");
  // 主标题一样、副标题不一样：同系列另一部，只给 guess；副标题一样就关联
  const sib = matchFolder(found("（1）美少女万華鏡 -呪われし伝説の少女-"), games, {});
  assert.equal(sib.game, null); assert.equal(sib.guess.id, "RJ999999");
  assert.equal(id(matchFolder(found("美少女万華鏡 -理と迷宮の少女- 汉化"), games, {})), "RJ999999");
  assert.equal(id(matchFolder(found("美少女万華鏡"), games, {})), "RJ999999");
  // 短的主标题藏在一长串别的名字里：只给 guess
  const th = matchFolder(found("夢想と心転のカタラアタナトス"), games, {});
  assert.equal(th.game, null); assert.equal(th.guess.id, "RJ000002");
  assert.equal(id(matchFolder(found("タナトス 汉化版"), games, {})), "RJ000002");
});

test("以前关联过的文件夹照旧；关联在包装层上的，要后端给的 top 作证才挪到里面", () => {
  const local = { RJ777777: { dir: "X:\\Old", exe: "X:\\Old\\Game.exe" } };
  assert.equal(id(matchFolder(found("Old"), games, local)), "RJ777777");
  assert.equal(id(matchFolder(found("inner", ["inner"], { dir: "X:\\old\\inner", top: "X:\\Old" }), games, local)), "RJ777777");
  // 只是在子文件夹里、不是包装层（没有 top）：不算
  assert.equal(id(matchFolder(found("inner", ["inner"], { dir: "X:\\old\\inner" }), games, local)), null);
  assert.equal(id(matchFolder(found("Older"), games, local)), null);
  // 只剩游玩记录（取消过关联）的不算关联
  assert.equal(id(matchFolder(found("Old"), games, { RJ777777: { playSeconds: 60 } })), null);
});

test("旧数据里没有 names 字段也能比", () => {
  const f = { dir: "X:\\Velmorin", name: "Velmorin", rj: null, exes: [] };
  assert.equal(id(matchFolder(f, games, {})), "RJ111111");
  assert.equal(norm("【汉化】Velmorin Ver1.2"), "velmorin");
});

test("纯英文数字、不到 7 个字母的短作品名只认完全一样的；中日文短名照旧", () => {
  // NatsuiroLesson 不能认成「lesson」；文件夹就叫 lesson 才算
  assert.deepEqual(matchFolder(found("NatsuiroLesson"), games, {}), { game: null });
  assert.deepEqual(matchFolder(found("Piano Lesson 2"), games, {}), { game: null });
  assert.equal(id(matchFolder(found("Lesson"), games, {})), "RJ000003");
  assert.equal(id(matchFolder(found("【汉化】lesson v1.2"), games, {})), "RJ000003");
  // 中日文的短名字（近所の人妻、タナトス）不受这条限制
  assert.equal(id(matchFolder(found("近所の人妻 汉化"), games, {})), "RJ333333");
  assert.equal(id(matchFolder(found("タナトス 汉化版"), games, {})), "RJ000002");
});

test("扫描结果：一部作品只关联一个文件夹，后来的进「没认出」并写上「可能是」；以前关联的不挪", () => {
  const a = found("Velmorin"), b = found("Velmorin", ["Velmorin"], { dir: "X:\\Other\\Velmorin" });
  // 这次扫描先认出的赢
  let r = planScan([a, b], games, {});
  assert.deepEqual(r.link.map(([g, f]) => [g.id, f.dir]), [["RJ111111", "X:\\Velmorin"]]);
  assert.deepEqual(r.unmatched.map(f => [f.dir, f.guess]), [["X:\\Other\\Velmorin", "RJ111111"]]);
  // 以前关联在 b 上：b 照旧，a 虽然名字也对得上，进「没认出」
  const local = { RJ111111: { dir: "X:\\Other\\Velmorin", exe: "X:\\Other\\Velmorin\\Game.exe" } };
  r = planScan([a, b], games, local);
  assert.deepEqual(r.link.map(([g, f]) => [g.id, f.dir]), [["RJ111111", "X:\\Other\\Velmorin"]]);
  assert.deepEqual(r.unmatched.map(f => [f.dir, f.guess]), [["X:\\Velmorin", "RJ111111"]]);
  // 以前关联在包装层上、这次扫到里面那层：算同一个文件夹，照旧关联
  const inner = found("www", ["www", "Velmorin"], { dir: "X:\\Velmorin\\www", top: "X:\\Velmorin" });
  r = planScan([inner], games, { RJ111111: { dir: "X:\\Velmorin", exe: "X:\\Velmorin\\Game.exe" } });
  assert.equal(r.link[0][1].dir, "X:\\Velmorin\\www");
  // 认不出的照旧：像的带 guess，不像的没有
  r = planScan([found("Pray Game 汉化"), found("随便的东西")], games, {});
  assert.deepEqual(r.link, []);
  assert.ok(["RJ555555", "RJ666666"].includes(r.unmatched[0].guess));
  assert.equal(r.unmatched[1].guess, undefined);
  assert.ok(under("X:\\A\\b", "x:\\a") && under("X:\\A", "X:\\A\\") && !under("X:\\AB", "X:\\A"));
});

test("重新扫描不抢别的作品的关联：外层关联着 A、里面的文件夹关联着 B（审查复现的情形）", () => {
  // A（Velmorin）关联在 X:\Collection，B（タナトス）关联在 X:\Collection\Beta；A 在记录里排前面
  const local = {
    RJ111111: { dir: "X:\\Collection", exe: "X:\\Collection\\a.exe" },
    RJ000002: { dir: "X:\\Collection\\Beta", exe: "X:\\Collection\\Beta\\Game.exe", playSeconds: 3600 },
  };
  const beta = found("Beta", ["Beta", "Velmorin"], { dir: "X:\\Collection\\Beta" });
  assert.equal(id(matchFolder(beta, games, local)), "RJ000002");
  let r = planScan([beta], games, local);
  assert.deepEqual(r.link.map(([g, f]) => [g.id, f.dir]), [["RJ000002", "X:\\Collection\\Beta"]]);
  // 就算 Collection 是包装层（top 作证）、名字也像 A：精确关联着 B 的文件夹还是 B 的
  r = planScan([{ ...beta, top: "X:\\Collection" }], games, local);
  assert.deepEqual(r.link.map(([g, f]) => [g.id, f.dir]), [["RJ000002", "X:\\Collection\\Beta"]]);
  // 占着这个文件夹的作品图鉴里已经没有了：名字认出是 A 也不抢（进「没认出」，可能是 A）
  const gone = { RJ111111: local.RJ111111, OLD1: { dir: "x:\\collection\\beta\\", exe: "x:\\collection\\beta\\Game.exe" } };
  r = planScan([{ ...beta, top: "X:\\Collection" }], games, gone);
  assert.deepEqual(r.link, []);
  assert.deepEqual(r.unmatched.map(f => f.guess), ["RJ111111"]);
  // 不是包装层：A 不会因为「在子文件夹里」被挪过来
  r = planScan([found("Velmorin", ["Velmorin"], { dir: "X:\\Collection\\Velmorin" })], games, { RJ111111: local.RJ111111 });
  assert.deepEqual(r.link, []);
  assert.deepEqual(r.unmatched.map(f => f.guess), ["RJ111111"]);
});

test("扫描结果交给 linkFolder：不去掉别的作品的关联；手动换关联、取消关联都留着游玩记录", async () => {
  const { data, linkFolder, unlinkFolder } = await import("../src/store.ts");
  data.local = {
    RJ111111: { dir: "X:\\Collection", exe: "X:\\Collection\\a.exe", playSeconds: 100, extra: 1 },
    RJ000002: { dir: "X:\\Collection\\Beta", exe: "X:\\Collection\\Beta\\Game.exe", playSeconds: 3600, lastPlayed: "2026-10-01T00:00:00.000Z" },
  };
  data.unmatched = []; data.marks = {};
  const beta = found("Beta", ["Beta", "Velmorin"], { dir: "X:\\Collection\\Beta", top: "X:\\Collection" });
  for (const [g, f] of planScan([beta], games, data.local).link) linkFolder(g.id, f);
  assert.equal(data.local.RJ111111.dir, "X:\\Collection");
  assert.equal(data.local.RJ000002.dir, "X:\\Collection\\Beta");
  // 手动把 Beta 关联给 A：B 只是没了关联，游玩记录还在
  linkFolder("RJ111111", beta);
  assert.equal(data.local.RJ111111.dir, "X:\\Collection\\Beta");
  assert.deepEqual(data.local.RJ000002, { playSeconds: 3600, lastPlayed: "2026-10-01T00:00:00.000Z" });
  // 取消关联：去掉 dir、exe、le，游玩记录和不认识的字段留着；什么都不剩就删掉这条
  data.local.RJ111111.le = true;
  unlinkFolder("RJ111111");
  assert.deepEqual(data.local.RJ111111, { playSeconds: 100, extra: 1 });
  data.local.X = { dir: "X:\\y", exe: "X:\\y\\a.exe" };
  unlinkFolder("X");
  assert.ok(!("X" in data.local));
  // 重新关联：游玩记录接着用
  linkFolder("RJ111111", found("Velmorin"));
  assert.equal(data.local.RJ111111.playSeconds, 100);
  assert.equal(data.local.RJ111111.dir, "X:\\Velmorin");
});

test("结果和候选、作品的先后顺序无关；续作数字可以是两位", () => {
  const perms = a => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  const cases = [
    [["Kaiju Princess 2", "Kaiju Princess", "暴食公主"], null, "RJ888888"], // 精确标题和续作都在：没把握
    [["Kaiju Princess 12", "暴食公主"], null, "RJ888888"],
    [["Pray Game", "汉化", "Pray Game ～後編～"], "RJ666666", undefined],
    [["Pray Game 汉化", "随便"], null, "pray"], // 前后编分不清
    [["Velmorin", "タナトス 汉化版"], "RJ111111", undefined], // 对上的长度不一样：长的赢
  ];
  for (const [names, game, guess] of cases) {
    const all = [...perms(names).map(ns => matchFolder(found(ns[0], ns), games, {})), matchFolder(found(names[0], names), [...games].reverse(), {})];
    const got = all.map(r => ({ game: id(r), guess: r.guess?.id }));
    for (const g of got) assert.deepEqual(g, got[0], names.join(" / "));
    assert.equal(got[0].game, game, names.join(" / "));
    if (guess === "pray") assert.ok(["RJ555555", "RJ666666"].includes(got[0].guess));
    else assert.equal(got[0].guess, guess, names.join(" / "));
  }
  // 版本号（1.2、1.0.4）不当续作数字
  assert.equal(id(matchFolder(found("Kaiju Princess 1.2"), games, {})), "RJ888888");
  assert.equal(id(matchFolder(found("Kaiju Princess 1.0.4"), games, {})), "RJ888888");
});
