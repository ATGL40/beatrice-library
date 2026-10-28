// 启动时清理我的游戏的封面：只在真的读到数据文件以后；后端换成记录调用的替身
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

globalThis.calls = [];
globalThis.dataText = null;
const backend = "data:text/javascript," + encodeURIComponent(`
  export const invoke = async (cmd, args) => {
    globalThis.calls.push([cmd, args]);
    if (cmd === "read_data") return globalThis.dataText;
    if (cmd === "backup_broken_data") return "data.broken.json";
    return null;
  };
  export const appDataDir = async () => "C:/app";
  export const convertFileSrc = path => "asset://" + path;
  const none = () => {};
  export { none as open, none as save, none as openUrl, none as revealItemInDir, none as getCurrentWindow, none as listen };
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@tauri-apps/")) return { url: backend, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts")) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
globalThis.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };

const { load } = await import("../src/store.ts");
const { initMyGames } = await import("../src/library.ts");
const prunes = () => calls.filter(c => c[0] === "prune_custom_covers");

test("数据文件坏了、是新版本写的、没有数据文件：不清理封面", async () => {
  for (const text of ["{坏了", JSON.stringify({ version: 9, custom: {} }), null]) {
    calls.length = 0; dataText = text;
    await load(); await initMyGames();
    assert.deepEqual(prunes(), [], String(text));
  }
});

test("成功读到数据以后才清理，留下还在用的封面", async () => {
  calls.length = 0;
  dataText = JSON.stringify({ version: 1, custom: { "local-abc": { title: "A", cat: "adv", cover: "local-abc.png" }, "local-def": { title: "B", cat: "adv" } } });
  await load(); await initMyGames();
  assert.deepEqual(prunes(), [["prune_custom_covers", { keep: ["local-abc.png"] }]]);
});
