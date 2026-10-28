import { sameCircle } from "./catalog";
import { bindActions, catScores, controlsHtml, games, genreLabel, markBits, metaHtml, nameOf, ranking, render, showGenre } from "./library";
import { TIERS, tierOf } from "./tiers";
import { NOTE_MAX } from "./marks";
import { data, hasMark, mark, pruneMark, save, type Game, type Lang } from "./store";
import { $, esc } from "./ui";

// —— 作品详情：大封面、三语名字、我的评论、别人的评分和评论 ——
const LANG_LABEL: Record<Lang, string> = { zh: "中文", en: "English", ja: "日本語" };
let current = "";

const dlg = () => $("#detail") as HTMLDialogElement;

/** 「图鉴综合榜：第 3 名 · 87 分（口碑 92 · 热度 80 · 榜单 70）」，名次跟着当前分类；没排名就不显示 */
function overallLine(id: string) {
  const s = catScores().get(id);
  if (!s?.rank || s.total === null) return "";
  const parts = s.parts.filter(p => p.score !== null).map(p => `${p.label} ${Math.round(p.score!)}`).join(" · ");
  return `<div class="note overall">${esc(ranking.scoring.name)}：第 ${s.rank} 名 · ${Math.round(s.total)} 分${parts ? `（${esc(parts)}）` : ""}</div>`;
}

/** 一排五个档位按钮：点一下放进那一档末尾，再点一次移出 */
function tierButtons(id: string) {
  const at = tierOf(data.tiers, id);
  return `<div class="tier-btns" role="group" aria-label="我的梯度表"><span class="hint">梯度</span>${TIERS.map(([k, l]) =>
    `<button class="tier-btn tier-${k}" data-act="tier" data-t="${k}" aria-pressed="${at?.tier === k}" title="${at?.tier === k ? `第 ${at.pos} · 再点一次移出` : `放进「${l}」末尾`}">${l}</button>`).join("")}</div>`;
}

/** 题材标签：点一个就关掉详情、在图鉴里只看这个题材 */
function genreChips(g: Game) {
  if (!g.genres?.length) return "";
  return `<div class="chips">${g.genres.map(id => `<button class="chip" data-genre="${esc(id)}" title="在图鉴里只看这个题材">${esc(genreLabel(id))}</button>`).join("")}</div>`;
}

/** 同社团的其他作品：小行，点了换成那部的详情 */
function circleHtml(g: Game) {
  const list = sameCircle(g, games.values());
  const year = (x: Game) => (x.state === "dev" ? "开发中" : (x.date || "").slice(0, 4));
  return list.length
    ? list.map(x => `<li class="rank-row" data-id="${esc(x.id)}" data-open title="打开详情"><span class="th">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : ""}</span>
        <span class="nm">${esc(nameOf(x))}</span><span class="sc">${esc(year(x))}</span></li>`).join("")
    : "";
}

function fill() {
  const g = games.get(current);
  if (!g) return;
  const name = nameOf(g);
  $("#detail-body").dataset.id = g.id;
  $("#detail-cover").innerHTML = g.cover ? `<img src="${esc(g.cover)}" alt="${esc(name)} 封面">` : `<span class="none">暂无封面</span>`;
  const names = (["zh", "en", "ja"] as const)
    .filter(l => g.names?.[l])
    .map(l => `<li><small>${LANG_LABEL[l]}</small>${esc(g.names[l])}${g.mt?.includes(l) ? `<span class="mt">机翻</span>` : ""}</li>`)
    .join("");
  $("#detail-info").innerHTML = `
    <h2>${esc(name)}</h2>
    <ul class="names">${names}</ul>
    <div class="meta">${metaHtml(g)}</div>
    ${genreChips(g)}
    ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
    ${overallLine(g.id)}
    ${controlsHtml(g)}
    ${tierButtons(g.id)}`;
  const circle = circleHtml(g);
  $("#detail-circle").hidden = !circle;
  $("#detail-circle-list").innerHTML = circle;
  const others = data.friends
    .map(f => [f, f.marks[g.id]] as const)
    .filter(([, m]) => m && hasMark(m));
  $("#detail-friends").innerHTML = others.length
    ? others.map(([f, m]) => `<li><div><b>${esc(f.name)}</b> <span class="hint">${esc(markBits(m))}</span></div>
        ${m.note ? `<p>${esc(m.note)}</p>` : ""}</li>`).join("")
    : `<li class="hint">还没有别人的评分。在设置里「导入评分文件」后，这里会显示他们的星级和评论。</li>`;
}

/** 离开一部作品时：评论去掉首尾空白，卡片上的「我的评论」标记也更新 */
function commitNote() {
  const m = data.marks[current];
  if (m?.note !== undefined) m.note = m.note.trim();
  pruneMark(current);
  save();
}

export function openDetail(id: string) {
  // 详情页里点同社团作品会直接换成那部：先把上一部的评论收好
  if (dlg().open && current !== id) commitNote();
  current = id;
  fill();
  const note = $("#my-note") as HTMLTextAreaElement;
  note.value = mark(id).note ?? "";
  if (!dlg().open) dlg().showModal();
  $("#detail").scrollTop = 0;
}

/** 卡片上的按钮改了标记后，详情页也跟着更新（评论框不动，免得打断输入） */
export function refreshDetail() {
  if (dlg().open) fill();
}

export function bindDetail() {
  bindActions($("#detail-body"));
  const note = $("#my-note") as HTMLTextAreaElement;
  note.maxLength = NOTE_MAX;
  note.addEventListener("input", () => {
    data.marks[current] = { ...mark(current), note: note.value };
    pruneMark(current);
    save();
  });
  dlg().addEventListener("close", () => { commitNote(); render(); });
  // 题材标签：关掉详情，图鉴里只看这个题材
  $("#detail-info").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-genre]");
    if (b) { dlg().close(); showGenre(b.dataset.genre!); }
  });
}
