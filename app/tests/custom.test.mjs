import test from "node:test";
import assert from "node:assert/strict";
import { bestCandidate, candidateKind, cleanCustom, customGame, defaultTitle, exportMarks, isCustomId, newCustomId, withoutCustom } from "../src/custom.ts";
import { makeSubmission } from "../src/marks.ts";
import { baseScores, cleanRecipeV2, finalOf } from "../src/scoring2.ts";

test("新 id：local- 加 12 位小写字母数字", () => {
  const id = newCustomId(n => new Uint8Array(n).fill(1));
  assert.equal(id, "local-bbbbbbbbbbbb");
  assert.match(newCustomId(), /^local-[a-z0-9]{12}$/);
  assert.ok(isCustomId(id)); assert.ok(!isCustomId("RJ01000000"));
});

test("读进来的 data.custom：id 和名字不对的丢掉，封面名不合规的去掉，不认识的字段留着", () => {
  const c = cleanCustom({
    "local-abc": { title: " 我的 ", cat: "", cover: "local-abc.png", extra: 1 },
    "local-x": { title: "坏封面", cat: "adv", cover: "../evil.png" },
    "RJ1": { title: "不是我的游戏" }, "local-y": { title: "" }, "local-Z": { title: "大写" },
  });
  assert.deepEqual(Object.keys(c), ["local-abc", "local-x"]);
  assert.equal(c["local-abc"].title, "我的"); assert.equal(c["local-abc"].cat, "other"); assert.equal(c["local-abc"].extra, 1);
  assert.equal(c["local-x"].cover, undefined);
  assert.deepEqual(cleanCustom([1]), {});
});

test("变成图鉴作品：来源 local、没有评分和链接；不参与综合榜", () => {
  const g = customGame("local-abc", { title: "我的", cat: "adv", circle: "社团", date: "2024-01-02" }, "asset://x");
  assert.equal(g.src, "local"); assert.equal(g.cat, "adv"); assert.equal(g.cover, "asset://x"); assert.equal(g.url, "");
  assert.equal(g.rate, null); assert.equal(g.names.ja, "我的");
  const rc = cleanRecipeV2({ version: 2 });
  const b = baseScores([g], [], rc, "2026-10-28");
  assert.equal(b.size, 0);
  assert.equal(finalOf(g, b.get(g.id), new Set(), rc), null);
});

test("移除我的游戏：标记、关联、梯度表一起去掉，别的不动", () => {
  const d = { custom: { "local-a": { title: "a", cat: "adv" }, "local-b": { title: "b", cat: "adv" } },
    marks: { "local-a": { score: 3 }, RJ1: { score: 4 } }, local: { "local-a": { dir: "D:/g", exe: "D:/g/g.exe", playSeconds: 60 } },
    tiers: { hang: ["local-a", "RJ1"], top: [], elite: [], npc: [], la: [] } };
  const r = withoutCustom(d, "local-a");
  assert.deepEqual(Object.keys(r.custom), ["local-b"]);
  assert.deepEqual(Object.keys(r.marks), ["RJ1"]);
  assert.deepEqual(r.local, {});
  assert.deepEqual(r.tiers.hang, ["RJ1"]);
  assert.ok(d.custom["local-a"]); // 原来的没改（撤销用）
});

test("导出评分：没勾「包含我的游戏」就不带；提交文件不带我的游戏", () => {
  const marks = { "local-a": { status: "played", fav: false, score: 5 }, RJ1: { status: "", fav: false, score: 4 } };
  assert.deepEqual(Object.keys(exportMarks(marks, false)), ["RJ1"]);
  assert.deepEqual(Object.keys(exportMarks(marks, true)), ["local-a", "RJ1"]);
  const f = makeSubmission("0.3.0", "2026-10-28", { "local-a": 5, RJ1: 4 }, { "local-a": { vote: "support" } });
  assert.deepEqual(f.ratings, { RJ1: 4 }); assert.deepEqual(f.votes, {});
});

test("找游戏：比文件夹的全部名字候选，说明是哪一个对上的", () => {
  const f = { dir: "D:/Games/RPG/RJ000001/www", name: "RJ000001", names: ["www", "RJ000001", "Game", "Velmorin 体験版"], rj: null, exes: ["D:/Games/RPG/RJ000001/www/Game.exe"] };
  assert.equal(candidateKind(f, "RJ000001"), "外层文件夹");
  assert.equal(candidateKind(f, "www"), "文件夹名");
  assert.equal(candidateKind(f, "Game"), "启动程序名");
  assert.equal(candidateKind(f, "Velmorin 体験版"), "引擎标题");
  // 启动程序藏在更深处时它所在的文件夹；新版后端单独给了引擎标题
  const deep = { dir: "D:/Games/Ice", name: "Ice", names: ["Ice", "Game", "アイスハート", "Ice Title"], rj: null, exes: ["D:/Games/Ice/アイスハート/Game.exe"], titles: ["Ice Title"] };
  assert.equal(candidateKind(deep, "アイスハート"), "启动程序所在的文件夹");
  assert.equal(candidateKind(deep, "Ice Title"), "引擎标题");
  const hit = bestCandidate("velmorin", f);
  assert.equal(hit.text, "Velmorin 体験版"); assert.equal(hit.kind, "引擎标题");
  assert.equal(bestCandidate("完全不相干", f), null);
  assert.equal(defaultTitle(f), "RJ000001"); // 通用词（www、Game）不当名字
});
