import test from "node:test";
import assert from "node:assert/strict";
import { matchFolder, planScan, reviewLinks, versionsOf } from "../src/match.ts";

const game = (id, title, o = {}) => ({ id, cat: "f-rpg", state: "released", src: "dlsite", title, names: { ja: title, zh: "", en: "" }, mt: [],
  circle: "Circle A", date: "2020-01-01", rate: null, dl: null, url: "", cover: "", note: "", ...o });
const found = (dir, names, o = {}) => ({ dir, name: names[0], names, rj: null, exes: [`${dir}\\Game.exe`], titles: [], ...o });

test("同一个游戏的几个版本（全名一样、同一个社团）：不再因为重名只给「可能是」，按证据挑一部", () => {
  const games = [
    game("RJ100001", "Corruption Town"),
    game("steam-2708950", "Corruption Town", { src: "steam", circle: "circle a ", date: "2021-05-01" }),
    game("steam-9999999", "Corruption Town", { src: "steam", circle: "Circle A", date: "2022-01-01" }),
  ];
  const m = (dir, o) => matchFolder(found(dir, [dir.split("\\").pop()], o), games, {});
  // 没有别的证据：DLsite 那部
  assert.deepEqual([m("X:\\Corruption Town").game?.id, m("X:\\Corruption Town").rule], ["RJ100001", "folder"]);
  // 在 steamapps\common 下：Steam 那部；appid 对得上的优先
  assert.equal(m("D:\\SteamLibrary\\steamapps\\common\\Corruption Town").game?.id, "steam-2708950");
  assert.equal(m("X:\\Corruption Town", { steam: "9999999" }).game?.id, "steam-9999999");
  assert.equal(m("X:\\Corruption Town", { steam: "" }).game?.id, "steam-2708950");
  // 文件夹里有其中一部的 RJ 号：就是它
  assert.equal(matchFolder(found("X:\\[RJ100001] Corruption Town", ["[RJ100001] Corruption Town"]), games, {}).game?.id, "RJ100001");
  // 启动程序名一字不差也一样
  assert.equal(matchFolder(found("X:\\ct", ["ct", "Corruption Town"], { exes: ["X:\\ct\\Corruption Town.exe"] }), games, {}).rule, "exe");
});

test("同名但不同社团：是不同的游戏，只给「可能是」，原因里列出几部和社团", () => {
  const games = [game("RJ200001", "Night Bus Story"), game("steam-1", "Night Bus Story", { src: "steam", circle: "Other Studio" })];
  const r = matchFolder(found("X:\\Night Bus Story", ["Night Bus Story"]), games, {});
  assert.equal(r.game, null);
  assert.ok(r.guess);
  assert.match(r.reason, /不同社团.*RJ200001（Circle A）.*steam-1（Other Studio）/);
  // 一部的全名是另一部的主标题（同系列另一部）：不算同一个游戏
  const series = [game("RJ300001", "Pray Game"), game("RJ300002", "Pray Game ～後編～")];
  assert.equal(matchFolder(found("X:\\Pray Game", ["Pray Game"]), series, {}).game, null);
});

test("一部作品可以关联几个文件夹：主版本 dir / exe 照旧，其他版本在 others；坏的、重复的不算", () => {
  assert.deepEqual(versionsOf(undefined), []);
  assert.deepEqual(versionsOf({ playSeconds: 5 }), []);
  const l = { dir: "X:\\A", exe: "X:\\A\\a.exe", via: "rj", others: [{ dir: "X:\\B", exe: "X:\\B\\b.exe" }, { dir: "x:\\a\\", exe: "x" }, { dir: 3 }, null] };
  assert.deepEqual(versionsOf(l), [{ dir: "X:\\A", exe: "X:\\A\\a.exe", via: "rj", main: true }, { dir: "X:\\B", exe: "X:\\B\\b.exe", main: false }]);
});

test("加版本、去掉版本、设为主版本、换文件夹：游玩记录和不认识的字段留着；一个文件夹只算一部", async () => {
  const { data, addVersion, linkFolder, removeVersion, setMainVersion, unlinkFolder } = await import("../src/store.ts");
  const f = (dir, exe = "Game.exe") => ({ dir, name: dir, names: [dir], rj: null, exes: [`${dir}\\${exe}`] });
  data.local = { W: { dir: "X:\\Old", exe: "X:\\Old\\Game.exe", playSeconds: 100, extra: 1 } };
  data.unmatched = [f("X:\\New")]; data.suspects = []; data.marks = {};
  addVersion("W", f("X:\\New"), "rj");
  assert.deepEqual(data.local.W, { dir: "X:\\Old", exe: "X:\\Old\\Game.exe", playSeconds: 100, extra: 1, others: [{ dir: "X:\\New", exe: "X:\\New\\Game.exe", via: "rj" }] });
  assert.deepEqual(data.unmatched, []);
  // 再加一次（重新扫描）：不重复
  addVersion("W", f("x:\\new\\"), undefined);
  assert.equal(data.local.W.others.length, 1);
  assert.equal(data.local.W.others[0].via, "rj");
  addVersion("W", f("X:\\New"), undefined); // 文件夹记成这次扫描到的写法
  // 设为主版本：两个对调，怎么关联的跟着走
  setMainVersion("W", "X:\\New");
  assert.deepEqual([data.local.W.dir, data.local.W.via, data.local.W.others], ["X:\\New", "rj", [{ dir: "X:\\Old", exe: "X:\\Old\\Game.exe" }]]);
  // 别的作品把其中一个文件夹拿走：只去掉这一个版本
  addVersion("V", f("X:\\Old"), "manual");
  assert.equal(data.local.V.dir, "X:\\Old");
  assert.deepEqual([data.local.W.dir, data.local.W.others], ["X:\\New", undefined]);
  // 去掉主版本：下一个接着当主版本；一个都不剩是取消关联，游玩记录留着
  addVersion("W", f("X:\\Third"));
  removeVersion("W", "X:\\New");
  assert.deepEqual([data.local.W.dir, data.local.W.others], ["X:\\Third", undefined]);
  removeVersion("W", "X:\\Third");
  assert.deepEqual(data.local.W, { playSeconds: 100, extra: 1 });
  // 换主文件夹（找电脑里的游戏）：原来是它的另一个版本的，从其他版本里去掉
  linkFolder("W", f("X:\\P"));
  addVersion("W", f("X:\\Q"));
  linkFolder("W", f("X:\\Q"));
  assert.deepEqual([data.local.W.dir, data.local.W.others], ["X:\\Q", undefined]);
  // 取消全部关联：其他版本也去掉
  addVersion("W", f("X:\\R"));
  unlinkFolder("W");
  assert.deepEqual(data.local.W, { playSeconds: 100, extra: 1 });
});

test("「关联可能有误」按文件夹分开查：另一个版本的启动程序像工具，只报这一个", () => {
  const games = [game("RJ400001", "Velmorin Saga")];
  const local = { RJ400001: { dir: "X:\\Velmorin Saga", exe: "X:\\Velmorin Saga\\Game.exe", others: [{ dir: "X:\\VS 2", exe: "X:\\VS 2\\Tool\\nwjc.exe" }] } };
  const s = reviewLinks([found("X:\\Velmorin Saga", ["Velmorin Saga"]), found("X:\\VS 2", ["VS 2", "Velmorin Saga"], { titles: ["Velmorin Saga"] })], games, local);
  assert.deepEqual(s, [{ id: "RJ400001", dir: "X:\\VS 2", exe: "X:\\VS 2\\Game.exe" }]);
  // 扫描时两个文件夹都算这部：一个主版本，一个另一个版本
  assert.deepEqual(planScan([found("X:\\VS 2", ["VS 2"])], games, local).link.map(([g, , , as]) => [g.id, as]), [["RJ400001", "other"]]);
});
