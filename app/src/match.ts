import { linked, type Found, type Game, type Linked, type Local } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入

/** 比较用的写法：全角转半角、去掉括号里的东西（[汉化] 【体验版】）、版本号和标点空格 */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\[【(（「『][^\]】)）」』]*[\]】)）」』]/g, "")
    .replace(/ver\.?\s*[\d.]+|v\d+(\.\d+)+|(?<![\d.])\d+(\.\d+)+/g, "")
    .replace(/[\s\-_~～〜・·:：!！?？。、,，.'"`]/g, "");
}

const GENERIC = new Set(["game", "www", "pc", "data", "bin", "x64", "x86", "rpgmv-game", "nwjs", "nw", "nwjc", "mtool_game"]);
/** 没有辨识度的名字：引擎、架构的通用文件夹名，版本号或纯数字，太短的（和后端 is_generic 一致） */
export function generic(s: string): boolean {
  const t = s.trim().toLowerCase();
  return [...t].length < 2 || GENERIC.has(t) || /^(ver|v)?(?=.*\d)[\d.]+$/.test(t);
}

/** 副标题的分隔：～ - 后面的是副标题 */
const SUB_SEP = /[～〜~\-―]/;
/**
 * 作品名的一种比较写法：full 全名、main 主标题（subs 是这部作品各种名字的副标题）、word 主标题里的单个词（只能整个对上）。
 * exact：纯英文数字、不到 7 个字母的短名字（lesson、room），只有候选和它完全一样才算，不然 NatsuiroLesson 也会认成它
 */
interface Key { k: string; kind: "full" | "main" | "word"; subs?: string[]; exact?: boolean }
const SHORT_ASCII = /^[a-z0-9]{1,6}$/;

/**
 * 作品名的几种比较写法：日文原名和中英译名各自的全名、去掉副标题的主标题，
 * 以及主标题里用空格隔开的长词（「Velmorin ヴェルモリン」里的 Velmorin）。
 * 太短（不到 4 个字）和纯数字的不要，免得「2048」「Game」这种到处都能对上；单个词要 7 个字母以上，hero、school 这种到处都是
 */
function keys(g: Game): Key[] {
  // 机翻的名字不会出现在别人起的文件夹名里，不拿来比
  const names = (["ja", "zh", "en"] as const).filter(l => !g.mt?.includes(l)).map(l => g.names?.[l]).filter(Boolean) as string[];
  const all = [g.title, ...names];
  const subs = all.map(n => norm(n.split(SUB_SEP).slice(1).join(""))).filter(Boolean);
  const out: Key[] = [];
  for (const n of all) {
    const [main] = n.split(SUB_SEP);
    out.push({ k: norm(n), kind: "full" }, { k: norm(main), kind: "main", subs });
    for (const w of main.split(/\s+/)) if (norm(w).length >= 7) out.push({ k: norm(w), kind: "word" });
  }
  return out.filter(x => x.k.length >= 4 && !/^\d+$/.test(x.k)).map(x => (SHORT_ASCII.test(x.k) ? { ...x, exact: true } : x));
}
// 一次扫描要拿几百个文件夹比上千部作品，每部作品的比较写法只算一次
const keyCache = new WeakMap<Game, Key[]>();
const keysOf = (g: Game) => { let k = keyCache.get(g); if (!k) { k = keys(g); keyCache.set(g, k); } return k; };

/** 认出的作品；没认出但像某一部时放在 guess 里（界面显示「可能是」） */
export interface Match { game: Game | null; guess?: Game }

/** 文件夹的全部名字候选：显示名、文件夹名、外层包装文件夹名、启动程序名、引擎文件里的标题（旧数据里没有 names） */
const candidates = (f: Found) => [...new Set([f.name, ...(f.names ?? [])])].filter(Boolean);
const candidateCache = new WeakMap<Found, { raw: string[]; names: { name: string; sub: string }[] }>();
function preparedCandidates(f: Found) {
  let c = candidateCache.get(f);
  if (!c) {
    const raw = candidates(f);
    c = { raw, names: raw.filter(x => !generic(x)).map(x => ({ name: norm(x), sub: norm(x.split(SUB_SEP).slice(1).join("")) })) };
    candidateCache.set(f, c);
  }
  return c;
}

/**
 * 一个候选名字和一个比较写法对不对得上：0 不对，1 像但没把握（只给「可能是」），2 对得上。
 * - 作品名包含在候选里就算对上，但要占候选的一定比例（全名四分之一、主标题四成），不然「ROOM」「タナトス」在一长串别的字里也能找到；
 * - 单个词只能和候选整个相等；
 * - 作品名后面紧跟一两位数字（Kaiju Princess 2、Kaiju Princess 12）多半是续作；主标题对上了、候选的副标题和这部作品的哪个副标题都对不上，多半是同系列另一部：都只算像
 */
function strength(name: string, cSub: string, { k, kind, subs, exact }: Key): 0 | 1 | 2 {
  if (kind === "word" || exact) return name === k ? 2 : 0;
  const i = name.indexOf(k);
  // 反过来（文件夹名是作品名的一部分）只在占了大半时才算，免得「Game」认成「Sample Game」
  if (i < 0) return name.length >= 4 && name.length >= k.length * 0.6 && k.includes(name) ? 2 : 0;
  if (/^\d{1,2}(?!\d)/.test(name.slice(i + k.length))) return 1;
  if (k.length * (kind === "full" ? 4 : 2.5) < name.length) return 1;
  if (kind === "main" && cSub && subs!.length && !subs!.some(s => cSub.includes(s) || s.includes(cSub))) return 1;
  return 2;
}

/**
 * 认出文件夹是哪部作品：
 * 1. 以前关联过这个文件夹的，照旧；关联在它外面的包装层上的（要后端给的 top 作证，不能只凭「在子文件夹里」），挪到里面这层，几层都关联过取最里面的；
 * 2. 候选名字里有 RJ 号的按 RJ 号；纯 6～8 位数字的文件夹名，图鉴里有 RJ+这串数字时也算；
 * 3. 候选名字里包含作品名（或反过来）的，取匹配最长的那部；
 *    最长的两处对上了不同的作品（分不清），或者只是像（见 strength），就不自动关联，只给个 guess。
 */
export function matchFolder(f: Found, games: Game[], local: Record<string, Local>): Match {
  const byId = new Map(games.map(g => [g.id, g]));
  let outer: Linked | undefined, outerId = "";
  for (const [id, l] of Object.entries(local)) {
    if (!linked(l) || !byId.has(id)) continue;
    if (sameDir(l.dir, f.dir)) return { game: byId.get(id)! };
    if (isWrapper(f, l.dir) && (!outer || l.dir.length > outer.dir.length)) { outer = l; outerId = id; }
  }
  if (outer) return { game: byId.get(outerId)! };
  const cands = preparedCandidates(f);
  for (const c of [f.rj ?? "", ...cands.raw]) {
    const rj = /rj\d{6,8}/i.exec(c)?.[0].toUpperCase() ?? (/^\d{6,8}$/.test(c.trim()) ? `RJ${c.trim()}` : "");
    if (rj && byId.has(rj)) return { game: byId.get(rj)! };
  }
  // 按作品汇总证据：每部取对上最长的那处；那个长度上有一处只是像（续作、同系列另一部），这部就没把握。结果和候选的先后顺序无关
  const best = new Map<Game, { len: number; sure: boolean }>();
  for (const { name, sub: cSub } of cands.names) {
    if (name.length < 3) continue;
    for (const g of games) {
      for (const key of keysOf(g)) {
        const s = strength(name, cSub, key);
        if (!s) continue;
        const len = Math.min(key.k.length, name.length);
        const b = best.get(g);
        if (!b || len > b.len) best.set(g, { len, sure: s === 2 });
        else if (len === b.len && s !== 2) b.sure = false;
      }
    }
  }
  let win: Game | null = null, winLen = 0, tie = false;
  for (const [g, b] of best) {
    if (b.len > winLen) { win = g; winLen = b.len; tie = false; }
    else if (b.len === winLen) { tie = true; if (g.id < win!.id) win = g; } // 分不清时「可能是」也固定取一部，不看作品的先后
  }
  if (!win) return { game: null };
  return tie || !best.get(win)!.sure ? { game: null, guess: win } : { game: win };
}

/** dir 就是 base，或在 base 里面（不分大小写，末尾有没有斜杠都一样） */
export const under = (dir: string, base: string) => {
  const d = dir.toLowerCase().replace(/[\\/]+$/, ""), b = base.toLowerCase().replace(/[\\/]+$/, "");
  return d === b || d.startsWith(b + "\\");
};
export const sameDir = (a: string, b: string) => under(a, b) && under(b, a);
/** dir 是不是 f 的包装层：在 f.dir 外面、f.top 里面（f.top 是后端扫描时确认的最外层包装文件夹；没有就不算） */
const isWrapper = (f: Found, dir: string) => !!f.top && !sameDir(f.dir, dir) && under(f.dir, dir) && under(dir, f.top);

/**
 * 一次扫描的结果怎么处理：每个文件夹认出是哪部，就关联；认不出的进「没认出」。
 * 一部作品只关联一个文件夹：它已经关联着别的文件夹（以前关联的，或这次扫描先认出的），后来的文件夹不抢，进「没认出」并写上「可能是」它——
 * 换关联要自己动手，软件不自动挪。这个文件夹记在别的作品上（哪怕图鉴里已经没有那部）的也不抢：自动扫描从不去掉别的作品的关联
 */
export function planScan(found: Found[], games: Game[], local: Record<string, Local>): { link: [Game, Found][]; unmatched: Found[] } {
  const link: [Game, Found][] = [], unmatched: Found[] = [];
  const taken = new Set<string>();
  for (const f of found) {
    const { game, guess } = matchFolder(f, games, local);
    const old = game ? local[game.id] : undefined;
    const owned = Object.entries(local).some(([id, l]) => id !== game?.id && !!l.dir && sameDir(l.dir, f.dir));
    const busy = !!game && (taken.has(game.id) || owned || (linked(old) && !sameDir(old.dir, f.dir) && !isWrapper(f, old.dir)));
    if (game && !busy) { link.push([game, f]); taken.add(game.id); }
    else { const g = game ?? guess; unmatched.push(g ? { ...f, guess: g.id } : f); }
  }
  return { link, unmatched };
}
