import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { fold, gameSearchTexts, scoreFolded } from "./search";
import { renderBatches, setHtml } from "./performance";
import { linkOf, POV_LABEL } from "./catalog";
import { openDetail, refreshDetail } from "./detail";
import { fromExe, openFinder } from "./finder";
import { sameDir } from "./match";
import { countGenres, genreName, hasGenres } from "./genres";
import { addSession, lastPlayedAt, lastPlayedText, playSecondsOf, playText } from "./playtime";
import { data, dataLoaded, hasMark, linked, linkFolder, localOf, mark, pruneMark, save, unlinkFolder, type Catalog, type Game, type GenreDict, type Lang, type Mark } from "./store";
import { $, esc, toast } from "./ui";
import { cleanRankings, cleanScoring, scoreAll, type GameScore, type Ranking, type Scoring } from "./scoring";
import { baseScores, cleanCanon, cleanRecipeV2, cmpFinal, finalOf, isThin, playerDelta, rankOrder, THIN_LABEL, THIN_NOTE, type Base, type Final, type RecipeV2 } from "./scoring2";
import { placeInTier, removeFromTiers, TIER_LABEL, tierOf, type TierKey } from "./tiers";
import { okLink, tierText } from "./marks";
import { customGame } from "./custom";
import { renderRank } from "./rank";
import { groupByYear, yearJumps } from "./yeargroups";
import { activeBands, bandKeyOf, bandOptions, countBands } from "./bands";

/** 「全部」：所有分类一起看 */
export const ALL = "all";
export const CATS = [
  [ALL, "全部"], ["f-rpg", "女主 RPG"], ["m-rpg", "男主 RPG"], ["adv", "ADV / 剧情"], ["slg", "SLG / 经营"], ["act", "动作"], ["other", "其他"],
] as const;
const TABS = [
  ["all", "全部"], ["want", "想玩"], ["have", "已有"], ["played", "玩过"], ["fav", "收藏"], ["dev", "开发中"],
] as const;
const STATUS = [["want", "想玩"], ["have", "已有"], ["played", "玩过"]] as const;
const STATUS_TEXT: Record<string, string> = { want: "想玩", have: "已有", played: "玩过" };

export const games = new Map<string, Game>();
export const catalogInfo = { updated: "", source: "" };
/** 题材字典（数据包给的）；选中的题材标签只在内存里，关掉软件就清空 */
let genreDict: GenreDict = {};
const selectedGenres = new Set<string>();
export const genreLabel = (id: string) => genreName(genreDict, id, data.ui.lang);
/**
 * 排行榜要用的：数据包里的民间榜单、综合榜配方，和按配方算好的每部作品的分数名次（scores 按分类排，allScores 所有分类一起排）。
 * 数据包的配方是第 2 版时用 v2：base 是每部作品不含玩家评分的部分（换目录时算一次），canon 是神作名单
 */
export const ranking: {
  lists: Ranking[]; scoring: Scoring; scores: Map<string, GameScore>; allScores: Map<string, GameScore>;
  v2: RecipeV2 | null; base: Map<string, Base>; canon: Map<string, string>; finals: Map<string, Final>; voteIds: string[];
} = { lists: [], scoring: cleanScoring(undefined), scores: new Map(), allScores: new Map(), v2: null, base: new Map(), canon: new Map(), finals: new Map(), voteIds: [] };
/** 每个分类的综合榜名次（第 2 版），换目录时清掉 */
const orders = new Map<string, Game[]>();

/** 换上一份作品目录（启动时、导入数据包后） */
export function setCatalog(cat: Catalog) {
  games.clear();
  for (const g of cat.games) games.set(g.id, g);
  catalogInfo.updated = cat.updated;
  catalogInfo.source = cat.source;
  genreDict = cat.genres;
  genreCounts.clear();
  selectedGenres.clear();
  syncCustom();
  ranking.lists = cleanRankings(cat.rankings);
  ranking.v2 = cleanRecipeV2(cat.scoring);
  ranking.canon = cleanCanon(cat.canon);
  ranking.scoring = ranking.v2 ? { name: ranking.v2.name, parts: [] } : cleanScoring(cat.scoring);
  ranking.base = ranking.v2 ? baseScores(cat.games, ranking.lists, ranking.v2, cat.updated) : new Map();
  // 公共分和档只看数据包，换目录时算一次；玩家评分只是个人修正，不改档
  ranking.finals = new Map();
  if (ranking.v2) for (const g of cat.games) { const f = finalOf(g, ranking.base.get(g.id), ranking.canon, ranking.v2); if (f) ranking.finals.set(g.id, f); }
  ranking.voteIds = [...ranking.finals].filter(([, f]) => f.canon || f.nominee).map(([id]) => id);
  orders.clear();
  ranking.scores = ranking.v2 ? new Map() : scoreAll(cat.games, ranking.lists, ranking.scoring);
  ranking.allScores = ranking.v2 ? new Map() : scoreAll(cat.games, ranking.lists, ranking.scoring, false);
}

/** 我的游戏的封面放在 <app data>/custom-covers/ 里（启动时取一次目录） */
let coverDir = "";
export async function initMyGames() {
  coverDir = (await appDataDir()).replace(/[\\/]+$/, "");
  // 移除我的游戏时封面先留着（好撤销），启动时把没人用的删掉；数据没读成功（没有、坏了、新版本写的）时一个都不删
  if (dataLoaded) invoke("prune_custom_covers", { keep: Object.values(data.custom).map(c => c.cover).filter(Boolean) }).catch(() => {});
}
/** 把 data.custom 里的我的游戏放进图鉴（不进综合榜）：添加、编辑、移除后调用 */
export function syncCustom() {
  for (const [id, g] of games) if (g.src === "local") games.delete(id);
  const sep = coverDir.includes("\\") ? "\\" : "/";
  for (const [id, c] of Object.entries(data.custom)) {
    games.set(id, customGame(id, c, c.cover && coverDir ? convertFileSrc([coverDir, "custom-covers", c.cover].join(sep)) : ""));
  }
}

/** 玩家评分的票：我的星级和每个朋友的星级（1–5） */
export const playerVotes = (id: string) => [mark(id).score, ...data.friends.map(f => f.marks[id]?.score ?? 0)].filter(v => v >= 1 && v <= 5);
/** 第 2 版：这部作品的公共分和档；第 1 版、开发中、没有平台评分的是 null */
export const finalFor = (g: Game): Final | null => ranking.finals.get(g.id) ?? null;
/** 第 2 版：评价不足（参与打分、但评价人数都不够下限），不打分、不分档，按分数排的列表里单独放在最后一组 */
export const thinFor = (g: Game) => !!ranking.v2 && isThin(g, ranking.base);
/** 第 2 版：我的修正（我和朋友的星级），只显示，不改公共分和档 */
export const myDelta = (id: string) => (ranking.v2 ? playerDelta(playerVotes(id), ranking.v2.players) : 0);
/** 「综合 94 · 我的修正 +2.5」；评价不足的写「评价不足」；没有公共分、只有玩家票的写「仅玩家评分 52」（票正负抵消、修正为 0 也写） */
export function scoreText2(g: Game) {
  const f = finalFor(g), d = myDelta(g.id), sign = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}`;
  if (!f) {
    const mine = ranking.v2 && playerVotes(g.id).length && g.state !== "dev" ? `仅玩家评分 ${Math.floor(50 + d)}` : "";
    return thinFor(g) ? [THIN_LABEL, mine].filter(Boolean).join(" · ") : mine;
  }
  return `综合 ${Math.floor(f.F + 1e-9)}${d ? ` · 我的修正 ${sign(d)}` : ""}`;
}
/** 第 2 版：当前分类里排得上名的作品，按名次排好（每个分类算一次） */
export function v2Order() {
  if (!orders.has(data.ui.cat)) orders.set(data.ui.cat, rankOrder([...games.values()].filter(g => inCat(g)), finalFor));
  return orders.get(data.ui.cat)!;
}
/** 档的小标签：颜色按配方里档的先后（神作金色），只有第 2 版有 */
export function bandTag(f: Final | null) {
  if (!f?.band) return "";
  const i = ranking.v2!.bands.findIndex(b => b[0] === f.band);
  return `<span class="band band-${i}">${esc(f.band)}</span>`;
}

const catOf = (g: Game) => g.cat || "other";
/** 在不在当前分类里（「全部」都算） */
export const inCat = (g: Game, cat = data.ui.cat) => cat === ALL || catOf(g) === cat;
/** 当前分类用的综合分和名次 */
export const catScores = () => (data.ui.cat === ALL ? ranking.allScores : ranking.scores);

/** 软件名也跟着名字语言换 */
export const APP_NAME: Record<Lang, string> = { zh: "碧翠子禁书库", en: "Beatrice Library", ja: "Beatrice Library" };
/** 页面标题、窗口标题和左上角的大字 */
function showAppName() {
  document.title = $("#app-name").textContent = APP_NAME[data.ui.lang];
  getCurrentWindow().setTitle(document.title).catch(() => {});
}

/** 按设置的语言取名字，没有就用日文原名 */
export const nameOf = (g: Game, lang: Lang = data.ui.lang) => g.names?.[lang] || g.names?.ja || g.title || g.id;

function inTab(g: Game, t: string) {
  const m = mark(g.id);
  if (t === "dev") return g.state === "dev";
  if (g.state === "dev" && t === "all") return false;
  if (t === "all") return true;
  if (t === "fav") return m.fav;
  return m.status === t;
}

/** 顶部副标题里写的排列方式，跟着排序下拉框和「按年份分组」变（和下拉框的选项一样；year 是发售日，新的在前） */
const SORT_TEXT: Record<string, string> = {
  year: "按发售日", rate: "按 DLsite 评分", dl: "按销量", score: "按我的评分",
  friends: "按朋友评分", overall: "按综合排名", name: "按名字", recent: "按最近游玩", playtime: "按游玩时长",
};

function renderNav() {
  const all = [...games.values()];
  setHtml($("#cats"), CATS.map(([k, label]) => {
    const n = all.filter(g => inCat(g, k)).length;
    return `<button class="cat ${n ? "" : "empty-cat"}" data-cat="${k}" aria-pressed="${k === data.ui.cat}">${label}<span class="n">${n}</span></button>`;
  }).join(""));
  const shown = all.filter(g => inCat(g));
  setHtml($("#tabs"), TABS.map(([k, label]) => {
    const n = shown.filter(g => inTab(g, k)).length;
    return `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === data.ui.tab}">${label}<span class="n">${n}</span></button>`;
  }).join(""));
  const n = Object.values(data.local).filter(linked).length; // 只剩游玩记录的不算
  const q = ($("#q") as HTMLInputElement).value.trim();
  const sort = SORT_TEXT[data.ui.sort] ?? SORT_TEXT.year;
  const how = data.ui.view === "rank" ? "排行榜" : q ? "按和搜索词的相近程度排列" : data.ui.group ? `按年份分组 · 年内${sort}` : `${sort}排列`;
  $("#sub").textContent = `${how} · 收录 ${all.length} 部 · 电脑里认出 ${n} 部`;
}

/** 别人的标记缩成一行：★4 · 玩过 · ♥ */
export function markBits(m: Mark) {
  return [m.score ? `★${m.score}` : "", STATUS_TEXT[m.status] ?? "", m.fav ? "♥" : "", tierText(m)].filter(Boolean).join(" · ");
}

function friendLines(id: string) {
  return data.friends.map(f => {
    const m = f.marks[id];
    if (!m || !hasMark(m)) return "";
    const bits = [markBits(m), m.note ? "有评论" : ""].filter(Boolean).join(" · ");
    return `<div class="friend-line"><b>${esc(f.name)}</b> ${esc(bits)}</div>`;
  }).join("");
}

/** 「玩了 3.2 小时 · 10-28」：只记软件自己启动的；没玩过是空 */
function playLine(id: string) {
  const l = data.local[id];
  return [playText(l), lastPlayedText(l)].filter(Boolean).join(" · ");
}

export function metaHtml(g: Game) {
  const link = linkOf(g); // 只有 DLsite 和 Ci-en / FANBOX 的作品有链接
  return [
    ranking.v2 ? esc(scoreText2(g)) : "",
    g.pov ? POV_LABEL[g.pov] : "",
    g.circle && esc(g.circle),
    g.date && esc(g.date),
    g.rate ? `DLsite ★${Number(g.rate).toFixed(2)}` : "",
    g.dl ? `销量 ${Number(g.dl).toLocaleString()}` : "",
    link ? `<a href="${esc(link.url)}" target="_blank" rel="noopener">${link.label}</a>` : "链接：暂无",
    esc(playLine(g.id)),
  ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
}

/** 启动按钮、菜单、状态、星级、收藏：卡片和详情页共用 */
export function controlsHtml(g: Game) {
  const m = mark(g.id);
  const local = localOf(g.id);
  const seg = STATUS.map(([k, l]) => `<button data-act="status" data-s="${k}" aria-pressed="${m.status === k}">${l}</button>`).join("");
  const stars = [1, 2, 3, 4, 5].map(i => `<button data-act="score" data-v="${i}" class="${i <= m.score ? "on" : ""}" aria-label="评 ${i} 分">★</button>`).join("");
  // ⋯ 菜单的按钮点开时才放进去（menuHtml），一千多张卡片不用每张都带着
  return `<div class="local">
      ${local
        ? `<button class="btn play" data-act="launch" title="${esc(local.exe)}">▶ 启动</button>`
        : `<button class="btn ghost find" data-act="find">找电脑里的游戏</button>`}
      <details><summary aria-label="更多">⋯</summary><div class="menu"></div></details>
    </div>
    <div class="ctl">
      <span class="seg">${seg}</span>
      <span class="row2"><span class="stars">${stars}</span>
        <button class="fav ${m.fav ? "on" : ""}" data-act="fav" aria-pressed="${m.fav}" aria-label="收藏">♥</button></span>
    </div>`;
}

/** ⋯ 菜单：每部作品都一样；还没关联的，「打开文件夹」「取消关联」灰掉 */
function menuHtml(g: Game) {
  const local = localOf(g.id), off = local ? "" : " disabled";
  // 「转区启动」：没关联、或设置里还没选 LEProc.exe 时灰掉，提示写在 title 里
  const leHint = !data.lePath ? "先在设置里选择 Locale Emulator 的 LEProc.exe" : "用 Locale Emulator 的日文区启动游戏；打开时不用 MTool 启动器";
  return `<button data-act="reveal"${off}>打开文件夹</button>
    <button data-act="find">${local ? "换游戏文件夹…" : "找电脑里的游戏…"}</button>
    <button data-act="pick-exe">${local ? "换启动程序…" : "选择启动程序…"}</button>
    <button data-act="le" aria-pressed="${!!local?.le}" title="${leHint}"${local && data.lePath ? "" : " disabled"}>${local?.le ? "✓ " : ""}转区启动（Locale Emulator）</button>
    <button data-act="unlink"${off}>取消关联</button>`;
}

/** 卡片和排行榜用的小图：有缩略图用缩略图（data-full 记着原图，缩略图坏了换原图），没有用原图 */
export function thumbAttrs(g: Game) {
  return `src="${esc(g.thumb || g.cover)}"${g.thumb ? ` data-full="${esc(g.cover)}"` : ""}`;
}

/** 一张卡片：封面用缩略图，浏览器自己按需载（loading="lazy"），解码不占滚动（decoding="async"） */
function card(g: Game) {
  const m = mark(g.id), f = finalFor(g);
  const stamp = g.state === "dev" ? `<span class="stamp dev">开发中</span>` : m.status === "played" ? `<span class="stamp">玩过</span>` : "";
  const lang = data.ui.lang, name = nameOf(g), orig = g.names?.ja || g.title;
  const isMt = !!g.names?.[lang] && g.mt?.includes(lang);
  const cover = g.cover ? `<img ${thumbAttrs(g)} alt="${esc(name)} 封面" loading="lazy" decoding="async">` : `<span class="none">暂无封面</span>`;
  return `<article class="card ${m.status === "played" ? "played" : ""}" data-id="${esc(g.id)}">
    <div class="cover" data-open title="打开详情">${cover}${stamp}</div>
    <div class="body"><div class="info">
      <div class="t" data-open title="打开详情">${esc(name)}${isMt ? `<span class="mt" title="没有官方或通用译名，这是机器翻译">机翻</span>` : ""}${g.src === "local" ? `<span class="mt" title="自己添加的游戏，不参与综合榜">我的游戏</span>` : ""}${m.note ? `<span class="mt" title="${esc(m.note)}">我的评论</span>` : ""}${bandTag(f)}${tierTag(g.id)}</div>
      ${orig !== name ? `<div class="orig">${esc(orig)}</div>` : ""}
      <div class="meta">${metaHtml(g)}</div>
      ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
      ${friendLines(g.id)}
    </div>
      ${controlsHtml(g)}
    </div>
  </article>`;
}

/** 卡片名字旁边的档位小标签 */
export function tierTag(id: string) {
  const t = tierOf(data.tiers, id);
  return t ? `<span class="tier-tag tier-${t.tier}" title="我的梯度表：${TIER_LABEL[t.tier]} 第 ${t.pos}">${TIER_LABEL[t.tier]}</span>` : "";
}

/** 顶部「图鉴 / 排行榜」切换：排行榜里不用页签、搜索和排序，分类按钮共用 */
export function render() {
  stopList();
  const rank = data.ui.view === "rank";
  for (const b of document.querySelectorAll<HTMLElement>("#views [data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === data.ui.view));
  for (const sel of ["#list", ".bar", "#q", "#sort", "#group-label", "#genres-btn", "#bands"]) ($(sel) as HTMLElement).hidden = rank;
  $("#rank").hidden = !rank;
  // 去排行榜时清空图鉴：一千多张卡片只隐藏的话，WebView 要花一百多毫秒；回图鉴时本来就重画
  if (rank) { unwatchList(); $("#list").innerHTML = ""; renderNav(); renderRank(); } else renderList();
  renderGenreChips();
  if (($("#genres") as HTMLDialogElement).open) renderGenreDialog();
  refreshDetail();
}

// —— 题材标签：「题材」窗口里勾，分类按钮下面显示选中的，选了几个就要同时带上几个 ——
function renderGenreChips() {
  const el = $("#genre-chips");
  el.hidden = data.ui.view === "rank" || !selectedGenres.size;
  const chip = (id: string) => `<button class="chip" data-genre="${esc(id)}" title="去掉这个标签">${esc(genreLabel(id))} ×</button>`;
  el.innerHTML = selectedGenres.size ? `${[...selectedGenres].map(chip).join("")}<button class="chip clear" data-genre="">清除</button>` : "";
}

/** 每个分类的题材部数只算一次（换目录时清掉） */
const genreCounts = new Map<string, [string, number][]>();
function renderGenreDialog() {
  if (!genreCounts.has(data.ui.cat)) genreCounts.set(data.ui.cat, countGenres([...games.values()].filter(g => inCat(g))));
  const tags = genreCounts.get(data.ui.cat)!;
  $("#genre-list").innerHTML = tags.length
    ? tags.map(([id, n]) => `<button class="genre" data-genre="${esc(id)}" aria-pressed="${selectedGenres.has(id)}">${esc(genreLabel(id))}<span class="n">${n}</span></button>`).join("")
    : `<p class="hint">这个分类里的作品还没有题材资料。</p>`;
}

/** 点一个题材：选上或去掉；id 为空是清除全部；only 是只选这一个 */
function toggleGenre(id: string, only = false) {
  if (only || !id) selectedGenres.clear();
  if (id && !selectedGenres.delete(id)) selectedGenres.add(id);
  render();
}

/** 详情页点题材标签：只选这一个，回到图鉴 */
export function showGenre(id: string) {
  data.ui.view = "library";
  save();
  toggleGenre(id, true);
}

// —— 分数筛选：分类按钮下面一排，按综合榜的档（和「评价不足」）筛，可以多选，什么都不选是全部；选择存在 ui.bands 里 ——
/** 现在的筛选项；不是第 2 版配方（没有档）时是空的，不显示也不筛 */
const bandOpts = () => (ranking.v2 ? bandOptions(ranking.v2.bands) : []);
const bandKey = (g: Game) => bandKeyOf(finalFor(g), thinFor(g));
/** 画分数筛选那一排；部数是当前分类、页签、题材下（不看分数筛选和搜索）每一档有几部 */
function renderBands(base: Game[]) {
  const el = $("#bands"), opts = bandOpts();
  el.hidden = !opts.length;
  if (!opts.length) { setHtml(el, ""); return; }
  const n = countBands(base.map(bandKey)), on = activeBands(data.ui.bands, opts);
  setHtml(el, `<span class="label">分数</span>${opts.map(o =>
    `<button class="genre" data-band="${esc(o.key)}" aria-pressed="${!!on?.has(o.key)}" title="${esc(o.title)}">${esc(o.key)}${o.range ? ` <span class="range">${esc(o.range)}</span>` : ""}<span class="n">${n.get(o.key) ?? 0}</span></button>`).join("")}${on ? `<button class="chip clear" data-band="">清除</button>` : ""}`);
}
/** 点一个档：选上或去掉；key 为空是清除全部 */
function toggleBand(key: string) {
  const sel = new Set(data.ui.bands);
  if (!key) sel.clear(); else if (!sel.delete(key)) sel.add(key);
  data.ui.bands = [...sel];
  save(); render();
}

/** 按名字排时用的语言规则：中文按拼音，日文按五十音 */
const COLLATE: Record<Lang, string> = { zh: "zh-Hans-CN-u-co-pinyin", en: "en", ja: "ja" };
const newerFirst = (a: Game, b: Game) => (b.date || "").localeCompare(a.date || "");
/** 朋友给的星级平均分；没人评过是 null */
function friendAvg(id: string): number | null {
  const s = data.friends.map(f => f.marks[id]?.score || 0).filter(Boolean);
  return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null;
}
/** 数字大的在前；同分按发售日期新的在前 */
const byNumber = (v: (g: Game) => number) => (a: Game, b: Game) => v(b) - v(a) || newerFirst(a, b);

/** 每种排序一个比较函数；朋友都没评过的排最后 */
function compareFor(sort: string): (a: Game, b: Game) => number {
  switch (sort) {
    case "rate": return byNumber(g => g.rate || 0);
    case "dl": return byNumber(g => g.dl || 0);
    case "score": return byNumber(g => mark(g.id).score || 0);
    case "friends": return byNumber(g => friendAvg(g.id) ?? -1);
    case "overall": {
      // 第 2 版先把每部的分算好，排序时不重复算
      if (ranking.v2) return (a, b) => { const x = finalFor(a), y = finalFor(b); return x && y ? cmpFinal(x, y) : +!x - +!y || newerFirst(a, b); };
      const s = catScores(); return byNumber(g => s.get(g.id)?.total ?? -1);
    }
    case "recent": return byNumber(g => lastPlayedAt(data.local[g.id]));
    case "playtime": return byNumber(g => playSecondsOf(data.local[g.id]));
    case "name": {
      const lang = data.ui.lang, coll = new Intl.Collator(COLLATE[lang]);
      return (a, b) => coll.compare(nameOf(a, lang), nameOf(b, lang)) || newerFirst(a, b);
    }
    default: return newerFirst;
  }
}

let stopList = renderBatches<Game>([], () => {});
function renderList() {
  renderNav();
  unwatchList();
  showYearBar();
  const q = ($("#q") as HTMLInputElement).value.trim();
  const sort = data.ui.sort;
  // 选了题材标签时，只看同时带上全部标签的作品（没有题材资料的不显示）
  const base = [...games.values()].filter(g => inCat(g) && inTab(g, data.ui.tab) && (!selectedGenres.size || hasGenres(g, selectedGenres)));
  // 选了分数档时只看这些档的作品；开发中、我的游戏这些没有档的不显示
  renderBands(base);
  const bands = activeBands(data.ui.bands, bandOpts());
  let list = bands ? base.filter(g => bands.has(bandKey(g))) : base;
  if (q) {
    // 搜索时按像不像排，最像的在前
    const query = fold(q);
    const scored = list.map(g => [g, scoreFolded(query, gameSearchTexts(g))] as const).filter(([, s]) => s > 0);
    scored.sort((a, b) => b[1] - a[1]);
    list = scored.map(([g]) => g);
    if (list.length) drawCards(list);
    else $("#list").innerHTML = `<p class="empty">没有符合搜索的作品。</p>`;
    return;
  }
  const el = $("#list");
  if (!list.length) {
    const catEmpty = ![...games.values()].some(g => inCat(g));
    el.innerHTML = `<p class="empty">${bands && base.length ? "没有这些分数档的作品。开发中的作品和我的游戏没有档，选了分数档时不显示。" : selectedGenres.size ? "没有同时带上这些题材的作品。" : catEmpty ? "这个分类还没收录作品。" : data.ui.tab === "dev" ? "还没有开发中的作品。" : "这一栏还是空的，在作品卡片上点按钮就会出现在这里。"}</p>`;
    return;
  }
  // 按年份分组时每年里按选的排序排；不分组就是一整列。按综合排名排时，评价不足的作品不混进榜尾，单独放在最后一组
  const cmp = compareFor(sort);
  const thin = sort === "overall" ? list.filter(thinFor) : [];
  if (thin.length) list = list.filter(g => !thinFor(g));
  let groups: [string, Game[]][] = data.ui.group ? groupByYear(list, cmp) : [["", list.sort(cmp)]];
  if (thin.length) groups.push([THIN_LABEL, thin.sort(cmp)]);
  groups = groups.filter(([, gs]) => gs.length); // 分数筛选只选了「评价不足」时，前面那一整列是空的
  if (groups.length === 1 && !groups[0][0]) drawCards(groups[0][1]);
  else drawCards(groups.flatMap(([, gs]) => gs), groups, data.ui.group);
}

/**
 * 保留年份和排列，卡片每帧追加一小段，给输入、切换分类留出时间；list 的顺序和分组一致（一组画完再画下一组）。
 * 组名是空的不写标题；jump 是要不要年份跳转条（按年份分组时才要）
 */
function drawCards(list: Game[], groups?: [string, Game[]][], jump = true) {
  const el = $("#list");
  unwatchList();
  let end = 0; // data-end：画到这一组最后一部时，list 里一共画了几部（跳到这一年时先画到这里）
  const head = (y: string, n: number) => (y ? `<div class="year"><h2>${esc(y)}</h2><span>${n} 部${y === THIN_LABEL ? ` · ${THIN_NOTE}` : ""}</span></div>` : "");
  el.innerHTML = groups ? groups.map(([y, gs]) =>
    `<section data-y="${esc(y)}" data-end="${end += gs.length}">${head(y, gs.length)}<div class="grid"></div></section>`).join("") : `<div class="grid"></div>`;
  const grids = [...el.querySelectorAll<HTMLElement>(".grid")], targets = new Map<string, HTMLElement>();
  if (groups) groups.forEach(([, gs], i) => gs.forEach(g => targets.set(g.id, grids[i])));
  stopList = renderBatches(list, part => {
    const html = new Map<HTMLElement, string[]>();
    for (const g of part) {
      const grid = targets.get(g.id) ?? grids[0];
      if (!html.has(grid)) html.set(grid, []);
      html.get(grid)!.push(card(g));
    }
    for (const [grid, cards] of html) grid.insertAdjacentHTML("beforeend", cards.join(""));
  });
  if (groups && groups.length > 1 && jump) { showYearBar(groups); watchYears(el); }
}

// —— 年份跳转条：按年份分组时显示，每年一个按钮；点了把那一年的标题滚到吸顶栏下面，滚动时亮起最上面那一年 ——
let headIO: IntersectionObserver | null = null, heads: HTMLElement[] = [], currentYear = "";
/** 列表清空或重画前：不再盯旧的年份标题 */
function unwatchList() {
  headIO?.disconnect();
  heads = [];
}
function showYearBar(groups?: [string, Game[]][]) {
  const bar = $("#year-jump");
  bar.hidden = !groups;
  currentYear = "";
  bar.innerHTML = groups ? yearJumps(groups).map(j =>
    `<button data-y="${esc(j.key)}" aria-current="false" title="跳到 ${esc(j.label)}（${j.n} 部）">${esc(j.label)}<span class="n">${j.n}</span></button>`).join("") : "";
}
/** 年份标题跳过去时停在吸顶栏下面多远 */
const HEAD_GAP = 8;
function watchYears(el: HTMLElement) {
  heads = [...el.querySelectorAll<HTMLElement>(".year")];
  if (!heads.length) return;
  // 标题越过吸顶栏下沿附近那条线时才回调，平时滚动不做事
  headIO = new IntersectionObserver(markTopYear, { rootMargin: `-${$(".bar").offsetHeight + HEAD_GAP * 2}px 0px 0px 0px` });
  for (const h of heads) headIO.observe(h);
}
/** 亮起已经滚到吸顶栏下沿（或更上面）的最后一个年份；都还没到就是第一个。滚到底时（最后几年太短，标题到不了顶）亮着的年份还看得见就不换 */
function markTopYear() {
  if (!heads.length) return;
  if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
    const on = heads.find(h => h.parentElement!.dataset.y === currentYear);
    if (on && on.getBoundingClientRect().top < innerHeight) return;
  }
  const line = $(".bar").getBoundingClientRect().bottom + HEAD_GAP * 2;
  let cur = heads[0];
  for (const h of heads) { if (h.getBoundingClientRect().top <= line) cur = h; else break; }
  markYear(cur.parentElement!.dataset.y!);
}
function markYear(key: string) {
  if (key === currentYear) return;
  currentYear = key;
  const bar = $("#year-jump");
  let on: HTMLElement | null = null;
  for (const b of bar.querySelectorAll<HTMLElement>("button")) {
    const hit = b.dataset.y === key;
    b.setAttribute("aria-current", String(hit));
    if (hit) on = b;
  }
  // 窄窗口里年份条横着滚：亮起的那个不在看得见的范围里就滚过去
  if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
    bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
  }
}
/**
 * 跳到一年：这一年和前面的卡片还没画的先马上画上（不然位置不对），再把标题滚到吸顶栏下面。
 * 两帧后再对一次：上面的卡片第一次排版、高度和占位不一样时会挪一点
 */
function jumpToYear(key: string) {
  const sec = [...$("#list").querySelectorAll<HTMLElement>("section[data-y]")].find(s => s.dataset.y === key);
  if (!sec) return;
  stopList.flush(Number(sec.dataset.end));
  const head = sec.firstElementChild as HTMLElement;
  const offset = () => head.getBoundingClientRect().top - $(".bar").offsetHeight - HEAD_GAP;
  const align = () => window.scrollTo({ top: Math.max(0, window.scrollY + offset()), behavior: "instant" });
  align();
  markYear(key);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (Math.abs(offset()) > 1) align(); }));
}

function setMark(id: string, patch: Partial<Mark>) {
  data.marks[id] = { ...mark(id), ...patch };
  pruneMark(id);
  save();
  refreshCard(id);
}

/** 卡片还留在这一栏、排序也不看星级时，只换这一张卡片，不重画整个列表（「全部」有一千多张）；不然整个重画 */
export function refreshCard(id: string) {
  const g = games.get(id), el = document.querySelector(`#list .card[data-id="${CSS.escape(id)}"]`);
  if (g && el && data.ui.view === "library" && data.ui.sort !== "score" && inTab(g, data.ui.tab)) {
    el.outerHTML = card(g);
    renderNav();
    refreshDetail();
    return;
  }
  render();
}

async function onCardAction(act: string, id: string, b: HTMLElement) {
  const m = mark(id), g = games.get(id)!, local = localOf(id);
  if (act === "status") setMark(id, { status: m.status === b.dataset.s ? "" : (b.dataset.s as Mark["status"]) });
  if (act === "fav") setMark(id, { fav: !m.fav });
  if (act === "score") { const v = Number(b.dataset.v); setMark(id, { score: m.score === v ? 0 : v }); }
  b.closest("details")?.removeAttribute("open");
  if (act === "find") openFinder(id);
  if (act === "tier") {
    // 详情页的档位按钮：点一下放进那一档末尾，再点一次移出
    const k = b.dataset.t as TierKey, cur = tierOf(data.tiers, id);
    data.tiers = cur?.tier === k ? removeFromTiers(data.tiers, id) : placeInTier(data.tiers, id, k);
    save(); render();
  }
  if (act === "pick-exe") {
    const exe = await open({ defaultPath: local?.dir, filters: [{ name: "启动程序", extensions: ["exe", "bat"] }] });
    if (typeof exe !== "string") return;
    // 换到别的文件夹时 linkFolder 可能抢走别的作品的关联，先拍快照好撤销
    const before = { local: { ...data.local }, unmatched: data.unmatched, suspects: data.suspects, mark: data.marks[id] };
    const f = fromExe(exe);
    if (local && sameDir(local.dir, f.dir)) { data.local[id] = { ...local, exe }; data.suspects = data.suspects.filter(s => s.id !== id); }
    else linkFolder(id, f);
    save(); render();
    toast(local ? "启动程序已更换" : `已关联：${nameOf(g)}`, () => {
      data.local = before.local; data.unmatched = before.unmatched; data.suspects = before.suspects;
      if (before.mark) data.marks[id] = before.mark; else delete data.marks[id];
      save(); render();
    });
  }
  if (!local) return;
  if (act === "le") {
    // 转区启动开关：关掉时把字段去掉，data.json 里不留 false
    if (local.le) delete local.le; else local.le = true;
    save(); render();
  }
  if (act === "launch") {
    // 开了转区、设置里也选了 LEProc.exe 才转区；转区时不用 MTool 启动器。后端把游戏放进作业对象，退出后发 game-exited 事件记时长
    const le = local.le && data.lePath ? data.lePath : null;
    invoke<string>("launch", { id, exe: local.exe, dir: local.dir, mtool: data.mtool, le })
      .then(how => toast(`已${how === "mtool" ? "用 MTool " : how === "le" ? "转区" : ""}启动：${nameOf(g)}`))
      .catch(e => toast(`启动失败：${e}`));
  }
  if (act === "reveal") revealItemInDir(local.exe).catch(e => toast(`打不开文件夹：${e}`));
  if (act === "unlink") {
    // 只去掉关联，游玩记录留着
    unlinkFolder(id);
    save(); render();
    // 撤销只把关联放回去；这期间新记的游玩时长不丢
    toast("已取消关联", () => { data.local[id] = { ...local, ...data.local[id] }; save(); render(); });
  }
}

/** 用户点了链接才调用：只有 https 和写给提交邮箱的 mailto 交给系统打开（权限配置里也只放了这两种） */
export function openLink(u: string) {
  if (okLink(u)) openUrl(u).catch(err => toast(`打不开链接：${err}`));
  else toast("只能打开 https 链接");
}

/** 卡片和详情页上的按钮：点链接用浏览器打开，点封面或名字打开详情，其他按 data-act 处理 */
export function bindActions(el: HTMLElement) {
  el.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLAnchorElement>("a[href]");
    if (a) {
      // 软件里不跳转任何页面；只有 https 链接交给系统浏览器打开
      e.preventDefault();
      openLink(a.href);
      return;
    }
    const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id) return;
    if (t.closest("[data-open]")) { openDetail(id); return; }
    // 点开 ⋯ 时才放菜单按钮（在展开之前；键盘的回车、空格也是 click）
    const menu = t.closest("summary")?.nextElementSibling;
    if (menu?.classList.contains("menu") && !menu.childElementCount) {
      const g = games.get(id);
      if (g) menu.innerHTML = menuHtml(g);
      return;
    }
    const b = t.closest<HTMLElement>("[data-act]");
    if (b) onCardAction(b.dataset.act!, id, b);
  });
}

export function bindLibrary() {
  bindActions($("#list"));
  $("#views").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (b) { data.ui.view = b.dataset.view === "rank" ? "rank" : "library"; save(); render(); }
  });
  $("#cats").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cat]");
    if (b) { data.ui.cat = b.dataset.cat!; save(); render(); }
  });
  $("#tabs").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (b) { data.ui.tab = b.dataset.tab!; save(); render(); }
  });
  $("#bands").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-band]");
    if (b) toggleBand(b.dataset.band!);
  });
  // 打字时停一下再搜，免得每个字都重画
  let qTimer = 0;
  $("#q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = window.setTimeout(render, 120); });
  $("#genres-btn").addEventListener("click", () => { renderGenreDialog(); ($("#genres") as HTMLDialogElement).showModal(); });
  for (const sel of ["#genre-list", "#genre-chips"]) {
    $(sel).addEventListener("click", e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-genre]");
      if (b) toggleGenre(b.dataset.genre!);
    });
  }
  // 软件自己启动的游戏退出了：累加游玩时长（太短的不算）；玩着的时候取消了关联也照记
  listen<{ id: string; startedAt: number; seconds: number }>("game-exited", e => {
    const { id, startedAt, seconds } = e.payload;
    const next = addSession(data.local[id] ?? {}, startedAt, seconds);
    if (next) { data.local[id] = next; save(); render(); }
  }).catch(e => console.error("监听游戏退出失败", e));
  const sort = $("#sort") as HTMLSelectElement;
  sort.value = data.ui.sort;
  sort.addEventListener("change", () => { data.ui.sort = sort.value; save(); render(); });
  const group = $("#group-year") as HTMLInputElement;
  group.checked = data.ui.group;
  group.addEventListener("change", () => { data.ui.group = group.checked; save(); render(); });
  const years = $("#year-jump");
  years.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-y]");
    if (b) jumpToYear(b.dataset.y!);
  });
  // 年份多、窗口窄时年份条横着滚：鼠标滚轮在上面也横着滚
  years.addEventListener("wheel", e => {
    if (!e.deltaY || years.scrollWidth <= years.clientWidth) return;
    years.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  addEventListener("scrollend", markTopYear);
  // 缩略图坏了（文件缺）就换原图
  document.addEventListener("error", e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.full) return;
    const full = img.dataset.full;
    delete img.dataset.full;
    img.src = full;
  }, true);
  const lang = $("#lang") as HTMLSelectElement;
  lang.value = data.ui.lang;
  showAppName();
  lang.addEventListener("change", () => { data.ui.lang = lang.value as Lang; save(); render(); showAppName(); });
}
