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
const { render, setCatalog, games, ranking, v2Order } = await import("../src/library.ts");
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
