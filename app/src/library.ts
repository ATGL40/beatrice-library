import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { score } from "./search";
import { openDetail, refreshDetail } from "./detail";
import { fromExe, openFinder } from "./finder";
import { data, hasMark, linkFolder, mark, pruneMark, save, type Catalog, type Game, type Lang, type Mark } from "./store";
import { $, esc, toast } from "./ui";
import { cleanRankings, cleanScoring, scoreAll, type GameScore, type Ranking, type Scoring } from "./scoring";
import { placeInTier, removeFromTiers, TIER_LABEL, tierOf, type TierKey } from "./tiers";
import { tierText } from "./marks";
import { renderRank } from "./rank";

export const CATS = [
  ["f-rpg", "女主 RPG"], ["m-rpg", "男主 RPG"], ["adv", "ADV / 剧情"], ["slg", "SLG / 经营"], ["act", "动作"], ["other", "其他"],
] as const;
const TABS = [
  ["all", "全部"], ["want", "想玩"], ["have", "已有"], ["played", "玩过"], ["fav", "收藏"], ["dev", "开发中"],
] as const;
const STATUS = [["want", "想玩"], ["have", "已有"], ["played", "玩过"]] as const;
const STATUS_TEXT: Record<string, string> = { want: "想玩", have: "已有", played: "玩过" };

export const games = new Map<string, Game>();
export const catalogInfo = { updated: "", source: "" };
/** 排行榜要用的：数据包里的民间榜单、综合榜配方，和按配方算好的每部作品的分数名次 */
export const ranking: { lists: Ranking[]; scoring: Scoring; scores: Map<string, GameScore> } = {
  lists: [], scoring: cleanScoring(undefined), scores: new Map(),
};

/** 换上一份作品目录（启动时、导入数据包后） */
export function setCatalog(cat: Catalog) {
  games.clear();
  for (const g of cat.games) games.set(g.id, g);
  catalogInfo.updated = cat.updated;
  catalogInfo.source = cat.source;
  ranking.lists = cleanRankings(cat.rankings);
  ranking.scoring = cleanScoring(cat.scoring);
  ranking.scores = scoreAll(cat.games, ranking.lists, ranking.scoring);
}
const catOf = (g: Game) => g.cat || "other";

/** 软件名也跟着名字语言换 */
export const APP_NAME: Record<Lang, string> = { zh: "碧翠子禁书库", en: "Beatrice Library", ja: "Beatrice Library" };
/** 页面标题、窗口标题和左上角的大字 */
function showAppName() {
  document.title = $("#app-name").textContent = APP_NAME[data.ui.lang];
  getCurrentWindow().setTitle(document.title).catch(() => {});
}

/** 按设置的语言取名字，没有就用日文原名 */
export const nameOf = (g: Game, lang: Lang = data.ui.lang) => g.names?.[lang] || g.names?.ja || g.title || g.id;
const searchTexts = (g: Game) => [g.title, g.names?.zh, g.names?.en, g.names?.ja, g.circle].filter(Boolean) as string[];

function inTab(g: Game, t: string) {
  const m = mark(g.id);
  if (t === "dev") return g.state === "dev";
  if (g.state === "dev" && t === "all") return false;
  if (t === "all") return true;
  if (t === "fav") return m.fav;
  return m.status === t;
}

/** 顶部副标题里写的排列方式，跟着排序下拉框变 */
const SORT_TEXT: Record<string, string> = {
  year: "按发售年份排列", rate: "按 DLsite 评分排列", dl: "按销量排列", score: "按我的评分排列",
  friends: "按朋友评分排列", overall: "按综合排名排列", name: "按名字排列",
};

function renderNav() {
  const all = [...games.values()];
  $("#cats").innerHTML = CATS.map(([k, label]) => {
    const n = all.filter(g => catOf(g) === k).length;
    return `<button class="cat ${n ? "" : "empty-cat"}" data-cat="${k}" aria-pressed="${k === data.ui.cat}">${label}<span class="n">${n}</span></button>`;
  }).join("");
  const inCat = all.filter(g => catOf(g) === data.ui.cat);
  $("#tabs").innerHTML = TABS.map(([k, label]) => {
    const n = inCat.filter(g => inTab(g, k)).length;
    return `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === data.ui.tab}">${label}<span class="n">${n}</span></button>`;
  }).join("");
  const n = Object.keys(data.local).length;
  const q = ($("#q") as HTMLInputElement).value.trim();
  const how = data.ui.view === "rank" ? "排行榜" : q ? "按和搜索词的相近程度排列" : SORT_TEXT[data.ui.sort] ?? SORT_TEXT.year;
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

export function metaHtml(g: Game) {
  return [
    g.circle && esc(g.circle),
    g.date && esc(g.date),
    g.rate ? `DLsite ★${Number(g.rate).toFixed(2)}` : "",
    g.dl ? `销量 ${Number(g.dl).toLocaleString()}` : "",
    g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">商店页</a>` : "",
  ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
}

/** 启动按钮、菜单、状态、星级、收藏：卡片和详情页共用 */
export function controlsHtml(g: Game) {
  const m = mark(g.id);
  const local = data.local[g.id];
  const seg = STATUS.map(([k, l]) => `<button data-act="status" data-s="${k}" aria-pressed="${m.status === k}">${l}</button>`).join("");
  const stars = [1, 2, 3, 4, 5].map(i => `<button data-act="score" data-v="${i}" class="${i <= m.score ? "on" : ""}" aria-label="评 ${i} 分">★</button>`).join("");
  // 每部作品都有同样的菜单；还没关联的，「打开文件夹」「取消关联」灰掉
  const off = local ? "" : " disabled";
  return `<div class="local">
      ${local
        ? `<button class="btn play" data-act="launch" title="${esc(local.exe)}">▶ 启动</button>`
        : `<button class="btn ghost find" data-act="find">找电脑里的游戏</button>`}
      <details><summary aria-label="更多">⋯</summary><div class="menu">
        <button data-act="reveal"${off}>打开文件夹</button>
        <button data-act="find">${local ? "换游戏文件夹…" : "找电脑里的游戏…"}</button>
        <button data-act="pick-exe">${local ? "换启动程序…" : "选择启动程序…"}</button>
        <button data-act="unlink"${off}>取消关联</button>
      </div></details>
    </div>
    <div class="ctl">
      <span class="seg">${seg}</span>
      <span class="row2"><span class="stars">${stars}</span>
        <button class="fav ${m.fav ? "on" : ""}" data-act="fav" aria-pressed="${m.fav}" aria-label="收藏">♥</button></span>
    </div>`;
}

function card(g: Game) {
  const m = mark(g.id);
  const stamp = g.state === "dev" ? `<span class="stamp dev">开发中</span>` : m.status === "played" ? `<span class="stamp">玩过</span>` : "";
  const lang = data.ui.lang, name = nameOf(g), orig = g.names?.ja || g.title;
  const isMt = !!g.names?.[lang] && g.mt?.includes(lang);
  const cover = g.cover ? `<img src="${esc(g.cover)}" alt="${esc(name)} 封面" loading="lazy">` : `<span class="none">暂无封面</span>`;
  return `<article class="card ${m.status === "played" ? "played" : ""}" data-id="${esc(g.id)}">
    <div class="cover" data-open title="打开详情">${cover}${stamp}</div>
    <div class="body">
      <div class="t" data-open title="打开详情">${esc(name)}${isMt ? `<span class="mt" title="没有官方或通用译名，这是机器翻译">机翻</span>` : ""}${m.note ? `<span class="mt" title="${esc(m.note)}">我的评论</span>` : ""}${tierTag(g.id)}</div>
      ${orig !== name ? `<div class="orig">${esc(orig)}</div>` : ""}
      <div class="meta">${metaHtml(g)}</div>
      ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
      ${friendLines(g.id)}
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
  const rank = data.ui.view === "rank";
  for (const b of document.querySelectorAll<HTMLElement>("#views [data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === data.ui.view));
  for (const sel of ["#list", ".bar", "#q", "#sort"]) ($(sel) as HTMLElement).hidden = rank;
  $("#rank").hidden = !rank;
  if (rank) { renderNav(); renderRank(); } else renderList();
  refreshDetail();
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
    case "overall": return byNumber(g => ranking.scores.get(g.id)?.total ?? -1);
    case "name": {
      const lang = data.ui.lang, coll = new Intl.Collator(COLLATE[lang]);
      return (a, b) => coll.compare(nameOf(a, lang), nameOf(b, lang)) || newerFirst(a, b);
    }
    default: return newerFirst;
  }
}

function renderList() {
  renderNav();
  const q = ($("#q") as HTMLInputElement).value.trim();
  const sort = data.ui.sort;
  let list = [...games.values()].filter(g => catOf(g) === data.ui.cat && inTab(g, data.ui.tab));
  if (q) {
    // 搜索时按像不像排，最像的在前
    const scored = list.map(g => [g, score(q, searchTexts(g))] as const).filter(([, s]) => s > 0);
    scored.sort((a, b) => b[1] - a[1]);
    list = scored.map(([g]) => g);
    $("#list").innerHTML = list.length
      ? `<div class="grid">${list.map(card).join("")}</div>`
      : `<p class="empty">没有符合搜索的作品。</p>`;
    return;
  }
  list.sort(compareFor(sort));
  const el = $("#list");
  if (!list.length) {
    const catEmpty = ![...games.values()].some(g => catOf(g) === data.ui.cat);
    el.innerHTML = `<p class="empty">${catEmpty ? "这个分类还没收录作品。" : data.ui.tab === "dev" ? "还没有开发中的作品。" : "这一栏还是空的，在作品卡片上点按钮就会出现在这里。"}</p>`;
    return;
  }
  if (sort !== "year") { el.innerHTML = `<div class="grid">${list.map(card).join("")}</div>`; return; }
  const groups = new Map<string, Game[]>();
  for (const g of list) {
    const y = g.state === "dev" ? "开发中" : (g.date || "").slice(0, 4) || "年份不明";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push(g);
  }
  el.innerHTML = [...groups].map(([y, gs]) =>
    `<section><div class="year"><h2>${esc(y)}</h2><span>${gs.length} 部</span></div><div class="grid">${gs.map(card).join("")}</div></section>`,
  ).join("");
}

function setMark(id: string, patch: Partial<Mark>) {
  data.marks[id] = { ...mark(id), ...patch };
  pruneMark(id);
  save();
  render();
}

async function onCardAction(act: string, id: string, b: HTMLElement) {
  const m = mark(id), g = games.get(id)!, local = data.local[id];
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
    const before = { local: { ...data.local }, unmatched: data.unmatched, mark: data.marks[id] };
    const f = fromExe(exe);
    if (local?.dir === f.dir) data.local[id] = { ...local, exe };
    else linkFolder(id, f);
    save(); render();
    toast(local ? "启动程序已更换" : `已关联：${nameOf(g)}`, () => {
      data.local = before.local; data.unmatched = before.unmatched;
      if (before.mark) data.marks[id] = before.mark; else delete data.marks[id];
      save(); render();
    });
  }
  if (!local) return;
  if (act === "launch") {
    invoke<boolean>("launch", { exe: local.exe, dir: local.dir, mtool: data.mtool })
      .then(viaMtool => toast(`已${viaMtool ? "用 MTool " : ""}启动：${nameOf(g)}`))
      .catch(e => toast(`启动失败：${e}`));
  }
  if (act === "reveal") revealItemInDir(local.exe).catch(e => toast(`打不开文件夹：${e}`));
  if (act === "unlink") {
    delete data.local[id];
    save(); render();
    toast("已取消关联", () => { data.local[id] = local; save(); render(); });
  }
}

/** 卡片和详情页上的按钮：点链接用浏览器打开，点封面或名字打开详情，其他按 data-act 处理 */
export function bindActions(el: HTMLElement) {
  el.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLAnchorElement>("a[href]");
    if (a) {
      // 软件里不跳转任何页面；只有 https 链接交给系统浏览器打开
      e.preventDefault();
      if (a.href.startsWith("https://")) openUrl(a.href).catch(err => toast(`打不开链接：${err}`));
      else toast("只能打开 https 链接");
      return;
    }
    const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id) return;
    if (t.closest("[data-open]")) { openDetail(id); return; }
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
  $("#q").addEventListener("input", render);
  const sort = $("#sort") as HTMLSelectElement;
  sort.value = data.ui.sort;
  sort.addEventListener("change", () => { data.ui.sort = sort.value; save(); render(); });
  const lang = $("#lang") as HTMLSelectElement;
  lang.value = data.ui.lang;
  showAppName();
  lang.addEventListener("change", () => { data.ui.lang = lang.value as Lang; save(); render(); showAppName(); });
}
