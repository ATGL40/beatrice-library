import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { cleanTiers, emptyTiers, type TierKey, type Tiers } from "./tiers.ts"; // 带 .ts 后缀，node 单测才能直接载入
import { normalizeCatalog } from "./catalog.ts";

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
}
/** 已关联的：有文件夹和启动程序（取消关联后只剩游玩记录的不算） */
export type Linked = Local & { dir: string; exe: string };
export const linked = (l: Local | undefined): l is Linked => !!l?.dir && !!l.exe;
export const localOf = (id: string): Linked | undefined => { const l = data.local[id]; return linked(l) ? l : undefined; };
/** 扫描到的一个游戏文件夹：dir 是放启动程序的文件夹，names 是名字的全部候选（文件夹名、外层包装文件夹名、启动程序名、引擎文件里的标题） */
export interface Found {
  dir: string; name: string; names: string[]; rj: string | null; exes: string[];
  /** 有包装层时：最外面那层包装文件夹（dir 在它里面）。以前关联在包装层上的，扫描时据此挪到 dir；没有包装层就没有这个字段 */
  top?: string;
  /** 没认出、但像是某部作品时记下它的 id（设置里显示「可能是」，关联时先搜它） */
  guess?: string;
}
export interface Friend { id: string; name: string; marks: Record<string, Mark> }

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
  /** DLsite 打分人数（综合榜的口碑用），旧资料没有 */
  rc?: number | null;
  /** DLsite 题材 id（名字在 Catalog.genres 里），只有 DLsite 的作品有 */
  genres?: string[];
}
/** 题材字典：题材 id → 三种语言的名字 */
export type GenreDict = Record<string, Record<Lang, string>>;
/** rankings（民间榜单）和 scoring（综合榜配方）可以没有，用之前经 scoring.ts 整理 */
export interface Catalog { version: number; updated: string; source: string; games: Game[]; genres: GenreDict; rankings?: unknown; scoring?: unknown }

export interface Data {
  version: 1;
  marks: Record<string, Mark>;
  local: Record<string, Local>;
  roots: string[];
  /** 上次扫描没认出来的文件夹，留着给设置里手动关联 */
  unmatched: Found[];
  friends: Friend[];
  myName: string;
  /** 有 MTool 生成的启动器就用它启动 */
  mtool: boolean;
  /** Locale Emulator 的 LEProc.exe 路径（设置里手动选），空的就没有转区功能 */
  lePath: string;
  /** 我的梯度表：每档一个作品 id 数组，顺序就是档内名次 */
  tiers: Tiers;
  /** 导出评分时选的：导出哪几类、哪些作品不导出（下次导出照旧） */
  export: { kinds: Kind[]; skip: string[]; format: "html" | "json" };
  /** view：「图鉴」library 或「排行榜」rank */
  ui: { tab: string; cat: string; sort: string; lang: Lang; view: "library" | "rank" };
}

const EMPTY: Data = {
  version: 1, marks: {}, local: {}, roots: [], unmatched: [], friends: [], myName: "", mtool: false, lePath: "", tiers: emptyTiers(),
  export: { kinds: KINDS.map(([k]) => k), skip: [], format: "html" },
  ui: { tab: "all", cat: "all", sort: "year", lang: "zh", view: "library" },
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

/** 读数据；文件坏了就改名留作备份、从空白开始，返回备份文件名让界面提示 */
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
    ui: { ...EMPTY.ui, ...saved.ui },
    export: { ...structuredClone(EMPTY.export), ...saved.export },
    tiers: cleanTiers(saved.tiers),
  });
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

/** 把数据包里相对的封面路径换成能显示的地址 */
/** 数据包的目录：先整理（补缺的字段、去掉坏的封面路径），再把封面换成能显示的地址 */
export function withPackCovers(raw: unknown, packDir: string): Catalog {
  const cat = normalizeCatalog(raw);
  const sep = packDir.includes("\\") ? "\\" : "/";
  for (const g of cat.games) {
    if (g.cover) g.cover = convertFileSrc(packDir + sep + g.cover.replace(/\//g, sep));
  }
  return cat;
}

/**
 * 作品目录：软件自带一份；导入过数据包、而且数据包比自带的新，就用数据包的。
 */
export async function loadCatalog(): Promise<Catalog> {
  const builtIn = normalizeCatalog(await (await fetch("catalog.json")).json());
  const pack = await invoke<[string, string] | null>("read_pack");
  if (!pack) return builtIn;
  try {
    const cat = withPackCovers(JSON.parse(pack[0]), pack[1]);
    if (cat.version > CATALOG_VERSION || cat.updated < builtIn.updated) return builtIn;
    return cat;
  } catch {
    return builtIn;
  }
}

/**
 * 把一个文件夹记成某部作品：已有的启动程序还在这个文件夹里就保留，没标过状态的标成「已有」。
 * 这个文件夹原来记在别的作品上的，那条关联去掉（一个文件夹只算一部；那部的游玩记录留着）
 */
export function linkFolder(id: string, f: Found) {
  for (const [other, l] of Object.entries(data.local)) if (other !== id && l.dir === f.dir) unlinkFolder(other);
  const old = data.local[id];
  const exe = old?.exe && old.dir === f.dir && f.exes.includes(old.exe) ? old.exe : f.exes[0];
  data.local[id] = { ...old, dir: f.dir, exe }; // 不认识的字段照留
  data.unmatched = data.unmatched.filter(u => u.dir !== f.dir);
  const m = data.marks[id];
  if (!m || !m.status) data.marks[id] = { ...(m ?? { fav: false, score: 0 }), status: "have" };
}

/** 取消关联：只去掉文件夹、启动程序和转区开关，游玩记录和不认识的字段留着；什么都不剩就删掉这条 */
export function unlinkFolder(id: string) {
  const rest = { ...data.local[id] };
  delete rest.dir; delete rest.exe; delete rest.le;
  if (Object.keys(rest).length) data.local[id] = rest; else delete data.local[id];
}
