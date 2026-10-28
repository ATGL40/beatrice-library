import test from "node:test";
import assert from "node:assert/strict";
import { cleanMarks, exportable, filterMarks, NOTE_MAX, pickMark } from "../src/marks.ts";

const ALL = ["want", "have", "played", "fav", "score", "note"];
const marks = {
  a: { status: "played", fav: true, score: 4, note: " 好玩 " },
  b: { status: "want", fav: false, score: 0, note: "" },
  c: { status: "", fav: false, score: 0, note: "只有评论" },
  d: { status: "have", fav: false, score: 3 },
};

test("全选时原样导出（评论去掉首尾空白）", () => {
  const out = filterMarks(marks, ALL, []);
  assert.deepEqual(Object.keys(out).sort(), ["a", "b", "c", "d"]);
  assert.equal(out.a.note, "好玩");
  assert.equal(out.b.note, undefined);
});

test("不导出评论：只有评论的作品整部不导出", () => {
  const out = filterMarks(marks, ALL.filter(k => k !== "note"), []);
  assert.deepEqual(Object.keys(out).sort(), ["a", "b", "d"]);
  assert.equal(out.a.note, undefined);
});

test("不导出「想玩」：状态清空，什么都不剩的作品不导出", () => {
  const out = filterMarks(marks, ALL.filter(k => k !== "want"), []);
  assert.equal(out.b, undefined);
  assert.equal(out.a.status, "played");
});

test("只导出星级", () => {
  const out = filterMarks(marks, ["score"], []);
  assert.deepEqual(out, { a: { status: "", fav: false, score: 4 }, d: { status: "", fav: false, score: 3 } });
});

test("取消勾选的作品不导出，exportable 不管 skip", () => {
  assert.deepEqual(Object.keys(filterMarks(marks, ALL, ["a", "c"])).sort(), ["b", "d"]);
  assert.equal(Object.keys(exportable(marks, ALL)).length, 4);
});

test("pickMark 不选任何类型返回 null", () => {
  assert.equal(pickMark(marks.a, []), null);
});

test("cleanMarks 丢掉不合法的字段和不认识的作品", () => {
  const raw = {
    a: { status: "played", fav: true, score: 5, note: "x".repeat(NOTE_MAX + 50) },
    b: { status: "hacked", fav: "yes", score: 9, note: 42 },
    c: { status: "want", score: 2.5 },
    z: { status: "have" },
    e: "not an object",
  };
  const out = cleanMarks(raw, id => id !== "z");
  assert.equal(out.a.note.length, NOTE_MAX);
  assert.equal(out.a.score, 5);
  assert.equal(out.b, undefined);
  assert.deepEqual(out.c, { status: "want", fav: false, score: 0 });
  assert.equal(out.z, undefined);
  assert.equal(out.e, undefined);
  assert.deepEqual(cleanMarks(null), {});
});

import { FILE_KIND, marksHtml, parseMarksFile } from "../src/marks.ts";

const file = {
  kind: FILE_KIND, version: 1, name: "<小明>", exported: "2026-10-27",
  marks: {
    RJ1: { status: "played", fav: true, score: 4, note: "好玩</script><script>alert(1)</script>\n第二行" },
    RJ2: { status: "want", fav: false, score: 0 },
  },
};
const names = id => ({ name: id === "RJ1" ? "名字 & <b>" : "二号", orig: id === "RJ1" ? "原名" : "" });
const APP = "碧翠子禁书库";

test("html 导出再读回来，内容和原来一样", () => {
  const html = marksHtml(file, names, APP);
  assert.deepEqual(parseMarksFile(html), file);
});

test("html 里的文字都转义，评论里的 </script> 不会结束数据段", () => {
  const html = marksHtml(file, names, APP);
  assert.ok(!html.includes("名字 & <b>"));
  assert.ok(html.includes("名字 &amp; &lt;b&gt;"));
  assert.ok(html.includes("&lt;小明&gt;的评分"));
  assert.equal(html.split("</script>").length, 2); // 只有数据段自己那一个
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!/(src|href)=/.test(html)); // 不引用外部资源
});

test("html 的标题和页脚用导出时语言的软件名", () => {
  const html = marksHtml(file, names, "Beatrice Library");
  assert.ok(html.includes("<title>&lt;小明&gt;的黄油评分 · Beatrice Library</title>"));
  assert.ok(html.includes("<footer>用Beatrice Library导出。"));
});

test("json 文件也能读，带 BOM 也行", () => {
  assert.deepEqual(parseMarksFile("\uFEFF" + JSON.stringify(file, null, 1)), file);
});

test("导出用新名字，改名前（v0.2.x）导出的旧文件也能读", () => {
  assert.equal(FILE_KIND, "beatrice-marks");
  assert.ok(marksHtml(file, names, APP).includes('id="beatrice-marks"'));
  const old = { ...file, kind: "galshelf-marks" };
  assert.deepEqual(parseMarksFile(JSON.stringify(old)), old);
  const oldHtml = marksHtml(file, names, APP).replace('id="beatrice-marks"', 'id="galshelf-marks"').replace('"kind":"beatrice-marks"', '"kind":"galshelf-marks"');
  assert.deepEqual(parseMarksFile(oldHtml), old);
});

test("不是评分文件就报错", () => {
  assert.throws(() => parseMarksFile("<html><body>hi</body></html>"), /不是碧翠子禁书库/);
  assert.throws(() => parseMarksFile('{"kind":"other","marks":{}}'), /不是碧翠子禁书库/);
  assert.throws(() => parseMarksFile("{broken"), /不是碧翠子禁书库/);
});

import { EXTRA_MAX, EXTRA_TEXT_MAX } from "../src/marks.ts";

test("导入时不认识的字段留着，但只留基本类型、字符串截短", () => {
  const raw = JSON.parse(`{"a": {"status": "played", "score": 3, "hours": 12, "done": true, "tag": "${"y".repeat(500)}",
    "obj": {"x": 1}, "arr": [1], "__proto__": {"polluted": 1}}}`);
  const out = cleanMarks(raw);
  assert.equal(out.a.hours, 12);
  assert.equal(out.a.done, true);
  assert.equal(out.a.tag.length, EXTRA_TEXT_MAX);
  assert.equal("obj" in out.a, false);
  assert.equal("arr" in out.a, false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out.a), Object.prototype);
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(cleanMarks({ a: { score: 1, ...many } }).a).length, 3 + EXTRA_MAX);
});

test("导出只带认识的字段", () => {
  const out = filterMarks({ a: { status: "played", fav: false, score: 2, note: "n", hours: 12, secret: "x" } }, ALL, []);
  assert.deepEqual(Object.keys(out.a).sort(), ["fav", "note", "score", "status"]);
});

import { friendFromFile, makeMarksFile } from "../src/marks.ts";

// 一份带路径和设置的「本地数据」，用来证明导出导入都不会把这些带出去 / 写进来
const localData = {
  marks: {
    RJ1: { status: "played", fav: true, score: 4, note: "好玩", dir: "D:\\Games\\RJ1", exe: "C:/x/Game.exe", hours: 3 },
    RJ2: { status: "want", fav: false, score: 0 },
  },
  local: { RJ1: { dir: "D:\\Games\\RJ1", exe: "D:\\Games\\RJ1\\Game.exe" } },
  roots: ["D:\\Games", "E:\\More"],
  unmatched: [{ dir: "E:\\More\\00001", name: "00001", rj: null, exes: [] }],
  myName: "小明", mtool: true, ui: { lang: "zh" }, export: { kinds: ALL, skip: [], format: "html" },
};
const PATHISH = /[A-Za-z]:[\\/]|\\\\|"(local|roots|unmatched|mtool|ui|export|dir|exe|myName)"/;

test("导出的 json 和 html 里没有设置、没有任何文件路径", () => {
  const file = makeMarksFile(localData.marks, ALL, [], localData.myName, "2026-10-27");
  assert.deepEqual(Object.keys(file).sort(), ["exported", "kind", "marks", "name", "version"]);
  const json = JSON.stringify(file, null, 1);
  assert.ok(!PATHISH.test(json), json);
  const html = marksHtml(file, id => ({ name: id, orig: "" }), APP);
  assert.ok(!PATHISH.test(html));
  assert.ok(html.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`));
  assert.equal(parseMarksFile(html).marks.RJ1.note, "好玩");
});

test("导入别人的文件只变成一条朋友记录，文件里的 local / roots 不会被收进来", () => {
  const evil = {
    kind: FILE_KIND, version: 1, name: "坏人", exported: "2026-10-27",
    local: { RJ1: { dir: "C:\\Windows", exe: "C:\\Windows\\evil.exe" } },
    roots: ["C:\\"], myName: "x", mtool: true,
    marks: { RJ1: { status: "have", score: 2, local: { dir: "C:\\" }, roots: ["C:\\"] } },
  };
  const f = friendFromFile(parseMarksFile(JSON.stringify(evil)), "9", "备用名");
  assert.deepEqual(Object.keys(f).sort(), ["id", "marks", "name"]);
  assert.deepEqual(f.marks.RJ1, { status: "have", fav: false, score: 2 }); // 对象 / 数组形式的未知字段不收
  assert.equal(friendFromFile({ ...evil, name: "" }, "9", "备用名").name, "备用名");
});

import { mergeMine } from "../src/marks.ts";

test("合并「这是我的」：空的补上，有值的保留并算冲突", () => {
  const mine = {
    a: { status: "", fav: false, score: 0, note: "" },
    b: { status: "played", fav: false, score: 4, note: "我的看法" },
  };
  const incoming = {
    a: { status: "have", fav: true, score: 3, note: "补上的评论" },
    b: { status: "want", fav: false, score: 2, note: "文件里的看法" },
  };
  const r = mergeMine(mine, incoming);
  assert.deepEqual(r.marks.a, { status: "have", fav: true, score: 3, note: "补上的评论" });
  assert.deepEqual(r.marks.b, mine.b); // 状态、星级、评论都不覆盖
  assert.equal(r.filled, 1);
  assert.equal(r.conflicts, 3); // status、score、note 各一处
  assert.equal(mine.a.status, ""); // 不改原来的对象
});

test("合并：收藏 false 会被补成 true，true 不会变回 false", () => {
  const r = mergeMine({ a: { status: "", fav: false, score: 0 }, b: { status: "", fav: true, score: 0 } },
    { a: { fav: true }, b: { fav: false, status: "want" } });
  assert.equal(r.marks.a.fav, true);
  assert.equal(r.marks.b.fav, true);
  assert.equal(r.marks.b.status, "want");
  assert.equal(r.conflicts, 0); // 文件里的 false 是「空」，不算冲突
});

test("合并：新作品整条加进来，评论只有空白算空", () => {
  const r = mergeMine({ a: { status: "played", fav: false, score: 5, note: "   " } },
    { a: { note: "真正的评论" }, n: { status: "want", fav: false, score: 0, note: "  " } });
  assert.equal(r.marks.a.note, "真正的评论");
  assert.deepEqual(r.marks.n, { status: "want", fav: false, score: 0 });
  assert.equal(r.filled, 2);
  assert.equal(r.conflicts, 0);
});

test("合并：不认识的字段只在自己没有时才补，对象和数组不收", () => {
  const r = mergeMine({ a: { status: "have", fav: false, score: 0, hours: 5 } },
    { a: { status: "have", hours: 9, mood: "好", obj: { x: 1 } } }); // 只有不认识字段的条目 cleanMarks 本来就不收
  assert.equal(r.marks.a.hours, 5);
  assert.equal(r.marks.a.mood, "好");
  assert.equal("obj" in r.marks.a, false);
  assert.equal(r.conflicts, 1);
  assert.equal(r.filled, 1);
});

test("合并：文件里没东西可补时什么都不变", () => {
  const mine = { a: { status: "played", fav: true, score: 4, note: "x" } };
  const r = mergeMine(mine, { a: { status: "played", fav: true, score: 4, note: "x" }, zzz: "坏数据" });
  assert.deepEqual(r.marks, mine);
  assert.equal(r.filled, 0);
  assert.equal(r.conflicts, 0);
});

test("评分文件版本比 1 大：提示要新版本的软件", () => {
  assert.throws(() => parseMarksFile(JSON.stringify({ kind: FILE_KIND, version: 2, name: "x", marks: {} })), /新版本/);
});

import { makeSubmission, okLink, upsertFriend, voteProblem, SUBMIT_KIND } from "../src/marks.ts";

test("导入同名朋友的评分文件：更新那个朋友，不重复加", () => {
  const a = { id: "1", name: "小明", marks: { x: { status: "", fav: false, score: 3 } } };
  const b = { id: "2", name: "小红", marks: {} };
  const r1 = upsertFriend([a, b], { id: "9", name: "小明", marks: { y: { status: "played", fav: false, score: 5 } } });
  assert.equal(r1.updated, true);
  assert.equal(r1.friends.length, 2);
  assert.equal(r1.friends[0].id, "1");
  assert.deepEqual(Object.keys(r1.friends[0].marks), ["y"]);
  const r2 = upsertFriend([a], { id: "9", name: "小刚", marks: {} });
  assert.equal(r2.updated, false);
  assert.deepEqual(r2.friends.map(f => f.id), ["1", "9"]);
});

test("提交文件：只有 kind / version / app / catalog / ratings / votes，星级只留 1–5，票要合格", () => {
  const f = makeSubmission("0.3.0", "2026-10-28", { a: 5, b: 0, c: 3.5, d: 1 }, {
    n1: { vote: "support" },
    n2: { vote: "support", reason: "  很好  " },
    n3: { vote: "oppose", reason: "太短" },
    n4: { vote: "oppose", reason: "这是一条超过二十个字的反对理由，写得够长了吧" },
    n5: { vote: "maybe" },
  });
  assert.deepEqual(Object.keys(f), ["kind", "version", "app", "catalog", "ratings", "votes"]);
  assert.equal(f.kind, SUBMIT_KIND);
  assert.deepEqual(f.ratings, { a: 5, d: 1 });
  assert.deepEqual(f.votes, { n1: { vote: "support" }, n2: { vote: "support", reason: "很好" }, n4: { vote: "oppose", reason: "这是一条超过二十个字的反对理由，写得够长了吧" } });
});

test("反对票的理由至少 20 个字（按字算，去掉首尾空白）", () => {
  assert.ok(voteProblem({ vote: "oppose" }));
  assert.ok(voteProblem({ vote: "oppose", reason: "  一二三四五六七八九十一二三四五六七八九  " }));
  assert.equal(voteProblem({ vote: "oppose", reason: "一二三四五六七八九十一二三四五六七八九十" }), "");
  assert.equal(voteProblem({ vote: "support" }), "");
});

test("交给系统打开的链接：只有 https 和写给提交邮箱的 mailto", () => {
  assert.ok(okLink("https://github.com/ATGL40/beatrice-library-data/issues/new?template=submit-ratings.yml"));
  assert.ok(okLink("mailto:beatrice2library@gmail.com?subject=%E7%A2%A7"));
  assert.ok(!okLink("mailto:someone@example.com"));
  assert.ok(!okLink("mailto:beatrice2library@gmail.com.evil.com"));
  assert.ok(!okLink("http://example.com"));
  assert.ok(!okLink("file:///C:/x"));
  // mailto 只能带一个 subject：不能加收件人、别的参数和控制字符
  assert.ok(okLink("mailto:beatrice2library@gmail.com"));
  for (const u of ["mailto:beatrice2library@gmail.com?bcc=other@example.org", "mailto:beatrice2library@gmail.com?to=other@example.org",
    "mailto:beatrice2library@gmail.com?cc=other@example.org", "mailto:beatrice2library@gmail.com?subject=x&bcc=other@example.org",
    "mailto:beatrice2library@gmail.com?body=x", "mailto:beatrice2library@gmail.com,other@example.org", "mailto:beatrice2library@gmail.com?subject=a%0Abcc:x",
    "mailto:beatrice2library@gmail.com?subject=a\nb", "mailto:beatrice2library@gmail.com?subject=%E7", "mailto:beatrice2library@gmail.com?subject=a?b=c"]) assert.ok(!okLink(u), u);
});

test("理由规则可以由配方改：all 都要写，none 都不用", () => {
  assert.ok(voteProblem({ vote: "support", reason: "短" }, { required: "all", min: 5 }));
  assert.equal(voteProblem({ vote: "support", reason: "一二三四五" }, { required: "all", min: 5 }), "");
  assert.equal(voteProblem({ vote: "oppose" }, { required: "none", min: 20 }), "");
});
