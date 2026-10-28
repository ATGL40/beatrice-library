/** 连续输入只处理最后一次；换窗口时可以取消 */
export function debounce<T extends unknown[]>(run: (...args: T) => void, ms = 120) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const call = (...args: T) => {
    cancel();
    timer = setTimeout(() => { timer = undefined; run(...args); }, ms);
  };
  return Object.assign(call, { cancel });
}

/** 长列表分帧追加；重新筛选、关闭窗口时取消旧任务 */
export function renderBatches<T>(items: T[], append: (part: T[]) => void, size = 24,
  schedule: (run: () => void) => number = run => requestAnimationFrame(run),
  unschedule: (id: number) => void = id => cancelAnimationFrame(id)) {
  let at = 0, frame = 0, stopped = false;
  const next = () => {
    if (stopped) return;
    append(items.slice(at, at += size));
    if (!stopped && at < items.length) frame = schedule(next);
  };
  if (items.length) next();
  return () => { stopped = true; unschedule(frame); };
}

/** 内容没变就保留节点，免得封面、焦点和菜单跟着重建 */
export function setHtml(el: HTMLElement, html: string) {
  // innerHTML 会规范化引号等写法，保存原文来比较
  const cached = htmlCache.get(el);
  if (cached?.source === html && cached.actual === el.innerHTML) return;
  el.innerHTML = html;
  htmlCache.set(el, { source: html, actual: el.innerHTML });
}
const htmlCache = new WeakMap<HTMLElement, { source: string; actual: string }>();
