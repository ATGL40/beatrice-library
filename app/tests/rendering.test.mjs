// 只用内存里的 DOM 替身验证调用关系，禁止调用 Tauri 和用户目录
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

const backend = "data:text/javascript," + encodeURIComponent(`
  const forbidden = () => { throw new Error("测试不能调用后端"); };
  export { forbidden as invoke, forbidden as open, forbidden as save, forbidden as openUrl,
    forbidden as revealItemInDir, forbidden as appDataDir, forbidden as getCurrentWindow, forbidden as listen };
  export const convertFileSrc = path => 'asset://' + path;
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@tauri-apps/")) return { url: backend, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts")) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});

let frameId = 0, scrolled = "";
const frames = new Map();
globalThis.requestAnimationFrame = run => { frames.set(++frameId, run); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.CSS = { escape: s => s };
const flush = () => { while (frames.size) { const [id, run] = frames.entries().next().value; frames.delete(id); run(); } };

class Element {
  constructor() { this.html = ""; this.grids = []; this.listeners = new Map(); this.open = false; this.value = ""; this.dataset = {}; }
  set innerHTML(html) {
    this.html = html;
    this.grids = [...html.matchAll(/<div class="grid">/g)].map(() => new Element());
    this.list = html.includes('<ol class="rank-list">') ? new Element() : undefined;
    if (this.list) this.list.html = html.split('<ol class="rank-list">')[1].split("</ol>")[0];
    this.more = html.includes('class="row more"') ? new Element() : undefined;
    if (this.more) this.more.parent = this;
  }
  get innerHTML() { return this.html; }
  get childNodes() { return [...this.html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(m => ({ html: m[0] })); }
  insertAdjacentHTML(position, html) { assert.equal(position, "beforeend"); this.html += html; }
  querySelectorAll(s) { return s === ".grid" ? this.grids : []; }
  querySelector(s) {
    if (s === ".rank-list") return this.list;
    if (s === ".more") return this.more;
    const id = /data-vote-id="([^"]+)"/.exec(s)?.[1];
    return id && this.html.includes(`data-vote-id="${id}"`) ? { scrollIntoView: () => { scrolled = id; } } : null;
  }
  append(...nodes) { for (const n of nodes) { if (n instanceof Element) { this.more = n; n.parent = this; } else this.html += n.html; } }
  remove() { this.parent.more = undefined; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  emit(type, target = this) { for (const fn of this.listeners.get(type) ?? []) fn({ target }); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  setAttribute() {}
}
const elements = new Map();
const el = s => { if (!elements.has(s)) elements.set(s, new Element()); return elements.get(s); };
const outputs = [new Element(), new Element()];
globalThis.document = {
  addEventListener() {},
  querySelector: el,
  querySelectorAll: s => s === "#submit [data-out]" ? outputs : [],
  createElement: tag => { assert.equal(tag, "template"); const e = new Element(); e.content = e; return e; },
};

const { data } = await import("../src/store.ts");
const { normalizeCatalog } = await import("../src/catalog.ts");
const { render, setCatalog, games, ranking, scoreText2, thinFor, v2Order, openScoreHelp, genreLabel } = await import("../src/library.ts");
const { openDetail } = await import("../src/detail.ts");
const { openSubmit, bindSubmit } = await import("../src/submit.ts");
const { renderRank, bindRank } = await import("../src/rank.ts");
const cat = normalizeCatalog(JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
const ids = s => [...s.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);
const cards = () => el("#list").grids.flatMap(g => ids(g.html));
setCatalog(cat);

test("图鉴：真实目录分帧画全、顺序不变，筛选取消旧批次", () => {
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year" });
  render(); assert.equal(cards().length, 24);
  flush();
  const expected = cat.games.filter(g => g.state !== "dev").sort((a, b) => b.date.localeCompare(a.date)).map(g => g.id);
  assert.deepEqual(cards(), expected);
  render(); // 旧任务排进下一帧之前切到空分类
  data.ui.cat = "empty"; render(); flush(); assert.deepEqual(cards(), []);
  data.ui.cat = "adv"; render(); flush();
  assert.deepEqual(cards(), cat.games.filter(g => g.cat === "adv" && g.state !== "dev").sort((a, b) => b.date.localeCompare(a.date)).map(g => g.id));
});

test("排行榜：显示更多保留已有列表，追加名次正确，换来源回第一页", () => {
  data.ui.cat = "all"; bindRank(); renderRank();
  const body = el("#rank-body"), first = body.list;
  assert.equal(ids(first.html).length, 200);
  const target = { closest: s => s === "#rank-more" ? {} : null };
  body.emit("click", target);
  assert.equal(body.list, first);
  assert.deepEqual(ids(first.html), v2Order().slice(0, 400).map(g => g.id));
  assert.match(first.html, /<span class="no">201<\/span>/);
  body.emit("click", { closest: s => s === "[data-src]" ? { dataset: { src: "dlsite" } } : null });
  assert.deepEqual(ids(body.list.html), v2Order().filter(g => g.src === "dlsite").slice(0, 200).map(g => g.id));
});

test("提交窗口：未渲染的坏票也禁导出，关闭取消追加，重开及延迟定位有效", () => {
  bindSubmit();
  const sample = [...games.values()].slice(0, 80);
  ranking.voteIds = sample.map(g => g.id);
  sample.forEach((g, i) => {
    ranking.finals.set(g.id, { F: 96, band: "神作", comp: 100 - i, date: "", canon: "manual", nominee: false });
    data.marks[g.id] = { score: 5 };
  });
  const last = sample.at(-1).id;
  data.votes[last] = { vote: "oppose", reason: "短" };
  openSubmit();
  assert.equal((el("#submit-votes").html.match(/data-vote-id=/g) ?? []).length, 24);
  assert.equal((el("#submit-ratings").html.match(/data-rate=/g) ?? []).length, 24);
  assert.match(el("#submit-summary").textContent, /有 1 张票/);
  assert.ok(outputs.every(b => b.disabled));
  el("#submit").close(); const before = el("#submit-votes").html; flush();
  assert.equal(el("#submit-votes").html, before);
  data.votes[last].reason = "足够长的理由".repeat(5);
  openSubmit(last); assert.ok(outputs.every(b => !b.disabled));
  flush();
  assert.equal((el("#submit-votes").html.match(/data-vote-id=/g) ?? []).length, 80);
  assert.equal((el("#submit-ratings").html.match(/data-rate=/g) ?? []).length, 80);
  assert.equal(scrolled, last);
});

test("没有公共分时：有玩家票就写「仅玩家评分」，票正负抵消（修正为 0）也写", () => {
  const g = { id: "local-novote", state: "released" }; // 我的游戏这类没有平台评分的作品
  assert.ok(g);
  assert.equal(scoreText2(g), "");
  data.marks[g.id] = { status: "", fav: false, score: 3 };
  assert.equal(scoreText2(g), "仅玩家评分 50");
  data.marks[g.id].score = 5;
  data.friends = [{ name: "朋友", marks: { [g.id]: { score: 1 } } }];
  assert.equal(scoreText2(g), "仅玩家评分 50");
  data.friends = []; delete data.marks[g.id];
});

test("评价不足：按综合排名排时单独放在最后一组（不分年份和按年份分组都是），卡片不写分和档；综合榜也单独列在最后", () => {
  const thin = { id: "RJ-thin", cat: "adv", src: "dlsite", date: "2026-10-01", rate: 4.9, rc: 3, dl: 50, title: "评价少的作品" };
  const raw = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8"));
  setCatalog(normalizeCatalog({ ...raw, games: [...raw.games, thin] }));
  const g = games.get("RJ-thin");
  assert.equal(scoreText2(g), "评价不足");
  Object.assign(data.ui, { view: "library", cat: "adv", tab: "all", sort: "overall", group: false });
  render(); flush();
  const list = el("#list");
  // 这一类里评价不足的（加上的这部，和只有 Steam 好评率的作品），新的在前
  const thinIds = [...games.values()].filter(x => x.cat === "adv" && thinFor(x)).sort((a, b) => b.date.localeCompare(a.date)).map(x => x.id);
  assert.ok(thinIds.includes("RJ-thin"));
  assert.match(list.html, new RegExp(`<section data-y="评价不足"[^>]*><div class="year"><h2>评价不足</h2><span>${thinIds.length} 部 · 可用的评价太少，暂不打分。</span>`));
  assert.deepEqual(ids(list.grids.at(-1).html), thinIds);
  assert.ok(!ids(list.grids[0].html).some(id => thinIds.includes(id)));
  assert.doesNotMatch(list.grids.at(-1).html, /class="band/);
  data.ui.group = true; render(); flush();
  assert.match(list.html, /data-y="评价不足"[^]*$/);
  assert.deepEqual(ids(el("#list").grids.at(-1).html), thinIds);
  // 综合榜：2026 年的 ADV 不到一页，画完排名后跟着「评价不足」一组
  data.ui.view = "rank"; renderRank();
  el("#rank-body").emit("click", { closest: s => s === "[data-src]" ? { dataset: { src: "" } } : null }); // 前面的测试选了 DLsite
  el("#rank-body").emit("click", { closest: s => s === "[data-year]" ? { dataset: { year: "2026" } } : null });
  const html = el("#rank-body").html;
  assert.ok(html.indexOf('<section class="thin-group">') > html.indexOf("</ol>"));
  const thin2026 = thinIds.filter(id => games.get(id).date.startsWith("2026"));
  assert.match(html, new RegExp(`<h3>评价不足（${thin2026.length} 部）</h3>`));
  Object.assign(data.ui, { view: "library", cat: "all", sort: "year", group: false });
  setCatalog(cat);
});

test("分数筛选：只画选中档的作品，部数和年份跳转条跟着变；只选评价不足时不留空的一组；没有档的作品不显示", () => {
  const all = [...games.values()].filter(g => g.state !== "dev");
  const bandOf = g => ranking.finals.get(g.id)?.band ?? (thinFor(g) ? "评价不足" : "");
  const big = all.filter(g => bandOf(g) === "超大杯").map(g => g.id);
  assert.ok(big.length > 0 && big.length < all.length);
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year", group: true, bands: ["超大杯", "旧档名"] });
  render(); flush();
  assert.deepEqual(cards().sort(), [...big].sort());
  const bar = el("#bands");
  assert.equal(bar.hidden, false);
  assert.match(bar.html, new RegExp(`data-band="超大杯" aria-pressed="true" title="综合 85–94 分">超大杯 <span class="range">85–94</span><span class="n">${big.length}</span>`));
  assert.match(bar.html, /data-band="大杯" aria-pressed="false"/);
  assert.match(bar.html, /data-band="">清除/);
  // 年份跳转条的部数加起来就是筛出来的部数
  const jumps = [...el("#year-jump").html.matchAll(/<span class="n">(\d+)<\/span>/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.equal(jumps, big.length);
  // 按综合排名、不分组、只选评价不足：只有「评价不足」一组，前面没有空的一列
  const thin = all.filter(thinFor).map(g => g.id);
  Object.assign(data.ui, { sort: "overall", group: false, bands: ["评价不足"] });
  render(); flush();
  assert.equal(el("#list").grids.length, 1);
  assert.match(el("#list").html, /^<section data-y="评价不足"/);
  assert.deepEqual(cards().sort(), [...thin].sort());
  // 开发中的作品没有档：选了分数档就没有可显示的，提示写明
  data.ui.tab = "dev"; render(); flush();
  assert.match(el("#list").html, /没有这些分数档的作品/);
  // 不选就是全部
  Object.assign(data.ui, { tab: "all", sort: "year", group: false, bands: [] });
  render(); flush();
  assert.equal(cards().length, all.length);
  assert.doesNotMatch(bar.html, /清除/);
  // 排行榜里不显示
  data.ui.view = "rank"; render();
  assert.equal(bar.hidden, true);
  data.ui.view = "library";
});

test("黑榜：「黑榜」页签只看我的黑榜，卡片带标签；开了隐藏后别的页签不显示；数据包标注的多人拉黑显示人数、不隐藏", () => {
  const all = [...games.values()].filter(g => g.state !== "dev");
  const [a, b, c] = all;
  data.blacklist = { [a.id]: { reason: "踩雷" }, [b.id]: {} };
  c.blacklist = { count: 7, flagged: true, settled: "2026-11-01" };
  Object.assign(data.ui, { view: "library", cat: "all", tab: "black", sort: "year", group: false, bands: [] });
  render(); flush();
  assert.deepEqual(cards().sort(), [a.id, b.id].sort());
  assert.match(el("#tabs").html, /data-tab="black" aria-selected="true">黑榜<span class="n">2<\/span>/);
  const html = el("#list").grids[0].html;
  assert.match(html, /<span class="mt black" title="我的黑榜：踩雷">黑榜<\/span>/);
  assert.match(html, /<span class="mt black" title="我的黑榜">黑榜<\/span>/);
  // 我的黑榜里的卡片换边框（只多一个 class）
  for (const id of [a.id, b.id]) assert.match(html, new RegExp(`<article class="card blacklisted" data-id="${id}">`));
  // 「全部」：默认不隐藏；多人拉黑的作品照样显示，带人数
  data.ui.tab = "all"; render(); flush();
  assert.equal(cards().length, all.length);
  const allHtml = el("#list").grids[0].html;
  assert.match(allHtml, /<span class="mt" title="很多玩家把它加进了黑榜；只代表他们的看法，不影响分数">多人拉黑 · 7 人<\/span>/);
  // 多人拉黑的作品不换边框；不在黑榜里的卡片也没有 blacklisted，玩过的照旧是 played
  assert.match(allHtml, new RegExp(`<article class="card" data-id="${c.id}">`));
  assert.equal((allHtml.match(/class="card[^"]*blacklisted/g) ?? []).length, 2);
  data.marks[a.id] = { status: "played", fav: false, score: 0 };
  render(); flush();
  assert.match(el("#list").grids[0].html, new RegExp(`<article class="card played blacklisted" data-id="${a.id}">`));
  delete data.marks[a.id];
  data.hideBlack = true; render(); flush();
  assert.equal(cards().length, all.length - 2);
  assert.ok(!cards().includes(a.id) && cards().includes(c.id));
  assert.match(el("#tabs").html, new RegExp(`data-tab="all" aria-selected="true">全部<span class="n">${all.length - 2}</span>`));
  data.ui.tab = "black"; render(); flush();
  assert.equal(cards().length, 2);
  // 空的黑榜有提示
  data.blacklist = {}; render(); flush();
  assert.match(el("#list").html, /黑榜还是空的/);
  data.hideBlack = false; delete c.blacklist;
  data.ui.tab = "all";
});

test("分数是怎么算的：综合榜提醒框、分数筛选那一排、详情页分数旁都有按钮，打开的是同一个窗口，内容按当前配方", () => {
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year", group: false, bands: [] });
  render(); flush();
  assert.match(el("#bands").html, /<button type="button" class="help-link" data-score-help>怎么算的？<\/button>$/);
  data.ui.view = "rank"; render();
  el("#rank-lists").emit("click", { closest: s => s === "[data-list]" ? { dataset: { list: "overall" } } : null });
  const head = el("#rank-body").html.split("</header>")[0];
  assert.match(head, /<div class="score-notice" role="note"><span class="icon" aria-hidden="true">i<\/span><p>分数只是参考：[^<]*自己喜欢最重要。<\/p><button type="button" class="help-link" data-score-help>分数是怎么算的<\/button><\/div>/);
  data.ui.view = "library";
  // 详情页：有分数的作品，分数旁是「怎么算的？」
  const g = [...games.values()].find(x => ranking.finals.has(x.id));
  openDetail(g.id);
  assert.match(el("#detail-info").html, /公共分 \d+[^]*data-score-help>怎么算的？<\/button>/);
  el("#detail").close();
  openScoreHelp();
  assert.equal(el("#score-help").open, true);
  assert.match(el("#score-help-body").html, /约 15%[^]*神作提名 95 › 超大杯 85–94/);
  el("#score-help").close();
});

test("题材「不看」：带这个题材的作品藏起来（没有题材资料的不受影响），卡片、页签部数、年份条、题材窗口、小标签、今天玩什么都跟着", async () => {
  const { openToday } = await import("../src/todayui.ts");
  const { countGenres } = await import("../src/genres.ts");
  const all = [...games.values()].filter(g => g.state !== "dev");
  const [[tag]] = countGenres(all);
  const hidden = new Set(all.filter(g => g.genres?.includes(tag)).map(g => g.id));
  assert.ok(hidden.size > 0 && hidden.size < all.length);
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year", group: true, bands: [], notGenres: [tag] });
  render(); flush();
  const shown = cards();
  assert.equal(shown.length, all.length - hidden.size);
  assert.ok(!shown.some(id => hidden.has(id)));
  assert.ok(shown.some(id => !games.get(id).genres)); // 没有题材资料的作品照样在
  const jumps = [...el("#year-jump").html.matchAll(/<span class="n">(\d+)<\/span>/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.equal(jumps, shown.length);
  assert.match(el("#tabs").html, new RegExp(`data-tab="all" aria-selected="true">全部<span class="n">${shown.length}</span>`));
  assert.equal(el("#genre-chips").hidden, false);
  assert.ok(el("#genre-chips").html.includes(`不看：${genreLabel(tag)} ×`));
  // 题材窗口：不看的标签带状态，部数写它藏起来几部
  el("#genres").open = true; render();
  const inAll = [...games.values()].filter(g => g.genres?.includes(tag)).length;
  assert.match(el("#genre-list").html, new RegExp(`data-genre="${tag}" data-state="not" aria-pressed="mixed"\\s+aria-label="[^"]*：不看（${inAll} 部）"`));
  assert.match(el("#genre-list").html, /data-state="" aria-pressed="false"/);
  el("#genres").open = false;
  // 今天玩什么：带不看题材的不挑
  const a = all.find(g => hidden.has(g.id)), b = all.find(g => !g.genres);
  data.marks[a.id] = { status: "want", fav: false, score: 0 };
  data.marks[b.id] = { status: "want", fav: false, score: 0 };
  for (let i = 0; i < 5; i++) { openToday(); assert.match(el("#today-body").html, new RegExp(`data-id="${b.id}"`)); }
  delete data.marks[a.id]; delete data.marks[b.id];
  data.ui.notGenres = []; render(); flush();
  assert.equal(cards().length, all.length);
  assert.equal(el("#genre-chips").hidden, true);
  data.ui.group = false;
});
test("第一次打开问不想看的题材：别的窗口开着时等它关了再问；列出最常见的 30 个，点了是不看，「好了」存进 notGenres，「跳过」只记问过，问过就不再问", async () => {
  const { maybeAskGenres, bindGenreAsk } = await import("../src/genreaskui.ts");
  const { countGenres } = await import("../src/genres.ts");
  globalThis.window ??= { setTimeout: () => 0 }; // save() 只排个定时器，测试里不真的写盘
  bindGenreAsk();
  Object.assign(data.ui, { view: "library", genreAsked: false, notGenres: [] });
  const ask = el("#genre-ask"), other = el("#news-for-test"), qsa = document.querySelectorAll;
  other.open = true;
  document.querySelectorAll = s => (s === "dialog" ? [other] : qsa(s));
  maybeAskGenres();
  assert.equal(ask.open, false);
  other.open = false; other.emit("close");
  document.querySelectorAll = qsa;
  assert.equal(ask.open, true);
  assert.equal((el("#genre-ask-list").html.match(/data-ask=/g) ?? []).length, 30);
  const [[tag, n]] = countGenres(games.values());
  el("#genre-ask-list").emit("click", { closest: s => (s === "[data-ask]" ? { dataset: { ask: tag } } : null) });
  assert.match(el("#genre-ask-list").html, new RegExp(`data-ask="${tag}" aria-pressed="true" data-state="not"\\s+aria-label="[^"]*（${n} 部）：不看"`));
  el("#genre-ask-ok").emit("click");
  assert.deepEqual(data.ui.notGenres, [tag]);
  assert.equal(data.ui.genreAsked, true);
  assert.equal(ask.open, false);
  maybeAskGenres();
  assert.equal(ask.open, false); // 问过就不再问
  // 跳过：不改不看的题材，只记问过；搜索按名字找
  Object.assign(data.ui, { genreAsked: false, notGenres: [] });
  maybeAskGenres();
  el("#genre-ask-q").value = genreLabel(tag); el("#genre-ask-q").emit("input");
  assert.match(el("#genre-ask-list").html, new RegExp(`data-ask="${tag}"`));
  el("#genre-ask-skip").emit("click");
  assert.deepEqual(data.ui.notGenres, []);
  assert.equal(data.ui.genreAsked, true);
  // 按 Esc 关掉也算问过
  data.ui.genreAsked = false; maybeAskGenres(); ask.close();
  assert.equal(data.ui.genreAsked, true);
  render(); flush();
});

test("题材窗口：还没有题材标签的作品有几部就写几部，都有标签就不写", () => {
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", notGenres: [] });
  el("#genres").open = true; render();
  const untagged = [...games.values()].filter(g => !g.genres?.length).length;
  assert.ok(untagged > 0);
  assert.equal(el("#genre-untagged").hidden, false);
  assert.equal(el("#genre-untagged").textContent, `有 ${untagged} 部作品还没有题材标签，不受「不看」影响。`);
  const withTags = [...games.values()].find(g => g.genres?.length);
  data.ui.cat = "__only_tagged__";
  games.set("__tagged__", { ...withTags, id: "__tagged__", cat: "__only_tagged__" });
  render();
  assert.equal(el("#genre-untagged").hidden, true);
  games.delete("__tagged__");
  el("#genres").open = false; data.ui.cat = "all"; render(); flush();
});
test("不显示的题材：存着的「不看」照旧把作品藏起来，但小标签、题材窗口、详情页、第一次问的窗口里都不出现", async () => {
  const { maybeAskGenres } = await import("../src/genreaskui.ts");
  const withHidden = [...games.values()].filter(g => g.hiddenGenres?.includes("206"));
  assert.ok(withHidden.length > 0);
  assert.ok(![...games.values()].some(g => g.genres?.includes("206")));
  Object.assign(data.ui, { view: "library", cat: "all", tab: "all", sort: "year", group: false, bands: [], notGenres: ["206"] });
  el("#genres").open = true; render(); flush();
  assert.ok(!cards().some(id => withHidden.some(g => g.id === id)));
  assert.equal(el("#genre-chips").hidden, true);
  assert.doesNotMatch(el("#genre-list").html, /data-genre="(206|210|211|504|531)"/);
  el("#genres").open = false;
  openDetail(withHidden[0].id);
  assert.doesNotMatch(el("#detail-info").html, /data-genre="206"/);
  el("#detail").close();
  data.ui.genreAsked = false; maybeAskGenres();
  assert.doesNotMatch(el("#genre-ask-list").html, /data-ask="(206|210|211|504|531)"/);
  el("#genre-ask-ok").emit("click");
  assert.deepEqual(data.ui.notGenres, ["206"]); // 没显示的照样留着
  data.ui.notGenres = []; render(); flush();
});