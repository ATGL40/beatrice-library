import { linked, type Found, type Game, type Linked, type Local } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入

const BRACKETS = /[\[【(（「『][^\]】)）」』]*[\]】)）」』]/g;
const VERSION = /ver\.?\s*[\d.]+|v\d+(\.\d+)+|(?<![\d.])\d+(\.\d+)+/g;
const SEP = /[\s\-_~～〜・·:：!！?？。、,，.'"`]/;

/** 比较用的写法：全角转半角、去掉括号里的东西（[汉化] 【体验版】）、版本号和标点空格 */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(BRACKETS, "")
    .replace(VERSION, "")
    .replace(new RegExp(SEP.source, "g"), "");
}

const GENERIC = new Set(["game", "www", "pc", "data", "bin", "x64", "x86", "rpgmv-game", "nwjs", "nw", "nwjc", "mtool_game"]);
/** 没有辨识度的名字：引擎、架构的通用文件夹名，版本号或纯数字，太短的（和后端 is_generic 一致） */
export function generic(s: string): boolean {
  const t = s.trim().toLowerCase();
  return [...t].length < 2 || GENERIC.has(t) || /^(ver|v)?(?=.*\d)[\d.]+$/.test(t);
}

/** 副标题的分隔：～ - 后面的是副标题（全角的先转成半角再分） */
const SUB_SEP = /[～〜~\-―]/;
const parts = (s: string) => s.normalize("NFKC").split(SUB_SEP);

/**
 * RJ 号（DLsite 的 RJ，也认 VJ）：RJ / VJ 后面跟 6 位或 8 位数字，前面不能紧挨字母数字（xxRJ01002988 不算），后面不能还是数字（RJ010029889 不算）。
 * 一段文字里的几个号都收集（不重复、大写）。和后端 find_rjs 一致
 */
export function rjCodes(s: string): string[] {
  return [...new Set([...s.matchAll(/(?<![a-z0-9])[rv]j(\d{8}|\d{6})(?!\d)/gi)].map(m => m[0].toUpperCase()))];
}

/**
 * 作品名的一种比较写法：full 全名、main 主标题（subs 是这部作品各种名字的副标题，sub 表示这个名字本身有副标题）、word 主标题里的单个词（只能整个对上）。
 * exact：纯英文数字、不到 7 个字母的短名字（lesson、room），只有候选和它完全一样才算，不然 NatsuiroLesson 也会认成它；
 * eqOnly：三个字的中日文全名（桜御前），也只认完全一样的；
 * mt：机翻的名字，不会出现在别人起的文件夹名里，对上了也只给「可能是」；
 * single：只是一个英文单词（Black、Lilitales），太容易撞名，完全一样也只给「可能是」
 */
interface Key { k: string; kind: "full" | "main" | "word"; subs: string[]; sub?: boolean; exact?: boolean; eqOnly?: boolean; mt?: boolean; single?: boolean }
/** 名字只是一个英文单词（中间没有空格、符号） */
const oneWord = (s: string) => { const t = s.normalize("NFKC").trim(); return /^[A-Za-z0-9]+$/.test(t); };
const SHORT_ASCII = /^[a-z0-9]{1,6}$/;

/**
 * 作品名的几种比较写法：日文原名、中英译名、核实过的别名（aliases）各自的全名、去掉副标题的主标题，
 * 以及主标题里用空格隔开的长词（「Velmorin ヴェルモリン」里的 Velmorin）。
 * 太短（不到 4 个字，三个字的中日文全名例外）和纯数字的不要，免得「2048」「Game」这种到处都能对上；单个词要 7 个字母以上，hero、school 这种到处都是
 */
function keys(g: Game): Key[] {
  const langs = ["ja", "zh", "en"] as const;
  const sure = [g.title, ...langs.filter(l => !g.mt?.includes(l)).map(l => g.names?.[l]), ...(g.aliases ?? [])].filter(Boolean) as string[];
  const mt = langs.filter(l => g.mt?.includes(l)).map(l => g.names?.[l]).filter(Boolean) as string[];
  const subs = [...sure, ...mt].map(n => norm(parts(n).slice(1).join(""))).filter(Boolean);
  const out: Key[] = [];
  for (const [list, isMt] of [[sure, false], [mt, true]] as const) {
    for (const n of list) {
      const [main, ...rest] = parts(n);
      const sub = rest.some(r => norm(r));
      out.push({ k: norm(n), kind: "full", subs, mt: isMt, single: oneWord(n) }, { k: norm(main), kind: "main", subs, sub, mt: isMt, single: oneWord(main) });
      for (const w of main.split(/\s+/)) if (norm(w).length >= 7) out.push({ k: norm(w), kind: "word", subs, mt: isMt });
    }
  }
  const seen = new Set<string>();
  return out
    .filter(x => !/^\d+$/.test(x.k) && (x.k.length >= 4 || (x.k.length === 3 && x.kind === "full" && /[^\x00-\x7f]/.test(x.k))))
    .filter(x => { const id = `${x.kind}|${x.k}`; if (seen.has(id)) return false; seen.add(id); return true; }) // 机翻名和原名一样时留原名那条
    .map(x => (SHORT_ASCII.test(x.k) ? { ...x, exact: true } : x.k.length === 3 ? { ...x, eqOnly: true } : x));
}
// 一次扫描要拿几百个文件夹比上千部作品，每部作品的比较写法只算一次
const keyCache = new WeakMap<Game, Key[]>();
const keysOf = (g: Game) => { let k = keyCache.get(g); if (!k) { k = keys(g); keyCache.set(g, k); } return k; };

/** 同一份作品列表里，每个主标题、全名是几部作品共用的（系列名：「美少女万華鏡」）；单个词另算（w| 开头），dungeon 这种好几部都有的词不算数 */
const sharedCache = new WeakMap<Game[], Map<string, number>>();
const sharedKey = (x: Key) => (x.kind === "word" ? `w|${x.k}` : x.k);
function sharedOf(games: Game[]) {
  let m = sharedCache.get(games);
  if (!m) {
    m = new Map();
    for (const g of games) for (const k of new Set(keysOf(g).filter(x => !x.mt || x.kind === "word").map(sharedKey))) m.set(k, (m.get(k) ?? 0) + 1);
    sharedCache.set(games, m);
  }
  return m;
}

/** 自动关联凭的是什么：rj 作品编号，title 引擎标题和作品全名一样，folder 文件夹名和作品全名一样，exe 启动程序名和作品全名一字不差 */
export type Rule = "rj" | "title" | "folder" | "exe";
/**
 * 认出的作品；没认出但像某一部时放在 guess 里（界面显示「可能是」）。
 * why：是哪个名字候选（或编号）让软件这么认为的；rule：自动关联凭的是什么；reason：只是「可能是」的原因（给主人看）
 */
export interface Match { game: Game | null; guess?: Game; why?: string; rule?: Rule; reason?: string }

// 候选名字里常见的发布标记：去掉后再比（「近所の人妻 汉化」就是「近所の人妻」）；作品名不去
const NOISE = /ai精翻|汉化版|汉化|漢化|官方中文版?|官中|中文版|中文|简中|繁中|精翻|机翻|機翻|硬盘版|免安装|绿色版|步兵版?|无修正?|無修正|体验版|體驗版|体験版|正式版|最新版|修复版|作弊版|全回想|双端|电脑版|pc版|dl版|steam版|日文版|英文版|(32|64)bit版?|(32|64)位版?/g;
/** 候选以续作记号结尾（Mansha300_2、Foo II、満車率300% 弐） */
const SEQUEL = /(?:[\s_\-]|(?<=[a-z]))(2|ii|弐)$/;
/** 解压出来的文件夹常带着压缩包的扩展名（地.7z、Foo.zip） */
const ARCHIVE = /\.(zip|7z|rar|tar|gz|lzh)(?=$|[\s\\/_\-)\]】])/g;
/** 候选写着 DLC：多半是追加内容，不是本篇 */
const DLC = /(?<![a-z])dlc(?![a-z])/;

/** 一个名字候选：name 是比较写法，bounds 是原来词和词之间（标点、空格、去掉的东西）的位置；main、sub 是主标题和副标题；weak：编码是猜的标题；sequel、dlc 见上面 */
interface Cand { raw: string; name: string; bounds: Set<number>; main: string; sub: string; weak: boolean; sequel: boolean; dlc: boolean }
function prep(raw: string, weak = false): Cand {
  const clean = (s: string) => s.toLowerCase().replace(ARCHIVE, " ").replace(BRACKETS, " ").replace(VERSION, " ").replace(NOISE, " ");
  const text = clean(raw.normalize("NFKC"));
  let name = "";
  const bounds = new Set([0]);
  for (const ch of text) { if (SEP.test(ch)) bounds.add(name.length); else name += ch; }
  bounds.add(name.length);
  const [main, ...rest] = parts(raw);
  return { raw, name, bounds, main: norm(clean(main)), sub: norm(clean(rest.join(" "))), weak, sequel: SEQUEL.test(text.trim()), dlc: DLC.test(text) };
}

/** 文件夹的全部名字候选：显示名、文件夹名、外层包装文件夹名、启动程序名、引擎文件里的标题（旧数据里没有 names） */
const rawCache = new WeakMap<Found, string[]>();
function candidates(f: Found): string[] {
  let c = rawCache.get(f);
  if (!c) { c = [...new Set([f.name, ...(f.names ?? [])])].filter(Boolean); rawCache.set(f, c); }
  return c;
}
const candidateCache = new WeakMap<Found, Cand[]>();
function preparedCandidates(f: Found): Cand[] {
  let c = candidateCache.get(f);
  if (!c) {
    const unsure = new Set(f.unsure ?? []);
    c = candidates(f).filter(x => !generic(x)).map(x => prep(x, unsure.has(x))).filter(x => x.name.length >= 3);
    candidateCache.set(f, c);
  }
  return c;
}

/** 字的种类：英文字母、数字、别的（中日文） */
const cls = (c: string | undefined) => (!c ? 0 : /[a-z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3);
/** name 里 [i, i+len) 这一段两头都在词的边界上：原来有标点空格，或者换了一种字（英文接中文） */
function bounded(c: Cand, i: number, len: number) {
  const at = (p: number) => c.bounds.has(p) || cls(c.name[p - 1]) !== cls(c.name[p]);
  return at(i) && at(i + len);
}

/** 只是像的两种：PART 候选和作品名只对上一部分（反过来包含、比例不够、不在词的边界上）；SERIES 多半是同系列的另一部（续作数字、副标题不同、只对上系列名） */
const PART = 1, SERIES = 2;
interface Hit { level: number; doubt: 0 | 1 | 2; tier: number }

/**
 * 一个候选名字和一个比较写法对不对得上，对上了是哪一级：
 * 3 和全名完全一样；2 对得上；1 只是像（只给「可能是」），doubt 说明为什么只是像。
 * tier 只用来给「可能是」排先后：机翻全名完全一样、编码是猜的标题 1，单个词、机翻名的一部分 0。
 * - 作品名包含在候选里，要占候选的一定比例（全名四分之一、主标题四成），两头还得在词的边界上（「なつのさがしもの」里的「さがしもの」不算）；
 * - 反过来（候选是作品名的一部分，「マインド・リュダ」之于「マインド・リュダ After day 1」）、单个词、机翻名，都只算像；
 * - 作品名后面紧跟一两位数字（Kaiju Princess 2）多半是续作；主标题对上了、文件夹的几个副标题和这部作品的副标题一个都对不上，
 *   或者只对上了几部作品共用的系列名（美少女万華鏡），多半是同系列另一部：都只算像
 */
function strength(c: Cand, key: Key, shared: Map<string, number>, mainSubs: Map<string, string[]>): Hit | null {
  const { name } = c, { k } = key;
  // 几百个文件夹 × 上千部作品，这里跑得最多：先用最便宜的判断把对不上的筛掉
  if (key.kind === "word") return name === k ? { level: 1, doubt: 0, tier: 0 } : null;
  if ((key.exact || key.eqOnly) && name !== k) return null;
  const i = name.indexOf(k);
  if (i < 0 && (name.length < 4 || name.length < k.length * 0.6 || !k.includes(name))) return null;
  const low = key.mt ? 0 : 1;
  const weak = (doubt: 0 | 1 | 2, tier = low): Hit => ({ level: 1, doubt, tier });
  if (i < 0) return weak(PART);
  if (name !== k) {
    if (/^\d{1,2}(?!\d)/.test(name.slice(i + k.length))) return weak(SERIES);
    if (k.length * (key.kind === "full" ? 4 : 2.5) < name.length || !bounded(c, i, k.length)) return weak(PART);
  }
  if (key.kind === "main") {
    const csubs = [c.sub, ...(mainSubs.get(k) ?? [])].filter(Boolean);
    const none = !csubs.some(s => key.subs.some(t => s.includes(t) || t.includes(s)));
    if ((csubs.length && key.subs.length && none) || (!csubs.length && key.sub && (shared.get(key.k) ?? 1) >= 2)) return weak(SERIES);
  }
  if (key.mt) return weak(0, name === k && key.kind === "full" ? 1 : 0);
  if (c.weak) return weak(0, 1);
  return { level: name === k && key.kind === "full" ? 3 : 2, doubt: 0, tier: 2 };
}

type Rank = [number, number, number];
const better = (a: Rank, b: Rank) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** 名字候选是从哪来的：引擎标题、文件夹名（包括包装层、启动程序所在的文件夹）、启动程序名；旧数据没有 titles 时剩下的都当引擎标题 */
type Src = "title" | "folder" | "exe" | "other";
const stemOf = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");
function sourceOf(f: Found, raw: string): Src {
  if (f.titles?.includes(raw)) return "title";
  if (f.dir.split(/[\\/]/).includes(raw) || f.exes.some(e => e.split(/[\\/]/).slice(0, -1).includes(raw))) return "folder";
  if (f.exes.some(e => stemOf(e) === raw)) return "exe";
  return f.titles ? "other" : "title";
}

/** 为什么只是「可能是」：给主人看的一句话（w 是起作用的那个名字候选） */
export const REASONS = {
  contains: (w: string) => `「${w}」里有作品名，但不完全一样`,
  mt: (w: string) => `只对上了机翻的名字（「${w}」）`,
  word: (w: string) => `只对上了一个词「${w}」`,
  part: (w: string) => `「${w}」只对上了作品名的一部分`,
  series: (w: string) => `「${w}」像是同系列的另一部（续作或副标题不同）`,
  unsure: (w: string) => `标题「${w}」的编码是猜的`,
  exe: (w: string) => `只有启动程序名「${w}」和作品名差不多（要一字不差才算）`,
  single: (w: string) => `作品名只是一个词「${w}」，容易撞名`,
  shared: (w: string) => `图鉴里有几部作品都叫「${w}」`,
  tie: (w: string) => `几部作品都对得上「${w}」`,
  conflict: (w: string) => `文件夹里的名字指向不同的作品（「${w}」）`,
  dlc: (w: string) => `看着像 DLC 或追加内容（「${w}」）`,
  sequel: (w: string) => `看着像续作（「${w}」）`,
};
type ReasonKind = keyof typeof REASONS;

/**
 * 一个文件夹对一部作品的全部证据：strong 对上的最长长度（sKey 是那个写法；exact：有和全名完全一样的），
 * part / series 只是像的最长长度（见 PART、SERIES），best 给「可能是」排先后（kind 是它为什么只是像）；
 * proofs：和全名（原名、非机翻的译名、核实过的别名）完全一样、不是单个词、不和别的作品重名的候选，src 是候选从哪来的；
 * exactFail：完全一样、但因为是单个词或重名不算数的
 */
interface Ev {
  strong: number; sKey: string; exact: boolean; part: number; series: number; best: Rank; why: string; kind: ReasonKind;
  seriesWhy?: string; partWhy?: string; proofs: { raw: string; src: Src }[]; exactFail?: { kind: "single" | "shared"; raw: string };
}

/**
 * 每个候选名字和每部作品比一遍：同一个候选对同一部作品取最好的那处（它在别的写法上只是像不要紧），
 * 再按作品汇总（见 Ev）。winners：每个候选对上最长的作品（并列的都在 set 里）；
 * others：候选只是像某部、又不是「同系列另一部」那种像（不常见的单个词、机翻全名、编码是猜的标题），指向别的作品时算各说各的
 */
function analyze(f: Found, games: Game[]) {
  const cands = preparedCandidates(f);
  const shared = sharedOf(games);
  const mainSubs = new Map<string, string[]>();
  for (const c of cands) if (c.sub) mainSubs.set(c.main, [...(mainSubs.get(c.main) ?? []), c.sub]);
  const per = new Map<Game, Ev>();
  const winners: { set: Game[]; len: number; k: string; c: Cand }[] = [];
  const others: { g: Game; c: Cand }[] = [];
  const strongOf = new Map<Cand, Set<Game>>();
  for (const c of cands) {
    let top = 0, set: Game[] = [], topK = "";
    const strong = new Set<Game>();
    strongOf.set(c, strong);
    let src: Src | undefined;
    for (const g of games) {
      let lv = 0, sLen = 0, sKey = "", series = 0, part = 0, other = false, best: Rank | null = null, kind: ReasonKind = "contains";
      let proof = false, fail: "single" | "shared" | undefined;
      for (const key of keysOf(g)) {
        const s = strength(c, key, shared, mainSubs);
        if (!s) continue;
        const len = Math.min(key.k.length, c.name.length);
        if (s.level >= 2 && (s.level > lv || (s.level === lv && len > sLen))) { lv = s.level; sLen = len; sKey = key.k; }
        if (s.level === 3) {
          if (key.single) fail ??= "single";
          else if ((shared.get(key.k) ?? 1) >= 2) fail = "shared";
          else proof = true;
        }
        if (s.doubt === SERIES) series = Math.max(series, len);
        if (s.doubt === PART) part = Math.max(part, len);
        if (s.level === 1 && !s.doubt && (key.kind === "word" ? (shared.get(sharedKey(key)) ?? 1) < 2 : s.tier === 1)) other = true;
        if (!best || better([s.level, s.tier, len], best) > 0) {
          best = [s.level, s.tier, len];
          kind = s.level >= 2 ? "contains" : s.doubt === SERIES ? "series" : s.doubt === PART ? "part" : key.kind === "word" ? "word" : key.mt ? "mt" : "unsure";
        }
      }
      if (!best) continue;
      let p = per.get(g);
      if (!p) { p = { strong: 0, sKey: "", exact: false, part: 0, series: 0, best: [0, 0, 0], why: c.raw, kind, proofs: [] }; per.set(g, p); }
      if (better(best, p.best) > 0) { p.best = best; p.why = c.raw; p.kind = kind; }
      if (proof) p.proofs.push({ raw: c.raw, src: (src ??= sourceOf(f, c.raw)) });
      else if (fail && !p.exactFail) p.exactFail = { kind: fail, raw: c.raw };
      if (lv) {
        strong.add(g);
        if (sLen > p.strong) { p.strong = sLen; p.sKey = sKey; }
        p.exact ||= lv === 3;
        if (sLen > top) { top = sLen; set = [g]; topK = sKey; }
        else if (sLen === top && !set.includes(g)) set.push(g);
      } else {
        if (series > p.series) { p.series = series; p.seriesWhy = c.raw; }
        if (part > p.part) { p.part = part; p.partWhy = c.raw; }
        if (other) others.push({ g, c });
      }
    }
    if (top) winners.push({ set, len: top, k: topK, c });
  }
  return { cands, per, winners, others, strongOf, shared };
}
type Analysis = ReturnType<typeof analyze>;

/** 只给「可能是」：guess 是哪部，why 是起作用的名字候选，reason 是给主人看的原因 */
const maybe = (g: Game | undefined, why: string, reason: string): Match => (g ? { game: null, guess: g, why, reason } : { game: null });

/**
 * 只按名字认。只有这一种情况自动关联（白名单）：引擎标题，或者文件夹名，和作品的全名（日文原名、不是机翻的译名、核实过的别名）
 * 去掉版本号、汉化标记、括号后完全一样，作品名不是单个英文单词、图鉴里也没有别的作品叫这个名字，而且没有一点矛盾：
 * - 最长的那处对上了好几部，或者不同的候选名字各说各的（「King Exit」和「魔法少女セレスフォニア」）——
 *   一个候选认出的作品名是另一个的一部分（外层「美少女万華鏡」，里面「美少女万華鏡 -理と迷宮の少女-」）不算各说各的；
 * - 同一部作品在别的候选上只是像、而且像的那处不比对上的短（续作、同系列另一部）；
 * - 有候选写着续作记号（Mansha300_2）却没对上这部，或者写着 DLC。
 * 别的（只是包含作品名、只有启动程序名一样、机翻名、单个词、系列名……）都只给「可能是」，并写上原因。结果和候选、作品的先后顺序无关
 */
/** 不能当作品名的启动程序名（通用词之外）：Start、Launcher、Play…… */
const GENERIC_EXE = /^(start|launcher|launch|play|player|run|main|app|startgame|start_game|game_?(cn|zh|en|jp|ja|chs|cht|zh-cn|pro)|mtool_game)$/i;
/**
 * 启动程序名（去掉 .exe）和作品的全名（日文原名、不是机翻的译名、核实过的别名）一字不差：只有大小写可以不同，
 * 版本号、标点、空格、下划线、括号、全角半角都不去，差一个字都不算。这时文件夹叫什么都不要紧
 */
function exeExact(f: Found, g: Game): string | undefined {
  const stem = f.exes[0] ? stemOf(f.exes[0]) : "";
  if (!stem || generic(stem) || GENERIC_EXE.test(stem)) return undefined;
  const langs = ["ja", "zh", "en"] as const;
  const names = [g.title, ...langs.filter(l => !g.mt?.includes(l)).map(l => g.names?.[l]), ...(g.aliases ?? [])].filter(Boolean) as string[];
  return names.some(n => n.toLowerCase() === stem.toLowerCase()) ? stem : undefined;
}

function decide(A: Analysis, f: Found): Match {
  const { cands, per, winners, others, strongOf } = A;
  const guess = (pick?: Game, why?: string, kind?: ReasonKind): Match => {
    let g = pick;
    if (!g) for (const [x, p] of per) { const d = g ? better(p.best, per.get(g)!.best) : 1; if (d > 0 || (d === 0 && x.id < g!.id)) g = x; }
    if (!g) return { game: null };
    const p = per.get(g)!, w = why ?? p.why;
    return maybe(g, w, REASONS[kind ?? p.kind](w));
  };
  if (!winners.length) return guess();
  winners.sort((a, b) => b.len - a.len);
  const top = winners[0];
  if (top.set.length > 1) return guess(top.set.reduce((a, b) => (b.id < a.id ? b : a)), top.c.raw, "tie");
  const g = top.set[0], p = per.get(g)!;
  const rival = winners.find(w => !w.set.includes(g) && !top.k.includes(w.k)) ?? others.find(o => o.g !== g && !strongOf.get(o.c)!.has(g));
  if (rival) return guess(g, rival.c.raw, "conflict");
  if (p.series >= p.strong) return guess(g, p.seriesWhy, "series");
  if (p.part >= p.strong) return guess(g, p.partWhy, "part");
  const dlc = cands.find(c => c.dlc);
  if (dlc) return guess(g, dlc.raw, "dlc");
  const seq = cands.find(c => c.sequel && !strongOf.get(c)!.has(g) && !/(2|ii|弐)$/.test(top.k));
  if (seq) return guess(g, seq.raw, "sequel");
  const proof = p.proofs.find(x => x.src === "title") ?? p.proofs.find(x => x.src === "folder");
  if (proof) return { game: g, why: proof.raw, rule: proof.src as "title" | "folder" };
  // 启动程序名一字不差（图鉴里没有别的作品叫这个名字）
  const exe = exeExact(f, g);
  if (exe && (A.shared.get(norm(exe)) ?? 1) < 2) return { game: g, why: exe, rule: "exe" };
  if (p.proofs.length) return guess(g, p.proofs[0].raw, "exe");
  if (p.exactFail) return guess(g, p.exactFail.raw, p.exactFail.kind);
  return guess(g, top.c.raw, "contains");
}

/** 文件夹 f 现在关联在哪部作品上（不管图鉴里有没有）：关联在这个文件夹上的；没有就看关联在它外面包装层上的（要后端给的 top 作证），几层都关联过取最里面的 */
export function ownerOf(f: Found, local: Record<string, Local>, has: (id: string) => boolean = () => true): string | undefined {
  let outer: Linked | undefined, outerId: string | undefined;
  for (const [id, l] of Object.entries(local)) {
    if (!linked(l) || !has(id)) continue;
    if (sameDir(l.dir, f.dir)) return id;
    if (isWrapper(f, l.dir) && (!outer || l.dir.length > outer.dir.length)) { outer = l; outerId = id; }
  }
  return outerId;
}

/**
 * 认出文件夹是哪部作品：
 * 1. 以前关联过这个文件夹的，照旧；关联在它外面的包装层上的（要后端给的 top 作证，不能只凭「在子文件夹里」），挪到里面这层，几层都关联过取最里面的；
 * 2. 文件夹名、启动程序名、游戏这层的文件名里有 RJ / VJ 号（后端给的 rjs，加上名字候选里的），而且只有一个号、图鉴里有，
 *    名字也没有指向别的作品：按号关联（rule "rj"）。几个号、号和名字指向不同的作品、号在图鉴里没有而名字像别的作品，只给「可能是」；
 *    纯 6 位或 8 位数字的文件夹名不算号，只给「可能是」（名字已经认出是同一部的除外）；
 * 3. 按名字认（见 decide），只有引擎标题或文件夹名和全名完全一样才关联（rule "title" / "folder"）。
 */
export function matchFolder(f: Found, games: Game[], local: Record<string, Local>): Match {
  const byId = new Map(games.map(g => [g.id, g]));
  const owner = ownerOf(f, local, id => byId.has(id));
  if (owner) return { game: byId.get(owner)! };
  const A = analyze(f, games);
  const named = decide(A, f);
  const codes = [...new Set([f.rj ?? "", ...(f.rjs ?? []), ...candidates(f)].flatMap(rjCodes))];
  if (codes.length > 1) {
    const r = codes.map(c => byId.get(c)).find(Boolean) ?? named.game ?? named.guess;
    return maybe(r ?? undefined, codes.join(" "), `文件夹里有几个不同的作品编号（${codes.join("、")}）`);
  }
  if (codes.length === 1) {
    const code = codes[0], r = byId.get(code);
    if (!r) return named.game ? maybe(named.game, named.why!, `文件夹里的编号 ${code} 图鉴里没有，不能只凭名字认`) : named;
    // 名字指向别的作品（对得上、或者机翻全名一样），而且那个名字不是这部作品名字的一部分
    const rp = A.per.get(r);
    const rival = [...A.per].find(([h, p]) => h !== r && (p.strong > 0 || (p.kind === "mt" && p.best[1] >= 1)) && !(rp?.sKey && p.sKey && rp.sKey.includes(p.sKey)));
    if (rival) return maybe(r, code, `编号 ${code} 和名字「${rival[1].why}」指向不同的作品`);
    return { game: r, why: code, rule: "rj" };
  }
  const digits = [...new Set(candidates(f).map(c => c.trim()).filter(c => /^(\d{6}|\d{8})$/.test(c)).map(c => `RJ${c}`))].filter(id => byId.has(id));
  if (digits.length) {
    const r = byId.get(digits[0])!;
    if (named.game === r && digits.length === 1) return named;
    return maybe(r, digits[0].slice(2), `文件夹名只是一串数字（${digits.map(d => d.slice(2)).join("、")}），没写 RJ`);
  }
  return named;
}

/** 文件夹里指向作品 g 的证据（RJ 号算和全名完全一样）；一点都没有（哪怕只是像：机翻名、单个词、续作）是 undefined */
function evidenceFor(f: Found, g: Game, games: Game[]): Ev | undefined {
  if ([f.rj ?? "", ...(f.rjs ?? []), ...candidates(f)].some(c => rjCodes(c).includes(g.id) || `RJ${c.trim()}` === g.id)) {
    return { strong: 8, sKey: "", exact: true, part: 0, series: 0, best: [3, 2, 8], why: g.id, kind: "contains", proofs: [] };
  }
  return analyze(f, games).per.get(g);
}

/**
 * 文件夹自己写明的名字：引擎标题（编码是猜的不算），或者文件夹名和启动程序名说的是同一个名字（ero dungeons / EroDungeons.exe）。
 * 给主人看的证据：和文件夹名一样的标题在前，其次长的在前（package.json 的 name 常常只是个代号）
 */
function declared(f: Found): string[] {
  const unsure = new Set(f.unsure ?? []);
  const segs = new Set([...f.dir.split(/[\\/]/), ...(f.top ?? "").split(/[\\/]/)].filter(s => !generic(s)).map(s => prep(s).name));
  const out = (f.titles ?? []).filter(t => !unsure.has(t) && !generic(t));
  out.sort((a, b) => Number(segs.has(prep(b).name)) - Number(segs.has(prep(a).name)) || b.length - a.length);
  const stem = f.exes[0]?.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "") ?? "";
  const exeName = prep(stem).name;
  if (exeName.length >= 3 && !generic(stem)) for (const n of candidates(f)) if (segs.has(prep(n).name) && !generic(n) && prep(n).name === exeName) out.push(n);
  return [...new Set(out)];
}

// —— 启动程序是不是工具（和后端 is_helper_exe / is_tool_dir 一致）——
const HELPER = ["unins", "setup", "install", "config", "crash", "notification_helper", "vcredist", "dxsetup", "dxwebsetup", "leproc", "redist", "updater",
  "uninstall", "7z", "nwjc", "chromedriver", "payload", "mask_trim_png", "png_alpha_colour_remover", "createdump", "steam_workshop", "savegametransfer",
  "opensavefolder", "savedata_location", "localization", "reipatcher", "winrar", "wrar", "trainer", "修改器", "运行库", "补丁", "ファイル破損チェック", "エンジン設定",
  "trial reset", "dotnet", "oalinst", "physx"];
const TOOL_DIRS = new Set(["tool", "tools", "mtool", "__macosx", "_commonredist", "commonredist", "redist", "directx", "vcredist", "reipatcher", "$pluginsdir"]);
const toolDir = (n: string) => { const t = n.trim().toLowerCase(); return t.startsWith(".") || TOOL_DIRS.has(t) || ["修改器", "trainer", "winrar", "运行库", "redist"].some(p => t.includes(p)); };
function helperName(file: string) {
  const n = file.toLowerCase();
  if (n.startsWith("._") || (n.includes("mtool") && !n.startsWith("mtool_game"))) return true;
  const tokens = n.replace(/\.exe$/, "").split(/[^\p{L}\p{N}]+/u);
  return HELPER.some(s => n.includes(s)) || tokens.some(t => /^rtp(\d.*)?$/.test(t) || t === "patch" || t === "patcher" || t === "4gb");
}
/** exe（在游戏文件夹 dir 里）像是工具、不是游戏本体：在 Tool、__MACOSX 这类文件夹里，或者名字是工具的 */
export function helperExe(exe: string, dir: string): boolean {
  const rel = under(exe, dir) ? exe.replace(/\//g, "\\").slice(dir.replace(/[\\/]+$/, "").length + 1) : exe.split(/[\\/]/).pop()!;
  const segs = rel.split("\\");
  return helperName(segs.pop()!) || segs.some(toolDir);
}

/** 「关联可能有误」里的一条：作品 id 现在关联着文件夹 dir */
export interface Suspect {
  id: string; dir: string;
  /** 文件夹里的证据（名字候选的原文），没有就是只有启动程序的问题 */
  why?: string;
  /** 证据有把握地指向另一部：可以「改成」它 */
  to?: string;
  /** 证据只是像另一部（只显示，不给「改成」） */
  maybe?: string;
  /** 启动程序像是工具：建议改用这个 */
  exe?: string;
}
/** 主人点过「保持」时记下的：当时的文件夹和启动程序，两样都没变就不再提 */
export const keptStamp = (l: Linked) => `${l.dir}\n${l.exe}`;

/**
 * 重新扫描时检查已有的关联（不自动改，交给主人确认）：
 * - 启动程序像是工具（Tool\nwjc.exe），文件夹里另有更像的启动程序；
 * - 按文件夹的证据有把握地认出是另一部；
 * - 文件夹里找不到一点指向现在这部的证据，又像另一部，或者文件夹自己写明了名字（引擎标题、文件夹名和启动程序名一致）；
 * - 指向现在这部的证据里有「同系列另一部」那种像（副标题不同、续作数字），又没有和全名完全一样的。
 * 图鉴里没有的作品、我的游戏只查启动程序；主人点过「保持」、文件夹和启动程序都没变的不查
 */
export function reviewLinks(found: Found[], games: Game[], local: Record<string, Local>): Suspect[] {
  const byId = new Map(games.map(g => [g.id, g]));
  const out: Suspect[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const id = ownerOf(f, local);
    if (!id || seen.has(id)) continue;
    const l = local[id] as Linked & { kept?: string };
    if (l.kept === keptStamp(l)) continue;
    const s: Suspect = { id, dir: l.dir };
    if (helperExe(l.exe, l.dir) && f.exes[0] && f.exes[0].toLowerCase() !== l.exe.toLowerCase()) s.exe = f.exes[0];
    const g = byId.get(id);
    if (g && !id.startsWith("local-")) {
      const fresh = matchFolder(f, games, {});
      if (fresh.game && fresh.game !== g) Object.assign(s, { to: fresh.game.id, why: fresh.why });
      else if (fresh.game !== g) {
        const ev = evidenceFor(f, g, games), other = fresh.guess && fresh.guess !== g ? fresh.guess.id : undefined;
        const own = declared(f);
        if (!ev && other) Object.assign(s, { maybe: other, why: fresh.why ?? own[0] });
        else if (!ev && own.length) s.why = own[0];
        else if (ev?.series && !ev.exact) Object.assign(s, other ? { maybe: other } : {}, { why: ev.seriesWhy });
      }
    }
    if (s.exe || s.why) { out.push(s); seen.add(id); }
  }
  return out;
}

/** 路径比较用的写法：不分大小写、/ 和 \ 一样、末尾的斜杠不算 */
const pathKey = (p: string) => p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
/** dir 就是 base，或在 base 里面（不分大小写，/ 和 \ 一样，末尾有没有斜杠都一样） */
export const under = (dir: string, base: string) => {
  const d = pathKey(dir), b = pathKey(base);
  return d === b || d.startsWith(b + "\\");
};
export const sameDir = (a: string, b: string) => pathKey(a) === pathKey(b);
/** dir 是不是 f 的包装层：在 f.dir 外面、f.top 里面（f.top 是后端扫描时确认的最外层包装文件夹；没有就不算） */
const isWrapper = (f: Found, dir: string) => !!f.top && !sameDir(f.dir, dir) && under(f.dir, dir) && under(dir, f.top);

/**
 * 一次扫描的结果怎么处理：每个文件夹认出是哪部，就关联；认不出的进「没认出」。
 * 一部作品只关联一个文件夹：它已经关联着别的文件夹（以前关联的，或这次扫描先认出的），后来的文件夹不抢，进「没认出」并写上「可能是」它——
 * 换关联要自己动手，软件不自动挪。这个文件夹记在别的作品上（哪怕图鉴里已经没有那部）的也不抢：自动扫描从不去掉别的作品的关联。
 * rejected：用户说过「不是它」的（见 recog.ts 的 rejectedBy），这个文件夹不再自动关联到那部、也不再猜成那部（现在就关联着它的照旧）
 */
export function planScan(found: Found[], games: Game[], local: Record<string, Local>, rejected: (dir: string, id: string) => boolean = () => false): { link: [Game, Found, Rule?][]; unmatched: Found[] } {
  const link: [Game, Found, Rule?][] = [], unmatched: Found[] = [];
  const taken = new Set<string>();
  for (const f of found) {
    let m = matchFolder(f, games, local);
    if (m.game && !ownerOf(f, local) && rejected(f.dir, m.game.id)) m = { game: null };
    if (m.guess && rejected(f.dir, m.guess.id)) m = { game: null };
    const { game, guess } = m;
    const old = game ? local[game.id] : undefined;
    const owned = Object.entries(local).some(([id, l]) => id !== game?.id && !!l.dir && sameDir(l.dir, f.dir));
    const busy = !!game && (taken.has(game.id) || owned || (linked(old) && !sameDir(old.dir, f.dir) && !isWrapper(f, old.dir)));
    if (game && !busy) { link.push([game, f, m.rule]); taken.add(game.id); }
    else {
      const g = game ?? guess, reason = game ? (owned ? "这个文件夹关联着别的作品" : "这部已经关联着别的文件夹") : m.reason;
      unmatched.push(g ? { ...f, guess: g.id, ...(reason ? { reason } : {}) } : f);
    }
  }
  return { link, unmatched };
}

/**
 * 把文件夹 dir 关联到作品 id 会替换掉什么（关联前给主人看）：from 是这部作品现在关联着的别的文件夹，owner 是现在关联着这个文件夹的别的作品
 */
export function replacing(id: string, dir: string, local: Record<string, Local>): { from?: string; owner?: string } {
  const l = local[id];
  const from = linked(l) && !sameDir(l.dir, dir) ? l.dir : undefined;
  const owner = Object.entries(local).find(([o, x]) => o !== id && linked(x) && sameDir(x.dir, dir))?.[0];
  return { ...(from ? { from } : {}), ...(owner ? { owner } : {}) };
}
