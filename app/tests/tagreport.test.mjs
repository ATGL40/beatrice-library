// 「标签不对？」：数据清洗、提交文件、详情页的窗口（记下 / 删除）和提交窗口。用 dom.mjs 的假页面，真实目录里加两个题材试并进学生和不显示
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { el, flush, target } from "./dom.mjs";

const { data, load } = await import("../src/store.ts");
const { normalizeCatalog } = await import("../src/catalog.ts");
const { games, setCatalog } = await import("../src/library.ts");
const { bindDetail, openDetail } = await import("../src/detail.ts");
const { bindTagReport, openTagReport } = await import("../src/tagreportui.ts");
const { bindSubmit, openSubmit } = await import("../src/submit.ts");
const { cleanTagReports, currentTagReport, currentTagReports, makeTagReport, TAG_NOTE_MAX } = await import("../src/tagreport.ts");
const { makeSubmission } = await import("../src/marks.ts");
const { submissionLists, submissionState } = await import("../src/submission.ts");

const raw = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8"));
// 女子校生（学生类，并进 400）和一个写了 hidden 的题材：都不该出现在「少了」里
raw.genres["9001"] = { ja: "女子校生", zh: "女高中生", en: "Schoolgirl" };
raw.genres["9002"] = { ja: "かくし", zh: "藏起来", en: "Hidden one", hidden: true };
const cat = normalizeCatalog(raw);
setCatalog(cat);
bindDetail(); bindTagReport(); bindSubmit();
globalThis.__APP_VERSION__ = "0.3.1";
let copied = "";
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async t => { copied = t; } } }, configurable: true });

test("一条报告：去重、少了里和不对重复的去掉、说明截到 200 字、年龄类题材去掉；什么都没有就是 null", () => {
  assert.equal(makeTagReport([], [], "  "), null);
  assert.deepEqual(makeTagReport(["1", "1", "206"], ["2", "1", "211"], "  看简介  ", "2026-10-30"), { wrong: ["1"], missing: ["2"], note: "看简介", date: "2026-10-30" });
  assert.equal(makeTagReport([], [], "长".repeat(TAG_NOTE_MAX + 9), "d").note.length, TAG_NOTE_MAX);
  assert.deepEqual(makeTagReport([], [], "只写说明", "d"), { wrong: [], missing: [], note: "只写说明", date: "d" });
});

test("数据文件里的 tagReports：不是对象当没有，我的游戏、坏条目、空报告丢掉，不是文字的 id 和年龄类的去掉，日期不对写空", () => {
  for (const bad of [undefined, null, "x", 5, [{ wrong: ["1"] }]]) assert.deepEqual(cleanTagReports(bad), {});
  const r = JSON.parse(`{
    "RJ1": { "wrong": ["070", 5, null, "070", "206"], "missing": ["400", "504", "070"], "note": " 说明 ", "date": "2026-10-30", "later": 1 },
    "RJ2": { "wrong": [], "missing": [] },
    "RJ3": { "wrong": "070", "missing": {} , "note": 7 },
    "RJ4": { "wrong": ["210"], "missing": ["211"] },
    "RJ5": { "missing": ["114"], "date": "昨天" },
    "RJ6": "坏", "RJ7": null, "RJ8": ["070"],
    "local-abc": { "wrong": ["070"] },
    "__proto__": { "wrong": ["070"] }
  }`);
  assert.deepEqual(cleanTagReports(r), {
    RJ1: { wrong: ["070"], missing: ["400"], note: "说明", date: "2026-10-30" },
    RJ5: { wrong: [], missing: ["114"], date: "" },
  });
});

test("读数据文件时整理 tagReports；旧文件没有这个字段是空的", async () => {
  handlers.read_data = () => JSON.stringify({ version: 1, tagReports: { RJ1: { wrong: ["070", "206"], missing: [], date: "2026-10-30" }, "local-x": { wrong: ["070"] } } });
  await load();
  assert.deepEqual(data.tagReports, { RJ1: { wrong: ["070"], missing: [], date: "2026-10-30" } });
  handlers.read_data = () => JSON.stringify({ version: 1 });
  await load();
  assert.deepEqual(data.tagReports, {});
  delete handlers.read_data;
});

test("按现在的资料算：不对的只留作品还带着的，少了的只留字典里有、作品还没有的；都改好了就没有", () => {
  const g = { id: "RJ1", src: "dlsite", genres: ["070", "114"] };
  const known = id => ["070", "114", "400", "256"].includes(id);
  const r = { wrong: ["070", "999"], missing: ["400", "114", "9001", "206"], date: "2026-10-30" };
  assert.deepEqual(currentTagReport(r, g, known), { wrong: ["070"], missing: ["400"], date: "2026-10-30" });
  assert.equal(currentTagReport({ wrong: ["999"], missing: ["114"], date: "d" }, g, known), null);
  assert.equal(currentTagReport(undefined, g, known), null);
  const all = new Map([["RJ1", g], ["local-a", { id: "local-a", src: "local", genres: ["070"] }]]);
  assert.deepEqual(Object.keys(currentTagReports({ RJ1: r, "local-a": { wrong: ["070"], missing: [], date: "d" }, gone: r }, all, known)), ["RJ1"]);
});

test("提交文件的 tags：有内容才写，version 还是 1；我的游戏、年龄类题材、空报告去掉", () => {
  const f = makeSubmission("0.3.1", "2026-10-30", { RJ1: 4 }, {}, undefined, {}, [], {
    RJ2: { wrong: ["070", "206"], missing: ["400"], note: "看简介", date: "2026-10-30" },
    RJ3: { wrong: ["211"], missing: [], date: "2026-10-30" },
    "local-a": { wrong: ["070"], missing: [], date: "2026-10-30" },
  });
  assert.equal(f.version, 1);
  assert.deepEqual(f.tags, { RJ2: { wrong: ["070"], missing: ["400"], note: "看简介", date: "2026-10-30" } });
  assert.ok(!("tags" in makeSubmission("0.3.1", "d", { RJ1: 4 }, {})));
  assert.ok(!("tags" in makeSubmission("0.3.1", "d", { RJ1: 4 }, {}, undefined, {}, [], { "local-a": { wrong: ["070"], missing: [], date: "d" } })));
});

test("提交窗口的标签报告：只列目录里有的作品，按名字排；取消勾选的不提交", () => {
  const all = new Map([["b", { id: "b", src: "dlsite" }], ["a", { id: "a", src: "steam" }], ["local-x", { id: "local-x", src: "local" }]]);
  const tags = { b: { wrong: ["070"], missing: [], date: "d" }, a: { wrong: [], missing: ["400"], date: "d" }, "local-x": { wrong: ["070"], missing: [], date: "d" }, gone: { wrong: ["070"], missing: [], date: "d" } };
  const lists = submissionLists(all, {}, [], new Map(), g => g.id, {}, tags);
  assert.deepEqual(lists.tagged.map(g => g.id), ["a", "b"]);
  const rule = { required: "oppose", min: 20 };
  assert.deepEqual(Object.keys(submissionState(lists, {}, {}, new Set(), rule, {}, new Set(), tags).tags), ["a", "b"]);
  assert.deepEqual(Object.keys(submissionState(lists, {}, {}, new Set(), rule, {}, new Set(), tags, new Set(["b"])).tags), ["a"]);
  // 旧的调用方式（不传标签报告）照常
  assert.deepEqual(submissionLists(all, {}, [], new Map(), g => g.id).tagged, []);
  assert.deepEqual(submissionState({ rated: [], votes: [] }, {}, {}, new Set(), rule).tags, {});
});

const work = cat.games.find(g => g.genres?.length >= 2 && !g.genres.includes("400"));
const picks = () => [...el("#tagreport-list").html.matchAll(/data-pick="([^"]+)"/g)].map(m => m[1]);
const search = q => { el("#tagreport-q").value = q; return el("#tagreport-q").emit("input").then(picks); };

test("详情页「标签不对？」：只有图鉴里的作品有；没有题材的作品也有；我的游戏没有", () => {
  data.tagReports = {};
  openDetail(work.id);
  assert.match(el("#detail-info").html, /data-tagreport>标签不对？<\/button>/);
  assert.doesNotMatch(el("#detail-info").html, /已报告标签/);
  const bare = cat.games.find(g => !g.genres?.length);
  openDetail(bare.id);
  assert.match(el("#detail-info").html, /data-tagreport/);
  games.set("local-test", { ...work, id: "local-test", src: "local", genres: undefined });
  openDetail("local-test");
  assert.doesNotMatch(el("#detail-info").html, /data-tagreport/);
  el("#tagreport").open = false;
  openTagReport("local-test");
  assert.ok(!el("#tagreport").open);
  games.delete("local-test");
  el("#detail").close();
});

test("窗口：列出现在的标签；「少了」只从字典里挑，不出现不显示的题材和学生变体（只有学生），也不出现作品已有的", async () => {
  data.tagReports = {};
  openDetail(work.id);
  await el("#detail-info").emit("click", target({ "data-tagreport": "" }));
  assert.ok(el("#tagreport").open);
  assert.equal(el("#tagreport-delete").hidden, true);
  for (const id of work.genres) assert.match(el("#tagreport-wrong").html, new RegExp(`data-wrong="${id}"`));
  const shown = picks();
  assert.equal(shown.length, 30); // 没搜索时是部数最多的 30 个
  assert.ok(!shown.some(id => work.genres.includes(id)));
  assert.deepEqual(await search("女子校生"), []);
  assert.deepEqual(await search("Schoolgirl"), []);
  assert.deepEqual(await search("藏起来"), []);
  assert.ok((await search("学生")).includes("400"));
  const girl = await search("少女");
  assert.ok(girl.includes("240") && !girl.includes("206"));
  for (const id of [...cat.hiddenGenres, ...Object.keys(cat.genreFold)]) assert.ok(!(await search(id)).includes(id), id);
});

test("记下、再打开带着旧内容、删除这条；详情页显示「已报告标签」", async () => {
  data.tagReports = {};
  openDetail(work.id);
  await el("#detail-info").emit("click", target({ "data-tagreport": "" }));
  const bad = work.genres[0];
  await el("#tagreport-wrong").emit("change", { dataset: { wrong: bad }, checked: true });
  await search("学生");
  await el("#tagreport-list").emit("click", target({ "data-pick": "400" }));
  assert.match(el("#tagreport-picked").textContent, /少了：学生/);
  el("#tagreport-note").value = "  简介里没有  ";
  await el("#tagreport-save").emit("click");
  assert.ok(!el("#tagreport").open);
  assert.deepEqual(data.tagReports[work.id], { wrong: [bad], missing: ["400"], note: "简介里没有", date: new Date().toISOString().slice(0, 10) });
  assert.match(el("#detail-info").html, /已报告标签/);

  // 再打开：勾着、挑着、说明都在，有「删除这条」
  await el("#detail-info").emit("click", target({ "data-tagreport": "" }));
  assert.match(el("#tagreport-wrong").html, new RegExp(`data-wrong="${bad}" checked`));
  await search("");
  assert.match(el("#tagreport-list").html, /data-pick="400" aria-pressed="true"/);
  assert.equal(el("#tagreport-note").value, "简介里没有");
  assert.equal(el("#tagreport-delete").hidden, false);

  // 提交窗口里列出这部，取消勾选后不提交
  data.marks = { [work.id]: { status: "", fav: false, score: 4 } };
  openSubmit(); flush();
  assert.match(el("#submit-tags").html, new RegExp(`data-tags="${work.id}" checked`));
  assert.match(el("#submit-tags").html, /不对：[^<]+ · 少了：学生 · 简介里没有/);
  assert.match(el("#submit-summary").textContent, /1 部的标签报告/);
  await el("#submit-copy").emit("click");
  assert.deepEqual(JSON.parse(copied).tags, { [work.id]: data.tagReports[work.id] });
  await el("#submit-tags").emit("change", { dataset: { tags: work.id }, checked: false });
  assert.doesNotMatch(el("#submit-summary").textContent, /标签报告/);
  await el("#submit-copy").emit("click");
  assert.ok(!("tags" in JSON.parse(copied)));
  el("#submit").close();

  await el("#tagreport-delete").emit("click");
  assert.ok(!(work.id in data.tagReports));
  assert.ok(!el("#tagreport").open);
  assert.doesNotMatch(el("#detail-info").html, /已报告标签/);
  assert.match(el("#toast").html, /已删除这条标签报告/);
});

test("什么都没勾、没挑、没写就点「记下」：不记；原来有的删掉", async () => {
  data.tagReports = {};
  openTagReport(work.id);
  await el("#tagreport-save").emit("click");
  assert.deepEqual(data.tagReports, {});
  assert.match(el("#toast").html, /没有记下/);
  data.tagReports = { [work.id]: { wrong: [work.genres[0]], missing: [], date: "2026-10-30" } };
  openTagReport(work.id);
  await el("#tagreport-wrong").emit("change", { dataset: { wrong: work.genres[0] }, checked: false });
  await el("#tagreport-save").emit("click");
  assert.deepEqual(data.tagReports, {});
  assert.match(el("#toast").html, /已删除这条标签报告/);
});
