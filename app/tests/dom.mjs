// 资料更新小结、全部数据备份、今天玩什么的界面测试共用：内存里的 DOM 替身和记录调用的后端替身，不碰 Tauri 和用户目录。
// 先 import 这个文件，再用 await import 载入 src 里的模块
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

/** 后端调用记录 [命令, 参数, 选项]；handlers 里按命令名放替身（没有的返回 null），open / save 是系统选文件窗口的替身 */
globalThis.calls = [];
globalThis.handlers = {};
const backend = "data:text/javascript," + encodeURIComponent(`
  export const invoke = async (cmd, args, opts) => {
    globalThis.calls.push([cmd, args, opts]);
    const h = globalThis.handlers[cmd];
    return h ? h(args, opts) : null;
  };
  export const open = async o => globalThis.handlers.open ? globalThis.handlers.open(o) : null;
  export const save = async o => globalThis.handlers.save ? globalThis.handlers.save(o) : null;
  export const appDataDir = async () => "C:/app";
  export const convertFileSrc = path => "asset://" + path;
  const none = () => {};
  export const getCurrentWindow = () => ({ setTitle: async () => {} });
  export const listen = async () => none;
  export { none as openUrl, none as revealItemInDir };
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

const frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = run => { frames.set(++frameId, run); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.CSS = { escape: s => s };
globalThis.window = globalThis;
globalThis.scrollTo = () => {};
globalThis.addEventListener = () => {};
globalThis.reloaded = 0;
globalThis.location = { reload: () => { globalThis.reloaded++; } };
export const flush = () => { while (frames.size) { const [id, run] = frames.entries().next().value; frames.delete(id); run(); } };

export class Element {
  constructor() { this.html = ""; this.grids = []; this.listeners = new Map(); this.open = false; this.value = ""; this.checked = false; this.hidden = false; this.textContent = ""; this.dataset = {}; this.disabled = false; }
  set innerHTML(html) { this.html = html; this.grids = [...html.matchAll(/<div class="grid">/g)].map(() => new Element()); }
  get innerHTML() { return this.html; }
  insertAdjacentHTML(position, html) { assert.equal(position, "beforeend"); this.html += html; }
  querySelectorAll(s) { return s === ".grid" ? this.grids : []; }
  querySelector() { return null; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  async emit(type, target = this) { for (const fn of this.listeners.get(type) ?? []) await fn({ target, currentTarget: this }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  setAttribute() {}
  matches() { return false; }
  showPopover() {} hidePopover() {}
  classList = { toggle() {}, contains: () => false };
}
const elements = new Map();
export const el = s => { if (!elements.has(s)) elements.set(s, new Element()); return elements.get(s); };
globalThis.document = {
  addEventListener() {},
  querySelector: el,
  querySelectorAll: () => [],
  createElement: () => new Element(),
  title: "",
  documentElement: { scrollHeight: 0 },
};

/** 点击事件的 target 替身：attrs 是它（和它外层）带的属性，closest("[data-x]") 有这个属性就返回自己 */
export function target(attrs) {
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith("data-")) dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
  const t = {
    dataset,
    closest(sel) {
      const names = [...sel.matchAll(/\[([\w-]+)\]/g)].map(m => m[1]);
      return names.some(n => n in attrs) ? t : null;
    },
  };
  return t;
}

/** 卡片 id（按画的顺序） */
export const ids = s => [...s.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);
export const cards = () => el("#list").grids.flatMap(g => ids(g.html));
/** 等后台的 Promise 都跑完 */
export const tick = () => new Promise(r => setTimeout(r, 0));
