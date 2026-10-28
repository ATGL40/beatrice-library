// node tests/performance.bench.mjs [修改前的 commit]；只读目录和 Git，不启动 Tauri
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { performance } from "node:perf_hooks";
import { normalizeCatalog } from "../src/catalog.ts";
import * as search from "../src/search.ts";
import * as scoring from "../src/scoring2.ts";
import * as custom from "../src/custom.ts";
import * as tiers from "../src/tiers.ts";
import { cleanRankings } from "../src/scoring.ts";
import { hasGenres } from "../src/genres.ts";
import { makeSubmission, voteProblem } from "../src/marks.ts";
import { submissionLists, submissionState } from "../src/submission.ts";

const revision = process.argv[2] ?? "2a53fce5768f0f3e763c3f9f86239ea61f214a48";
// 独立模块地址，载入 Git 里的旧纯函数，不覆盖工作区文件
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("before:") || (context.parentURL?.startsWith("before:") && specifier.startsWith("."))) {
      const url = new URL(specifier, context.parentURL);
      if (!url.pathname.endsWith(".ts")) url.pathname += ".ts";
      return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context.parentURL?.startsWith("before:")
      ? { ...context, parentURL: new URL("../src/store.ts", import.meta.url).href } : context);
  },
  load(url, context, next) {
    if (url.startsWith("before:")) {
      const path = new URL(url).pathname.slice(1);
      const source = execFileSync("git", ["show", `${revision}:app/${path}`], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
      return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true };
    }
    return next(url, context);
  },
});
const oldSearch = await import("before:///src/search.ts");
const oldScoring = await import("before:///src/scoring2.ts");
const oldCustom = await import("before:///src/custom.ts");
const oldTiers = await import("before:///src/tiers.ts");

const cat = normalizeCatalog(JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
const all = cat.games, games = new Map(all.map(g => [g.id, g]));
const rc = scoring.cleanRecipeV2(cat.scoring), lists = cleanRankings(cat.rankings), canon = scoring.cleanCanon(cat.canon);
assert.ok(rc, "这份目录应该使用第 2 版配方");
const scoreAll = mod => {
  const base = mod.baseScores(all, lists, rc, cat.updated), finals = new Map();
  for (const g of all) { const f = mod.finalOf(g, base.get(g.id), canon, rc); if (f) finals.set(g.id, f); }
  return { base, finals };
};
const { finals } = scoreAll(scoring);
const voteIds = [...finals].filter(([, f]) => f.canon || f.nominee).map(([id]) => id);
const name = g => g.names?.zh || g.names?.ja || g.title || g.id;
// 本机标记不能读取，用固定间隔生成星级、梯度和投票
const marks = Object.fromEntries(all.filter((_, i) => i % 12 === 0).map((g, i) => [g.id, { score: i % 5 + 1 }]));
const votes = Object.fromEntries(voteIds.filter((_, i) => i % 2 === 0).map(id => [id, { vote: "support" }]));
const skip = new Set(), rule = { required: rc.canon.reasonRequired, min: rc.canon.reasonMinChars };
const tierData = tiers.emptyTiers();
all.forEach((g, i) => tierData[tiers.TIER_KEYS[i % 5]].push(g.id));
const genre = new Set(Object.keys(cat.genres).slice(0, 1));
const queries = ["魔法", "Velmorni", "ミルフェリア"];
const folders = all.map(g => ({ dir: `D:/bench/${g.id}`, name: g.title, names: [g.names?.en, g.names?.zh, "Game"].filter(Boolean), exes: [], rj: null }));
const rawTexts = g => [g.title, g.names?.zh, g.names?.en, g.names?.ja, g.circle].filter(Boolean);
const beforeSearch = () => queries.map(q => all.map(g => oldSearch.score(q, rawTexts(g))));
const afterSearch = () => queries.map(q => { const f = search.fold(q); return all.map(g => search.scoreFolded(f, search.gameSearchTexts(g))); });
// 对应旧 submit.ts 的 rated()/voteGames()，旧函数没有导出
const beforeSubmission = () => ({
  rated: Object.entries(marks).filter(([id, m]) => m.score >= 1 && m.score <= 5 && games.get(id) && games.get(id).src !== "local")
    .map(([id]) => games.get(id)).sort((a, b) => marks[b.id].score - marks[a.id].score || name(a).localeCompare(name(b))),
  votes: [...games.values()].filter(g => { const f = finals.get(g.id); return !!f && (!!f.canon || f.nominee); })
    .sort((a, b) => oldScoring.cmpFinal(finals.get(a.id), finals.get(b.id))),
});
const afterSubmission = () => submissionLists(games, marks, voteIds, finals, name);
const selected = afterSubmission();
const beforeCheck = () => {
  const s = beforeSubmission();
  const bad = s.votes.filter(g => votes[g.id] && voteProblem(votes[g.id], rule)).length;
  const f = makeSubmission("0.3.0", cat.updated,
    Object.fromEntries(s.rated.filter(g => !skip.has(g.id)).map(g => [g.id, marks[g.id].score])),
    Object.fromEntries(s.votes.filter(g => votes[g.id]).map(g => [g.id, votes[g.id]])), rule);
  return [Object.keys(f.ratings).length, Object.keys(f.votes).length, bad];
};
const afterCheck = () => { const s = submissionState(selected, marks, votes, skip, rule); return [Object.keys(s.ratings).length, Object.keys(s.votes).length, s.problems.size]; };
const filter = () => all.filter(g => g.state !== "dev" && hasGenres(g, genre));

const cases = [
  ["全目录计分（含公共档位）", () => scoreAll(oldScoring), () => scoreAll(scoring)],
  ["题材筛选（原逻辑保留）", filter, filter],
  ["全目录梯度归属", () => all.map(g => oldTiers.tierOf(tierData, g.id)), () => all.map(g => tiers.tierOf(tierData, g.id))],
  ["三次图鉴搜索", beforeSearch, afterSearch],
  ["三次找游戏候选打分", () => queries.map(q => folders.map(f => oldCustom.bestCandidate(q, f))), () => queries.map(q => folders.map(f => custom.bestCandidate(q, f)))],
  ["提交列表生成（打开）", beforeSubmission, afterSubmission],
  ["提交输入校验", beforeCheck, afterCheck],
];
// 每种操作先核对结果，再预热 3 次，交错测量 11 次取中位数；缓存是预热后的常用路径
const median = xs => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`Node ${process.version}；目录 ${all.length} 部；合成星级 ${Object.keys(marks).length} 部；投票资格 ${voteIds.length} 部`);
console.log(`旧版本 ${revision}；单位 ms；不包含 DOM、布局、图片解码和防抖等待`);
const results = [];
for (const [label, before, after] of cases) {
  assert.deepEqual(after(), before(), `${label}结果必须一致`);
  for (let i = 0; i < 3; i++) { before(); after(); }
  const a = [], b = [];
  for (let i = 0; i < 11; i++) {
    const measure = (fn, times) => { const start = performance.now(); fn(); times.push(performance.now() - start); };
    if (i % 2) { measure(after, b); measure(before, a); }
    else { measure(before, a); measure(after, b); }
  }
  results.push({ 操作: label, 改前毫秒: +median(a).toFixed(3), 改后毫秒: +median(b).toFixed(3) });
}
console.table(results);
