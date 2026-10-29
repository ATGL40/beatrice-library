import type { Found } from "./store.ts"; // 带 .ts 后缀，node 单测才能直接载入

// —— 识别报告：认错了的文件夹记一条，提交时可以一起发给碧翠子禁书库，帮着改识别规则。纯函数，方便单测 ——

/**
 * 一条识别报告。只有这些字段，而且都是给维护者看识别规则用的：
 * folder 文件夹（相对加进软件的那个游戏文件夹，去掉盘符、用户名），exes 启动程序的文件名，titles 引擎文件里读到的标题，
 * names 名字候选，rjs 找到的编号；matched 软件认成 / 猜成的作品 id，rule 凭什么（rj / title / folder / exe 自动关联，manual 手动关联，
 * guess 只是「可能是」，unknown 旧版本关联的），reason「可能是」的原因；correct 用户选的正确作品（不知道就没有）；date 日期
 */
export interface RecogReport {
  folder: string; exes: string[]; titles: string[]; names: string[]; rjs?: string[];
  matched?: string; rule: string; reason?: string; correct?: string; date: string;
}

const MAX_TEXT = 200, MAX_ITEMS = 20, MAX_REPORTS = 100;
export const REPORT_RULES = ["rj", "title", "folder", "exe", "manual", "guess", "unknown"];

/** 路径里看着像用户名的部分：…\Users\<名字>\…（也认「用户」），和设置里填的名字 */
export function userNames(paths: string[], myName = ""): string[] {
  const out = new Set<string>();
  for (const p of paths) for (const m of p.matchAll(/[\\/](?:users|用户|home)[\\/]([^\\/]+)/gi)) out.add(m[1]);
  if (myName.trim()) out.add(myName.trim());
  return [...out].filter(u => u.length >= 2);
}

/** 一段文字去掉盘符开头的路径、网络路径、用户名，截到 200 字 */
export function scrub(s: string, users: string[] = []): string {
  let t = String(s ?? "")
    .replace(/(?:(?<![a-z0-9])[a-z]:|\\\\[^\\/\s]+)[\\/][^\s"'|<>]*/gi, "…")
    .replace(/[\\/](?:users|用户|home)[\\/][^\\/\s]+/gi, "…");
  for (const u of users) t = t.split(u).join("…").replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "…");
  return t.trim().slice(0, MAX_TEXT);
}

/** 文件夹相对游戏文件夹根目录的写法（\ 分隔）；不在任何根目录里的只留最后一层名字 */
export function relFolder(dir: string, roots: string[]): string {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "");
  const d = norm(dir);
  const root = roots.map(norm).filter(r => d.toLowerCase() === r.toLowerCase() || d.toLowerCase().startsWith(r.toLowerCase() + "\\"))
    .sort((a, b) => b.length - a.length)[0];
  const rel = root && d.length > root.length ? d.slice(root.length + 1) : "";
  return rel || d.split("\\").pop() || "";
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? "";
const list = (xs: unknown, users: string[]) => [...new Set((Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map(x => scrub(x, users)))].slice(0, MAX_ITEMS);

/**
 * 做一条报告：f 是扫描到的那个文件夹（找不到时用关联里的文件夹和启动程序拼一个），roots 是游戏文件夹，
 * how：软件当时认成 / 猜成哪部、凭什么、原因；correct：用户选的正确作品
 */
export function makeReport(f: Found, roots: string[], how: { matched?: string; rule: string; reason?: string }, correct?: string, date = new Date().toISOString().slice(0, 10), myName = ""): RecogReport {
  const users = userNames([f.dir, ...roots, ...f.exes], myName);
  const r: RecogReport = {
    folder: scrub(relFolder(f.dir, roots), users),
    exes: list(f.exes.map(fileName), users),
    titles: list(f.titles ?? [], users),
    names: list([f.name, ...(f.names ?? [])], users),
    rule: REPORT_RULES.includes(how.rule) ? how.rule : "unknown",
    date,
  };
  const rjs = list(f.rjs ?? [], users);
  if (rjs.length) r.rjs = rjs;
  if (how.matched) r.matched = how.matched;
  if (how.reason) r.reason = scrub(how.reason, users);
  if (correct && correct !== how.matched) r.correct = correct;
  return r;
}

/** 提交文件里的识别报告：只留白名单里的字段，再过一遍脱敏；作品 id 只留图鉴里有的（我的游戏不提交），最多 100 条 */
export function cleanReports(raw: unknown, known: (id: string) => boolean = () => true): RecogReport[] {
  const out: RecogReport[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? scrub(v) : "");
    const id = (v: unknown) => (typeof v === "string" && !v.startsWith("local-") && known(v) ? v : undefined);
    const folder = str(o.folder);
    if (!folder) continue;
    const r: RecogReport = {
      folder, exes: list(o.exes, []), titles: list(o.titles, []), names: list(o.names, []),
      rule: REPORT_RULES.includes(String(o.rule)) ? String(o.rule) : "unknown",
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date)) ? String(o.date) : "",
    };
    const rjs = list(o.rjs, []);
    if (rjs.length) r.rjs = rjs;
    const matched = id(o.matched), correct = id(o.correct), reason = str(o.reason);
    if (matched) r.matched = matched;
    if (reason) r.reason = reason;
    if (correct) r.correct = correct;
    out.push(r);
  }
  return out.slice(-MAX_REPORTS);
}

/** 新报告加进本机的列表：同一个文件夹只留最新的一条，最多 100 条 */
export function addReport(reports: RecogReport[], r: RecogReport): RecogReport[] {
  return [...reports.filter(x => x.folder !== r.folder), r].slice(-MAX_REPORTS);
}

/**
 * 用户说过「不是它」的：报告里记着这个文件夹（相对路径）当时认成 / 猜成 matched，而正确的不是它。
 * 返回判断函数：扫描时这个文件夹不再自动关联、也不再猜成那部
 */
export function rejectedBy(reports: RecogReport[], roots: string[], myName = ""): (dir: string, id: string) => boolean {
  const no = new Set(reports.filter(r => r.matched && r.correct !== r.matched).map(r => `${r.folder}\n${r.matched}`));
  return (dir, id) => no.size > 0 && no.has(`${scrub(relFolder(dir, roots), userNames([dir, ...roots], myName))}\n${id}`);
}
