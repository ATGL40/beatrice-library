import test from "node:test";
import assert from "node:assert/strict";
import { addSession, lastPlayedAt, lastPlayedText, MIN_SESSION, playSecondsOf, playText } from "../src/playtime.ts";

const local = (o = {}) => ({ dir: "X:\\a", exe: "X:\\a\\Game.exe", ...o });

test("一次游玩：累加秒数、记结束时间；太短的不记；旧数据里没有或不是数字的当 0", () => {
  const t0 = Date.UTC(2026, 9, 28, 12, 0, 0);
  const l = addSession(local(), t0, 90);
  assert.equal(l.playSeconds, 90);
  assert.equal(l.lastPlayed, "2026-10-28T12:01:30.000Z");
  assert.equal(addSession(l, t0, 30.6).playSeconds, 121);
  assert.equal(addSession(local(), t0, MIN_SESSION - 1), null);
  assert.equal(addSession(local(), t0, NaN), null);
  assert.equal(addSession(local({ playSeconds: "x" }), t0, 20).playSeconds, 20);
  assert.equal(addSession(local({ playSeconds: -5 }), t0, 20).playSeconds, 20);
  assert.equal(l.extra, undefined);
  assert.equal(addSession(local({ extra: 1 }), t0, 20).extra, 1); // 不认识的字段照留
});

test("时长写法：不到一小时按分钟，一小时以上一位小数；没玩过是空", () => {
  assert.equal(playText(undefined), "");
  assert.equal(playText(local()), "");
  assert.equal(playText(local({ playSeconds: 20 })), "玩了 1 分钟");
  assert.equal(playText(local({ playSeconds: 1500 })), "玩了 25 分钟");
  assert.equal(playText(local({ playSeconds: 3600 })), "玩了 1 小时");
  assert.equal(playText(local({ playSeconds: 11520 })), "玩了 3.2 小时");
});

test("最后游玩日期：今年的只写月日，往年的带年份；读不出是空", () => {
  const now = new Date(2026, 9, 28);
  const iso = new Date(2026, 9, 5, 20, 0).toISOString(); // 本地时间 10-05
  assert.equal(lastPlayedText(local({ lastPlayed: iso }), now), "10-05");
  assert.equal(lastPlayedText(local({ lastPlayed: new Date(2025, 0, 2).toISOString() }), now), "2025-01-02");
  assert.equal(lastPlayedText(local({ lastPlayed: "昨天" }), now), "");
  assert.equal(lastPlayedText(local(), now), "");
  assert.equal(lastPlayedText(undefined, now), "");
});

test("排序用的数值：没玩过是 -1，排在玩过的后面", () => {
  const played = local({ playSeconds: 100, lastPlayed: "2026-10-28T12:00:00.000Z" });
  assert.equal(playSecondsOf(played), 100);
  assert.equal(playSecondsOf(local()), -1);
  assert.equal(playSecondsOf(undefined), -1);
  assert.equal(lastPlayedAt(played), Date.UTC(2026, 9, 28, 12));
  assert.equal(lastPlayedAt(local({ lastPlayed: "x" })), -1);
  assert.equal(lastPlayedAt(undefined), -1);
  const byRecent = [local(), played, local({ lastPlayed: "2026-01-01T00:00:00.000Z" })].sort((a, b) => lastPlayedAt(b) - lastPlayedAt(a));
  assert.deepEqual(byRecent.map(l => l.lastPlayed), ["2026-10-28T12:00:00.000Z", "2026-01-01T00:00:00.000Z", undefined]);
});
