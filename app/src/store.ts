import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { cleanTiers, emptyTiers, type TierKey, type Tiers } from "./tiers.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { normalizeCatalog, olderCatalog } from "./catalog.ts";
import { cleanCustom, type Custom } from "./custom.ts";
import { cleanBandSel } from "./bands.ts";
import { cleanBlacklist } from "./blacklist.ts";
import { helperExe, sameDir, versionsOf, type Suspect } from "./match.ts";
import { cleanReports, type RecogReport } from "./recog.ts";
import type { CatalogSnap } from "./news.ts";

export type Status = "" | "want" | "have" | "played";
export interface Mark {
  status: Status; fav: boolean; score: number;
  /** 我的评论 */
  note?: string;
  /** 只在评分文件里出现：这部作品在梯度表的哪一档、档内第几（自己的存在 Data.tiers） */
  tier?: TierKey;
  tierPos?: number;
}
/** 导出时可以单独不导出的几类 */
export type Kind = "want" | "have" | "played" | "fav" | "score" | "note" | "tier";
export const KINDS: [Kind, string][] = [["want", "想玩"], ["have", "已有"], ["played", "玩过"], ["fav", "收藏"], ["score", "星级"], ["note", "评论"], ["tier", "梯度"]];
export interface Local {
  /** 关联的游戏文件夹和启动程序；取消关联后这两个字段去掉，游玩记录留着 */
  dir?: string; exe?: string;
  /** 用 Locale Emulator 转区启动 */
  le?: boolean;
  /** 累计游玩秒数、最后一次游玩结束的时间（ISO 8601，UTC） */
  playSeconds?: number;
  lastPlayed?: string;
  /** 主人在「关联可能有误」里点了「保持」：记下当时的文件夹和启动程序（见 match.ts 的 keptStamp），两样都没变就不再提 */
  kept?: string;
  /** 这个关联是怎么来的：rj / title / folder / exe 扫描时自动关联（见 match.ts 的 Rule），manual 自己选的；旧版本关联的没有。报告「认错了」时用 */
  via?: string;
  /** 这部作品的其他版本（旧版 / 新版、原版 / 汉化版、装了两份……）：dir、exe 之外各自的 via、kept 同上。dir、exe 是主版本，卡片上的「启动」用它 */
  others?: Version[];
}
/** 同一部作品的另一个版本 */
export interface Version { dir: string; exe: string; via?: string; kept?: string }
/** 已关联的：有文件夹和启动程序（取消关联后只剩游玩记录的不算） */
export type Linked = Local & { dir: string; exe: string };
export const linked = (l: Local | undefined): l is Linked => !!l?.dir && !!l.exe;
export const localOf = (id: string): Linked | undefined => { const l = data.local[id]; return linked(l) ? l : undefined; };
/** 扫描到的一个游戏文件夹：dir 是放启动程序的文件夹，names 是名字的全部候选（文件夹名、外层包装文件夹名、启动程序名、引擎文件里的标题） */
export interface Found {
  dir: string; name: string; names: string[]; rj: string | null; exes: string[];
  /** 找到的全部 RJ 号（文件夹名里的在前）；旧版后端没有 */
  rjs?: string[];
  /** 引擎文件里读到的标题（names 里也有），unsure 是其中编码是猜的那些（只拿来给「可能是」）；旧版后端没有 */
  titles?: string[];
  unsure?: string[];
  /** Steam 版的痕迹：游戏这层有 steam_appid.txt（写着 appid 时是它）或 steam_api.dll 时有这个字段（没有 appid 是 ""）；旧版后端没有 */
  steam?: string;
  /** 有包装层时：最外面那层包装文件夹（dir 在它里面）。以前关联在包装层上的，扫描时据此挪到 dir；没有包装层就没有这个字段 */
  top?: string;
  /** 没认出、但像是某部作品时记下它的 id（设置里显示「可能是」，关联时先搜它） */
  guess?: string;
  /** 只是「可能是」的原因（给主人看的一句话） */
  reason?: string;
}
export interface Friend { id: string; name: string; marks: Record<string, Mark> }
/** 神作 / 神作提名的复议票：支持或反对，理由（反对时必填，至少 20 字） */
export interface Vote { vote: "support" | "oppose"; reason?: string }
/** 黑榜里的一部：理由可以不写 */
export interface Black { reason?: string }

export type Lang = "zh" | "en" | "ja";
export interface Game {
  id: string; cat: string; state: "released" | "dev";
  /** 来源：dlsite / fanza / commercial（商业）/ steam / cien / fanbox，旧资料没有就算 dlsite */
  src: string;
  /** 日文原名 */
  title: string;
  /** 三种语言的名字；mt 里列出的是机翻 */
  names: Record<Lang, string>; mt: Lang[];
  circle: string; date: string;
  rate: number | null; dl: number | null; url: string; cover: string; note: string;
  /** 视角：female / male / both / multi / none，没有就不显示（标签见 catalog.ts 的 POV_LABEL） */
  pov?: string;
  /** 卡片、排行榜用的缩略图（数据包里有才有，没有是空的，用 cover）；详情页和导出图片用 cover */
  thumb?: string;
  /** DLsite 打分人数（综合榜的口碑用），旧资料没有 */
  rc?: number | null;
  /** DLsite 题材 id（名字在 Catalog.genres 里），只有 DLsite 的作品有 */
  genres?: string[];
  /** 核实过的别名（汉化版的名字、罗马字、遮字前的写法……），识别游戏文件夹时和作品名一样用 */
  aliases?: string[];
}
/** 题材字典：题材 id → 三种语言的名字 */
export type GenreDict = Record<string, Record<Lang, string>>;
/** rankings（民间榜单）、scoring（综合榜配方）、canon（神作名单）可以没有，用之前经 scoring.ts / scoring2.ts 整理 */
export interface Catalog { version: number; updated: string; revision: number; source: string; games: Game[]; genres: GenreDict; rankings?: unknown; scoring?: unknown; canon?: unknown }

export interface Data {
  version: 1;
  marks: Record<string, Mark>;
  local: Record<string, Local>;
  roots: string[];
  /** 上次扫描没认出来的文件夹，留着给设置里手动关联 */
  unmatched: Found[];
  /** 上次扫描时看着可能关联错了的（见 match.ts 的 reviewLinks），留着给设置里确认 */
  suspects: Suspect[];
  /** 识别报告：「认错了」时记下的（见 recog.ts），提交时可以一起发 */
  reports: RecogReport[];
  friends: Friend[];
  /** 我的游戏：图鉴里没有、自己添加的（id 是 local- 开头，关联和游玩记录照样在 local 里） */
  custom: Record<string, Custom>;
  /** 我对神作 / 神作提名的投票（提交给碧翠子禁书库用，存着方便以后改） */
  votes: Record<string, Vote>;
  /** 我的黑榜：不推荐的作品（我的游戏不能放），不改分数；提交给碧翠子禁书库时可以带上 */
  blacklist: Record<string, Black>;
  /** 图鉴里隐藏黑榜作品（「黑榜」页签里照样有），默认关 */
  hideBlack: boolean;
  /** 上次看过的作品资料的极简快照（资料更新小结用，见 news.ts）；没有就是还没记过 */
  catalogSeen?: CatalogSnap;
  /** 设置里「更新资料后显示变化」，没有这个字段算开 */
  catalogNews?: boolean;
  myName: string;
  /** 有 MTool 生成的启动器就用它启动 */
  mtool: boolean;
  /** Locale Emulator 的 LEProc.exe 路径（设置里手动选），空的就没有转区功能 */
  lePath: string;
  /** 我的梯度表：每档一个作品 id 数组，顺序就是档内名次 */
  tiers: Tiers;
  /** 导出评分时选的：导出哪几类、哪些作品不导出（下次导出照旧） */
  export: { kinds: Kind[]; skip: string[]; format: "html" | "json"; custom?: boolean };
  /** view：「图鉴」library 或「排行榜」rank；group：图鉴按年份分组（每年里按 sort 排），默认开；bands：图鉴分数筛选选中的档名（和「评价不足」），空的是不筛；notGenres：题材里选了「不看」的 id（带上任何一个就不显示），genreAsked：第一次打开时问过「有没有不想看的题材」（答了或跳过） */
  ui: { tab: string; cat: string; sort: string; lang: Lang; view: "library" | "rank"; group: boolean; bands: string[]; notGenres: string[]; genreAsked: boolean };
}

const EMPTY: Data = {
  version: 1, marks: {}, local: {}, roots: [], unmatched: [], suspects: [], reports: [], friends: [], custom: {}, votes: {}, blacklist: {}, hideBlack: false, myName: "", mtool: false, lePath: "", tiers: emptyTiers(),
  export: { kinds: KINDS.map(([k]) => k), skip: [], format: "html" },
  ui: { tab: "all", cat: "all", sort: "year", lang: "zh", view: "library", group: true, bands: [], notGenres: [], genreAsked: false },
};

export const data: Data = structuredClone(EMPTY);
export const NO_MARK: Mark = { status: "", fav: false, score: 0, note: "" };
/** 这条标记有没有任何内容 */
export const hasMark = (m: Mark) => !!(m.status || m.fav || m.score || m.note?.trim() || m.tier);
const MARK_KEYS = ["status", "fav", "score", "note"];
/** 标记变成全空、也没有不认识的字段时删掉这条，免得 data.json 越积越大 */
export function pruneMark(id: string) {
  const m = data.marks[id];
  if (m && !hasMark(m) && Object.keys(m).every(k => MARK_KEYS.includes(k))) delete data.marks[id];
}
export const mark = (id: string): Mark => data.marks[id] ?? NO_MARK;

/** 这次启动真的读到了数据文件（没有文件、文件坏了、新版本写的都是 false）；false 时不清理我的游戏的封面 */
export let dataLoaded = false;

/** 读数据文件；文件坏了或是新版本软件写的，就另存一份、从空白开始，返回给用户看的提示 */
export async function load(): Promise<string | null> {
  // 传本地日期给后端，每天第一次读到数据时自动备份
  const d = new Date(), pad = (n: number) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const text = await invoke<string | null>("read_data", { today });
  if (!text) return null;
  let saved: Partial<Data> | null = null;
  try {
    saved = JSON.parse(text);
  } catch { /* 下面统一处理 */ }
  // null、数字、数组都不是数据文件
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    return `数据文件读不出来，已另存为 ${await invoke<string>("backup_broken_data")}，现在从空白开始`;
  }
  // 新版本软件写的：不硬读，原样另存一份留着（不会被这个版本覆盖），这次从空白开始
  if (typeof saved.version === "number" && saved.version > 1) {
    return `数据文件是新版本的软件写的，已原样另存为 ${await invoke<string>("backup_broken_data")}；请升级软件后再把它改回 data.json。这次从空白开始`;
  }
  Object.assign(data, structuredClone(EMPTY), saved, {
    lePath: typeof saved.lePath === "string" ? saved.lePath : "",
    ui: { ...EMPTY.ui, ...saved.ui, group: saved.ui?.group !== false, bands: cleanBandSel(saved.ui?.bands), notGenres: cleanBandSel(saved.ui?.notGenres), genreAsked: saved.ui?.genreAsked === true },
    export: { ...structuredClone(EMPTY.export), ...saved.export },
    tiers: cleanTiers(saved.tiers),
    custom: cleanCustom(saved.custom),
    votes: saved.votes && typeof saved.votes === "object" && !Array.isArray(saved.votes) ? saved.votes : {},
    suspects: Array.isArray(saved.suspects) ? saved.suspects : [],
    reports: cleanReports(saved.reports),
    blacklist: cleanBlacklist(saved.blacklist),
    hideBlack: saved.hideBlack === true,
  });
  dataLoaded = true;
  return null;
}

let timer = 0;
/** 改完数据就调用；连续改动合成一次写盘 */
export function save() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    invoke("write_data", { text: JSON.stringify(data, null, 1) }).catch(e => console.error("保存失败", e));
  }, 300);
}

/** 软件能读的作品目录格式最高版本；更高的说明是新版软件做的数据包 */
export const CATALOG_VERSION = 2;

/** 数据包的目录：先整理（补缺的字段、去掉坏的封面路径），再把封面和缩略图换成能显示的地址 */
export function withPackCovers(raw: unknown, packDir: string): Catalog {
  const cat = normalizeCatalog(raw);
  const sep = packDir.includes("\\") ? "\\" : "/";
  for (const g of cat.games) {
    if (g.cover) g.cover = convertFileSrc(packDir + sep + g.cover.replace(/\//g, sep));
    if (g.thumb) g.thumb = convertFileSrc(packDir + sep + g.thumb.replace(/\//g, sep));
  }
  return cat;
}

/**
 * 作品目录：软件自带一份；导入过数据包、而且数据包不比自带的旧（日期和 revision 一样也用包的，包里可能有封面），就用数据包的。
 */
export async function loadCatalog(): Promise<Catalog> {
  const builtIn = normalizeCatalog(await (await fetch("catalog.json")).json());
  const pack = await invoke<[string, string] | null>("read_pack");
  if (!pack) return builtIn;
  try {
    const cat = withPackCovers(JSON.parse(pack[0]), pack[1]);
    if (cat.version > CATALOG_VERSION || olderCatalog(cat, builtIn)) return builtIn;
    return cat;
  } catch {
    return builtIn;
  }
}

/**
 * 把一个文件夹记成某部作品：已有的启动程序还在这个文件夹里就保留，没标过状态的标成「已有」。
 * 这个文件夹原来记在别的作品上的，那条关联去掉（一个文件夹只算一部；那部的游玩记录留着）
 */
export function linkFolder(id: string, f: Found, via?: string) {
  takeFolder(id, f.dir);
  const old = data.local[id];
  // 原来的启动程序像是工具（Tool\nwjc.exe）时也先留着：重新扫描不悄悄换，交给「关联可能有误」让主人确认
  const same = !!old?.exe && !!old.dir && sameDir(old.dir, f.dir);
  const exe = same && (f.exes.includes(old.exe!) || helperExe(old.exe!, old.dir!)) ? old.exe! : f.exes[0];
  data.local[id] = { ...old, dir: f.dir, exe }; // 不认识的字段照留
  // 怎么关联的：给了就记下；换了文件夹又没说的去掉（同一个文件夹重新扫描照旧）
  const how = via ?? (same ? old?.via : undefined);
  if (how) data.local[id].via = how; else delete data.local[id].via;
  if (!same) delete data.local[id].kept;
  // 这个文件夹原来是它的另一个版本：现在是主版本了，从其他版本里去掉
  const others = (old?.others ?? []).filter(v => !sameDir(v.dir, f.dir));
  if (others.length) data.local[id].others = others; else delete data.local[id].others;
  linked_(id, f.dir);
}

/** 文件夹 dir 关联给了作品 id：别的作品上关联着这个文件夹的那个版本去掉（一个文件夹只算一部） */
function takeFolder(id: string, dir: string) {
  for (const [other, l] of Object.entries(data.local)) if (other !== id && versionsOf(l).some(v => sameDir(v.dir, dir))) removeVersion(other, dir);
}
/** 关联好以后：这个文件夹不再算「没认出」，它的「关联可能有误」去掉，没标过状态的标成「已有」 */
function linked_(id: string, dir: string) {
  data.unmatched = data.unmatched.filter(u => !sameDir(u.dir, dir));
  data.suspects = data.suspects.filter(x => !(x.id === id || sameDir(x.dir, dir)));
  const m = data.marks[id];
  if (!m || !m.status) data.marks[id] = { ...(m ?? { fav: false, score: 0 }), status: "have" };
}

/**
 * 把文件夹记成作品 id 的另一个版本（主版本不变）；还没关联过的就当主版本。已经是它的版本的：启动程序还在就留着（像工具的也先留着，见 linkFolder）
 */
export function addVersion(id: string, f: Found, via?: string) {
  const l = data.local[id];
  if (!linked(l) || sameDir(l.dir, f.dir)) return linkFolder(id, f, via);
  takeFolder(id, f.dir);
  const all = data.local[id] as Linked, list = all.others ?? [];
  const old = list.find(v => sameDir(v.dir, f.dir));
  const exe = old && (f.exes.includes(old.exe) || helperExe(old.exe, old.dir)) ? old.exe : f.exes[0];
  const v: Version = { ...old, dir: f.dir, exe };
  const how = via ?? old?.via;
  if (how) v.via = how; else delete v.via;
  data.local[id] = { ...all, others: [...list.filter(x => !sameDir(x.dir, f.dir)), v] };
  linked_(id, f.dir);
}

/** 去掉作品 id 的一个版本（文件夹 dir）：是主版本的，下一个版本接着当主版本；一个都不剩就是取消关联（游玩记录留着） */
export function removeVersion(id: string, dir: string) {
  const l = data.local[id];
  if (!linked(l)) return;
  data.suspects = data.suspects.filter(x => !(x.id === id && sameDir(x.dir, dir)));
  const rest = versionsOf(l).filter(v => !sameDir(v.dir, dir));
  if (rest.length === versionsOf(l).length) return;
  if (!rest.length) return unlinkFolder(id);
  data.local[id] = withMain(l, rest);
}

/** 改作品 id 的版本 dir 的启动程序或「保持」记号（主版本、其他版本都行） */
export function patchVersion(id: string, dir: string, patch: Partial<Pick<Version, "exe" | "kept">>) {
  const l = data.local[id];
  if (linked(l)) data.local[id] = withMain(l, versionsOf(l).map(v => (sameDir(v.dir, dir) ? { ...v, ...patch } : v)));
}

/** 把作品 id 的版本 dir 设为主版本（卡片上的「启动」用它） */
export function setMainVersion(id: string, dir: string) {
  const l = data.local[id];
  if (!linked(l)) return;
  const vs = versionsOf(l), i = vs.findIndex(v => sameDir(v.dir, dir));
  if (i > 0) data.local[id] = withMain(l, [vs[i], ...vs.filter((_, j) => j !== i)]);
}

/** 按 list 的顺序重排版本：第一个是主版本（dir、exe、via、kept），其余的放进 others；别的字段（游玩记录、转区……）照留 */
function withMain(l: Local, list: (Version & { main?: boolean })[]): Local {
  const strip = ({ main: _m, ...v }: Version & { main?: boolean }) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as unknown as Version;
  const [first, ...others] = list.map(strip);
  const out: Local = { ...l, dir: first.dir, exe: first.exe };
  delete out.via; delete out.kept; delete out.others;
  if (first.via) out.via = first.via;
  if (first.kept) out.kept = first.kept;
  if (others.length) out.others = others;
  return out;
}

/** 取消关联（全部版本）：只去掉文件夹、启动程序、其他版本和转区开关，游玩记录和不认识的字段留着；什么都不剩就删掉这条 */
export function unlinkFolder(id: string) {
  const rest = { ...data.local[id] };
  delete rest.dir; delete rest.exe; delete rest.le; delete rest.kept; delete rest.via; delete rest.others;
  data.suspects = data.suspects.filter(x => x.id !== id);
  if (Object.keys(rest).length) data.local[id] = rest; else delete data.local[id];
}
