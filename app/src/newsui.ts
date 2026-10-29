import { openDetail } from "./detail";
import { finalFor, games, nameOf, showOnly } from "./library";
import {
  addRecord, cleanChangelog, cleanHistory, cleanSnap, diffSnaps, hasNews, makeSnap, newerThan, scoreChangeText, toRecord, versionLabel, versionList,
  type CatalogNews, type ChangelogEntry, type DevNews, type ScoreChange, type Version,
} from "./news";
import { data, save, type Catalog } from "./store";
import { $, esc } from "./ui";

// —— 资料更新小结：启动时和导入数据包后，资料比上次看过的新，就弹一个小窗口：最上面是我们写的更新说明，下面是跟你有关的变化（设置里可以关；关了也照样记快照和记录） ——
// —— 资料更新记录：设置里和小结里都能打开，选一个版本看它的更新说明和当时算的你的变化 ——

/** 设置里「更新资料后显示变化」，默认开 */
export const newsOn = () => data.catalogNews !== false;
/** 每类最多列几部，多的写「还有 N 部」 */
const LIST_MAX = 50;

/** 现在用的资料：版本和它带的更新说明（每次换资料时在 noteCatalog 里记下） */
let current: { version: Version | null; changelog: ChangelogEntry[] } = { version: null, changelog: [] };
const notesOf = (v: Version) => current.changelog.find(e => versionLabel(e) === versionLabel(v));

/**
 * 换上一份资料以后调用（启动时、导入数据包后，在 setCatalog 之后）：记下这份资料的快照；
 * 比上次记的新时，把你的变化存进更新记录，设置里开着、又有变化或更新说明时弹小结。第一次（还没有快照）只记不弹。返回比出来的变化（测试用）
 */
export function noteCatalog(cat: Catalog): CatalogNews | null {
  current = { version: { updated: cat.updated, revision: cat.revision }, changelog: cleanChangelog(cat.changelog) };
  const now = makeSnap(cat, cat.games, finalFor, data.marks, g => nameOf(g));
  const old = cleanSnap(data.catalogSeen);
  const same = !!old && old.updated === now.updated && old.revision === now.revision;
  // 同一份资料：只在快照有变化时（比如新标记了作品，要记下名字）重写
  if (!same || JSON.stringify(old) !== JSON.stringify(now)) { data.catalogSeen = now; save(); }
  if (!old || same || !newerThan(now, old)) return null;
  const news = diffSnaps(old, now, data.marks);
  data.catalogHistory = addRecord(cleanHistory(data.catalogHistory), toRecord(news, gameName));
  save();
  if (newsOn() && (hasNews(news) || notesOf(news.version))) showNews(news);
  return news;
}

const gameName = (id: string) => { const g = games.get(id); return g ? nameOf(g) : id; };
/** 一类变化：标题带部数，每行是名字（还在图鉴里的能点开详情）和一句说明 */
function block(title: string, rows: { id: string; text: string; name: string }[], extra = "") {
  if (!rows.length) return "";
  const li = rows.slice(0, LIST_MAX).map(r => `<li>${games.has(r.id) ? `<button class="link" data-id="${esc(r.id)}">${esc(gameName(r.id))}</button>` : `<span>${esc(r.name)}</span>`}${r.text ? `<small>${esc(r.text)}</small>` : ""}</li>`).join("");
  const more = rows.length > LIST_MAX ? `<li class="hint">还有 ${rows.length - LIST_MAX} 部</li>` : "";
  return `<section><h3>${esc(title)}（${rows.length}）</h3>${extra}<ul class="news-list">${li}${more}</ul></section>`;
}

/** 我们写的更新说明 */
function notesHtml(e: ChangelogEntry | undefined) {
  return e ? `<section><h3>更新说明</h3><ul class="news-notes">${e.notes.map(s => `<li>${esc(s)}</li>`).join("")}</ul></section>` : "";
}

/** 跟你有关的变化（小结和更新记录共用）；name 是作品已经不在图鉴里时用的名字；addedButton 是要不要「在图鉴里看看这些作品」 */
function changesHtml(c: { added: number; scores: ScoreChange[]; dev: DevNews[]; removed: { id: string; name: string }[] }, name: (id: string) => string, addedButton: boolean) {
  const added = c.added
    ? `<section><h3>新收录 ${c.added} 部</h3>${addedButton ? `<div class="row"><button class="btn small" data-news-added>在图鉴里看看这些作品</button></div>` : ""}</section>` : "";
  return added
    + block("你列表里的作品分数变了", c.scores.map(x => ({ id: x.id, text: scoreChangeText(x), name: name(x.id) })), `<p class="hint">想玩、已有、玩过、收藏里的作品。</p>`)
    + block("开发中的作品有消息", c.dev.map(d => ({ id: d.id, text: d.released ? "已经发售" : `发售日 ${d.date}`, name: name(d.id) })))
    + block("移出图鉴的作品", c.removed.map(r => ({ id: r.id, name: r.name, text: "" })), `<p class="hint">你标记过它们，标记还留在数据里；新资料里没有了。</p>`);
}

/** 小结的内容（单独拆出来，方便测试） */
export function newsHtml(n: CatalogNews) {
  return notesHtml(notesOf(n.version))
    + `<p class="hint">资料 ${esc(n.from)} → ${esc(n.to)}。跟你有关的变化只比较本机的新旧两份资料，不联网；可以在设置 → 作品资料里关掉这个小结。</p>`
    + changesHtml({ ...n, added: n.added.length }, gameName, true)
    + `<div class="row"><button class="link" data-news-log>看所有版本</button></div>`;
}

let shown: CatalogNews | null = null;
export function showNews(n: CatalogNews) {
  shown = n;
  $("#news-body").innerHTML = newsHtml(n);
  const d = $("#news") as HTMLDialogElement;
  if (!d.open) d.showModal();
}

// —— 资料更新记录 ——
/** 能选的版本：现在用的、更新说明里有的、存过记录的 */
const logVersions = () => versionList(current.changelog, cleanHistory(data.catalogHistory), current.version ?? undefined);

/** 一个版本的内容：更新说明，和那次更新时算的你的变化（没有记录就写一句） */
export function logHtml(v: Version) {
  const rec = cleanHistory(data.catalogHistory).find(r => versionLabel(r) === versionLabel(v));
  const notes = notesOf(v);
  const mine = rec
    ? `<p class="hint">这次是从 ${esc(rec.from || "更早的资料")} 更新过来的，下面是当时算的。</p>${changesHtml(rec, id => rec.names[id] ?? id, false) || `<p class="hint">没有和你有关的变化。</p>`}`
    : `<p class="hint">这个版本没有你的变化记录：可能是第一次打开软件时用的资料，或者没在这台电脑上更新到它。</p>`;
  return (notes ? notesHtml(notes) : `<p class="hint">这个版本没有写更新说明。</p>`) + `<section><h3>跟你有关的变化</h3>${mine}</section>`;
}

/** 打开「资料更新记录」，选中 v（默认最新的） */
export function openNewsLog(v?: Version) {
  const list = logVersions();
  const sel = $("#news-log-ver") as HTMLSelectElement;
  const cur = current.version && versionLabel(current.version);
  sel.innerHTML = list.map(x => `<option value="${esc(versionLabel(x))}">${esc(versionLabel(x))}${versionLabel(x) === cur ? "（现在用的）" : ""}</option>`).join("");
  const pick = v ?? list[0];
  sel.value = pick ? versionLabel(pick) : "";
  renderLog();
  const d = $("#news-log") as HTMLDialogElement;
  if (!d.open) d.showModal();
}
function renderLog() {
  const v = logVersions().find(x => versionLabel(x) === ($("#news-log-ver") as HTMLSelectElement).value);
  $("#news-log-body").innerHTML = v ? logHtml(v) : `<p class="hint">还没有资料版本的记录。</p>`;
}

export function bindNews() {
  const d = $("#news") as HTMLDialogElement, log = $("#news-log") as HTMLDialogElement;
  $("#news-body").addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-news-added]") && shown) { d.close(); showOnly(shown.added, "新收录"); return; }
    if (t.closest("[data-news-log]")) { d.close(); openNewsLog(shown?.version); return; }
    const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id && games.has(id)) { d.close(); openDetail(id); }
  });
  $("#news-log-body").addEventListener("click", e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id && games.has(id)) { log.close(); openDetail(id); }
  });
  $("#news-log-ver").addEventListener("change", renderLog);
  $("#open-news-log").addEventListener("click", () => openNewsLog());
  const box = $("#catalog-news") as HTMLInputElement;
  $("#open-settings").addEventListener("click", () => { box.checked = newsOn(); });
  box.addEventListener("change", () => { data.catalogNews = box.checked; save(); });
}
