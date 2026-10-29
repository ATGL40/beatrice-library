import test from "node:test";
import assert from "node:assert/strict";
import { addReport, cleanReports, makeReport, relFolder, scrub, userNames } from "../src/recog.ts";
import { makeSubmission } from "../src/marks.ts";

const f = {
  dir: "C:\\Users\\Alice\\Games\\汉化\\Velmorin Saga v1.2\\www", name: "Velmorin Saga v1.2", names: ["www", "Velmorin Saga v1.2", "Game", "Velmorin"],
  rj: null, rjs: ["RJ111111"], exes: ["C:\\Users\\Alice\\Games\\汉化\\Velmorin Saga v1.2\\www\\Game.exe"], titles: ["Velmorin"],
};
const roots = ["C:\\Users\\Alice\\Games"];

test("识别报告：文件夹只写相对游戏文件夹的路径，去掉盘符、用户名；exe 只留文件名", () => {
  const r = makeReport(f, roots, { matched: "RJ111111", rule: "folder" }, "RJ222222", "2026-10-29");
  assert.deepEqual(r, {
    folder: "汉化\\Velmorin Saga v1.2\\www", exes: ["Game.exe"], titles: ["Velmorin"], names: ["Velmorin Saga v1.2", "www", "Game", "Velmorin"],
    rjs: ["RJ111111"], matched: "RJ111111", rule: "folder", correct: "RJ222222", date: "2026-10-29",
  });
  // 不在任何游戏文件夹里（自己选的启动程序）：只留最后一层
  assert.equal(relFolder("D:\\Downloads\\Foo", roots), "Foo");
  assert.equal(relFolder("c:/users/alice/games/", roots), "games");
  // 看着像用户名、路径的都去掉
  assert.deepEqual(userNames(["C:\\Users\\Alice\\x", "/home/bob/y"], "  我的名字 "), ["Alice", "bob", "我的名字"]);
  assert.equal(scrub("D:\\Games\\Alice\\标题 by Alice", ["Alice"]), "… by …");
  assert.equal(scrub("见 C:\\Users\\Bob\\a.txt 和 \\\\nas\\share\\b"), "见 … 和 …");
  assert.equal(scrub("Re:Zero 标题"), "Re:Zero 标题");
  const mine = makeReport({ ...f, names: ["Alice 的游戏"] }, roots, { rule: "manual" }, undefined, "2026-10-29", "Alice");
  assert.deepEqual(mine.names, ["Velmorin Saga v1.2", "… 的游戏"]);
  // 选的和认成的是同一部：不写 correct；不认识的 rule 记成 unknown
  assert.equal(makeReport(f, roots, { matched: "RJ1", rule: "x" }, "RJ1").correct, undefined);
  assert.equal(makeReport(f, roots, { matched: "RJ1", rule: "x" }).rule, "unknown");
});

test("识别报告进提交文件：只留白名单字段，我的游戏的 id 不写，没有报告就没有这个字段", () => {
  const r = makeReport(f, roots, { matched: "RJ111111", rule: "guess", reason: "只对上了机翻的名字" }, "local-abc", "2026-10-29");
  const sub = makeSubmission("0.3.1", "2026-10-29", { RJ1: 4 }, {}, undefined, {}, [{ ...r, extra: "x", path: "C:\\secret" }]);
  assert.deepEqual(sub.recognition, [{
    folder: "汉化\\Velmorin Saga v1.2\\www", exes: ["Game.exe"], titles: ["Velmorin"], names: ["Velmorin Saga v1.2", "www", "Game", "Velmorin"],
    rule: "guess", date: "2026-10-29", rjs: ["RJ111111"], matched: "RJ111111", reason: "只对上了机翻的名字",
  }]);
  assert.ok(!("recognition" in makeSubmission("0.3.1", "2026-10-29", { RJ1: 4 }, {})));
  // 读回来时再洗一遍：坏的条目丢掉，路径去掉
  assert.deepEqual(cleanReports([null, { folder: "" }, { folder: "D:\\x\\y", exes: "Game.exe", rule: "rj", date: "bad" }]),
    [{ folder: "…", exes: [], titles: [], names: [], rule: "rj", date: "" }]);
});

test("本机的报告：同一个文件夹只留最新一条，最多 100 条", () => {
  let list = [];
  for (let i = 0; i < 105; i++) list = addReport(list, { folder: `F${i}`, exes: [], titles: [], names: [], rule: "guess", date: "2026-10-29" });
  list = addReport(list, { folder: "F104", exes: [], titles: [], names: [], rule: "rj", date: "2026-10-30" });
  assert.equal(list.length, 100);
  assert.deepEqual(list.at(-1), { folder: "F104", exes: [], titles: [], names: [], rule: "rj", date: "2026-10-30" });
  assert.equal(list.filter(r => r.folder === "F104").length, 1);
});

test("说过「不是它」的文件夹，下次扫描不再自动关联到那部、也不再猜成那部；选了别的作品的、现在关联着的照旧", async () => {
  const { planScan } = await import("../src/match.ts");
  const { rejectedBy } = await import("../src/recog.ts");
  const g = { id: "RJ111111", title: "Velmorin Saga", names: { ja: "Velmorin Saga", zh: "", en: "" }, mt: [] };
  const root = "X:/Games", dir = "X:/Games/Velmorin Saga";
  const f = { dir, name: "Velmorin Saga", names: ["Velmorin Saga"], rj: null, exes: [dir + "/Game.exe"], titles: [] };
  const report = makeReport(f, [root], { matched: "RJ111111", rule: "folder" }, undefined, "2026-10-29");
  assert.equal(report.folder, "Velmorin Saga");
  const no = rejectedBy([report], [root]);
  assert.ok(no(dir, "RJ111111") && !no(dir, "RJ222222") && !no("X:/Games/Other", "RJ111111"));
  assert.deepEqual(planScan([f], [g], {}, no).link, []);
  assert.equal(planScan([f], [g], {}, no).unmatched[0].guess, undefined);
  assert.equal(planScan([f], [g], {}).link.length, 1);
  // 用户后来自己又关联回去：照旧
  assert.equal(planScan([f], [g], { RJ111111: { dir, exe: dir + "/Game.exe" } }, no).link.length, 1);
  // 选的就是认成的那部：不算「不是它」
  assert.ok(!rejectedBy([{ ...report, correct: "RJ111111" }], [root])(dir, "RJ111111"));
});
