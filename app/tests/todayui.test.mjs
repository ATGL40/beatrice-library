// 今天玩什么的界面：用真实目录
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { el } from "./dom.mjs";

const { data } = await import("../src/store.ts");
const { normalizeCatalog } = await import("../src/catalog.ts");
const { setCatalog } = await import("../src/library.ts");
const { bindToday } = await import("../src/todayui.ts");
const cat = normalizeCatalog(JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
setCatalog(cat);
bindToday();
const released = cat.games.filter(g => g.state !== "dev");
const picked = () => /class="today-pick" data-id="([^"]+)"/.exec(el("#today-body").html)?.[1];

test("想玩和已有都空：不打开窗口，只提示一句（分了类时写分类名）", async () => {
  data.marks = {}; data.blacklist = {}; data.ui.cat = "all";
  await el("#today-btn").emit("click");
  assert.ok(!el("#today").open);
  assert.match(el("#toast").html, /想玩和已有里还没有能挑的作品/);
  data.ui.cat = "adv";
  await el("#today-btn").emit("click");
  assert.match(el("#toast").html, /「ADV \/ 剧情」分类的想玩和已有里/);
});

test("挑一部打开窗口：只从想玩、已有里挑（不含玩过、黑榜），看当前分类；换一个不重复；看详情打开详情页", async () => {
  const adv = released.filter(g => g.cat === "adv"), slg = released.find(g => g.cat === "slg");
  const [a, b, c, d] = adv;
  data.marks = {
    [a.id]: { status: "want", fav: false, score: 0 }, [b.id]: { status: "have", fav: false, score: 0 },
    [c.id]: { status: "played", fav: false, score: 0 }, [d.id]: { status: "want", fav: false, score: 0 },
    [slg.id]: { status: "want", fav: false, score: 0 },
  };
  data.blacklist = { [d.id]: {} };
  data.ui.cat = "adv";
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    await el("#today-btn").emit("click");
    assert.ok(el("#today").open);
    seen.add(picked());
  }
  assert.deepEqual([...seen].sort(), [a.id, b.id].sort());
  assert.match(el("#today-body").html, /从 2 部里挑的/);
  assert.equal(el("#today-again").disabled, false);
  for (let i = 0; i < 10; i++) {
    const before = picked();
    await el("#today-again").emit("click");
    assert.notEqual(picked(), before);
  }
  // 「全部」分类时别的分类的也能挑
  data.ui.cat = "all";
  const all = new Set();
  for (let i = 0; i < 60; i++) { await el("#today-btn").emit("click"); all.add(picked()); }
  assert.deepEqual([...all].sort(), [a.id, b.id, slg.id].sort());
  // 只剩一部：换一个灰掉
  data.marks = { [a.id]: { status: "have", fav: false, score: 0 } };
  await el("#today-btn").emit("click");
  assert.equal(picked(), a.id);
  assert.match(el("#today-body").html, /已有 · 从 1 部里挑的/);
  assert.equal(el("#today-again").disabled, true);
  await el("#today-open").emit("click");
  assert.ok(!el("#today").open);
  assert.ok(el("#detail").open);
});
