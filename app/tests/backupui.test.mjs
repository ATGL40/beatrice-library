// 导出全部数据、从备份恢复：后端换成记录调用的替身，系统选文件窗口也是替身
import test from "node:test";
import assert from "node:assert/strict";
import { el, Element, tick } from "./dom.mjs";

globalThis.__APP_VERSION__ = "0.3.0";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const CONVERTED = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
// jpg 转 png 用的画布替身
globalThis.createImageBitmap = async () => ({ width: 2, height: 3 });
Element.prototype.getContext = () => ({ drawImage() {} });
Element.prototype.toBlob = cb => cb(new Blob([CONVERTED]));

const { data } = await import("../src/store.ts");
const { bindBackup } = await import("../src/backupui.ts");
const { toBase64, BACKUP_KIND } = await import("../src/backup.ts");
bindBackup();
const cmds = name => calls.filter(c => c[0] === name);
const reset = () => { calls.length = 0; globalThis.handlers = {}; };

const mine = () => ({
  marks: { RJ1: { status: "played", fav: true, score: 5, note: "好" } }, local: { RJ1: { dir: "D:\\Games\\A", exe: "D:\\Games\\A\\a.exe" } }, roots: ["D:\\Games"],
  custom: { "local-abc": { title: "我的", cat: "adv", cover: "local-abc.png" }, "local-def": { title: "没封面了", cat: "adv", cover: "local-def.jpg" } },
  blacklist: { RJ2: { reason: "雷" } }, votes: {}, friends: [], reports: [], myName: "我",
});

test("导出全部数据：选好位置后写一个 .json，带全部数据和读得到的封面，读不到的记在 missingCovers；取消就什么都不写", async () => {
  reset();
  Object.assign(data, mine());
  handlers.read_custom_cover = ({ name }) => { if (name === "local-abc.png") return PNG.buffer; throw new Error("没有"); };
  handlers.save = () => null;
  await el("#export-all").emit("click"); await tick();
  assert.equal(cmds("write_json_file").length, 0);
  handlers.save = o => { assert.match(o.defaultPath, /^碧翠子禁书库备份-\d{4}-\d\d-\d\d\.json$/); return "E:\\备份.json"; };
  await el("#export-all").emit("click"); await tick();
  const [[, { path, text }]] = cmds("write_json_file");
  assert.equal(path, "E:\\备份.json");
  const f = JSON.parse(text);
  assert.equal(f.kind, BACKUP_KIND);
  assert.equal(f.version, 1);
  assert.equal(f.app, "0.3.0");
  assert.deepEqual(f.data.marks, data.marks);
  assert.deepEqual(f.data.local, data.local);
  assert.deepEqual(f.data.blacklist, data.blacklist);
  assert.deepEqual(f.covers, { "local-abc.png": toBase64(PNG) });
  assert.deepEqual(f.missingCovers, ["local-def.jpg"]);
  assert.match(el("#toast").html, /1 张封面没读到/);
});

test("从备份恢复：不对的文件只提示；对的先列出现在和备份里各有多少，确认后先自动备份现在的数据，放回封面，换上数据写盘并重新载入", async () => {
  reset();
  Object.assign(data, mine());
  handlers.open = () => "E:\\x.json";
  handlers.read_json_file = () => JSON.stringify({ name: "朋友", marks: {} });
  await el("#restore-all").emit("click"); await tick();
  assert.match(el("#toast").html, /没有恢复：这不是「导出全部数据」做的备份/);
  assert.ok(!el("#restore").open);

  const backup = {
    kind: BACKUP_KIND, version: 1, app: "0.2.9", date: "2026-10-01T03:04:00.000Z", note: "",
    data: {
      version: 1, marks: { RJ3: { status: "want", fav: false, score: 0 }, RJ4: { status: "", fav: false, score: 3 } }, local: {}, roots: [],
      custom: {
        "local-abc": { title: "同一张", cat: "adv", cover: "local-abc.png" },
        "local-new": { title: "jpg 封面", cat: "adv", cover: "local-new.jpg" },
        "local-png": { title: "新电脑", cat: "adv", cover: "local-png.png" },
      },
      ui: { tab: "want" },
    },
    covers: { "local-abc.png": toBase64(PNG), "local-new.jpg": toBase64(JPG), "local-png.png": toBase64(PNG) },
  };
  handlers.read_json_file = () => JSON.stringify(backup);
  await el("#restore-all").emit("click"); await tick();
  assert.ok(el("#restore").open);
  const html = el("#restore-body").html;
  assert.match(html, /软件版本 0\.2\.9/);
  assert.match(html, /带 3 张我的游戏封面/);
  assert.match(html, /<tr><th>标记过的作品<\/th><td>1<\/td><td>2<\/td><\/tr>/);
  assert.match(html, /<tr><th>关联的游戏文件夹<\/th><td>1<\/td><td>0<\/td><\/tr>/);
  assert.match(html, /先把现在的数据自动备份/);

  // 本机：local-abc.png 一模一样（不写），别的都没有；custom-covers 里 local-png 写不进（模拟文件夹还没有），走中转文件
  calls.length = 0;
  handlers.read_custom_cover = ({ name }) => { if (name === "local-abc.png") return PNG.buffer; throw new Error("没有"); };
  handlers.write_png = (bytes, o) => { if (decodeURIComponent(o.headers.path).endsWith("local-png.png")) throw new Error("文件夹不存在"); };
  handlers.import_custom_cover = ({ id }) => `${id}.png`;
  await el("#restore-go").emit("click"); await tick();
  // 1. 先备份现在的数据，到备份文件夹
  const [first] = calls.filter(c => c[0] !== "read_custom_cover");
  assert.equal(first[0], "write_json_file");
  assert.match(first[1].path, /^C:\/app\/backups\/restore-before-\d{8}-\d{6}\.json$/);
  assert.deepEqual(JSON.parse(first[1].text).data.marks, mine().marks);
  // 2. 封面：jpg 转成 png 写进 custom-covers；写不进的经中转文件交给 import_custom_cover
  const pngs = cmds("write_png").map(c => [decodeURIComponent(c[2].headers.path), [...c[1]]]);
  assert.deepEqual(pngs, [
    ["C:/app/custom-covers/local-new.png", [...CONVERTED]],
    ["C:/app/custom-covers/local-png.png", [...PNG]],
    ["C:/app/custom-cover-restore.png", [...PNG]],
  ]);
  assert.deepEqual(cmds("import_custom_cover").map(c => c[1]), [{ path: "C:/app/custom-cover-restore.png", id: "local-png" }]);
  // 3. 换上数据、写盘、重新载入
  const [[, { text }]] = cmds("write_data");
  const saved = JSON.parse(text);
  assert.deepEqual(saved.marks, backup.data.marks);
  assert.equal(saved.blacklist, undefined); // 现在的数据整个换掉，备份里没有的就没有（下次启动时补默认值）
  assert.equal(saved.custom["local-abc"].cover, "local-abc.png");
  assert.equal(saved.custom["local-new"].cover, "local-new.png");
  assert.equal(saved.custom["local-png"].cover, "local-png.png");
  assert.ok(saved.custom["local-new"].coverVersion > 0);
  assert.equal(saved.custom["local-abc"].coverVersion, undefined);
  assert.deepEqual(data.marks, backup.data.marks);
  assert.equal(globalThis.reloaded, 1);
  assert.ok(!el("#restore").open);
});

test("从备份恢复：现在的数据备份不了就不恢复；写盘失败时内存里的数据换回去", async () => {
  reset();
  Object.assign(data, mine());
  const backup = { kind: BACKUP_KIND, version: 1, data: { version: 1, marks: { RJ8: { status: "want", fav: false, score: 0 } } }, covers: {} };
  handlers.open = () => "E:\\x.json";
  handlers.read_json_file = () => JSON.stringify(backup);
  handlers.write_json_file = () => { throw new Error("拒绝访问"); };
  await el("#restore-all").emit("click"); await tick();
  await el("#restore-go").emit("click"); await tick();
  assert.equal(cmds("write_json_file").length, 2); // 备份文件夹、数据文件夹都试过
  assert.equal(cmds("write_data").length, 0);
  assert.match(el("#toast").html, /没能先备份现在的数据/);
  assert.deepEqual(data.marks, mine().marks);

  // 备份文件夹写不进、数据文件夹写得进：照样恢复
  calls.length = 0;
  handlers.write_json_file = ({ path }) => { if (path.includes("backups")) throw new Error("文件夹不存在"); };
  handlers.write_data = () => { throw new Error("磁盘满了"); };
  await el("#restore-go").emit("click"); await tick();
  assert.match(cmds("write_json_file")[1][1].path, /^C:\/app\/restore-before-/);
  assert.equal(cmds("write_data").length, 1);
  assert.deepEqual(data.marks, mine().marks);
  assert.match(el("#toast").html, /恢复失败，数据没有改/);
  assert.equal(globalThis.reloaded, 1); // 没有再重新载入
});
