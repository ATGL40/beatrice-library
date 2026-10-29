// —— 返回顶部：往下翻了大约一屏后右下角出现一个小按钮，点一下平滑回到顶部（图鉴、排行榜都是整页滚动）——

/**
 * 不监听滚动、滚动时也不读布局：页面最上面放一块一屏高、看不见的标记（#top-mark），
 * 用 IntersectionObserver 看它还在不在视口里——整块滚出去了就是往下翻过一屏，显示按钮；回到顶上就藏起来
 */
export function bindToTop(doc: Document = document, win: Window & typeof globalThis = window) {
  const btn = doc.querySelector<HTMLButtonElement>("#to-top"), mark = doc.querySelector<HTMLElement>("#top-mark");
  if (!btn || !mark || typeof win.IntersectionObserver !== "function") return;
  btn.hidden = true;
  new win.IntersectionObserver((entries: IntersectionObserverEntry[]) => { btn.hidden = entries[entries.length - 1].isIntersecting; }).observe(mark);
  btn.addEventListener("click", () => {
    // 系统设置了「减少动态效果」的直接跳过去
    const reduce = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    win.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
}
