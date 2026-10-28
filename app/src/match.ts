import type { Found, Game, Local } from "./store";

/** 比较用的写法：全角转半角、去掉括号里的东西（[汉化] 【体验版】）、版本号和标点空格 */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\[【(（「『][^\]】)）」』]*[\]】)）」』]/g, "")
    .replace(/ver\.?\s*[\d.]+|v\d+(\.\d+)+/g, "")
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
/** 作品名的一种比较写法：full 全名、main 主标题（subs 是这部作品各种名字的副标题）、word 主标题里的单个词（只能整个对上） */
interface Key { k: string; kind: "full" | "main" | "word"; subs?: string[] }

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
  return out.filter(x => x.k.length >= 4 && !/^\d+$/.test(x.k));
}
// 一次扫描要拿几百个文件夹比上千部作品，每部作品的比较写法只算一次
const keyCache = new WeakMap<Game, Key[]>();
const keysOf = (g: Game) => { let k = keyCache.get(g); if (!k) { k = keys(g); keyCache.set(g, k); } return k; };

/** 认出的作品；没认出但像某一部时放在 guess 里（界面显示「可能是」） */
export interface Match { game: Game | null; guess?: Game }

/** 文件夹的全部名字候选：显示名、文件夹名、外层包装文件夹名、启动程序名、引擎文件里的标题（旧数据里没有 names） */
const candidates = (f: Found) => [...new Set([f.name, ...(f.names ?? [])])].filter(Boolean);

/**
 * 一个候选名字和一个比较写法对不对得上：0 不对，1 像但没把握（只给「可能是」），2 对得上。
 * - 作品名包含在候选里就算对上，但要占候选的一定比例（全名四分之一、主标题四成），不然「ROOM」「タナトス」在一长串别的字里也能找到；
 * - 单个词只能和候选整个相等；
 * - 作品名后面紧跟一个数字（Kaiju Princess 2）多半是续作；主标题对上了、候选的副标题和这部作品的哪个副标题都对不上，多半是同系列另一部：都只算像
 */
function strength(name: string, cSub: string, { k, kind, subs }: Key): 0 | 1 | 2 {
  if (kind === "word") return name === k ? 2 : 0;
  const i = name.indexOf(k);
  // 反过来（文件夹名是作品名的一部分）只在占了大半时才算，免得「Game」认成「Sample Game」
  if (i < 0) return name.length >= 4 && name.length >= k.length * 0.6 && k.includes(name) ? 2 : 0;
  if (/^\d(?!\d)/.test(name.slice(i + k.length))) return 1;
  if (k.length * (kind === "full" ? 4 : 2.5) < name.length) return 1;
  if (kind === "main" && cSub && subs!.length && !subs!.some(s => cSub.includes(s) || s.includes(cSub))) return 1;
  return 2;
}

/**
 * 认出文件夹是哪部作品：
 * 1. 以前关联过这个文件夹（或它外面的包装文件夹）的，照旧；
 * 2. 候选名字里有 RJ 号的按 RJ 号；纯 6～8 位数字的文件夹名，图鉴里有 RJ+这串数字时也算；
 * 3. 候选名字里包含作品名（或反过来）的，取匹配最长的那部；
 *    最长的两处对上了不同的作品（分不清），或者只是像（见 strength），就不自动关联，只给个 guess。
 */
export function matchFolder(f: Found, games: Game[], local: Record<string, Local>): Match {
  const byId = new Map(games.map(g => [g.id, g]));
  const dir = f.dir.toLowerCase();
  for (const [id, l] of Object.entries(local)) {
    const d = l.dir.toLowerCase();
    if ((d === dir || dir.startsWith(d.replace(/[\\/]*$/, "\\"))) && byId.has(id)) return { game: byId.get(id)! };
  }
  const cands = candidates(f);
  for (const c of [f.rj ?? "", ...cands]) {
    const rj = /rj\d{6,8}/i.exec(c)?.[0].toUpperCase() ?? (/^\d{6,8}$/.test(c.trim()) ? `RJ${c.trim()}` : "");
    if (rj && byId.has(rj)) return { game: byId.get(rj)! };
  }
  let best: Game | null = null, bestLen = 0, bestSure = false, tie = false;
  for (const c of cands) {
    if (generic(c)) continue;
    const name = norm(c);
    if (name.length < 3) continue;
    const [, ...rest] = c.split(SUB_SEP);
    const cSub = norm(rest.join(""));
    for (const g of games) {
      for (const key of keysOf(g)) {
        const s = strength(name, cSub, key);
        if (!s) continue;
        const len = Math.min(key.k.length, name.length);
        if (len > bestLen) { best = g; bestLen = len; bestSure = s === 2; tie = false; }
        else if (len === bestLen && g !== best) tie = true;
      }
    }
  }
  if (!best) return { game: null };
  return tie || !bestSure ? { game: null, guess: best } : { game: best };
}
