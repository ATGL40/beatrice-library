import type { Black, Game, Mark, Vote } from "./store.ts";
import { cmpFinal, type Final } from "./scoring2.ts";
import { voteProblem, type ReasonRule } from "./marks.ts";

/** 只取有星级、有投票资格、在黑榜里的作品（我的游戏不算），排序每次打开做一次 */
export function submissionLists(games: Map<string, Game>, marks: Record<string, Mark>, voteIds: string[],
  finals: Map<string, Final>, name: (g: Game) => string, blacklist: Record<string, Black> = {}) {
  const shared = (g: Game | undefined): g is Game => !!g && g.src !== "local";
  const rated = Object.keys(marks).filter(id => marks[id].score >= 1 && marks[id].score <= 5)
    .map(id => games.get(id)).filter(shared)
    .sort((a, b) => marks[b.id].score - marks[a.id].score || name(a).localeCompare(name(b)));
  const votes = voteIds.map(id => games.get(id)).filter(shared)
    .sort((a, b) => cmpFinal(finals.get(a.id)!, finals.get(b.id)!));
  const black = Object.keys(blacklist).map(id => games.get(id)).filter(shared).sort((a, b) => name(a).localeCompare(name(b)));
  return { rated, votes, black };
}

/** 校验包含还没画出的票；输入时不排序、不生成整个提交文件。skipBlack 是这次不提交的黑榜作品 */
export function submissionState(lists: { rated: Game[]; votes: Game[]; black?: Game[] }, marks: Record<string, Mark>,
  votes: Record<string, Vote>, skip: Set<string>, rule: ReasonRule, blacklist: Record<string, Black> = {}, skipBlack = new Set<string>()) {
  const ratings: Record<string, number> = {}, valid: Record<string, Vote> = {}, problems = new Map<string, string>();
  for (const g of lists.rated) if (!skip.has(g.id) && Number.isInteger(marks[g.id]?.score)) ratings[g.id] = marks[g.id].score;
  for (const g of lists.votes) {
    const v = votes[g.id];
    if (!v) continue;
    const p = voteProblem(v, rule);
    if (p) problems.set(g.id, p);
    else if (v.vote === "support" || v.vote === "oppose") valid[g.id] = v;
  }
  const picked: Record<string, Black> = {};
  for (const g of lists.black ?? []) if (!skipBlack.has(g.id) && blacklist[g.id]) picked[g.id] = blacklist[g.id];
  return { ratings, votes: valid, blacklist: picked, problems };
}
