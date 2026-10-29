import { COVER_NAME } from "./custom.ts"; // 带 .ts 后缀，node 单测才能直接载入

// —— 全部数据备份：设置里「导出全部数据」存成一个 .json，「从备份恢复」换回来（纯函数，方便单测） ——

/** 备份文件的 kind 和格式版本；软件只认 version 不比自己新的 */
export const BACKUP_KIND = "beatrice-backup";
export const BACKUP_VERSION = 1;
/** 写进文件开头的说明 */
export const BACKUP_NOTE = "碧翠子禁书库的全部数据备份：标记、评分、评论、黑榜、关联的游戏文件夹、我的游戏（连封面）、梯度表、设置。在软件的「设置 → 备份 → 从备份恢复」里恢复。里面有你电脑上的文件夹路径和评分，不要发给别人。";

export interface Backup {
  kind: string; version: number;
  /** 做备份的软件版本、时间（ISO 8601，UTC） */
  app: string; date: string;
  note: string;
  /** data.json 的全部内容 */
  data: Record<string, unknown>;
  /** 我的游戏的封面：custom-covers 里的文件名 → 图片内容（base64） */
  covers: Record<string, string>;
  /** 没读到、没放进来的封面文件名（要自己从 custom-covers 文件夹复制）；都读到了就没有这个字段 */
  missingCovers?: string[];
}

export function makeBackup(data: object, app: string, date: string, covers: Record<string, string>, missing: string[] = []): Backup {
  const b: Backup = { kind: BACKUP_KIND, version: BACKUP_VERSION, app, date, note: BACKUP_NOTE, data: data as Record<string, unknown>, covers };
  if (missing.length) {
    b.missingCovers = missing;
    b.note += ` 有 ${missing.length} 张我的游戏封面没读到，没放进这个文件，需要自己从软件数据文件夹的 custom-covers 里复制。`;
  }
  return b;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 读备份文件：kind、版本、数据都对才行；不对时 error 是给人看的一句话 */
export function parseBackup(text: string): { backup: Backup; error?: undefined } | { backup?: undefined; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: "这个文件读不出来，不是备份文件" }; }
  if (!isObj(raw) || raw.kind !== BACKUP_KIND) return { error: "这不是「导出全部数据」做的备份文件（评分文件请用「导入评分文件」）" };
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) return { error: "备份文件的格式不对" };
  const data = raw.data;
  if ((raw.version as number) > BACKUP_VERSION || (isObj(data) && typeof data.version === "number" && data.version > 1)) {
    return { error: "这是新版本的软件做的备份，请先升级软件再恢复" };
  }
  if (!isObj(data)) return { error: "备份文件里没有数据" };
  const covers = isObj(raw.covers) ? Object.fromEntries(Object.entries(raw.covers).filter(([k, v]) => typeof v === "string" && COVER_NAME.test(k))) as Record<string, string> : {};
  const missing = Array.isArray(raw.missingCovers) ? raw.missingCovers.filter((x): x is string => typeof x === "string") : [];
  const backup = makeBackup(data, typeof raw.app === "string" ? raw.app : "", typeof raw.date === "string" ? raw.date : "", covers, missing);
  if (typeof raw.note === "string") backup.note = raw.note;
  return { backup };
}


/** 恢复前给人看的：几样东西各有多少（现在的和备份里的各算一次） */
export function summarize(d: Record<string, unknown>): [string, number][] {
  const obj = (k: string) => (isObj(d[k]) ? (d[k] as Record<string, Record<string, unknown>>) : {});
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]) : []);
  const marks = Object.values(obj("marks")).filter(isObj);
  const tiers = Object.values(obj("tiers")).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  return [
    ["标记过的作品", marks.filter(m => m.status || m.fav || m.score || (typeof m.note === "string" && m.note.trim())).length],
    ["评论", marks.filter(m => typeof m.note === "string" && m.note.trim()).length],
    ["黑榜", Object.keys(obj("blacklist")).length],
    ["梯度表里的作品", tiers],
    ["神作投票", Object.keys(obj("votes")).length],
    ["关联的游戏文件夹", Object.values(obj("local")).filter(l => isObj(l) && l.dir && l.exe).length],
    ["设置里的游戏文件夹", arr("roots").length],
    ["我的游戏", Object.keys(obj("custom")).length],
    ["朋友的评分", arr("friends").length],
    ["识别报告", arr("reports").length],
  ];
}

/** 默认文件名：碧翠子禁书库备份-2026-10-29.json */
export const backupFileName = (day: string) => `碧翠子禁书库备份-${day}.json`;
/** 恢复前自动备份的文件名：restore-before-20261029-153000.json（按本机时间） */
export function autoBackupName(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `restore-before-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

// —— base64：封面图片放进 JSON ——
export function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b: Uint8Array) => PNG.every((x, i) => b[i] === x);
