import type { Game, Mark, Vote } from "./store.ts";
import { cmpFinal, type Final } from "./scoring2.ts";
import { voteProblem, type ReasonRule } from "./marks.ts";

/** 只取有星级或有投票资格的作品，排序每次打开做一次 */
export function submissionLists(games: Map<string, Game>, marks: Record<string, Mark>, voteIds: string[],
  finals: Map<string, Final>, name: (g: Game) => string) {
  const rated = Object.keys(marks).filter(id => marks[id].score >= 1 && marks[id].score <= 5)
    .map(id => games.get(id)).filter((g): g is Game => !!g && g.src !== "local")
    .sort((a, b) => marks[b.id].score - marks[a.id].score || name(a).localeCompare(name(b)));
  const votes = voteIds.map(id => games.get(id)).filter((g): g is Game => !!g && g.src !== "local")
    .sort((a, b) => cmpFinal(finals.get(a.id)!, finals.get(b.id)!));
  return { rated, votes };
}

/** 校验包含还没画出的票；输入时不排序、不生成整个提交文件 */
export function submissionState(lists: { rated: Game[]; votes: Game[] }, marks: Record<string, Mark>,
  votes: Record<string, Vote>, skip: Set<string>, rule: ReasonRule) {
  const ratings: Record<string, number> = {}, valid: Record<string, Vote> = {}, problems = new Map<string, string>();
  for (const g of lists.rated) if (!skip.has(g.id) && Number.isInteger(marks[g.id]?.score)) ratings[g.id] = marks[g.id].score;
  for (const g of lists.votes) {
    const v = votes[g.id];
    if (!v) continue;
    const p = voteProblem(v, rule);
    if (p) problems.set(g.id, p);
    else if (v.vote === "support" || v.vote === "oppose") valid[g.id] = v;
  }
  return { ratings, votes: valid, problems };
}
