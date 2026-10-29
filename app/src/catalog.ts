import type { Catalog, Game, GenreDict, Lang } from "./store.ts";
import { FOLD_GENRES, HIDDEN_GENRES, isStudentName, STUDENT_GENRE } from "./genres.ts";

// —— 作品目录整理（纯函数，方便单测）：数据包里的字段可能缺、可能是别的类型，统一补成能直接用的样子 ——

const LANGS: Lang[] = ["ja", "zh", "en"];
/** 视角（pov）：卡片和详情页上写的标签；不认识的值丢掉 */
export const POV_LABEL: Record<string, string> = { female: "女主视角", male: "男主视角", both: "男女双视角", multi: "多视角", none: "无固定主角" };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 封面只认 covers/ 下、缩略图只认 thumbs/ 下，文件名只有字母数字和 ._- 的图片（和后端解压时的规则一致） */
export const COVER_RE = /^(covers|thumbs)\/(?!\.)[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const okImage = (c: string, folder: string) => c.startsWith(folder + "/") && COVER_RE.test(c) && !RESERVED.test(c.slice(folder.length + 1)) && !/[. ]$/.test(c);
export const okCover = (c: string) => okImage(c, "covers");
/** 缩略图（数据包 --thumbs 做的，卡片和排行榜用；没有就用原图） */
export const okThumb = (c: string) => okImage(c, "thumbs");

/** 不显示的题材：软件自带的年龄类题材（HIDDEN_GENRES），加上数据包题材字典里写了 hidden: true 的 */
export function hiddenGenreIds(raw: unknown): Set<string> {
  const out = new Set(HIDDEN_GENRES);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (v && typeof v === "object" && (v as Record<string, unknown>).hidden === true) out.add(id);
  }
  return out;
}

/**
 * 并进别的题材的：id → 并进哪个。写死的 FOLD_GENRES，数据包字典里写了 foldInto 的，和名字是「某种学生」的（并进学生 400，见 genres.ts）；
 * 一路并下去（最多几层），并回自己的不算
 */
export function genreFoldMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { ...FOLD_GENRES };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!id || !v || typeof v !== "object") continue;
      const n = v as Record<string, unknown>;
      const into = str(n.foldInto).trim();
      if (into && into !== id) out[id] = into;
      else if (!out[id] && id !== STUDENT_GENRE && isStudentName(str(n.ja), str(n.zh), str(n.en))) out[id] = STUDENT_GENRE;
    }
  }
  // 一路找到最后那个；转回已经走过的（并成一圈）就不并
  const end: Record<string, string> = {};
  for (const id of Object.keys(out)) {
    const seen = new Set([id]);
    let to = out[id];
    while (out[to] && !seen.has(to)) { seen.add(to); to = out[to]; }
    if (!seen.has(to)) end[id] = to;
  }
  return end;
}

/** 题材字典：只认 { id: { ja, zh, en } } 这种形状的条目，名字都是字符串（缺的补空）；不是对象就当没有；不显示的（hidden）、并进别的题材的（fold）不进字典 */
export function normalizeGenres(raw: unknown, hidden: ReadonlySet<string> = hiddenGenreIds(raw), fold: Record<string, string> = genreFoldMap(raw)): GenreDict {
  const out: GenreDict = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !v || typeof v !== "object" || hidden.has(id) || fold[id]) continue;
    const n = v as Record<string, unknown>;
    const ja = str(n.ja);
    if (ja) out[id] = { ja, zh: str(n.zh), en: str(n.en) };
  }
  // 有学生类的题材并进来、字典里却没有「学生」时补上
  if (Object.values(fold).includes(STUDENT_GENRE) && !out[STUDENT_GENRE] && !hidden.has(STUDENT_GENRE)) out[STUDENT_GENRE] = { ja: "学生", zh: "学生", en: "Student" };
  return out;
}

/**
 * 一部作品：没有 id 的返回 null；其他缺的字段补默认值，链接只留 https；题材只留字典里有的 id；别名只留非空字符串。
 * 不显示的题材（hidden）从 genres 里拿走、放进 hiddenGenres：哪里都不显示，只给存着的「不看」照旧筛；
 * 并进别的题材的（fold，比如女子校生 → 学生）换成并进去的那个，重复的只留一个
 */
export function normalizeGame(raw: unknown, genres: GenreDict = {}, hidden: ReadonlySet<string> = HIDDEN_GENRES, fold: Record<string, string> = {}): Game | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  if (!id) return null;
  const title = str(r.title) || id;
  const rawNames = (r.names && typeof r.names === "object" ? r.names : {}) as Record<string, unknown>;
  const names = { ja: str(rawNames.ja) || title, zh: str(rawNames.zh), en: str(rawNames.en) } as Record<Lang, string>;
  const cover = str(r.cover), thumb = str(r.thumb);
  const ids = Array.isArray(r.genres) ? [...new Set(r.genres.filter((x): x is string => typeof x === "string").map(x => fold[x] ?? x))] : [];
  const tags = ids.filter(x => x in genres && !hidden.has(x)), hid = ids.filter(x => hidden.has(x));
  const aliases = Array.isArray(r.aliases) ? [...new Set(r.aliases.filter((x): x is string => typeof x === "string" && !!x.trim()))] : [];
  return {
    ...r, // 不认识的字段照留
    genres: tags.length ? tags : undefined,
    hiddenGenres: hid.length ? hid : undefined,
    aliases: aliases.length ? aliases : undefined,
    id, title, names,
    cat: str(r.cat) || "other",
    src: str(r.src) || "dlsite",
    state: r.state === "dev" ? "dev" : "released",
    mt: Array.isArray(r.mt) ? (r.mt.filter(l => LANGS.includes(l)) as Lang[]) : [],
    circle: str(r.circle), date: str(r.date), note: str(r.note),
    url: /^https:\/\//i.test(str(r.url)) ? str(r.url) : "",
    pov: typeof r.pov === "string" && Object.prototype.hasOwnProperty.call(POV_LABEL, r.pov) ? r.pov : undefined,
    cover: okCover(cover) ? cover : "",
    thumb: okCover(cover) && okThumb(thumb) ? thumb : "",
    rate: num(r.rate), dl: num(r.dl), rc: num(r.rc),
  } as Game;
}

/** 整份目录：坏的作品丢掉，同一个 id 只留第一次出现的 */
export function normalizeCatalog(raw: unknown): Catalog {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hidden = hiddenGenreIds(r.genres), fold = genreFoldMap(r.genres);
  for (const id of hidden) delete fold[id]; // 不显示的不并（不然会以「学生」露出来）
  const genres = normalizeGenres(r.genres, hidden, fold);
  const seen = new Set<string>();
  const games: Game[] = [];
  for (const x of Array.isArray(r.games) ? r.games : []) {
    const g = normalizeGame(x, genres, hidden, fold);
    if (g && !seen.has(g.id)) { seen.add(g.id); games.push(g); }
  }
  const revision = Number.isInteger(r.revision) && (r.revision as number) >= 0 ? (r.revision as number) : 0;
  return { version: num(r.version) ?? 0, updated: str(r.updated), revision, source: str(r.source), games, genres, hiddenGenres: [...hidden], genreFold: fold, rankings: r.rankings, scoring: r.scoring, canon: r.canon, changelog: r.changelog };
}

/** a 比 b 旧：先比资料日期 updated，同一天再比 revision（同一天改了资料时加一，没写就是 0） */
export function olderCatalog(a: Catalog, b: Catalog): boolean {
  return a.updated < b.updated || (a.updated === b.updated && a.revision < b.revision);
}

/** 作品的外部链接：只有 DLsite（商店页）和 Ci-en / FANBOX（支持页）的作品有，别的来源不显示链接 */
export function linkOf(g: Game): { label: string; url: string } | null {
  if (!g.url) return null;
  if (g.src === "dlsite") return { label: "商店页", url: g.url };
  if (g.src === "cien" || g.src === "fanbox") return { label: "支持页", url: g.url };
  return null;
}

/** 同一个社团的其他作品（社团名去掉首尾空白后完全一样），新的在前，最多 max 部 */
export function sameCircle(g: Game, all: Iterable<Game>, max = 12): Game[] {
  const c = g.circle.trim();
  if (!c) return [];
  return [...all]
    .filter(x => x.id !== g.id && x.circle.trim() === c)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, max);
}
