import { countGenres } from "./genres";
import { askTags } from "./genreask";
import { games, genreIds, genreKnown, genreLabel, genreNamesAll, nameOf } from "./library";
import { currentTagReport, makeTagReport, TAG_NOTE_MAX } from "./tagreport";
import { data, save } from "./store";
import { $, esc, toast } from "./ui";

// —— 「标签不对？」：详情页题材旁的小按钮打开。勾出不对的标签、从题材字典里挑出少了的、写一句说明，「记下」存在 data.tagReports，
//    提交给碧翠子禁书库时可以一起发（见 tagreport.ts）。我的游戏没有 ——

const dlg = () => $("#tagreport") as HTMLDialogElement;
let current = "", after = () => {};
/** 勾了「不对」的、挑出来「少了」的（只在窗口开着时用，「记下」才存） */
let wrong = new Set<string>(), missing = new Set<string>();
/** 「少了」能挑的：字典里的题材（不显示的、并进学生的变体本来就不在字典里），部数多的在前，这部作品已经带着的不算 */
let pool: [string, number][] = [];

function renderWrong() {
  const tags = games.get(current)?.genres ?? [];
  $("#tagreport-wrong").innerHTML = tags.length
    ? tags.map(id => `<li><label><input type="checkbox" data-wrong="${esc(id)}"${wrong.has(id) ? " checked" : ""} />
      <span class="path">${esc(genreLabel(id))}</span><small>不对</small></label></li>`).join("")
    : `<li class="hint">这部作品还没有题材标签，可以在下面挑出少了的。</li>`;
}

function renderMissing() {
  const ids = askTags(pool, missing, ($("#tagreport-q") as HTMLInputElement).value, genreNamesAll);
  $("#tagreport-list").innerHTML = ids.length
    ? ids.map(id => `<button type="button" class="genre" data-pick="${esc(id)}" aria-pressed="${missing.has(id)}">${esc(genreLabel(id))}</button>`).join("")
    : `<p class="hint">没有找到这个题材。</p>`;
  $("#tagreport-picked").textContent = missing.size ? `少了：${[...missing].map(genreLabel).join("、")}` : "";
}

/** 打开某部作品的标签报告；有旧的就填进去（按现在的资料筛过：已经改好的不再列）。done：记下或删除以后调用（详情页刷新） */
export function openTagReport(id: string, done = () => {}) {
  const g = games.get(id);
  if (!g || g.src === "local") return;
  current = id; after = done;
  const old = data.tagReports[id], r = currentTagReport(old, g, genreKnown);
  wrong = new Set(r?.wrong ?? []); missing = new Set(r?.missing ?? []);
  const have = new Set(g.genres ?? []), n = new Map(countGenres(games.values()));
  pool = genreIds().filter(x => !have.has(x)).map(x => [x, n.get(x) ?? 0] as [string, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("#tagreport-what").textContent = `「${nameOf(g)}」`;
  ($("#tagreport-q") as HTMLInputElement).value = "";
  ($("#tagreport-note") as HTMLTextAreaElement).value = old?.note ?? "";
  $("#tagreport-delete").hidden = !old;
  renderWrong();
  renderMissing();
  dlg().showModal();
}

/** 记下：什么都没勾、没挑、没写就当删掉 */
function keep() {
  const r = makeTagReport([...wrong], [...missing], ($("#tagreport-note") as HTMLTextAreaElement).value), had = !!data.tagReports[current];
  if (r) data.tagReports[current] = r; else delete data.tagReports[current];
  save(); dlg().close(); after();
  toast(r ? "已记下标签报告；提交给碧翠子禁书库时可以一起发" : had ? "什么都没选，已删除这条标签报告" : "什么都没选，没有记下");
}

function drop() {
  delete data.tagReports[current];
  save(); dlg().close(); after();
  toast("已删除这条标签报告");
}

export function bindTagReport() {
  ($("#tagreport-note") as HTMLTextAreaElement).maxLength = TAG_NOTE_MAX;
  $("#tagreport-wrong").addEventListener("change", e => {
    const t = e.target as HTMLInputElement, id = t.dataset.wrong;
    if (!id) return;
    if (t.checked) wrong.add(id); else wrong.delete(id);
  });
  $("#tagreport-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!b) return;
    const id = b.dataset.pick!;
    if (!missing.delete(id)) missing.add(id);
    renderMissing();
  });
  $("#tagreport-q").addEventListener("input", renderMissing);
  $("#tagreport-save").addEventListener("click", keep);
  $("#tagreport-delete").addEventListener("click", drop);
}
