import { invoke } from "@tauri-apps/api/core";
import { games, nameOf, render } from "./library";
import { fromExe } from "./finder";
import { sameDir } from "./match";
import { addReport, makeReport, relFolder } from "./recog";
import { score } from "./search";
import { data, linkFolder, localOf, save, unlinkFolder, type Found } from "./store";
import { $, esc, toast } from "./ui";

// —— 「认错了」：关联错了的作品、猜错了的「可能是」。选出正确的作品就改过来（不知道就只取消），同时记一条识别报告（见 recog.ts） ——

const RULE_TEXT: Record<string, string> = {
  rj: "凭作品编号认的", title: "凭引擎标题认的", folder: "凭文件夹名认的", exe: "凭启动程序名认的", manual: "自己选的", unknown: "旧版本认的",
};
type Target = { kind: "link"; id: string; dir: string; f: Promise<Found> } | { kind: "guess"; f: Found };
let target: Target | null = null;
let after = () => {};
const dlg = () => $("#misrecog") as HTMLDialogElement;

/** 已关联的作品认错了：先读一遍游戏文件夹拿到这个文件夹的名字候选、启动程序和标题（报告里用），不在游戏文件夹里的只用关联里的 */
export function openMisrecogLink(id: string, done = () => {}) {
  const l = localOf(id);
  if (!l) return;
  const fallback = (): Found => ({ ...fromExe(l.exe), dir: l.dir });
  const f = data.roots.length
    ? invoke<Found[]>("scan_roots", { roots: data.roots }).then(all => all.find(x => sameDir(x.dir, l.dir)) ?? fallback(), fallback)
    : Promise.resolve(fallback());
  const g = games.get(id);
  show({ kind: "link", id, dir: l.dir, f }, `「${g ? nameOf(g) : id}」现在关联着 ${relFolder(l.dir, data.roots)}（${RULE_TEXT[l.via ?? "unknown"] ?? RULE_TEXT.unknown}）。`, "不知道是哪部，只取消关联", done);
}

/** 「可能是」猜错了 */
export function openMisrecogGuess(f: Found, done = () => {}) {
  const g = f.guess ? games.get(f.guess) : undefined;
  show({ kind: "guess", f }, `${relFolder(f.dir, data.roots)} 软件猜是「${g ? nameOf(g) : f.guess ?? "?"}」${f.reason ? `（${f.reason}）` : ""}。`, "不知道是哪部，只去掉「可能是」", done);
}

function show(t: Target, what: string, none: string, done: () => void) {
  target = t; after = done;
  $("#misrecog-what").textContent = what;
  $("#misrecog-none").textContent = none;
  const q = $("#misrecog-q") as HTMLInputElement;
  q.value = "";
  renderList();
  dlg().showModal();
  q.focus();
}

function renderList() {
  const q = ($("#misrecog-q") as HTMLInputElement).value.trim();
  const list = q ? [...games.values()]
    .map(g => [g, score(q, [g.title, g.names?.ja, g.names?.zh, g.names?.en, ...(g.aliases ?? []), g.circle, g.id].filter(Boolean) as string[])] as const)
    .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([g]) => g) : [];
  $("#misrecog-list").innerHTML = list.length
    ? list.map(g => `<li><button data-pick="${esc(g.id)}">${esc(nameOf(g))}${localOf(g.id) ? "<em>已关联别的文件夹</em>" : ""}<small>${esc(g.circle)}</small></button></li>`).join("")
    : `<li class="hint">${q ? "没有符合搜索的作品。" : "搜一下正确的作品（名字、社团、RJ 号）。"}</li>`;
}

/** 改过来（correct 是用户选的作品，没有就只取消）并记一条报告；可以撤销 */
async function settle(correct?: string) {
  const t = target;
  if (!t) return;
  target = null;
  dlg().close();
  const before = { local: structuredClone(data.local), unmatched: data.unmatched, suspects: data.suspects, reports: data.reports, marks: structuredClone(data.marks) };
  const f = t.kind === "link" ? await t.f : t.f;
  const how = t.kind === "link"
    ? { matched: t.id, rule: data.local[t.id]?.via ?? "unknown" }
    : { matched: f.guess, rule: "guess", reason: f.reason };
  data.reports = addReport(data.reports, makeReport(f, data.roots, how, correct, undefined, data.myName));
  let text: string;
  if (correct && t.kind === "link" && correct === t.id) text = "没有改动，记下了报告";
  else if (correct) {
    linkFolder(correct, t.kind === "link" ? { ...f, dir: t.dir } : f, "manual");
    text = `已改成：${nameOf(games.get(correct)!)}`;
  } else if (t.kind === "link") { unlinkFolder(t.id); text = "已取消关联"; }
  else {
    data.unmatched = data.unmatched.map(u => (sameDir(u.dir, f.dir) ? (({ guess: _g, reason: _r, ...rest }) => rest)(u) : u));
    text = "已去掉「可能是」";
  }
  save(); render(); after();
  toast(`${text}；识别报告提交时可以一起发`, () => { Object.assign(data, before); save(); render(); after(); });
}

export function bindMisrecog() {
  $("#misrecog-q").addEventListener("input", renderList);
  $("#misrecog-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (b) settle(b.dataset.pick!);
  });
  $("#misrecog-none").addEventListener("click", () => settle());
  dlg().addEventListener("close", () => { target = null; });
}
