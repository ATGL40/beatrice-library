import test from "node:test";
import assert from "node:assert/strict";
import { ellipsize, IMG, layoutTiers, perRow } from "../src/tierlayout.ts";

test("每行放几张：宽 1200 时 6 张，宽度变了跟着变", () => {
  assert.equal(perRow(), 6);
  assert.equal(perRow({ ...IMG, width: 300 }), 1); // 再窄也至少 1 张
});

test("换行和高度：空档占一行；7 张换成两行；整张图高度按内容来", () => {
  const L = layoutTiers([0, 6, 7, 13, 0]);
  const cellH = IMG.coverH + IMG.capH;
  const one = cellH + IMG.gap * 2, two = cellH * 2 + IMG.gap * 3, three = cellH * 3 + IMG.gap * 4;
  assert.deepEqual(L.rows.map(r => r.h), [one, one, two, three, one]);
  assert.equal(L.rows[0].y, IMG.headH);
  assert.equal(L.rows[1].y, IMG.headH + one + IMG.rowGap);
  const sum = [one, one, two, three, one].reduce((a, b) => a + b, 0) + IMG.rowGap * 4;
  assert.equal(L.height, IMG.headH + sum + IMG.footH);
  // 第 7 张回到行首、往下一行
  const c = L.rows[2].cells;
  assert.equal(c[6].x, c[0].x);
  assert.equal(c[6].y, c[0].y + cellH + IMG.gap);
  assert.equal(c[5].x, c[0].x + 5 * (IMG.coverW + IMG.gap));
  // 最右边的封面不超出图片
  assert.ok(c[5].x + IMG.coverW <= IMG.width - IMG.pad);
});

test("名字太长截断加 …，不长就原样", () => {
  const m = s => [...s].length * 10;
  assert.equal(ellipsize("短名", 100, m), "短名");
  assert.equal(ellipsize("一二三四五六七八九十十一", 60, m), "一二三四五…");
  assert.equal(m(ellipsize("abcdefghijklmnop", 55, m)) <= 55, true);
});
