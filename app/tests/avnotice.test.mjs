// 360 的主动防御在运行时提醒一次：没运行不弹、弹过不再弹、别的窗口开着时等它关了；后端换成记录调用的替身，窗口换成假的
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

globalThis.calls = [];
globalThis.avRunning = false;
const backend = "data:text/javascript," + encodeURIComponent(`
  export const invoke = async (cmd, args) => {
    globalThis.calls.push([cmd, args]);
    if (cmd === "av_running") {
      if (globalThis.avRunning === "error") throw new Error("查不到");
      return globalThis.avRunning;
    }
    return null;
  };
  export const convertFileSrc = path => "asset://" + path;
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

/** 假的 <dialog>：只有用到的几样 */
function fakeDialog() {
  const closers = [];
  const d = {
    open: false,
    shown: 0,
    addEventListener: (_type, fn) => closers.push(fn),
    showModal() { d.open = true; d.shown++; },
    close() { d.open = false; for (const fn of closers.splice(0)) fn(); },
  };
  return d;
}
const notice = fakeDialog(), other = fakeDialog();
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {},
  querySelector: sel => (sel === "#av-notice" ? notice : null),
  querySelectorAll: () => [other, notice],
};

const { data } = await import("../src/store.ts");
const { maybeWarnAv } = await import("../src/avnotice.ts");
const saves = () => calls.filter(c => c[0] === "write_data");
const wait = ms => new Promise(r => setTimeout(r, ms));

test("360 的主动防御没在运行（或查不到）：什么都不弹，也不记成提醒过", async () => {
  for (const v of [false, "error"]) {
    avRunning = v;
    await maybeWarnAv();
    assert.equal(notice.shown, 0);
    assert.equal(data.avNoticed, undefined);
  }
});

test("在运行但别的窗口开着：等它关了再弹", async () => {
  avRunning = true;
  other.open = true;
  await maybeWarnAv();
  assert.equal(notice.shown, 0);
  other.close();
  assert.equal(notice.shown, 1);
  assert.equal(data.avNoticed, undefined, "还没看过就不记");
});

test("关掉提醒才记成提醒过并存盘，以后不再弹", async () => {
  calls.length = 0;
  notice.close();
  assert.equal(data.avNoticed, true);
  await wait(400); // save() 连续改动合成一次，300 毫秒后写盘
  assert.equal(saves().length, 1);
  assert.equal(JSON.parse(saves()[0][1].text).avNoticed, true);
  calls.length = 0;
  await maybeWarnAv();
  assert.equal(notice.shown, 1);
  assert.deepEqual(calls, [], "提醒过了连服务都不用问");
});

test("提醒过的记号不是 true（文件被改坏）：当没提醒过", async () => {
  data.avNoticed = "是";
  await maybeWarnAv();
  assert.equal(notice.shown, 2);
  notice.close();
  assert.equal(data.avNoticed, true);
});
