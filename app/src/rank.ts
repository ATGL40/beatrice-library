import { HELP_LINK } from "./scorehelp";
import { bandTag, bindActions, CATS, catScores, finalFor, games, inCat as inCatOf, nameOf, ranking, render, thinFor, thumbAttrs, v2Order } from "./library";
import { inSrc, listGroup, recipeText, scoreText, SRC_BUTTONS, yearNum, yearsOf, type Ranking } from "./scoring";
import { devRows, hiddenGemRows, SCORE_NOTE, THIN_LABEL, THIN_NOTE, type GemRow } from "./scoring2";
import { data, hasMark, mark, save, type Game } from "./store";
import { exportTierImage } from "./tierimage";
import { isTier, moveInTier, placeInTier, removeFromTiers, TIER_KEYS, TIER_LABEL, TIERS, tierOf, type TierKey } from "./tiers";
import { $, esc, toast } from "./ui";
import { setHtml } from "./performance";

// —— 排行榜视图：左边选榜单（图鉴综合榜、我的梯度表、民间榜单），右边是名次 ——
const OVERALL = "overall", MINE = "tiers", DEV = "dev", GEMS = "gems";
let sel = OVERALL;
/** 长榜先画前 PAGE 名，点「显示更多」再接着画（换榜单、分类、筛选时回到第一页） */
const PAGE = 200;
let shown = PAGE, shownCat = "";
let year: number | undefined;        // 民间榜单选中的年份
let overallYear: number | undefined; // 综合榜（和冷门佳作榜）细分的年份，undefined 是全部年份（不存盘）
let overallSrc: string | undefined;  // 综合榜（和冷门佳作榜）细分的来源（srcKey），undefined 是全部来源（不存盘）
const KIND_TEXT: Record<string, string> = { vote: "投票", score: "评分", editor: "编辑推荐" };

const inCat = (g: Game | undefined) => !!g && inCatOf(g);
const thumb = (g?: Game) => (g?.cover ? `<img ${thumbAttrs(g)} alt="" loading="lazy" decoding="async">` : "");
const catLabel = () => CATS.find(([k]) => k === data.ui.cat)?.[1] ?? "";

/** 民间榜单按名字分组（名字里的年份不算），同一组是不同年份，新的在前 */
function groups(): Map<string, Ranking[]> {
  if (groupSource === ranking.lists) return groupCache;
  const m = new Map<string, Ranking[]>();
  for (const r of ranking.lists) {
    const k = listGroup(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  for (const rs of m.values()) rs.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  groupSource = ranking.lists; groupCache = m;
  return m;
}
let groupSource: Ranking[] | undefined, groupCache = new Map<string, Ranking[]>();

export function renderRank(append = false) {
  if (shownCat !== data.ui.cat) { shownCat = data.ui.cat; shown = PAGE; }
  const gs = groups();
  if (sel !== OVERALL && sel !== MINE && !(sel === DEV && ranking.v2) && !(sel === GEMS && ranking.v2?.hiddenGems) && !gs.has(sel)) sel = OVERALL;
  const btn = (key: string, label: string) => `<button data-list="${esc(key)}" aria-pressed="${sel === key}">${esc(label)}</button>`;
  setHtml($("#rank-lists"), btn(OVERALL, ranking.scoring.name) + (ranking.v2 ? btn(DEV, ranking.v2.development.name) : "")
    + (ranking.v2?.hiddenGems ? btn(GEMS, ranking.v2.hiddenGems.name) : "") + btn(MINE, "我的梯度表")
    + (gs.size ? `<h3>民间榜单</h3>${[...gs.keys()].map(n => btn(n, n)).join("")}` : `<p class="hint">导入带榜单的数据包后，这里会显示民间榜单。</p>`));
  const body = $("#rank-body"), list = append ? body.querySelector(".rank-list") : null;
  const start = list ? shown - PAGE : 0;
  const html = sel === OVERALL ? (ranking.v2 ? overallV2(start) : overallHtml()) : sel === DEV ? devHtml(start) : sel === GEMS ? gemsHtml(start)
    : sel === MINE ? tiersHtml() : folkHtml(gs.get(sel)!);
  if (!list) { setHtml(body, html); return; }
  // 显示更多只追加新行，已有封面和滚动位置保留
  const next = document.createElement("template");
  next.innerHTML = html;
  list.append(...next.content.querySelector(".rank-list")!.childNodes);
  body.querySelector(".more")?.remove();
  const thin = next.content.querySelector(".thin-group"); // 综合榜画到最后一页时，评价不足的一组跟在后面
  if (thin) body.append(thin);
  const button = next.content.querySelector(".more");
  if (button) body.append(button);
}

/** 年份、来源按钮（综合榜两版共用） */
function filtersHtml(ys: number[]) {
  const ybtn = (y: number | undefined, label: string) => `<button data-year="${y ?? ""}" aria-pressed="${overallYear === y}">${label}</button>`;
  const years = ys.length ? `<div class="years">${ybtn(undefined, "全部年份")}${ys.map(y => ybtn(y, String(y))).join("")}</div>` : "";
  const sbtn = (k: string | undefined, label: string) => `<button data-src="${esc(k ?? "")}" aria-pressed="${overallSrc === k}">${esc(label)}</button>`;
  return years + `<div class="years">${sbtn(undefined, "全部来源")}${SRC_BUTTONS.map(([k, l]) => sbtn(k, l)).join("")}</div>`;
}
const more = (n: number) => (n > shown ? `<div class="row more"><button class="btn" id="rank-more">显示更多（还有 ${n - shown} 部）</button></div>` : "");

// —— 图鉴综合榜（第 2 版配方）：分数和档已经在换目录时算好，这里只排序、筛选、画前几百名；评价不足的作品单独一组放在最后 ——
function overallV2(start = 0) {
  const rc = ranking.v2!;
  const ranked = v2Order();
  const thinAll = [...games.values()].filter(g => inCat(g) && thinFor(g)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const ys = yearsOf([...ranked, ...thinAll]);
  if (overallYear && !ys.includes(overallYear)) overallYear = undefined;
  const pick = (g: Game) => (!overallYear || yearNum(g) === overallYear) && inSrc(g, overallSrc);
  const rows = ranked.filter(pick), thin = thinAll.filter(pick);
  // 标题下是醒目的提醒框，带「分数是怎么算的」按钮（怎么算的只写在那个窗口里，数字取自配方）
  const head = `<header class="rank-head"><h2>${esc(rc.name)}</h2>
    <div class="score-notice" role="note"><span class="icon" aria-hidden="true">i</span><p>${SCORE_NOTE}</p>${HELP_LINK()}</div>${filtersHtml(ys)}
    <p class="hint">这里是公共分，你和朋友的星级（我的修正）只写在卡片和详情页上，不改名次和档。评价太少的作品不打分，放在最后的「${THIN_LABEL}」。点年份或来源只看那一部分，名次在其中重新编号。</p></header>`;
  const thinHtml = thin.length && rows.length <= shown ? `<section class="thin-group"><h3>${THIN_LABEL}（${thin.length} 部）</h3><p class="hint">${THIN_NOTE}</p>
    <ul class="rank-list">${thin.map(g => `<li class="rank-row" data-id="${esc(g.id)}" data-open title="打开详情"><span class="no"></span>
      <span class="th">${thumb(g)}</span><span class="nm">${esc(nameOf(g))}</span><span class="sc">${THIN_LABEL}</span></li>`).join("")}</ul></section>` : "";
  if (!rows.length) {
    const why = overallSrc === "cien" ? "开发中的作品不参与综合排名，见「" + esc(rc.development.name) + "」。" : overallYear || overallSrc ? "这个年份 / 来源里没有上榜的作品。" : `「${esc(catLabel())}」里还没有能排名的作品。`;
    return head + `<p class="empty">${why}</p>` + thinHtml;
  }
  return head + `<ol class="rank-list">${rows.slice(start, shown).map((g, i) => {
    const f = finalFor(g)!;
    return `<li class="rank-row" data-id="${esc(g.id)}" data-open title="打开详情"><span class="no">${start + i + 1}</span>
      <span class="th">${thumb(g)}</span><span class="nm">${esc(nameOf(g))}</span><span class="sc">${Math.floor(f.F + 1e-9)} ${bandTag(f)}</span></li>`;
  }).join("")}</ol>${thinHtml}${more(rows.length)}`;
}

// —— 开发中关注榜：Ci-en 关注者数在创作者里的百分位；FANBOX 没有公开数字 ——
let devSource: typeof ranking.base | undefined, devCache: ReturnType<typeof devRows> = [];
function devHtml(start = 0) {
  const rc = ranking.v2!;
  // 百分位不随分类变，换资料后再重算
  if (devSource !== ranking.base) { devSource = ranking.base; devCache = devRows([...games.values()], rc.development.field); }
  const rows = devCache.filter(r => inCat(r.g));
  const head = `<header class="rank-head"><h2>${esc(rc.development.name)}</h2>
    <p class="hint">开发中的作品按 Ci-en 关注者数排（分数是在所有创作者里的百分位，同一个创作者只算一次）。FANBOX 不公开关注数，排在后面、写「暂无关注数据」。</p></header>`;
  if (!rows.length) return head + `<p class="empty">「${esc(catLabel())}」里没有开发中的作品。</p>`;
  let no = rows.slice(0, start).filter(r => r.score !== null).length;
  return head + `<ol class="rank-list">${rows.slice(start, shown).map(r => `<li class="rank-row" data-id="${esc(r.g.id)}" data-open title="打开详情">
      <span class="no">${r.score === null ? "" : ++no}</span><span class="th">${thumb(r.g)}</span><span class="nm">${esc(nameOf(r.g))}</span>
      <span class="sc">${r.followers === null ? "暂无关注数据" : `关注 ${r.followers.toLocaleString()} · ${Math.round(r.score!)}`}</span></li>`).join("")}</ol>${more(rows.length)}`;
}

// —— 冷门佳作榜：评分高、评价人数还少的已发售作品，按口碑分排；年份、来源细分和综合榜共用 ——
let gemSource: typeof ranking.base | undefined, gemCache: GemRow[] = [];
/** 评分和人数，按来源写法不同 */
function gemText(r: GemRow) {
  if (r.g.src === "dlsite") return `DLsite ★${r.x.toFixed(2)} · ${r.n.toLocaleString()} 人评价`;
  if (r.g.src === "commercial") return `批評空間 ${r.x} 分 · ${r.n.toLocaleString()} 人`;
  if (r.g.src === "steam") return `Steam 好评 ${r.x}% · ${r.n.toLocaleString()} 篇评测`;
  return `${r.x} · ${r.n.toLocaleString()} 人`;
}
const SRC_LINE: Record<string, (x: number) => string> = { dlsite: x => `DLsite ★${x.toFixed(2)}`, commercial: x => `批評空間 ${x} 分`, steam: x => `Steam 好评 ${x}%` };
function gemsHtml(start = 0) {
  const hg = ranking.v2!.hiddenGems!;
  // 选出来的作品不随分类变，换资料后再重算
  if (gemSource !== ranking.base) { gemSource = ranking.base; gemCache = hiddenGemRows(games.values(), ranking.base, hg); }
  const inCatRows = gemCache.filter(r => inCat(r.g));
  const ys = yearsOf(inCatRows.map(r => r.g));
  if (overallYear && !ys.includes(overallYear)) overallYear = undefined;
  const rows = inCatRows.filter(r => (!overallYear || yearNum(r.g) === overallYear) && inSrc(r.g, overallSrc)).slice(0, hg.limit);
  const lines = Object.entries(hg.rating).map(([src, x]) => {
    const [lo, hi] = hg.raters[src];
    return `${(SRC_LINE[src] ?? (v => `${src} ${v}`))(x)}以上、${lo}～${hi - 1} 人`;
  }).join("；");
  const head = `<header class="rank-head"><h2>${esc(hg.name)}</h2>${filtersHtml(ys)}
    <p class="hint">评分高、但评价人数还不多的已发售作品（${esc(lines)}），按口碑排（和综合榜一样把各社区的评分合起来），最多 ${hg.limit} 部。只是一个榜单，不改综合分和档。</p></header>`;
  if (!rows.length) return head + `<p class="empty">${overallYear || overallSrc ? "这个年份 / 来源里没有冷门佳作。" : `「${esc(catLabel())}」里没有冷门佳作。`}</p>`;
  return head + `<ol class="rank-list">${rows.slice(start, shown).map((r, i) => `<li class="rank-row" data-id="${esc(r.g.id)}" data-open title="打开详情">
      <span class="no">${start + i + 1}</span><span class="th">${thumb(r.g)}</span><span class="nm">${esc(nameOf(r.g))}</span>
      <span class="sc">${esc(gemText(r))}</span></li>`).join("")}</ol>${more(rows.length)}`;
}

// —— 图鉴综合榜 ——
function overallHtml() {
  const scores = catScores();
  const ranked = [...games.values()]
    .filter(g => inCat(g) && scores.get(g.id)?.rank)
    .sort((a, b) => scores.get(a.id)!.rank! - scores.get(b.id)!.rank!);
  const ys = yearsOf(ranked);
  if (overallYear && !ys.includes(overallYear)) overallYear = undefined; // 换分类后没有这一年就回到全部年份
  const filtered = !!(overallYear || overallSrc); // 年份和来源可以同时选，名次在选出来的范围里重新编号
  const rows = ranked.filter(g => (!overallYear || yearNum(g) === overallYear) && inSrc(g, overallSrc));
  const head = `<header class="rank-head"><h2>${esc(ranking.scoring.name)}</h2>${filtersHtml(ys)}
    <p class="hint">按配方生成：${esc(recipeText(ranking.scoring))}。每个分类各自排名（「全部」是所有分类一起排），开发中的、没有任何资料（评分、销量、榜单）的作品不参与。点年份或来源只看那一部分作品，名次在其中重新编号，分数不变。算法见 方案.md。</p></header>`;
  if (!rows.length) {
    const why = overallSrc === "cien" ? "开发中的作品暂不参与综合排名。" : filtered ? "这个年份 / 来源里没有上榜的作品。" : `「${esc(catLabel())}」里还没有能排名的作品。`;
    return head + `<p class="empty">${why}</p>`;
  }
  return head + `<ol class="rank-list">${rows.map((g, i) => {
    const s = scores.get(g.id)!;
    return `<li class="rank-row" data-id="${esc(g.id)}" data-open title="打开详情"><span class="no">${filtered ? i + 1 : s.rank}</span>
      <span class="th">${thumb(g)}</span><span class="nm">${esc(nameOf(g))}</span><span class="sc">${esc(scoreText(s))}</span></li>`;
  }).join("")}</ol>`;
}

// —— 民间榜单 ——
function folkHtml(rs: Ranking[]) {
  const r = rs.find(x => x.year === year) ?? rs[0];
  year = r.year;
  const years = rs.length > 1
    ? `<div class="years">${rs.map(x => `<button data-year="${x.year ?? ""}" aria-pressed="${x === r}">${x.year ?? "不明"}</button>`).join("")}</div>` : "";
  // 来源文字一律转义（它来自数据包），链接单独拼
  const src = [esc(r.source), r.year ? `${r.year} 年` : "", r.kind ? esc(KIND_TEXT[r.kind]) : "", r.url ? `<a href="${esc(r.url)}">出处链接</a>` : ""]
    .filter(Boolean).join(" · ");
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
    if (b) { sel = b.dataset.list!; year = undefined; shown = PAGE; renderRank(); }
  });
  const body = $("#rank-body");
  body.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const y = t.closest<HTMLElement>("[data-year]");
    if (y) {
      const v = y.dataset.year ? Number(y.dataset.year) : undefined;
      if (sel === OVERALL || sel === GEMS) overallYear = v; else year = v;
      shown = PAGE; renderRank(); return;
    }
    const sb = t.closest<HTMLElement>("[data-src]");
    if (sb) { overallSrc = sb.dataset.src || undefined; shown = PAGE; renderRank(); return; }
    if (t.closest("#rank-more")) { shown += PAGE; renderRank(true); return; }
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
