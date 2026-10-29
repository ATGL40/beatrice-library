import test from "node:test";
import assert from "node:assert/strict";
import { autoBackupName, BACKUP_KIND, backupFileName, fromBase64, isPng, makeBackup, parseBackup, summarize, toBase64 } from "../src/backup.ts";

const data = {
  version: 1,
  marks: { RJ1: { status: "want", fav: false, score: 0 }, RJ2: { status: "", fav: false, score: 0, note: "好玩" }, RJ3: { status: "", fav: false, score: 0, note: "  " } },
  local: { RJ1: { dir: "D:\\Games\\A", exe: "D:\\Games\\A\\Game.exe" }, RJ9: { playSeconds: 30 } },
  roots: ["D:\\Games"], friends: [{ id: "1", name: "朋友", marks: {} }], custom: { "local-abc": { title: "A", cat: "adv", cover: "local-abc.png" } },
  votes: { RJ5: { vote: "support" } }, blacklist: { RJ7: {} }, tiers: { hang: ["RJ1"], top: [], elite: ["RJ2", "RJ3"], npc: [], la: [] }, reports: [{}],
  ui: { tab: "all" },
};

test("做备份：带 kind、版本、软件版本、时间、说明（提醒里有文件夹路径和评分，不要发给别人）、全部数据和封面", () => {
  const b = makeBackup(data, "0.3.0", "2026-10-29T03:00:00.000Z", { "local-abc.png": "iVBO" });
  assert.equal(b.kind, BACKUP_KIND);
  assert.equal(b.version, 1);
  assert.equal(b.app, "0.3.0");
  assert.match(b.note, /文件夹路径和评分，不要发给别人/);
  assert.equal(b.data, data);
  assert.deepEqual(b.covers, { "local-abc.png": "iVBO" });
  assert.equal(b.missingCovers, undefined);
  const m = makeBackup(data, "0.3.0", "", {}, ["local-abc.png"]);
  assert.deepEqual(m.missingCovers, ["local-abc.png"]);
  assert.match(m.note, /1 张我的游戏封面没读到.*custom-covers/);
});

test("读备份：读不出来、不是备份文件、格式不对、新版本做的、没有数据都拒绝，写一句原因", () => {
  assert.match(parseBackup("{坏").error, /读不出来/);
  assert.match(parseBackup(JSON.stringify({ name: "我", marks: {} })).error, /不是「导出全部数据」做的备份/);
  assert.match(parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: "1", data })).error, /格式不对/);
  assert.match(parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 2, data })).error, /新版本/);
  assert.match(parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, data: { ...data, version: 2 } })).error, /新版本/);
  assert.match(parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, data: [] })).error, /没有数据/);
  assert.match(parseBackup("null").error, /不是/);
});

test("读备份：好的文件原样拿回来，封面只留按规则起名的、内容是文字的", () => {
  const text = JSON.stringify({ ...makeBackup(data, "0.3.0", "2026-10-29T03:00:00.000Z", {}), covers: { "local-abc.png": "AAAA", "../x.png": "BBBB", "local-def.gif": "C", "local-ghi.jpg": 5 } });
  const { backup, error } = parseBackup(text);
  assert.equal(error, undefined);
  assert.deepEqual(backup.data, data);
  assert.deepEqual(backup.covers, { "local-abc.png": "AAAA" });
  assert.equal(backup.app, "0.3.0");
});

test("恢复前的对照：每样有多少（标记只算有内容的，关联只算有文件夹和启动程序的）；不是对象的当 0", () => {
  assert.deepEqual(summarize(data), [
    ["标记过的作品", 2], ["评论", 1], ["黑榜", 1], ["梯度表里的作品", 3], ["神作投票", 1],
    ["关联的游戏文件夹", 1], ["设置里的游戏文件夹", 1], ["我的游戏", 1], ["朋友的评分", 1], ["识别报告", 1],
  ]);
  assert.ok(summarize({ marks: [], local: "x", roots: {} }).every(([, n]) => n === 0));
});

test("文件名和 base64", () => {
  assert.equal(backupFileName("2026-10-29"), "碧翠子禁书库备份-2026-10-29.json");
  assert.equal(autoBackupName(new Date(2026, 9, 29, 15, 3, 7)), "restore-before-20261029-150307.json");
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.ok(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])));
  assert.ok(!isPng(new Uint8Array([0xff, 0xd8, 0xff])));
});
