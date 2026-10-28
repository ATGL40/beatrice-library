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

/**
 * 作品名的几种比较写法：日文原名和中英译名各自的全名、去掉副标题（～ 或 - 后面的）的主标题，
 * 以及主标题里用空格隔开的较长部分（「Velmorin ヴェルモリン」里的 Velmorin）
 */
function keys(g: Game): string[] {
  // 机翻的名字不会出现在别人起的文件夹名里，不拿来比
  const names = (["ja", "zh", "en"] as const).filter(l => !g.mt?.includes(l)).map(l => g.names?.[l]).filter(Boolean) as string[];
  const out: string[] = [];
  for (const n of [g.title, ...names]) {
    const main = n.split(/[～〜~\-―]/)[0];
    out.push(n, main, ...main.split(/\s+/).filter(p => p.length >= 5));
  }
  return out.map(norm).filter(k => k.length >= 3);
}

/**
 * 认出文件夹是哪部作品：
 * 1. 以前关联过这个文件夹的，照旧；
 * 2. 有 RJ 号的按 RJ 号；
 * 3. 文件夹名里包含作品名（或反过来）的，取匹配最长的那部。
 */
export function matchFolder(f: Found, games: Game[], local: Record<string, Local>): Game | null {
  const byId = new Map(games.map(g => [g.id, g]));
  for (const [id, l] of Object.entries(local)) {
    if (l.dir === f.dir && byId.has(id)) return byId.get(id)!;
  }
  if (f.rj && byId.has(f.rj)) return byId.get(f.rj)!;
  const name = norm(f.name);
  if (name.length < 3) return null;
  let best: Game | null = null, bestLen = 0;
  for (const g of games) {
    for (const k of keys(g)) {
      // 反过来（文件夹名是作品名的一部分）只在占了大半时才算，免得「Game」认成「Sample Game」
      const hit = name.includes(k) || (name.length >= 4 && name.length >= k.length * 0.6 && k.includes(name));
      const len = Math.min(k.length, name.length);
      if (hit && len > bestLen) { best = g; bestLen = len; }
    }
  }
  return best;
}
