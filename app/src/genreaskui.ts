import { countGenres } from "./genres";
import { askTags } from "./genreask";
import { games, genreLabel, genreNamesAll, render } from "./library";
import { data, save } from "./store";
import { $, esc } from "./ui";

// —— 第一次打开时问一次「有没有不想看的题材？」（ui.genreAsked 记着问过没有；老用户更新后也问一次）。
//    选中的就是题材里的「不看」；别的窗口（比如「资料更新了」）开着时等它关了再问 ——

const dlg = () => $("#genre-ask") as HTMLDialogElement;
let picked = new Set<string>(), counts: [string, number][] = [];

function renderAsk() {
  const q = ($("#genre-ask-q") as HTMLInputElement).value;
  const n = new Map(counts);
  const ids = askTags(counts, picked, q, genreNamesAll);
  $("#genre-ask-list").innerHTML = ids.length
    ? ids.map(id => {
      const on = picked.has(id), name = genreLabel(id);
      return `<button type="button" class="genre" data-ask="${esc(id)}" aria-pressed="${on}"${on ? ` data-state="not"` : ""}
        aria-label="${esc(`${name}（${n.get(id) ?? 0} 部）${on ? "：不看" : ""}`)}">${on ? `<span class="not-tag">不看</span>` : ""}${esc(name)}<span class="n">${n.get(id) ?? 0}</span></button>`;
    }).join("")
    : `<p class="hint">没有找到这个题材。</p>`;
}

/** 该问就问：问过了、资料里没有题材就不问；别的窗口开着时等它关了 */
export function maybeAskGenres() {
  if (data.ui.genreAsked || dlg().open) return;
  counts = countGenres(games.values());
  if (!counts.length) return; // 资料里没有题材（比如很旧的数据包）：这次不问，也不记成问过
  const other = [...document.querySelectorAll<HTMLDialogElement>("dialog")].find(d => d.open);
  if (other) { other.addEventListener("close", () => maybeAskGenres(), { once: true }); return; }
  picked = new Set(data.ui.notGenres);
  ($("#genre-ask-q") as HTMLInputElement).value = "";
  renderAsk();
  dlg().showModal();
}

/** 记成问过（好了、跳过、按 Esc 关掉都是） */
function done() {
  if (data.ui.genreAsked) return;
  data.ui.genreAsked = true;
  save();
}

export function bindGenreAsk() {
  $("#genre-ask-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ask]");
    if (!b) return;
    const id = b.dataset.ask!;
    if (!picked.delete(id)) picked.add(id);
    renderAsk();
    // 重画后焦点还在这个标签上，键盘可以接着点
    ($("#genre-ask-list").querySelector(`[data-ask="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
  });
  $("#genre-ask-q").addEventListener("input", renderAsk);
  $("#genre-ask-ok").addEventListener("click", () => {
    // 原来「不看」的顺序不变，新选的接在后面
    data.ui.notGenres = [...data.ui.notGenres.filter(id => picked.has(id)), ...[...picked].filter(id => !data.ui.notGenres.includes(id))];
    done(); dlg().close(); render();
  });
  $("#genre-ask-skip").addEventListener("click", () => { done(); dlg().close(); });
  dlg().addEventListener("close", done);
}
