import test from "node:test";
import assert from "node:assert/strict";
import { linkOf, normalizeCatalog, normalizeGame, okCover, okThumb, olderCatalog, POV_LABEL, sameCircle } from "../src/catalog.ts";
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
  // 缩略图只认 thumbs/ 下的；封面不认 thumbs/；没有合规的封面时缩略图也不要
  assert.ok(okThumb("thumbs/RJ1.jpg"));
  for (const bad of ["covers/RJ1.jpg", "thumbs/CON.jpg", "thumbs/a/b.jpg", "thumbs/../a.jpg"]) assert.ok(!okThumb(bad), bad);
  assert.ok(!okCover("thumbs/RJ1.jpg"));
  assert.equal(normalizeGame({ id: "RJ1", cover: "covers/RJ1.png", thumb: "thumbs/RJ1.jpg" }).thumb, "thumbs/RJ1.jpg");
  assert.equal(normalizeGame({ id: "RJ1", cover: "covers/RJ1.png", thumb: "covers/RJ1.png" }).thumb, "");
  assert.equal(normalizeGame({ id: "RJ1", thumb: "thumbs/RJ1.jpg" }).thumb, "");
  // 视角：只认这五种，别的（包括 toString 这类原型上的名字）丢掉
  for (const pov of ["female", "male", "both", "multi", "none"]) assert.equal(normalizeGame({ id: "RJ1", pov }).pov, pov);
  for (const pov of ["Female", "toString", 3, ""]) assert.equal(normalizeGame({ id: "RJ1", pov }).pov, undefined);
  assert.equal(POV_LABEL.both, "男女双视角");
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

test("链接：只有 DLsite（商店页）和 Ci-en / FANBOX（支持页）的作品有，别的来源、没有 url 的都没有", () => {
  const g = (src, url = "https://x.example/") => normalizeGame({ id: "a", src, url });
  assert.deepEqual(linkOf(g("dlsite")), { label: "商店页", url: "https://x.example/" });
  assert.deepEqual(linkOf(g("cien")), { label: "支持页", url: "https://x.example/" });
  assert.deepEqual(linkOf(g("fanbox")), { label: "支持页", url: "https://x.example/" });
  assert.equal(linkOf(g("steam")), null);
  assert.equal(linkOf(g("commercial")), null);
  assert.equal(linkOf(g("dlsite", "")), null);
  assert.equal(linkOf(g("dlsite", "http://x.example/")), null); // 只认 https
});

test("同社团作品：社团名去掉首尾空白后完全一样，不含自己，新的在前，最多 12 部", () => {
  const g = (id, circle, date) => normalizeGame({ id, circle, date });
  const me = g("me", "甲社团", "2022-01-01");
  const all = [me, g("a", "甲社团 ", "2021-05-01"), g("b", "甲社团", "2024-01-01"), g("c", "乙社团", "2024-01-01"), g("d", "甲社团", "")];
  assert.deepEqual(sameCircle(me, all).map(x => x.id), ["b", "a", "d"]);
  assert.deepEqual(sameCircle(g("x", "", "2020-01-01"), all), []); // 没写社团的不找
  const many = Array.from({ length: 20 }, (_, i) => g(`m${i}`, "甲社团", `20${String(i).padStart(2, "0")}-01-01`));
  assert.equal(sameCircle(me, many).length, 12);
  assert.equal(sameCircle(me, many)[0].id, "m19");
});

test("资料新旧按 (updated, revision) 比：没写 revision 算 0，同一天比 revision，一样的不算旧", () => {
  const c = (updated, revision) => normalizeCatalog({ version: 2, updated, revision, games: [] });
  const builtIn = c("2026-10-28", 1);
  assert.equal(c("2026-10-28").revision, 0); // 旧包没有 revision
  assert.equal(c("2026-10-28", -1).revision, 0);
  assert.equal(c("2026-10-28", "2").revision, 0);
  assert.equal(c("2026-10-28", 1.5).revision, 0);
  assert.equal(olderCatalog(c("2026-10-28"), builtIn), true); // 同一天的旧包：用自带的
  assert.equal(olderCatalog(c("2026-10-28", 2), builtIn), false); // 同一天 revision 更高：用包的
  assert.equal(olderCatalog(c("2026-10-28", 1), builtIn), false); // 一样：用包的（可能有封面）
  assert.equal(olderCatalog(c("2026-10-27", 9), builtIn), true); // 日期旧的 revision 再高也旧
  assert.equal(olderCatalog(c("2026-10-29"), builtIn), false);
});

test("别名：只留非空字符串、去重；没有就是 undefined", () => {
  assert.deepEqual(normalizeGame({ id: "RJ1", aliases: ["Yuen-Zoku", "", 3, "Yuen-Zoku", " ", "优艳之花"] }).aliases, ["Yuen-Zoku", "优艳之花"]);
  assert.equal(normalizeGame({ id: "RJ1", aliases: "x" }).aliases, undefined);
  assert.equal(normalizeGame({ id: "RJ1" }).aliases, undefined);
});
