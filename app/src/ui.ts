import { esc } from "./text";
export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export { esc } from "./text";

let toastTimer = 0;
/** 底部提示；给了 undo 就带一个「撤销」按钮 */
export function toast(text: string, undo?: () => void) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">撤销</button>` : ""}`;
  el.hidden = false;
  // 重新弹出，才会盖在后打开的对话框上面
  try { if (el.matches(":popover-open")) el.hidePopover(); el.showPopover(); } catch { /* 不支持 popover 时照常显示 */ }
  el.querySelector("button")?.addEventListener("click", () => { undo?.(); el.hidden = true; }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), undo ? 6000 : 3000);
}

// 对话框里带 data-close 的按钮都能关掉对话框
document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest("[data-close]");
  b?.closest("dialog")?.close();
});
