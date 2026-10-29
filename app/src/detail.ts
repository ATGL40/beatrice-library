import { sameCircle } from "./catalog";
import { BLACK_REASON_MAX, canBlacklist } from "./blacklist";
import { bandTag, bindActions, blackTags, catScores, CATS, controlsHtml, toggleBlack, thumbAttrs, finalFor, games, genreLabel, markBits, metaHtml, myDelta, nameOf, playerVotes, ranking, refreshCard, scoreText2, showGenre, thinFor, v2Order } from "./library";
import { godvote, praiseTopLine, SCORE_NOTE_SHORT, THIN_LABEL, THIN_NOTE, type Final } from "./scoring2";
import { openSubmit } from "./submit";
import { openMyGame, removeMyGame } from "./mygames";
import { TIERS, tierOf } from "./tiers";
import { NOTE_MAX } from "./marks";
import { data, hasMark, mark, pruneMark, save, type Game, type Lang } from "./store";
import { $, esc } from "./ui";
import { setHtml } from "./performance";

// —— 作品详情：大封面、三语名字、我的评论、别人的评分和评论 ——
const LANG_LABEL: Record<Lang, string> = { zh: "中文", en: "English", ja: "日本語" };
let current = "";

const dlg = () => $("#detail") as HTMLDialogElement;

const SRC_UNIT: Record<string, (x: number) => string> = {
  dlsite: x => `★${x}`, commercial: x => `中央值 ${x}`, steam: x => `好评率 ${x}%`, vndb: x => `${x} 分`, bgm: x => `${x} 分`, community: x => `★${x}`,
};
const SRC_NAME: Record<string, string> = { dlsite: "DLsite", commercial: "批評空間", steam: "Steam", vndb: "VNDB", bgm: "Bangumi", community: "社区评分" };

/** 第 2 版：口碑和热度从哪来，和神作提名看的四个维度（口★ / 榜 / 玩 / 多），各一句说明 */
function dimsHtml(g: Game) {
  const rc = ranking.v2!, b = ranking.base.get(g.id);
  if (!b) return "";
  const cm = rc.gates.community, n = (v: number) => Math.ceil(v).toLocaleString();
  const unit = (s: string) => SRC_UNIT[s] ?? String;
  const used = b.per.map(s => `${SRC_NAME[s.src] ?? s.src} ${unit(s.src)(s.x)} · ${n(s.n)} 人`).concat(b.lists ? [`上榜 ${b.lists} 次`] : []).join("；");
  const lines = rc.nominee.praiseSources.map(s => [s, praiseTopLine(rc, s, g.src)] as const).filter(([, l]) => l)
    .map(([s, l]) => `${SRC_NAME[s] ?? s} ${unit(s)(l![0])}、${n(l![1])} 人`).join("，或 ");
  const rows: [boolean, string, string][] = [
    [b.dims.praiseTop, "口★", `顶尖口碑：${lines || "暂无"}`],
    [b.dims.lists, "榜", "榜单：上过民间榜单"],
    [b.dims.players, "玩", `玩家：社区评分 ≥ ${cm.minAvg} 星，至少 ${cm.minCount} 人`],
    [b.dims.second, "多", "多个社区：至少两个社区的评分都很高、评价人数也够"],
  ];
  return `<p class="hint">${esc(`口碑 ${Math.round(b.P)}（${used}）· 热度 ${b.hot ? Math.round(b.H) : "无数据"}（和同时期同来源的作品比，中间是 50）`)}</p>
    <ul class="dims">${rows.map(([on, k, t]) => `<li><span class="dim${on ? " on" : ""}">${k}</span>${esc(t)}</li>`).join("")}</ul>`;
}

/** 第 2 版：分数从哪来、为什么封顶、神作提名和复议 */
function whyHtml(g: Game, f: Final) {
  const rc = ranking.v2!, v = godvote(g), votes = v.support + v.oppose ? `（支持 ${v.support} / 反对 ${v.oppose}）` : "";
  const lines = [
    f.canon === "manual" ? "神作：由维护者认定，显示不封顶的分数。" : "",
    f.canon === "vote" ? `神作：神作提名经社区投票升为神作${votes}。` : "",
    f.nominee ? `神作提名：由算法提名（分数够高、口★，并且榜 / 玩 / 多至少 ${rc.nominee.others} 项），社区投票达到门槛后升为神作${votes}。` : "",
    f.reviewed ? `经复议调整（${v.changed}）：社区复议投票${votes}撤下了神作，按分数分档。` : "",
    f.capped !== null ? `除神作和神作提名外，分数最高 ${f.capped}。` : "",
    myVotes(g),
  ].filter(Boolean);
  return lines.map(t => `<p class="hint">${esc(t)}</p>`).join("");
}

/** 我的修正：只按我和朋友的星级算，只给自己看，不改公共分和档 */
function myVotes(g: Game) {
  const d = myDelta(g.id), n = playerVotes(g.id).length;
  return n ? `我的修正 ${d > 0 ? "+" : ""}${d.toFixed(1)}：按我和朋友的 ${n} 个星级算，只给自己看，不改公共分和档。` : "";
}

/** 分数旁的小「?」：鼠标停上去或点开都显示一句说明 */
const QMARK = `<details class="qmark"><summary title="${SCORE_NOTE_SHORT}" aria-label="分数说明">?</summary><span>${SCORE_NOTE_SHORT}</span></details>`;

/** 第 2 版的综合榜一行：「图鉴综合榜：第 12 名（女主 RPG）· 87 分 杰作」，下面是维度和说明 */
function overallV2(g: Game) {
  const f = finalFor(g);
  if (!f && thinFor(g)) return `<div class="note overall">${esc(ranking.scoring.name)}：${THIN_LABEL}${QMARK}</div><p class="hint">${THIN_NOTE}</p>${myVotes(g) ? `<p class="hint">${esc(myVotes(g))}</p>` : ""}`;
  if (!f) { const s = scoreText2(g); return s ? `<div class="note overall">${esc(s)}（没有平台评分）</div><p class="hint">${esc(myVotes(g))}</p>` : ""; }
  const rank = v2Order().indexOf(g) + 1, cat = CATS.find(([k]) => k === data.ui.cat)?.[1] ?? "", delta = myDelta(g.id);
  const canVote = !!f.canon || f.nominee;
  return `<div class="note overall">${esc(ranking.scoring.name)}：${rank ? `第 ${rank} 名（${esc(cat)}）· ` : ""}公共分 ${Math.floor(f.F + 1e-9)} ${bandTag(f)}${delta ? ` · 我的修正 ${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : ""}${QMARK}</div>
    ${dimsHtml(g)}${whyHtml(g, f)}
    ${canVote ? `<div class="row"><button class="btn small" data-vote="${esc(g.id)}">投票 / 复议</button></div>` : ""}`;
}

/** 「图鉴综合榜：第 3 名 · 87 分（口碑 92 · 热度 80 · 榜单 70）」，名次跟着当前分类；没排名就不显示 */
function overallLine(id: string) {
  if (ranking.v2) return overallV2(games.get(id)!);
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
    ? list.map(x => `<li class="rank-row" data-id="${esc(x.id)}" data-open title="打开详情"><span class="th">${x.cover ? `<img ${thumbAttrs(x)} alt="" loading="lazy" decoding="async">` : ""}</span>
        <span class="nm">${esc(nameOf(x))}</span><span class="sc">${esc(year(x))}</span></li>`).join("")
    : "";
}

function fill() {
  const g = games.get(current);
  if (!g) return;
  const name = nameOf(g);
  $("#detail-body").dataset.id = g.id;
  setHtml($("#detail-cover"), g.cover ? `<img src="${esc(g.cover)}" alt="${esc(name)} 封面" decoding="async">` : `<span class="none">暂无封面</span>`);
  // 我的游戏只有一个名字，不分语言
  const names = (g.src === "local" ? [] : (["zh", "en", "ja"] as const))
    .filter(l => g.names?.[l])
    .map(l => `<li><small>${LANG_LABEL[l]}</small>${esc(g.names[l])}${g.mt?.includes(l) ? `<span class="mt">机翻</span>` : ""}</li>`)
    .join("");
  setHtml($("#detail-info"), `
    <h2>${esc(name)}</h2>
    ${blackTags(g) ? `<div class="black-tags">${blackTags(g)}</div>` : ""}
    <ul class="names">${names}</ul>
    <div class="meta">${metaHtml(g)}</div>
    ${genreChips(g)}
    ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
    ${overallLine(g.id)}
    ${g.src === "local" ? `<div class="row"><span class="mt">我的游戏</span><button class="btn small" data-mygame="edit">编辑</button><button class="btn small ghost" data-mygame="remove">移除</button></div>` : ""}
    ${controlsHtml(g)}
    ${tierButtons(g.id)}`);
  // 黑榜：我的游戏不能放；理由框只在黑榜里时显示，正在打字时不改它的内容
  const black = data.blacklist[g.id], reason = $("#black-reason") as HTMLTextAreaElement;
  $("#detail-black").hidden = !canBlacklist(g);
  $("#black-toggle").textContent = black ? "移出黑榜" : "加入黑榜";
  reason.hidden = !black;
  if (document.activeElement !== reason) reason.value = black?.reason ?? "";
  const circle = circleHtml(g);
  $("#detail-circle").hidden = !circle;
  setHtml($("#detail-circle-list"), circle);
  const others = data.friends
    .map(f => [f, f.marks[g.id]] as const)
    .filter(([, m]) => m && hasMark(m));
  setHtml($("#detail-friends"), others.length
    ? others.map(([f, m]) => `<li><div><b>${esc(f.name)}</b> <span class="hint">${esc(markBits(m))}</span></div>
        ${m.note ? `<p>${esc(m.note)}</p>` : ""}</li>`).join("")
    : `<li class="hint">还没有别人的评分。在设置里「导入评分文件」后，这里会显示他们的星级和评论。</li>`);
}

/** 离开一部作品时：评论去掉首尾空白，卡片上的「我的评论」标记也更新 */
function commitNote() {
  const m = data.marks[current];
  if (m?.note !== undefined) m.note = m.note.trim();
  pruneMark(current);
  // 黑榜理由也去掉首尾空白，空的不留
  const b = data.blacklist[current];
  if (typeof b?.reason === "string") { b.reason = b.reason.trim(); if (!b.reason) delete b.reason; }
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
  $("#black-toggle").addEventListener("click", () => toggleBlack(current));
  const reason = $("#black-reason") as HTMLTextAreaElement;
  reason.maxLength = BLACK_REASON_MAX;
  reason.addEventListener("input", () => {
    const b = data.blacklist[current];
    if (b) { b.reason = reason.value; save(); }
  });
  // 关掉时只更新这一张卡片（评论标记），不重画整个图鉴
  dlg().addEventListener("close", () => { commitNote(); refreshCard(current); });
  // 题材标签：关掉详情，图鉴里只看这个题材
  $("#detail-info").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-genre]");
    if (b) { dlg().close(); showGenre(b.dataset.genre!); return; }
    const v = (e.target as HTMLElement).closest<HTMLElement>("[data-vote]");
    if (v) openSubmit(v.dataset.vote);
    // 我的游戏：编辑；移除要点两次
    const m = (e.target as HTMLElement).closest<HTMLElement>("[data-mygame]");
    if (m?.dataset.mygame === "edit") openMyGame({ id: current });
    if (m?.dataset.mygame === "remove") {
      if (!m.dataset.sure) { m.dataset.sure = "1"; m.textContent = "再点一次确认移除（标记和游玩记录一起去掉）"; return; }
      const id = current;
      dlg().close();
      removeMyGame(id);
    }
  });
}
