import test from "node:test";
import assert from "node:assert/strict";
import { countGenres, genreName, hasAnyGenre, hasGenres, HIDDEN_GENRES, isStudentName, nextGenreState } from "../src/genres.ts";
import { genreFoldMap } from "../src/catalog.ts";
import { normalizeCatalog } from "../src/catalog.ts";

const dict = { "001": { ja: "学校/学園", zh: "学校/学园", en: "School" }, "182": { ja: "RPG", zh: "", en: "" } };
const game = (id, genres) => ({ id, genres });

test("题材名字按语言取，缺的用日文，字典里没有就显示 id", () => {
  assert.equal(genreName(dict, "001", "zh"), "学校/学园");
  assert.equal(genreName(dict, "001", "en"), "School");
  assert.equal(genreName(dict, "182", "zh"), "RPG");
  assert.equal(genreName(dict, "999", "zh"), "999");
});

test("统计：部数多的在前，一样多按 id；没有题材的作品不算", () => {
  const gs = [game("a", ["001", "182"]), game("b", ["182"]), game("c", ["003", "001"]), game("d")];
  assert.deepEqual(countGenres(gs), [["001", 2], ["182", 2], ["003", 1]]);
  assert.deepEqual(countGenres([]), []);
});

test("筛选：选了几个就要同时带上几个；没有题材资料的作品不算", () => {
  const sel = new Set(["001", "182"]);
  assert.ok(hasGenres(game("a", ["001", "182", "003"]), sel));
  assert.ok(!hasGenres(game("b", ["182"]), sel));
  assert.ok(!hasGenres(game("d"), sel));
  assert.ok(hasGenres(game("d"), new Set())); // 没选就都算
});

test("目录里的题材：字典只认 { id: { ja, zh, en } }，作品里不在字典的 id 丢掉、重复的只留一个", () => {
  const c = normalizeCatalog({
    games: [{ id: "a", genres: ["001", "999", "001", 5] }, { id: "b", genres: "x" }, { id: "c" }],
    genres: { "001": { ja: "学校", zh: "学校" }, "bad": "x", "002": { zh: "没有日文名" } },
  });
  assert.deepEqual(c.genres, { "001": { ja: "学校", zh: "学校", en: "" } });
  assert.deepEqual(c.games[0].genres, ["001"]);
  assert.equal(c.games[1].genres, undefined);
  assert.equal(c.games[2].genres, undefined);
  // 字典不是对象、或根本没有：作品的题材全部丢掉
  assert.equal(normalizeCatalog({ games: [{ id: "a", genres: ["001"] }], genres: [] }).games[0].genres, undefined);
  assert.deepEqual(normalizeCatalog({ games: [] }).genres, {});
});

test("不看：带上任何一个不看的题材就藏起来；没有题材资料的作品不受影响；没选不看就都不藏", () => {
  const not = ["001", "182"];
  assert.ok(hasAnyGenre(game("a", ["003", "182"]), not));
  assert.ok(!hasAnyGenre(game("b", ["003"]), not));
  assert.ok(!hasAnyGenre(game("c"), not));
  assert.ok(!hasAnyGenre(game("d", []), not));
  assert.ok(!hasAnyGenre(game("e", ["001"]), []));
  assert.ok(hasAnyGenre(game("f", ["001"]), new Set(["001"])));
});

test("点一下题材：不选 → 只看 → 不看 → 不选", () => {
  assert.equal(nextGenreState(""), "only");
  assert.equal(nextGenreState("only"), "not");
  assert.equal(nextGenreState("not"), "");
});
test("不显示的年龄类题材：自带的几个和数据包里 hidden: true 的不进字典、不进作品的 genres，放进 hiddenGenres 只给「不看」筛", () => {
  assert.deepEqual([...HIDDEN_GENRES].sort(), ["206", "210", "211", "504", "531"]);
  const c = normalizeCatalog({
    games: [{ id: "a", genres: ["206", "001", "300", "531"] }, { id: "b", genres: ["206"] }, { id: "c", genres: ["001"] }],
    genres: { "001": { ja: "学校", zh: "学校", en: "School" }, "206": { ja: "少女", zh: "少女", en: "Girl" }, "300": { ja: "X", zh: "X", en: "X", hidden: true } },
  });
  assert.deepEqual(Object.keys(c.genres), ["001"]);
  assert.deepEqual(c.games[0].genres, ["001"]);
  assert.deepEqual(c.games[0].hiddenGenres, ["206", "300", "531"]);
  assert.equal(c.games[1].genres, undefined);
  assert.deepEqual(c.games[1].hiddenGenres, ["206"]);
  assert.equal(c.games[2].hiddenGenres, undefined);
  assert.ok(c.hiddenGenres.includes("300") && c.hiddenGenres.includes("206"));
  // 计数、只看都看不到它们；存着的「不看」照旧筛
  assert.deepEqual(countGenres(c.games), [["001", 2]]);
  assert.ok(!hasGenres(c.games[1], ["206"]));
  assert.ok(hasAnyGenre(c.games[1], ["206"]));
  assert.ok(!hasAnyGenre(c.games[2], ["206"]));
});
test("学生类题材认得出来：各种学生、JK 这类缩写、英文的学生；学校、校园泳装、前辈后辈、同学、学生服、先生不算", () => {
  for (const n of ["学生", "女子校生", "男子校生", "女子高生", "女子大生", "女学生", "高校生", "中学生", "大学生", "小学生", "留学生", "転校生", "女高中生", "初中生", "学生妹",
    "JK", "jc", "Student", "Female Student", "Schoolgirl", "School Girl", "High School Girl", "College Student", "Schoolboys", "女子校生/女学生"]) assert.ok(isStudentName(n), n);
  for (const n of ["学校/学園", "学校/学园", "School / Academy", "スクール水着", "School Swimwear", "先輩/後輩", "Junior / Senior (at work, school, etc)", "同級生/同僚", "同学/同事",
    "Classmate / Colleague", "学生服", "制服", "先生", "女生", "少女", "Girl", "High School", "Student Council", ""]) assert.ok(!isStudentName(n), n);
});

test("学生类题材并进 400：作品里换成 400（重复的只留一个），字典里没有变体；数据包的 foldInto 也认；不显示的不并", () => {
  const dict = {
    "001": { ja: "学校/学園", zh: "学校/学园", en: "School / Academy" }, "104": { ja: "スクール水着", zh: "死库水/校园泳装", en: "School Swimwear" },
    "285": { ja: "先輩/後輩", zh: "前辈/后辈", en: "Junior / Senior" }, "400": { ja: "学生", zh: "学生", en: "Student" },
    "901": { ja: "女子校生", zh: "女高中生", en: "Schoolgirl" }, "902": { ja: "JK", zh: "JK", en: "JK" },
    "903": { ja: "なにか", zh: "某", en: "Something", foldInto: "001" }, "904": { ja: "女子大生", zh: "女大学生", en: "College Girl", hidden: true },
  };
  assert.deepEqual(genreFoldMap(dict), { "901": "400", "902": "400", "903": "001", "904": "400" });
  const c = normalizeCatalog({ genres: dict, games: [{ id: "a", genres: ["901", "400", "902", "104", "903", "904"] }, { id: "b", genres: ["902"] }] });
  assert.deepEqual(Object.keys(c.genres).sort(), ["001", "104", "285", "400"]);
  assert.deepEqual(c.games[0].genres, ["400", "104", "001"]);
  assert.deepEqual(c.games[0].hiddenGenres, ["904"]); // 写了 hidden 的照样不显示，不会以「学生」露出来
  assert.deepEqual(c.games[1].genres, ["400"]);
  assert.equal(c.genreFold["901"], "400");
  assert.equal(c.genreFold["904"], undefined);
  // 字典里没有 400 时补上「学生」
  const d = normalizeCatalog({ genres: { "901": dict["901"] }, games: [{ id: "x", genres: ["901"] }] });
  assert.deepEqual(d.genres["400"], { ja: "学生", zh: "学生", en: "Student" });
  assert.deepEqual(d.games[0].genres, ["400"]);
  // 并成一圈的不并
  assert.deepEqual(genreFoldMap({ "1": { ja: "a", foldInto: "2" }, "2": { ja: "b", foldInto: "1" } }), {});
});