// 代码里按 id 找的元素都得有：测试用的假页面会自动补任何 id，漏写进 index.html 只有真软件启动时才崩
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const src = new URL("../src/", import.meta.url);
const code = readdirSync(src).filter(f => f.endsWith(".ts")).map(f => readFileSync(new URL(f, src), "utf8")).join("\n");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("代码里 $(\"#…\") / getElementById 用到的 id，index.html 或代码生成的 HTML 里都有", () => {
  const used = new Set([...code.matchAll(/\$\("#([\w-]+)"\)|getElementById\("([\w-]+)"\)/g)].map(m => m[1] ?? m[2]));
  const have = new Set([...(html + code).matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(id => !have.has(id)), []);
});
