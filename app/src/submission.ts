import type { Black, Game, Mark, Vote } from "./store.ts";
import type { TagReport } from "./tagreport.ts";
import { cmpFinal, type Final } from "./scoring2.ts";
import { voteProblem, type ReasonRule } from "./marks.ts";

/** 只取有星级、有投票资格、在黑榜里、有标签报告的作品（我的游戏不算），排序每次打开做一次。tags 是按现在的资料筛过的标签报告（见 tagreport.ts 的 currentTagReports） */
export function submissionLists(games: Map<string, Game>, marks: Record<string, Mark>, voteIds: string[],
  finals: Map<string, Final>, name: (g: Game) => string, blacklist: Record<string, Black> = {}, tags: Record<string, TagReport> = {}) {
  const shared = (g: Game | undefined): g is Game => !!g && g.src !== "local";
  const byName = (a: Game, b: Game) => name(a).localeCompare(name(b));
  const rated = Object.keys(marks).filter(id => marks[id].score >= 1 && marks[id].score <= 5)
    .map(id => games.get(id)).filter(shared)
    .sort((a, b) => marks[b.id].score - marks[a.id].score || byName(a, b));
  const votes = voteIds.map(id => games.get(id)).filter(shared)
    .sort((a, b) => cmpFinal(finals.get(a.id)!, finals.get(b.id)!));
  const black = Object.keys(blacklist).map(id => games.get(id)).filter(shared).sort(byName);
  const tagged = Object.keys(tags).map(id => games.get(id)).filter(shared).sort(byName);
  return { rated, votes, black, tagged };
}

/** 校验包含还没画出的票；输入时不排序、不生成整个提交文件。skipBlack、skipTags 是这次不提交的黑榜作品、标签报告 */
export function submissionState(lists: { rated: Game[]; votes: Game[]; black?: Game[]; tagged?: Game[] }, marks: Record<string, Mark>,
  votes: Record<string, Vote>, skip: Set<string>, rule: ReasonRule, blacklist: Record<string, Black> = {}, skipBlack = new Set<string>(),
  tags: Record<string, TagReport> = {}, skipTags = new Set<string>()) {
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
  const pickedTags: Record<string, TagReport> = {};
  for (const g of lists.tagged ?? []) if (!skipTags.has(g.id) && tags[g.id]) pickedTags[g.id] = tags[g.id];
  return { ratings, votes: valid, blacklist: picked, tags: pickedTags, problems };
}
