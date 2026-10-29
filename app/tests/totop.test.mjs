// 返回顶部：用内存里的替身检查显示 / 隐藏和点了以后滚到哪，确认没有监听滚动
import test from "node:test";
import assert from "node:assert/strict";
import { bindToTop } from "../src/totop.ts";

function setup({ reduce = false, io = true } = {}) {
  const listeners = {}, scrolls = [], winListeners = [];
  const btn = { hidden: false, addEventListener: (t, f) => (listeners[t] = f) };
  const mark = {};
  let observed, callback;
  const doc = { querySelector: s => (s === "#to-top" ? btn : s === "#top-mark" ? mark : null) };
  const win = {
    IntersectionObserver: io ? class { constructor(cb) { callback = cb; } observe(el) { observed = el; } } : undefined,
    matchMedia: q => ({ matches: reduce && q.includes("reduce") }),
    scrollTo: o => scrolls.push(o),
    addEventListener: (t) => winListeners.push(t),
  };
  bindToTop(doc, win);
  return { btn, mark, listeners, scrolls, winListeners, observed: () => observed, fire: v => callback([{ isIntersecting: v }]) };
}

test("返回顶部：在顶上时藏着，翻过一屏（顶上的标记整个滚出视口）才出现，回到顶上又藏起来", () => {
  const s = setup();
  assert.equal(s.btn.hidden, true);
  assert.equal(s.observed(), s.mark);
  s.fire(false); assert.equal(s.btn.hidden, false);
  s.fire(true); assert.equal(s.btn.hidden, true);
  // 不监听滚动事件（不给滚动加负担）
  assert.deepEqual(s.winListeners, []);
});

test("返回顶部：点了平滑滚到顶；系统要求减少动态效果时直接跳过去", () => {
  const s = setup();
  s.listeners.click();
  assert.deepEqual(s.scrolls, [{ top: 0, behavior: "smooth" }]);
  const r = setup({ reduce: true });
  r.listeners.click();
  assert.deepEqual(r.scrolls, [{ top: 0, behavior: "auto" }]);
});

test("返回顶部：页面里没有按钮、或者不支持 IntersectionObserver 时什么都不做", () => {
  const s = setup({ io: false });
  assert.equal(s.listeners.click, undefined);
  assert.doesNotThrow(() => bindToTop({ querySelector: () => null }, {}));
});

test("返回顶部：页面里有按钮（button、aria-label）和顶上的标记，样式用现成的颜色变量", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="top-mark" aria-hidden="true"><\/div>/);
  assert.match(html, /<button[^>]*id="to-top"[^>]*aria-label="返回顶部"[^>]*hidden/);
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.to-top \{[^}]*position: fixed;[^}]*var\(--panel\)/);
});
