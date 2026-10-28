import type { Catalog, Game, Lang } from "./store.ts";

// —— 作品目录整理（纯函数，方便单测）：数据包里的字段可能缺、可能是别的类型，统一补成能直接用的样子 ——

const LANGS: Lang[] = ["ja", "zh", "en"];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 封面只认 covers/ 下、文件名只有字母数字和 ._- 的图片（和后端解压时的规则一致） */
export const COVER_RE = /^covers\/(?!\.)[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export const okCover = (c: string) => COVER_RE.test(c) && !RESERVED.test(c.slice(7)) && !/[. ]$/.test(c);

/** 一部作品：没有 id 的返回 null；其他缺的字段补默认值，链接只留 https */
export function normalizeGame(raw: unknown): Game | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  if (!id) return null;
  const title = str(r.title) || id;
  const rawNames = (r.names && typeof r.names === "object" ? r.names : {}) as Record<string, unknown>;
  const names = { ja: str(rawNames.ja) || title, zh: str(rawNames.zh), en: str(rawNames.en) } as Record<Lang, string>;
  const cover = str(r.cover);
  return {
    ...r, // 不认识的字段照留
    id, title, names,
    cat: str(r.cat) || "other",
    state: r.state === "dev" ? "dev" : "released",
    mt: Array.isArray(r.mt) ? (r.mt.filter(l => LANGS.includes(l)) as Lang[]) : [],
    circle: str(r.circle), date: str(r.date), note: str(r.note),
    url: /^https:\/\//i.test(str(r.url)) ? str(r.url) : "",
    cover: okCover(cover) ? cover : "",
    rate: num(r.rate), dl: num(r.dl), rc: num(r.rc),
  } as Game;
}

/** 整份目录：坏的作品丢掉，同一个 id 只留第一次出现的 */
export function normalizeCatalog(raw: unknown): Catalog {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const games: Game[] = [];
  for (const x of Array.isArray(r.games) ? r.games : []) {
    const g = normalizeGame(x);
    if (g && !seen.has(g.id)) { seen.add(g.id); games.push(g); }
  }
  return { version: num(r.version) ?? 0, updated: str(r.updated), source: str(r.source), games, rankings: r.rankings, scoring: r.scoring };
}
