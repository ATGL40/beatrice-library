import type { Local } from "./store.ts";

// —— 游玩时长和最后游玩时间：只记软件自己启动的游戏（纯函数，方便单测） ——

/** 不到这么多秒的一次启动不算（闪退、只开了启动器） */
export const MIN_SESSION = 10;

const secs = (l: Local | undefined) => (typeof l?.playSeconds === "number" && l.playSeconds > 0 ? l.playSeconds : 0);

/** 一次游玩结束：累加时长、记下结束时间；太短的不记，返回 null */
export function addSession(l: Local, startedAt: number, seconds: number): Local | null {
  if (!(seconds >= MIN_SESSION)) return null;
  return { ...l, playSeconds: secs(l) + Math.round(seconds), lastPlayed: new Date(startedAt + seconds * 1000).toISOString() };
}

/** 「玩了 25 分钟」「玩了 3.2 小时」；没玩过是空 */
export function playText(l: Local | undefined): string {
  const s = secs(l);
  if (!s) return "";
  return s < 3600 ? `玩了 ${Math.max(1, Math.round(s / 60))} 分钟` : `玩了 ${(s / 3600).toFixed(1).replace(/\.0$/, "")} 小时`;
}

/** 最后游玩的日期：今年的写 10-28，往年的写 2025-10-28；没有或读不出是空 */
export function lastPlayedText(l: Local | undefined, now = new Date()): string {
  const t = l?.lastPlayed ? new Date(l.lastPlayed) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const md = `${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  return t.getFullYear() === now.getFullYear() ? md : `${t.getFullYear()}-${md}`;
}

/** 排序用：累计秒数、最后游玩的时间戳；没玩过都是 -1（排最后） */
export const playSecondsOf = (l: Local | undefined) => secs(l) || -1;
export function lastPlayedAt(l: Local | undefined): number {
  const t = l?.lastPlayed ? Date.parse(l.lastPlayed) : NaN;
  return Number.isNaN(t) ? -1 : t;
}
