import type { Game, GenreDict, Lang } from "./store.ts";

// —— 题材标签：名字按语言取、统计当前分类里有哪些、按选中的标签筛（纯函数，方便单测） ——

/**
 * 不显示的年龄类题材（DLsite 题材 id）：资料仓库会去掉它们，这里给旧的、别人做的数据包兜底。
 * 206 少女 / Girl、210 少年 / Boy、211 ショタ / 正太 / Shota、504 おねショタ / 姐姐×正太、531 つるぺたババア / 萝老太婆 / Petite Baba。
 * 数据包题材字典里写了 hidden: true 的也一样不显示（见 catalog.ts 的 hiddenGenreIds）
 */
export const HIDDEN_GENRES: ReadonlySet<string> = new Set(["206", "210", "211", "504", "531"]);

/**
 * 学生类题材：
 * - 未成年的学段（小学生、中学生、初中生、高中生、高校生、女子高生、女子校生、男子校生、JK / JC / DK / DC、Schoolgirl、High School Girl、Pupil……）
 *   和 HIDDEN_GENRES 一样不显示（isMinorStudentName；这类作品本来就不该收录，这里只是兜底）；
 * - 成年或不分学段的（学生、女学生、大学生、女子大生、JD、留学生、転校生、優等生、Student、Female Student、College Student……）
 *   一律只显示成「学生」（400）（isStudentName）。数据包里写了 "foldInto": "400" 的也并。
 * FOLD_GENRES 是写死的 id → 并进哪个（DLsite 现在的题材字典里只有 400 学生一个，所以是空的）。
 * 学校 / 学园（001）、スクール水着（104）、先輩 / 後輩（285）、同級生 / 同僚（281）这些场所、衣服、关系类的不动
 */
export const STUDENT_GENRE = "400";
export const FOLD_GENRES: Readonly<Record<string, string>> = {};
const MINOR_JA_ZH = /^(?:女子|男子|女|男)?(?:[小中高][学校]?|校|高中|初中)生$|^学生妹$/;
const MINOR_ABBR = /^(?:JK|JC|DK|DC)$/i;
const MINOR_EN = /^(?:(?:female|male)[- ]?)?(?:(?:high|middle|elementary|primary|grade)[- ]?school|junior[- ]?high)[- ]?(?:girl|boy|student|pupil)s?$|^(?:school ?girl|school ?boy|pupil)s?$/i;
const ADULT_JA_ZH = /^(?:女子|男子|女|男)?(?:学|大学?|留学|転校|转校|优等|優等|新入|特待|交換留学|交换留学)生$/;
const ADULT_ABBR = /^JD$/i;
const ADULT_EN = /^(?:(?:female|male|college|university|exchange|transfer|honou?r)[- ]?)*(?:student|coed|co-ed)s?$|^(?:college|university)[- ]?(?:girl|boy)s?$/i;
/** 名字（日 / 中 / 英，按 / 分开的每一段）里有一段整段符合 */
const anySeg = (names: string[], test: (s: string) => boolean) =>
  names.some(n => (n || "").split(/[/／]/).some(seg => { const s = seg.trim(); return !!s && test(s); }));
/** 未成年学段的学生题材（不显示） */
export const isMinorStudentName = (...names: string[]) => anySeg(names, s => MINOR_JA_ZH.test(s) || MINOR_ABBR.test(s) || MINOR_EN.test(s));
/** 成年或不分学段的学生题材（并进「学生」400）；未成年学段的不算 */
export const isStudentName = (...names: string[]) =>
  !isMinorStudentName(...names) && anySeg(names, s => ADULT_JA_ZH.test(s) || ADULT_ABBR.test(s) || ADULT_EN.test(s));

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
