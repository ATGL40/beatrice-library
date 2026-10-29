import { openDetail } from "./detail";
import { finalFor, games, nameOf, showOnly } from "./library";
import { cleanSnap, diffSnaps, hasNews, makeSnap, newerThan, scoreChangeText, type CatalogNews } from "./news";
import { data, save, type Catalog } from "./store";
import { $, esc } from "./ui";

// —— 资料更新小结：启动时和导入数据包后，资料比上次看过的新，就弹一个小窗口列出变化（设置里可以关；关了也照样记快照） ——

/** 设置里「更新资料后显示变化」，默认开 */
export const newsOn = () => data.catalogNews !== false;
/** 每类最多列几部，多的写「还有 N 部」 */
const LIST_MAX = 50;

/**
 * 换上一份资料以后调用（启动时、导入数据包后，在 setCatalog 之后）：记下这份资料的快照；
 * 比上次记的新、设置里开着、又有变化时弹小结。第一次（还没有快照）只记不弹。返回比出来的变化（测试用）
 */
export function noteCatalog(cat: Catalog): CatalogNews | null {
  const now = makeSnap(cat, cat.games, finalFor, data.marks, g => nameOf(g));
  const old = cleanSnap(data.catalogSeen);
  const same = !!old && old.updated === now.updated && old.revision === now.revision;
  // 同一份资料：只在快照有变化时（比如新标记了作品，要记下名字）重写
  if (!same || JSON.stringify(old) !== JSON.stringify(now)) { data.catalogSeen = now; save(); }
  if (!old || same || !newerThan(now, old)) return null;
  const news = diffSnaps(old, now, data.marks);
  if (newsOn() && hasNews(news)) showNews(news);
  return news;
}

const gameName = (id: string) => { const g = games.get(id); return g ? nameOf(g) : id; };
/** 一类变化：标题带部数，每行是能点开详情的名字和一句说明 */
function block(title: string, rows: { id: string; text: string; open: boolean; name?: string }[], extra = "") {
  if (!rows.length) return "";
  const li = rows.slice(0, LIST_MAX).map(r => `<li>${r.open ? `<button class="link" data-id="${esc(r.id)}">${esc(gameName(r.id))}</button>` : `<span>${esc(r.name ?? r.id)}</span>`}${r.text ? `<small>${esc(r.text)}</small>` : ""}</li>`).join("");
  const more = rows.length > LIST_MAX ? `<li class="hint">还有 ${rows.length - LIST_MAX} 部</li>` : "";
  return `<section><h3>${esc(title)}（${rows.length}）</h3>${extra}<ul class="news-list">${li}${more}</ul></section>`;
}

/** 小结的内容（单独拆出来，方便测试） */
export function newsHtml(n: CatalogNews) {
  const added = n.added.length
    ? `<section><h3>新收录 ${n.added.length} 部</h3><div class="row"><button class="btn small" data-news-added>在图鉴里看看这些作品</button></div></section>` : "";
  return `<p class="hint">资料 ${esc(n.from)} → ${esc(n.to)}。只比较本机的新旧两份资料，不联网；可以在设置 → 作品资料里关掉这个小结。</p>`
    + added
    + block("你列表里的作品分数变了", n.scores.map(c => ({ id: c.id, text: scoreChangeText(c), open: games.has(c.id) })), `<p class="hint">想玩、已有、玩过、收藏里的作品。</p>`)
    + block("开发中的作品有消息", n.dev.map(d => ({ id: d.id, text: d.released ? "已经发售" : `发售日 ${d.date}`, open: games.has(d.id) })))
    + block("移出图鉴的作品", n.removed.map(r => ({ id: r.id, name: r.name, text: "", open: false })), `<p class="hint">你标记过它们，标记还留在数据里；新资料里没有了。</p>`);
}

let shown: CatalogNews | null = null;
export function showNews(n: CatalogNews) {
  shown = n;
  $("#news-body").innerHTML = newsHtml(n);
  const d = $("#news") as HTMLDialogElement;
  if (!d.open) d.showModal();
}

export function bindNews() {
  const d = $("#news") as HTMLDialogElement;
  $("#news-body").addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-news-added]") && shown) { d.close(); showOnly(shown.added, "新收录"); return; }
    const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id && games.has(id)) { d.close(); openDetail(id); }
  });
  const box = $("#catalog-news") as HTMLInputElement;
  $("#open-settings").addEventListener("click", () => { box.checked = newsOn(); });
  box.addEventListener("change", () => { data.catalogNews = box.checked; save(); });
}
