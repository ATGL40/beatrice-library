import test from "node:test";
import assert from "node:assert/strict";
import { generic, helperExe, matchFolder, norm, planScan, reviewLinks, rjCodes, sameDir, under } from "../src/match.ts";

const game = (id, title, o = {}) => ({ id, cat: "f-rpg", state: "released", src: "dlsite", title, names: { ja: title, zh: "", en: "" }, mt: [],
  circle: "", date: "2020-01-01", rate: null, dl: null, url: "", cover: "", note: "", ...o });
const games = [
  game("RJ111111", "Velmorin ヴェルモリン", { names: { ja: "Velmorin ヴェルモリン", zh: "", en: "Velmorin Saga" } }),
  game("RJ121212", "Grimoire ディアボリカ"),
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
  game("VJ012345", "プロ版の作品"),
];
/** 扫描结果：文件夹 X:\<name>，names 不给就只有文件夹名，引擎标题 titles 默认没有 */
const found = (name, names = [name], o = {}) => ({ dir: `X:\\${name}`, name, names, rj: null, exes: [`X:\\${name}\\Game.exe`], titles: [], ...o });
const id = m => m.game?.id ?? null;
const both = m => [m.game?.id ?? null, m.guess?.id ?? null];

test("通用词：引擎文件夹、架构、版本号、纯数字、太短的", () => {
  for (const g of ["Game", "www", "PC", "x64", "rpgmv-game", "v1.0", "ver1.2", "1546", "2.25", "a", ""]) assert.ok(generic(g), g);
  for (const ok of ["Velmorin", "R-3189", "蝴蝶公主", "ab"]) assert.ok(!generic(ok), ok);
});

test("白名单：文件夹名或引擎标题和作品全名（去掉版本号、汉化标记、括号）完全一样才自动关联，写明凭什么", () => {
  assert.deepEqual(matchFolder(found("Velmorin Saga v1.2"), games, {}), { game: games[0], why: "Velmorin Saga v1.2", rule: "folder" });
  assert.equal(id(matchFolder(found("近所の人妻 汉化"), games, {})), "RJ333333");
  assert.equal(id(matchFolder(found("【汉化】美少女万華鏡 -理と迷宮の少女- v1.2"), games, {})), "RJ999999");
  // 包装层（文件夹路径里的一层）也算文件夹名
  assert.equal(id(matchFolder(found("www", ["www", "Velmorin Saga", "Game"], { dir: "X:\\Velmorin Saga\\www" }), games, {})), "RJ111111");
  // 引擎标题
  const ace = matchFolder(found("Ace", ["Ace", "Game", "聖なる剣と魔法少女"], { titles: ["聖なる剣と魔法少女"] }), games, {});
  assert.deepEqual([id(ace), ace.rule], ["RJ444444", "title"]);
  // 旧数据（没有 titles 字段）：不是文件夹名、启动程序名的候选当引擎标题
  assert.equal(id(matchFolder({ dir: "X:\\Ace", name: "Ace", names: ["Ace", "聖なる剣と魔法少女"], rj: null, exes: [] }, games, {})), "RJ444444");
  // 候选全是通用词：认不出
  assert.deepEqual(matchFolder(found("1546", ["1546", "Game"]), games, {}), { game: null });
});

test("白名单以外的只给「可能是」，并写上原因", () => {
  // 启动程序名和作品名只是差不多（下划线代替空格）
  const exe = matchFolder(found("4440", ["4440", "Kinjo_no_Hitozuma"], { exes: ["X:\\4440\\Kinjo_no_Hitozuma.exe"] }), games, {});
  assert.deepEqual(both(exe), [null, "RJ333333"]); assert.match(exe.reason, /启动程序名/);
  // 只是包含作品名（主标题），不完全一样
  const th = matchFolder(found("タナトス 汉化版"), games, {});
  assert.deepEqual(both(th), [null, "RJ000002"]); assert.match(th.reason, /不完全一样/);
  // 作品名只是一个英文单词
  const ls = matchFolder(found("Lesson"), games, {});
  assert.deepEqual(both(ls), [null, "RJ000003"]); assert.match(ls.reason, /一个词/);
  // 只对上了主标题（系列名）
  assert.deepEqual(both(matchFolder(found("美少女万華鏡"), games, {})), [null, "RJ999999"]);
});

test("启动程序名和作品全名一字不差（只有大小写可以不同）就关联，文件夹叫什么都不要紧；差一个字、下划线代替空格、带版本号都只是「可能是」", () => {
  const ex = (stem, o = {}) => matchFolder(found("4440", ["4440", stem], { exes: [`X:\\4440\\${stem}.exe`], ...o }), games, {});
  assert.deepEqual(ex("Kinjo no Hitozuma"), { game: games[3], why: "Kinjo no Hitozuma", rule: "exe" });
  assert.equal(ex("KINJO NO HITOZUMA").rule, "exe");
  assert.equal(ex("近所の人妻").rule, "exe");
  for (const near of ["Kinjo no Hitozum", "Kinjo_no_Hitozuma", "Kinjo no Hitozuma v1.02", "Kinjo no Hitozuma（汉化）", "Kinjo  no Hitozuma"]) {
    assert.equal(ex(near).game, null, near);
  }
  // 全角半角不同也不算
  assert.equal(ex("近所の人妻２").game, null);
  // 文件夹里的 RJ 号指向别的作品：只给「可能是」
  assert.equal(matchFolder(found("RJ222222", ["RJ222222", "Kinjo no Hitozuma"], { exes: ["X:\\RJ222222\\Kinjo no Hitozuma.exe"] }), games, {}).game, null);
  // 图鉴里不止一部叫这个名字：只给「可能是」
  const twin = [...games, { ...games[3], id: "RJ333334" }];
  assert.equal(matchFolder(found("4440", ["4440", "Kinjo no Hitozuma"], { exes: ["X:\\4440\\Kinjo no Hitozuma.exe"] }), twin, {}).game, null);
  // 通用的启动程序名不算（作品就叫 Start 也一样）
  assert.equal(matchFolder(found("x", ["x", "Start"], { exes: ["X:\\x\\Start.exe"] }), [...games, { ...games[3], id: "RJ1", title: "Start", names: { ja: "Start", zh: "", en: "" } }], {}).game, null);
});

test("RJ / VJ 号：文件夹名、启动程序名、游戏这层的文件名里只有一个号、图鉴里有、名字不指向别的作品，才按号关联", () => {
  assert.deepEqual(matchFolder(found("whatever", ["whatever", "rj111111_x"]), games, {}), { game: games[0], why: "RJ111111", rule: "rj" });
  assert.equal(id(matchFolder(found("x", ["x"], { rj: "RJ333333", rjs: ["RJ333333"] }), games, {})), "RJ333333");
  assert.equal(id(matchFolder(found("VJ012345_pro"), games, {})), "VJ012345");
  // 号和名字指向不同的作品
  const clash = matchFolder(found("[RJ333333] Velmorin Saga"), games, {});
  assert.deepEqual(both(clash), [null, "RJ333333"]); assert.match(clash.reason, /指向不同的作品/);
  // 号在图鉴里没有、名字却像另一部：不能只凭名字认
  const unknown = matchFolder(found("[RJ999998] Velmorin Saga"), games, {});
  assert.deepEqual(both(unknown), [null, "RJ111111"]); assert.match(unknown.reason, /图鉴里没有/);
  // 纯数字的文件夹名不算号：只给「可能是」；图鉴里没有这个号就什么都没有
  const digits = matchFolder(found("222222"), games, {});
  assert.deepEqual(both(digits), [null, "RJ222222"]); assert.match(digits.reason, /一串数字/);
  assert.equal(id(matchFolder(found("01412576"), games, {})), null);
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
  // 够长的单词整个对上也只算像
  const gr = matchFolder(found("Grimoire"), games, {});
  assert.deepEqual(both(gr), [null, "RJ121212"]); assert.match(gr.reason, /一个词/);
  assert.equal(matchFolder(found("GoodbyeVelmorin"), games, {}).game, null);
  // Kaiju Princess 2 是续作：只给 guess
  const seq = matchFolder(found("暴食公主", ["暴食公主", "Kaiju Princess 2 v1.04"]), games, {});
  assert.equal(seq.game, null); assert.equal(seq.guess.id, "RJ888888");
  assert.equal(id(matchFolder(found("Kaiju Princess v1.04"), games, {})), "RJ888888");
  // 主标题一样、副标题不一样：同系列另一部，只给 guess；副标题一样就关联
  const sib = matchFolder(found("（1）美少女万華鏡 -呪われし伝説の少女-"), games, {});
  assert.equal(sib.game, null); assert.equal(sib.guess.id, "RJ999999");
  assert.match(sib.reason, /同系列/);
  assert.equal(id(matchFolder(found("美少女万華鏡 -理と迷宮の少女- 汉化"), games, {})), "RJ999999");
  // 短的主标题藏在一长串别的名字里：只给 guess
  const th = matchFolder(found("夢想と心転のカタラアタナトス"), games, {});
  assert.equal(th.game, null); assert.equal(th.guess.id, "RJ000002");
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
  const f = { dir: "X:\\Velmorin Saga", name: "Velmorin Saga", rj: null, exes: [] };
  assert.equal(id(matchFolder(f, games, {})), "RJ111111");
  assert.equal(norm("【汉化】Velmorin Ver1.2"), "velmorin");
});

test("纯英文数字、不到 7 个字母的短作品名只认完全一样的，一样了也只是「可能是」（单个词）；中日文短名照常比", () => {
  // NatsuiroLesson 不能认成「lesson」
  assert.deepEqual(matchFolder(found("NatsuiroLesson"), games, {}), { game: null });
  assert.deepEqual(matchFolder(found("Piano Lesson 2"), games, {}), { game: null });
  assert.deepEqual(both(matchFolder(found("Lesson"), games, {})), [null, "RJ000003"]);
  assert.deepEqual(both(matchFolder(found("【汉化】lesson v1.2"), games, {})), [null, "RJ000003"]);
  assert.equal(id(matchFolder(found("近所の人妻 汉化"), games, {})), "RJ333333");
});

test("扫描结果：同一部作品的几个文件夹（版本）都认得出时，先认出的当主版本，后来的记成另一个版本；以前的主版本不挪", () => {
  const a = found("Velmorin Saga"), b = found("Velmorin Saga", ["Velmorin Saga"], { dir: "X:\\Other\\Velmorin Saga" });
  // 这次扫描先认出的是主版本（写明凭什么），后来的是另一个版本
  let r = planScan([a, b], games, {});
  assert.deepEqual(r.link.map(([g, f, rule, as]) => [g.id, f.dir, rule, as]), [["RJ111111", "X:\\Velmorin Saga", "folder", "main"], ["RJ111111", "X:\\Other\\Velmorin Saga", "folder", "other"]]);
  assert.deepEqual(r.unmatched, []);
  // 以前关联在 b 上：b 照旧是主版本，a 记成另一个版本
  const local = { RJ111111: { dir: "X:\\Other\\Velmorin Saga", exe: "X:\\Other\\Velmorin Saga\\Game.exe" } };
  r = planScan([a, b], games, local);
  assert.deepEqual(r.link.map(([g, f, , as]) => [g.id, f.dir, as]), [["RJ111111", "X:\\Velmorin Saga", "other"], ["RJ111111", "X:\\Other\\Velmorin Saga", "main"]]);
  // 证据不够的（只是「可能是」）还是进「没认出」
  r = planScan([found("Velmorin Saga 汉化 外传版")], games, local);
  assert.deepEqual(r.link, []);
  // 已经是另一个版本的文件夹：照旧算这部的另一个版本
  r = planScan([a], games, { RJ111111: { ...local.RJ111111, others: [{ dir: "x:\\velmorin saga", exe: "X:\\Velmorin Saga\\Game.exe" }] } });
  assert.deepEqual(r.link.map(([g, , rule, as, from]) => [g.id, rule, as, from]), [["RJ111111", undefined, "other", "x:\\velmorin saga"]]);
  // 以前关联在包装层上、这次扫到里面那层：算同一个文件夹，照旧关联
  const inner = found("www", ["www", "Velmorin Saga"], { dir: "X:\\Velmorin Saga\\www", top: "X:\\Velmorin Saga" });
  r = planScan([inner], games, { RJ111111: { dir: "X:\\Velmorin Saga", exe: "X:\\Velmorin Saga\\Game.exe" } });
  assert.equal(r.link[0][1].dir, "X:\\Velmorin Saga\\www");
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
    [["Velmorin Saga", "タナトス 汉化版"], null, "RJ111111"], // 两个候选各说各的：不关联，「可能是」对上长的那部
  ];
  for (const [names, game, guess] of cases) {
    // 候选都当引擎标题，先后顺序不影响它是从哪来的
    const all = [...perms(names).map(ns => matchFolder(found(ns[0], ns, { titles: ns }), games, {})), matchFolder(found(names[0], names, { titles: names }), [...games].reverse(), {})];
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

// —— 证据互相矛盾时只给「可能是」（误认比漏认更糟） ——
const g2 = [
  game("RJ01402070", "SUMMER ~夏の14日~", { names: { ja: "SUMMER ~夏の14日~", zh: "SUMMER ~夏日14天~", en: "SUMMER ~14 Days of Summer~" }, mt: ["zh", "en"] }),
  game("RJ500001", "マインド・リュダ After day 1"),
  game("RJ500002", "さがしもの"),
  game("RJ190251", "King Exit"),
  game("RJ297120", "魔法少女セレスフォニア"),
  game("RJ500003", "美少女万華鏡 -理と迷宮の少女-"),
  game("RJ500004", "美少女万華鏡 -呪われし伝説の少女-"),
  game("RJ500005", "侵蝕のヒプノシス", { names: { ja: "侵蝕のヒプノシス", zh: "侵蚀的催眠", en: "Hypnosis of Erosion" }, mt: ["zh", "en"] }),
  game("RJ500006", "Hypnosis Academy"),
  game("RJ01187104", "桜御前", { names: { ja: "桜御前", zh: "樱御前", en: "Sakura Gozen" }, mt: ["zh", "en"] }),
  game("RJ283778", "優艶の花 続 淫縛の館", { aliases: ["Yuen-Zoku"] }),
  game("RJ325126", "満車率300%"),
  game("RJ01058687", "無気力天使ちゃんは性活学科の単位が足りない…。"),
  game("RJ431925", "ハチナ怪異譚"),
  game("RJ01064183", "穢神楽～Aikagura～", { names: { ja: "穢神楽～Aikagura～", zh: "", en: "Aikagura" } }),
  game("RJ302497", "オプスキュリテ・マジー ～ 淫欲冒険者と王家の血", { names: { ja: "オプスキュリテ・マジー ～ 淫欲冒険者と王家の血", zh: "", en: "Obscurite Magie ~The Lusty Adventurer and the Royal Blood~" } }),
  game("RJ01002988", "セイントギアフォース"),
];
const m2 = (name, names, o) => matchFolder(found(name, names, o), g2, {});

test("短名字完全一样也要过副标题这关；反过来包含、不在词的边界上的只算像", () => {
  // SUMMER-田舎の性活 里还有个 Summer（exe 名）：副标题和「夏の14日」对不上
  assert.deepEqual(both(m2("SUMMER-田舎の性活", ["SUMMER-田舎の性活", "Summer"])), [null, "RJ01402070"]);
  // 本篇的文件夹不能认成后日谈；「なつのさがしもの」里的「さがしもの」不是一个词
  assert.deepEqual(both(m2("マインド・リュダ ver1.36")), [null, "RJ500001"]);
  assert.deepEqual(both(m2("なつのさがしもの")), [null, "RJ500002"]);
  // 在词的边界上（空格、去掉的汉化标记、换了一种字）照样认
  assert.deepEqual(both(m2("さがしもの 汉化版")), ["RJ500002", null]);
  assert.deepEqual(both(m2("さがしもの汉化")), ["RJ500002", null]);
});

test("不同的候选名字各说各的不自动关联；一个是另一个的一部分不算", () => {
  assert.deepEqual(both(m2("KingExit", ["KingExit", "魔法少女セレスフォニア"])), [null, "RJ297120"]);
  // 只对上几部共用的系列名：只算像；外层是系列名、里面写全了：认里面这部
  assert.equal(m2("美少女万華鏡").game, null);
  assert.deepEqual(both(m2("美少女万華鏡 -理と迷宮の少女-", ["美少女万華鏡 -理と迷宮の少女-", "美少女万華鏡"])), ["RJ500003", null]);
  // 副标题有一个对得上就不算「同系列另一部」（另一个是汉化组自己翻的）；但只对上了主标题，还是「可能是」
  const om = m2("Obscurite Magie The Blood of Kings", ["Obscurite Magie The Blood of Kings", "Obscurite Magie ～ 淫欲冒険者と王家の血", "Obscurite Magie ～ 强欲冒险家与王室之血"]);
  assert.deepEqual(both(om), [null, "RJ302497"]); assert.match(om.reason, /不完全一样/);
  // 英文全名只是一个词（Aikagura）：完全一样也只是「可能是」
  assert.deepEqual(both(m2("穢神楽", ["穢神楽", "Aikagura"], { titles: ["Aikagura"] })), [null, "RJ01064183"]);
  // 64bit 不是续作数字
  assert.deepEqual(both(m2("ハチナ怪異譚_64bit版", ["ハチナ怪異譚_64bit版", "ハチナ怪異譚"])), ["RJ431925", null]);
});

test("续作记号、DLC：名字对上了也只给「可能是」", () => {
  assert.deepEqual(both(m2("満車率300%", ["満車率300%", "Mansha300_2"])), [null, "RJ325126"]);
  assert.deepEqual(both(m2("TIANSHI", ["TIANSHI", "天使dlc", "無気力天使ちゃんは性活学科の単位が足りない…。居残りVer1.0"])), [null, "RJ01058687"]);
  assert.deepEqual(both(m2("満車率300%")), ["RJ325126", null]);
});

test("RJ 号：前后都要有边界；几个号对不上、号和名字对不上，只给「可能是」", () => {
  assert.deepEqual(rjCodes("xxRJ01002988 RJ010029889"), []);
  assert.deepEqual(rjCodes("[RJ01002988]体験版 rj123456 RJ01002988"), ["RJ01002988", "RJ123456"]);
  assert.equal(m2("xxRJ01002988").game, null);
  assert.deepEqual(both(m2("x", ["x"], { rjs: ["RJ01002988"] })), ["RJ01002988", null]);
  assert.deepEqual(both(m2("x", ["x"], { rj: "RJ01002988", rjs: ["RJ01002988", "RJ325126"] })), [null, "RJ01002988"]);
  assert.deepEqual(both(m2("RJ01002988 King Exit")), [null, "RJ01002988"]);
  // 纯数字的文件夹名（没写 RJ）只给「可能是」；引擎标题已经认出是同一部的照样关联
  assert.deepEqual(both(m2("01002988", ["01002988", "King Exit"])), [null, "RJ01002988"]);
  assert.deepEqual(both(m2("01002988")), [null, "RJ01002988"]);
  assert.deepEqual(both(m2("01002988", ["01002988", "セイントギアフォース"], { titles: ["セイントギアフォース"] })), ["RJ01002988", null]);
});

test("机翻名只给「可能是」，完全一样的排在单个词前面；三个字的中日文全名只认完全一样的；别名和作品名一样用", () => {
  assert.deepEqual(both(m2("侵蚀的催眠")), [null, "RJ500005"]);
  assert.deepEqual(both(m2("x", ["Hypnosis", "侵蚀的催眠"])), [null, "RJ500005"]);
  assert.deepEqual(both(m2("桜御前(ver1.10)")), ["RJ01187104", null]);
  assert.deepEqual(both(m2("桜御前_v105", ["桜御前_v105", "樱花御前", "桜御前(ver1.05)"], { titles: ["桜御前(ver1.05)"] })), ["RJ01187104", null]);
  assert.deepEqual(m2("桜御前の秘密"), { game: null });
  assert.deepEqual(both(m2("09191010", ["09191010", "优艶の花", "Yuen-Zoku"], { titles: ["Yuen-Zoku"] })), ["RJ283778", null]);
  // 编码是猜的标题（后端 unsure）只给「可能是」
  assert.deepEqual(both(m2("x", ["x", "Yuen-Zoku"], { unsure: ["Yuen-Zoku"] })), [null, "RJ283778"]);
});

test("路径比较：不分大小写，/ 和 \\ 一样；工具 exe 只看游戏文件夹里面的路径", () => {
  assert.ok(sameDir("X:/Games/A/", "x:\\games\\a") && under("x:/games/a/b", "X:\\Games\\A"));
  assert.ok(helperExe("X:\\G\\Tool\\nwjc.exe", "X:\\G") && helperExe("X:\\G\\Tool\\nw.exe", "x:/g"));
  assert.ok(helperExe("X:\\G\\MTool.exe", "X:\\G") && helperExe("X:\\G\\__MACOSX\\._Game.exe", "X:\\G"));
  assert.ok(!helperExe("X:\\G\\nw.exe", "X:\\G") && !helperExe("X:\\G\\MTool_Game.exe", "X:\\G") && !helperExe("X:\\Tools\\G\\Game.exe", "X:\\Tools\\G"));
});

test("检查旧关联：不自动改，列出启动程序像工具的、证据指向别处的、文件夹写明是别的名字的、同系列另一部的", () => {
  const f = (dir, names, o = {}) => ({ dir, name: names[0], names, rj: null, exes: [`${dir}\\Game.exe`], ...o });
  const found = [
    f("X:\\Syn", ["Syn", "セイントギアフォース"], { exes: ["X:\\Syn\\PS.exe"] }),
    f("X:\\KingExit", ["KingExit", "King Exit"]),
    f("X:\\Black", ["怪奇異聞録BLACKOUT", "Game", "怪奇異聞録BLACKOUT"], { titles: ["kurotaitsu", "怪奇異聞録BLACKOUT"] }),
    f("X:\\渎神圣女", ["渎神圣女", "Game"]),
    f("X:\\万华镜", ["美少女万华镜 -罪与罚的少女-", "美少女万華鏡"]),
    f("X:\\Kept", ["Kept", "King Exit"]),
  ];
  const local = {
    RJ01002988: { dir: "X:\\Syn", exe: "X:\\Syn\\Tool\\nwjc.exe" },
    RJ297120: { dir: "x:\\kingexit\\", exe: "X:\\KingExit\\Game.exe" },
    RJ500002: { dir: "X:\\Black", exe: "X:\\Black\\Game.exe" },
    RJ500001: { dir: "X:\\渎神圣女", exe: "X:\\渎神圣女\\Game.exe" },
    RJ500003: { dir: "X:\\万华镜", exe: "X:\\万华镜\\Game.exe" },
    RJ325126: { dir: "X:\\Kept", exe: "X:\\Kept\\Game.exe", kept: "X:\\Kept\nX:\\Kept\\Game.exe" },
  };
  const games3 = g2.map(g => (g.id === "RJ500003" ? { ...g, names: { ...g.names, zh: "美少女万华镜 -理与迷宫的少女-" }, mt: ["zh"] } : g));
  const s = reviewLinks(found, games3, local);
  assert.deepEqual(s, [
    { id: "RJ01002988", dir: "X:\\Syn", exe: "X:\\Syn\\PS.exe" },
    { id: "RJ297120", dir: "x:\\kingexit\\", to: "RJ190251", why: "King Exit" },
    { id: "RJ500002", dir: "X:\\Black", why: "怪奇異聞録BLACKOUT" },
    { id: "RJ500003", dir: "X:\\万华镜", why: "美少女万华镜 -罪与罚的少女-" },
  ]);
  // 扫描照旧保留旧关联（不悄悄改关联）
  const { link } = planScan(found, games3, local);
  assert.ok(link.some(([g, x]) => g.id === "RJ297120" && x.dir === "X:\\KingExit"));
});

test("重新扫描时原来的启动程序像工具也先留着（交给「关联可能有误」）；路径大小写不同也算同一个文件夹", async () => {
  const { data, linkFolder } = await import("../src/store.ts");
  data.local = { A: { dir: "X:\\Syn", exe: "X:\\Syn\\Tool\\nwjc.exe" }, B: { dir: "x:\\other\\", exe: "x:\\other\\b.exe" } };
  data.unmatched = [{ dir: "x:\\syn", name: "Syn", names: [], rj: null, exes: [] }];
  data.suspects = [{ id: "A", dir: "X:\\Syn", exe: "X:\\Syn\\PS.exe" }];
  data.marks = {};
  linkFolder("A", { dir: "x:\\SYN", name: "Syn", names: ["Syn"], rj: null, exes: ["X:\\Syn\\PS.exe"] });
  assert.equal(data.local.A.exe, "X:\\Syn\\Tool\\nwjc.exe");
  assert.deepEqual(data.unmatched, []);
  assert.deepEqual(data.suspects, []);
  // 别的作品关联着同一个文件夹（写法不同）：那条关联去掉
  linkFolder("C", { dir: "X:\\Other", name: "Other", names: ["Other"], rj: null, exes: ["X:\\Other\\c.exe"] });
  assert.equal(data.local.B, undefined);
  assert.equal(data.local.C.exe, "X:\\Other\\c.exe");
});

test("关联前算出会替换掉什么：作品原来的文件夹、原来关联着这个文件夹的作品（路径写法不同也算）", async () => {
  const { replacing } = await import("../src/match.ts");
  const local = { A: { dir: "X:\\A", exe: "X:\\A\\a.exe" }, B: { dir: "x:/b/", exe: "x:/b/b.exe" }, C: { playSeconds: 5 } };
  assert.deepEqual(replacing("A", "X:\\B", local), { from: "X:\\A", owner: "B" });
  assert.deepEqual(replacing("A", "x:\\a\\", local), {});
  assert.deepEqual(replacing("C", "X:\\New", local), {});
});

test("别人的文件夹结构：汉化名、带版本号的重新打包、合集、Steam、DLsite Play、解压出来的包装层", () => {
  const f = (dir, names, o = {}) => ({ dir, name: names[0], names, rj: null, exes: [`${dir}/Game.exe`], titles: [], ...o });
  const m = (...a) => both(matchFolder(f(...a), games, {}));
  // 只有汉化组起的中文名（图鉴里是机翻名或没有）：只给「可能是」；引擎标题是原名就关联
  assert.deepEqual(m("X:/聖剣と魔法少女汉化版", ["聖剣と魔法少女汉化版"]), [null, null]);
  assert.deepEqual(m("X:/圣剑与魔法少女", ["圣剑与魔法少女", "聖なる剣と魔法少女"], { titles: ["聖なる剣と魔法少女"] }), ["RJ444444", null]);
  // 带版本号、发布标记的重新打包
  assert.deepEqual(m("X:/Velmorin_Saga_Ver1.05", ["Velmorin_Saga_Ver1.05"]), ["RJ111111", null]);
  assert.deepEqual(m("X:/Velmorin Saga (DL版) v1.0.3", ["Velmorin Saga (DL版) v1.0.3"]), ["RJ111111", null]);
  assert.deepEqual(m("X:/[RJ111111][汉化] 随便起的名字 v2", ["[RJ111111][汉化] 随便起的名字 v2"]), ["RJ111111", null]);
  // 合集：里面每一部单独认；整个合集当成一部时只有合集名，最多「可能是」
  assert.deepEqual(m("X:/全家桶/Velmorin Saga", ["Velmorin Saga"]), ["RJ111111", null]);
  assert.equal(m("X:/美少女万華鏡 合集", ["美少女万華鏡 合集", "Game"])[0], null);
  // Steam：文件夹名或 Unity 的产品名
  assert.deepEqual(m("D:/SteamLibrary/steamapps/common/Kaiju Princess", ["Kaiju Princess", "KaijuPrincess"], { exes: ["D:/SteamLibrary/steamapps/common/Kaiju Princess/KaijuPrincess.exe"], titles: ["Kaiju Princess"] }), ["RJ888888", null]);
  // DLsite Play / 下载器：文件夹按编号起名
  assert.deepEqual(m("C:/Users/me/DLsite Play/RJ333333/Game", ["Game", "RJ333333"], { rjs: ["RJ333333"] }), ["RJ333333", null]);
  assert.deepEqual(m("C:/Games/RJ333333_近所の人妻", ["RJ333333_近所の人妻"]), ["RJ333333", null]);
  // 解压出来的包装层带着压缩包扩展名
  assert.deepEqual(m("X:/Velmorin Saga.7z/123", ["123", "Velmorin Saga.7z"]), ["RJ111111", null]);
  assert.deepEqual(m("X:/Velmorin Saga.zip/Velmorin Saga", ["Velmorin Saga", "Velmorin Saga.zip"]), ["RJ111111", null]);
});
