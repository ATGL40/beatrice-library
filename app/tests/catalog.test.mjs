import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalog, normalizeGame, okCover } from "../src/catalog.ts";
import { scoreAll } from "../src/scoring.ts";

test("缺字段的作品补上默认值，渲染要用的字段都是字符串", () => {
  const g = normalizeGame({ id: "RJ1", extra: 1 });
  assert.equal(g.title, "RJ1");
  assert.deepEqual(g.names, { ja: "RJ1", zh: "", en: "" });
  assert.equal(g.cat, "other");
  assert.equal(g.state, "released");
  assert.equal(g.date, "");
  assert.deepEqual(g.mt, []);
  assert.equal(g.rate, null);
  assert.equal(g.extra, 1); // 不认识的字段照留
  // 这些写法在渲染层都不会崩
  assert.equal((g.date || "").slice(0, 4), "");
  assert.equal(typeof g.names.ja.localeCompare("x"), "number");
});

test("类型不对的字段当成没有；链接只留 https；封面只认合规的 covers/ 路径", () => {
  const g = normalizeGame({ id: " RJ2 ", title: 5, names: "x", mt: ["zh", "xx"], date: 2020, url: "http://x", cover: "covers/../a.jpg", rate: "4.5", state: "dev" });
  assert.equal(g.id, "RJ2");
  assert.equal(g.title, "RJ2");
  assert.deepEqual(g.mt, ["zh"]);
  assert.equal(g.date, "");
  assert.equal(g.url, "");
  assert.equal(g.cover, "");
  assert.equal(g.rate, null);
  assert.equal(g.state, "dev");
  for (const ok of ["covers/RJ1.jpg", "covers/a_b-c.1.PNG"]) assert.ok(okCover(ok), ok);
  for (const bad of ["covers/中文.jpg", "covers/.x.jpg", "covers/CON.jpg", "covers/com1.png", "covers/a.exe", "x/a.jpg", "covers/a/b.jpg"]) assert.ok(!okCover(bad), bad);
});

test("整份目录：没 id 的、不是对象的丢掉，重复 id 留第一个；整份都坏也不崩", () => {
  const c = normalizeCatalog({ version: 2, updated: "2026-10-27", games: [{ id: "a" }, null, "x", { title: "无编号" }, { id: "a", title: "重复" }, { id: "b", cat: "m-rpg" }] });
  assert.deepEqual(c.games.map(g => g.id), ["a", "b"]);
  assert.equal(c.games[0].title, "a");
  assert.deepEqual(normalizeCatalog(null).games, []);
  assert.deepEqual(normalizeCatalog({ games: "坏" }).games, []);
  // 缺字段的目录照样能算综合榜
  const s = scoreAll(c.games, [], undefined);
  assert.equal(s.size, 2);
});
