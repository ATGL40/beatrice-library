import type { Game, GenreDict, Lang } from "./store.ts";

// —— 题材标签：名字按语言取、统计当前分类里有哪些、按选中的标签筛（纯函数，方便单测） ——

/**
 * 不显示的年龄类题材（DLsite 题材 id）：资料仓库会去掉它们，这里给旧的、别人做的数据包兜底。
 * 206 少女 / Girl、210 少年 / Boy、211 ショタ / 正太 / Shota、504 おねショタ / 姐姐×正太、531 つるぺたババア / 萝老太婆 / Petite Baba。
 * 数据包题材字典里写了 hidden: true 的也一样不显示（见 catalog.ts 的 hiddenGenreIds）
 */
export const HIDDEN_GENRES: ReadonlySet<string> = new Set(["206", "210", "211", "504", "531"]);

/**
 * 学生类题材一律只显示成「学生」（400）：女子校生、男子校生、女子大生、女学生、JK、高校生、中学生……都并进 400。
 * FOLD_GENRES 是写死的 id → 并进哪个（DLsite 现在的题材字典里只有 400 学生一个，所以是空的）；
 * 字典里名字（日 / 中 / 英任一种）是「某种学生」的也并进 400（isStudentName）；数据包里写了 "foldInto": "400" 的也并。
 * 学校 / 学园（001）、スクール水着（104）、先輩 / 後輩（285）、同級生 / 同僚（281）这些场所、衣服、关系类的不并
 */
export const STUDENT_GENRE = "400";
export const FOLD_GENRES: Readonly<Record<string, string>> = {};
/** 名字里一段（按 / 分开）整段是某种学生：学生、女子校生、女子高生、女子大生、女学生、高校生、中学生、大学生、小学生、留学生……，JK / JC / JD / DK，High School Girl、Schoolgirl、Student…… */
const STUDENT_JA_ZH = /^(?:女子|男子|女|男)?(?:[小中高大][学校]?|[学校]|高中|初中|优等|優等|留学|転校|转校|新入|特待|交換留学|交换留学)生$|^学生妹$/;
const STUDENT_ABBR = /^(?:JK|JC|JD|DK|DC)$/i;
const STUDENT_EN_KIND = /^(?:high[- ]?school|middle[- ]?school|junior[- ]?high|elementary[- ]?school|college|university)[- ]?(?:girl|boy)s?$/i;
const STUDENT_EN = /^(?:(?:female|male|girl|boy|high[- ]?school|middle[- ]?school|junior[- ]?high|elementary|college|university|exchange|transfer|honou?r)[- ]?)*(?:student|schoolgirl|schoolboy|school ?girl|school ?boy|pupil|coed|co-ed)s?$/i;
export function isStudentName(...names: string[]): boolean {
  return names.some(n => (n || "").split(/[/／]/).some(seg => {
    const s = seg.trim();
    return !!s && (STUDENT_JA_ZH.test(s) || STUDENT_ABBR.test(s) || STUDENT_EN.test(s) || STUDENT_EN_KIND.test(s));
  }));
}

/** 题材名字：按设置的语言取，没有就用日文；字典里没有这个 id 就显示 id */
export const genreName = (dict: GenreDict, id: string, lang: Lang) => dict[id]?.[lang] || dict[id]?.ja || id;

/** 这些作品里出现过的题材和部数，部数多的在前（一样多按 id） */
export function countGenres(games: Iterable<Game>): [string, number][] {
  const n = new Map<string, number>();
  for (const g of games) for (const id of g.genres ?? []) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** 选了标签时只留同时带上全部选中标签的作品；没有题材资料的作品不算 */
export const hasGenres = (g: Game, selected: Iterable<string>) => [...selected].every(id => g.genres?.includes(id));

/** 「不看」：带上任何一个不看的题材就不显示（不显示的题材 hiddenGenres 也算，存着的「不看」照旧筛）；没有题材资料的作品不受影响 */
export function hasAnyGenre(g: Game, ids: Iterable<string>): boolean {
  if (!g.genres?.length && !g.hiddenGenres?.length) return false;
  for (const id of ids) if (g.genres?.includes(id) || g.hiddenGenres?.includes(id)) return true;
  return false;
}

/** 题材窗口里一个标签的状态：不选 ""、只看 only、不看 not */
export type GenreState = "" | "only" | "not";
/** 点一下：不选 → 只看 → 不看 → 不选 */
export const nextGenreState = (s: GenreState): GenreState => (s === "" ? "only" : s === "only" ? "not" : "");
