import { bindActions, CATS, catScores, games, inCat as inCatOf, nameOf, ranking, render } from "./library";
import { listGroup, recipeText, scoreText, yearNum, yearsOf, type Ranking } from "./scoring";
import { data, hasMark, mark, save, type Game } from "./store";
import { exportTierImage } from "./tierimage";
import { isTier, moveInTier, placeInTier, removeFromTiers, TIER_KEYS, TIER_LABEL, TIERS, tierOf, type TierKey } from "./tiers";
import { $, esc, toast } from "./ui";

// —— 排行榜视图：左边选榜单（图鉴综合榜、我的梯度表、民间榜单），右边是名次 ——
const OVERALL = "overall", MINE = "tiers";
let sel = OVERALL;
let year: number | undefined;        // 民间榜单选中的年份
let overallYear: number | undefined; // 综合榜细分的年份，undefined 是全部年份（不存盘）
const KIND_TEXT: Record<string, string> = { vote: "投票", score: "评分", editor: "编辑推荐" };

const inCat = (g: Game | undefined) => !!g && inCatOf(g);
const thumb = (g?: Game) => (g?.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : "");
const catLabel = () => CATS.find(([k]) => k === data.ui.cat)?.[1] ?? "";

/** 民间榜单按名字分组（名字里的年份不算），同一组是不同年份，新的在前 */
function groups(): Map<string, Ranking[]> {
  const m = new Map<string, Ranking[]>();
  for (const r of ranking.lists) {
    const k = listGroup(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  for (const rs of m.values()) rs.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return m;
}

export function renderRank() {
  const gs = groups();
  if (sel !== OVERALL && sel !== MINE && !gs.has(sel)) sel = OVERALL;
  const btn = (key: string, label: string) => `<button data-list="${esc(key)}" aria-pressed="${sel === key}">${esc(label)}</button>`;
  $("#rank-lists").innerHTML = btn(OVERALL, ranking.scoring.name) + btn(MINE, "我的梯度表")
    + (gs.size ? `<h3>民间榜单</h3>${[...gs.keys()].map(n => btn(n, n)).join("")}` : `<p class="hint">导入带榜单的数据包后，这里会显示民间榜单。</p>`);
  $("#rank-body").innerHTML = sel === OVERALL ? overallHtml() : sel === MINE ? tiersHtml() : folkHtml(gs.get(sel)!);
}

// —— 图鉴综合榜 ——
function overallHtml() {
  const scores = catScores();
  const ranked = [...games.values()]
    .filter(g => inCat(g) && scores.get(g.id)?.rank)
    .sort((a, b) => scores.get(a.id)!.rank! - scores.get(b.id)!.rank!);
  const ys = yearsOf(ranked);
  if (overallYear && !ys.includes(overallYear)) overallYear = undefined; // 换分类后没有这一年就回到全部年份
  const rows = overallYear ? ranked.filter(g => yearNum(g) === overallYear) : ranked;
  const ybtn = (y: number | undefined, label: string) => `<button data-year="${y ?? ""}" aria-pressed="${overallYear === y}">${label}</button>`;
  const years = ys.length ? `<div class="years">${ybtn(undefined, "全部年份")}${ys.map(y => ybtn(y, String(y))).join("")}</div>` : "";
  const head = `<header class="rank-head"><h2>${esc(ranking.scoring.name)}</h2>${years}
    <p class="hint">按配方生成：${esc(recipeText(ranking.scoring))}。每个分类各自排名（「全部」是所有分类一起排），开发中的作品不参与。点年份只看那一年的作品，名次在年内重新编号，分数不变。算法见 方案.md。</p></header>`;
  if (!rows.length) return head + `<p class="empty">「${esc(catLabel())}」里还没有能排名的作品。</p>`;
  return head + `<ol class="rank-list">${rows.map((g, i) => {
    const s = scores.get(g.id)!;
    return `<li class="rank-row" data-id="${esc(g.id)}" data-open title="打开详情"><span class="no">${overallYear ? i + 1 : s.rank}</span>
      <span class="th">${thumb(g)}</span><span class="nm">${esc(nameOf(g))}</span><span class="sc">${esc(scoreText(s))}</span></li>`;
  }).join("")}</ol>`;
}

// —— 民间榜单 ——
function folkHtml(rs: Ranking[]) {
  const r = rs.find(x => x.year === year) ?? rs[0];
  year = r.year;
  const years = rs.length > 1
    ? `<div class="years">${rs.map(x => `<button data-year="${x.year ?? ""}" aria-pressed="${x === r}">${x.year ?? "不明"}</button>`).join("")}</div>` : "";
  const src = [r.source, r.year ? `${r.year} 年` : "", r.kind ? KIND_TEXT[r.kind] : "", r.url ? `<a href="${esc(r.url)}">出处链接</a>` : ""]
    .filter(Boolean).map(x => (x.startsWith("<a ") ? x : esc(x))).join(" · ");
  const head = `<header class="rank-head"><h2>${esc(r.name)}</h2>${years}
    <p class="hint">出处：${src || "未注明"}</p>${r.note ? `<p class="hint">${esc(r.note)}</p>` : ""}</header>`;
  return head + `<ol class="rank-list">${r.items.map(it => {
    const g = it.rj ? games.get(it.rj) : undefined;
    if (g) return `<li class="rank-row" data-id="${esc(g.id)}" data-open title="打开详情"><span class="no">${it.rank}</span>
      <span class="th">${thumb(g)}</span><span class="nm">${esc(nameOf(g))}</span><span class="sc">已收录</span></li>`;
    const name = [it.title, it.zh].filter(Boolean).map(esc).join(" · ");
    return `<li class="rank-row off"><span class="no">${it.rank}</span><span class="th"></span>
      <span class="nm">${name}</span><span class="sc">${it.url ? `<a href="${esc(it.url)}">链接</a>` : "未收录"}</span></li>`;
  }).join("")}</ol>`;
}

// —— 我的梯度表 ——
function mini(g: Game, inTier: boolean) {
  const at = tierOf(data.tiers, g.id);
  const items = inTier
    ? [`<button data-tact="up">上移</button>`, `<button data-tact="down">下移</button>`,
      ...TIERS.filter(([k]) => k !== at?.tier).map(([k, l]) => `<button data-tact="to" data-t="${k}">移到「${l}」</button>`),
      `<button data-tact="out">移出梯度表</button>`]
    : TIERS.map(([k, l]) => `<button data-tact="to" data-t="${k}">放进「${l}」</button>`);
  return `<div class="mini" draggable="true" data-id="${esc(g.id)}">
    <div class="mini-cover" data-open title="打开详情">${thumb(g) || `<span class="none">暂无封面</span>`}</div>
    <div class="mini-foot"><span class="mini-name" data-open title="${esc(nameOf(g))}">${esc(nameOf(g))}</span>
      <details class="mini-menu"><summary aria-label="更多">⋯</summary><div class="menu">${items.join("")}</div></details></div>
  </div>`;
}

function tiersHtml() {
  const rows = TIERS.map(([k, label]) => {
    const list = data.tiers[k].map(id => games.get(id)).filter(inCat) as Game[];
    return `<div class="tier-row"><div class="tier-label tier-${k}">${label}</div>
      <div class="tier-cards" data-drop="${k}">${list.map(g => mini(g, true)).join("") || `<span class="hint">拖到这里</span>`}</div></div>`;
  }).join("");
  const pool = [...games.values()]
    .filter(g => inCat(g) && hasMark(mark(g.id)) && !tierOf(data.tiers, g.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<header class="rank-head"><h2>我的梯度表</h2>
      <p class="hint">「${esc(catLabel())}」· 拖动卡片调整先后或换档（放在哪张卡上就排在它前面，放在空白处就排到末尾）；也可以点 ⋯。</p>
      <div class="row"><button class="btn small" id="tier-image">导出图片</button></div></header>
    <div class="tier-board">${rows}</div>
    <section class="tier-pool"><h3>未分档（${pool.length}）</h3>
      <p class="hint">当前分类里你标过（想玩、已有、玩过、收藏或打过星）但还没分档的作品。</p>
      <div class="tier-cards" data-drop="pool">${pool.map(g => mini(g, false)).join("") || `<span class="hint">没有了</span>`}</div></section>`;
}

function setTiers(next: typeof data.tiers) {
  data.tiers = next;
  save(); render();
}

/** ⋯ 菜单里的操作 */
function onTierAction(b: HTMLElement) {
  const id = b.closest<HTMLElement>(".mini")?.dataset.id;
  if (!id) return;
  b.closest("details")?.removeAttribute("open");
  const visible = (x: string) => inCat(games.get(x));
  const act = b.dataset.tact;
  if (act === "up" || act === "down") setTiers(moveInTier(data.tiers, id, act === "up" ? -1 : 1, visible));
  if (act === "to" && isTier(b.dataset.t)) setTiers(placeInTier(data.tiers, id, b.dataset.t));
  if (act === "out") {
    const before = data.tiers;
    setTiers(removeFromTiers(data.tiers, id));
    toast("已移出梯度表", () => setTiers(before));
  }
}

/** 拖动：拖到某张卡上就排在它前面，拖到空白处就排到末尾，拖到「未分档」就移出 */
function bindDrag(el: HTMLElement) {
  let dragging = "";
  el.addEventListener("dragstart", e => {
    const m = (e.target as HTMLElement).closest<HTMLElement>(".mini");
    if (!m || !e.dataTransfer) return;
    dragging = m.dataset.id!;
    e.dataTransfer.setData("text/plain", dragging);
    e.dataTransfer.effectAllowed = "move";
    m.classList.add("dragging");
  });
  el.addEventListener("dragend", () => {
    dragging = "";
    el.querySelectorAll(".dragging, .over").forEach(x => x.classList.remove("dragging", "over"));
  });
  el.addEventListener("dragover", e => {
    const zone = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (!zone || !dragging) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.querySelectorAll(".over").forEach(x => x !== zone && x.classList.remove("over"));
    zone.classList.add("over");
  });
  el.addEventListener("drop", e => {
    const zone = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (!zone || !dragging) return;
    e.preventDefault();
    const id = dragging, k = zone.dataset.drop!;
    const before = (e.target as HTMLElement).closest<HTMLElement>(".mini")?.dataset.id;
    if (k === "pool") setTiers(removeFromTiers(data.tiers, id));
    else if (isTier(k)) setTiers(placeInTier(data.tiers, id, k as TierKey, before));
  });
}

export function bindRank() {
  $("#rank-lists").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-list]");
    if (b) { sel = b.dataset.list!; year = undefined; renderRank(); }
  });
  const body = $("#rank-body");
  body.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const y = t.closest<HTMLElement>("[data-year]");
    if (y) {
      const v = y.dataset.year ? Number(y.dataset.year) : undefined;
      if (sel === OVERALL) overallYear = v; else year = v;
      renderRank(); return;
    }
    const b = t.closest<HTMLElement>("[data-tact]");
    if (b) { onTierAction(b); return; }
    if (t.closest("#tier-image")) exportTierImage().catch(err => toast(`导出图片失败：${err instanceof Error ? err.message : err}`));
  });
  bindActions(body); // 点名字或封面打开详情，https 链接交给系统浏览器
  bindDrag(body);
}

/** 当前分类里每一档的作品（导出图片用） */
export const tierRowsForCat = () =>
  TIER_KEYS.map(k => ({ key: k, label: TIER_LABEL[k], games: data.tiers[k].map(id => games.get(id)).filter(inCat) as Game[] }));
export { catLabel };
