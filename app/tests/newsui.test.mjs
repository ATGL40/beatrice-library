// 资料更新小结的界面：用真实目录，旧快照在测试里改出变化
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cards, el, flush, target } from "./dom.mjs";

const { data } = await import("../src/store.ts");
const { normalizeCatalog } = await import("../src/catalog.ts");
const { render, setCatalog, games, finalFor, onlyIds } = await import("../src/library.ts");
const { noteCatalog, bindNews } = await import("../src/newsui.ts");
const { bindLibrary } = await import("../src/library.ts");
const cat = normalizeCatalog(JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
setCatalog(cat);
bindLibrary();
bindNews();
Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year", group: false, bands: [] });

test("第一次只记快照不弹；同一份资料不再弹；设置里的勾选跟着 catalogNews（默认开）", async () => {
  assert.equal(noteCatalog(cat), null);
  assert.equal(data.catalogSeen.updated, cat.updated);
  assert.equal(Object.keys(data.catalogSeen.games).length, cat.games.length);
  assert.ok(!el("#news").open);
  assert.equal(noteCatalog(cat), null);
  assert.ok(!el("#news").open);
  await el("#open-settings").emit("click");
  assert.equal(el("#catalog-news").checked, true);
  el("#catalog-news").checked = false; await el("#catalog-news").emit("change");
  assert.equal(data.catalogNews, false);
  el("#catalog-news").checked = true; await el("#catalog-news").emit("change");
  assert.equal(data.catalogNews, true);
});

test("资料比上次的新：弹小结，点「在图鉴里看看这些作品」只看新收录的，点小标签去掉；点名字打开详情", async () => {
  const released = cat.games.filter(g => g.state !== "dev");
  const scored = released.find(g => finalFor(g));
  const dev = cat.games.find(g => g.state === "dev" && g.date);
  const [n1, n2] = released.slice(-2);
  data.marks = { [scored.id]: { status: "want", fav: false, score: 0 }, GONE: { status: "played", fav: false, score: 4 } };
  // 旧快照：日期早一天；n1、n2 那时还没有，GONE 那时还在，scored 那时少 3 分，dev 那时没定档
  const old = structuredClone(data.catalogSeen);
  old.updated = "2000-01-01";
  delete old.games[n1.id]; delete old.games[n2.id];
  old.games.GONE = ""; old.names.GONE = "被移出的作品";
  const [s, band] = old.games[scored.id].split("|");
  old.games[scored.id] = `${Number(s) - 3}|${band}`;
  old.games[dev.id] = "d:";
  data.catalogSeen = old;
  const news = noteCatalog(cat);
  assert.deepEqual(news.added.sort(), [n1.id, n2.id].sort());
  assert.deepEqual(news.scores.map(c => c.id), [scored.id]);
  assert.ok(news.dev.some(d => d.id === dev.id && d.date === dev.date && !d.released));
  assert.deepEqual(news.removed, [{ id: "GONE", name: "被移出的作品" }]);
  assert.equal(data.catalogSeen.updated, cat.updated); // 记下了新的快照
  assert.ok(el("#news").open);
  const html = el("#news-body").html;
  assert.match(html, /新收录 2 部/);
  assert.match(html, new RegExp(`data-id="${scored.id}"[^]*综合 ${Number(s) - 3} → ${s}`));
  assert.match(html, new RegExp(`data-id="${dev.id}"[^]*发售日 ${dev.date}`));
  assert.match(html, /<span>被移出的作品<\/span>/);
  assert.match(html, /不联网/);
  // 看看新收录的
  await el("#news-body").emit("click", target({ "data-news-added": "" }));
  assert.ok(!el("#news").open);
  flush();
  assert.deepEqual(cards().sort(), [n1.id, n2.id].sort());
  assert.match(el("#only-chip").html, /只看：新收录（2 部）/);
  assert.equal(el("#only-chip").hidden, false);
  await el("#only-chip").emit("click", target({ "data-only": "" }));
  assert.equal(onlyIds.ids, null);
  assert.equal(el("#only-chip").hidden, true);
  flush();
  assert.equal(cards().length, released.length);
  // 点名字：关掉小结、打开详情
  el("#news").open = true;
  await el("#news-body").emit("click", target({ "data-id": scored.id }));
  assert.ok(!el("#news").open);
  assert.ok(el("#detail").open);
  el("#detail").open = false;
});

test("设置里关掉后：照样记快照，但不弹", () => {
  data.catalogNews = false;
  const old = structuredClone(data.catalogSeen);
  old.updated = "2000-01-01";
  delete old.games[cat.games[0].id];
  data.catalogSeen = old;
  const news = noteCatalog(cat);
  assert.deepEqual(news.added, [cat.games[0].id]);
  assert.ok(!el("#news").open);
  assert.equal(data.catalogSeen.updated, cat.updated);
  data.catalogNews = true;
  render();
  assert.ok(games.size > 0);
});
