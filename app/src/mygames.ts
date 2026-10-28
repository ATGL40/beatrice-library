import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultTitle, newCustomId, withoutCustom, type Custom } from "./custom";
import { fromExe } from "./finder";
import { CATS, ALL, render, syncCustom } from "./library";
import { data, linkFolder, save, type Found } from "./store";
import { $, esc, toast } from "./ui";

// —— 我的游戏：添加 / 编辑窗口（名字、分类、社团、日期、简介、封面），移除 ——
let editing = "";            // 编辑中的 id，新加的是空
let folder: Found | null = null; // 要关联的游戏文件夹（新加时）
let coverPath = "";          // 这次选的封面图片

const dlg = () => $("#mygame") as HTMLDialogElement;
const input = (id: string) => $(id) as HTMLInputElement;

/** 打开添加 / 编辑窗口：found 是要关联的文件夹（「没认出」里的、或自己选的启动程序），id 是要编辑的我的游戏 */
export function openMyGame(o: { found?: Found; id?: string }) {
  editing = o.id ?? "";
  folder = o.found ?? null;
  coverPath = "";
  const c = editing ? data.custom[editing] : undefined;
  $("#mygame-title").textContent = editing ? "编辑我的游戏" : "添加为我的游戏";
  input("#mygame-name").value = c?.title ?? (folder ? defaultTitle(folder) : "");
  ($("#mygame-cat") as HTMLSelectElement).innerHTML = CATS.filter(([k]) => k !== ALL)
    .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  ($("#mygame-cat") as HTMLSelectElement).value = c?.cat ?? (data.ui.cat !== ALL ? data.ui.cat : "other");
  input("#mygame-circle").value = c?.circle ?? "";
  input("#mygame-date").value = c?.date ?? "";
  ($("#mygame-note") as HTMLTextAreaElement).value = c?.note ?? "";
  $("#mygame-cover").textContent = c?.cover ? "已有封面，选一张新的就替换" : "没有封面";
  const exe = folder?.exes[0] ?? (editing ? data.local[editing]?.exe : "");
  $("#mygame-exe").textContent = exe ? `启动程序：${exe}` : "还没关联游戏文件夹（之后可以在作品菜单里「找电脑里的游戏」）";
  dlg().showModal();
  input("#mygame-name").focus();
}

/** 设置里的「添加游戏」：先选启动程序 */
export async function addMyGame() {
  const exe = await open({ filters: [{ name: "启动程序", extensions: ["exe", "bat"] }] });
  if (typeof exe === "string") openMyGame({ found: fromExe(exe) });
}

async function saveMyGame() {
  const title = input("#mygame-name").value.trim().slice(0, 200);
  if (!title) { toast("请填名字"); return; }
  const id = editing || newCustomId();
  const opt = (v: string, max: number) => v.trim().slice(0, max) || undefined;
  const c: Custom = {
    ...data.custom[id], title, cat: ($("#mygame-cat") as HTMLSelectElement).value,
    circle: opt(input("#mygame-circle").value, 200), date: opt(input("#mygame-date").value, 10),
    note: opt(($("#mygame-note") as HTMLTextAreaElement).value, 2000),
  };
  for (const k of ["circle", "date", "note"] as const) if (!c[k]) delete c[k];
  // 封面：后端只读这一张图，查过文件头后复制进软件自己的文件夹
  if (coverPath) {
    try { c.cover = await invoke<string>("import_custom_cover", { path: coverPath, id }); }
    catch (e) { toast(`封面没换成：${e}`); return; }
  }
  data.custom[id] = c;
  if (folder) linkFolder(id, folder);
  syncCustom(); save(); render();
  dlg().close();
  toast(editing ? "已保存" : `已添加：${title}`);
}

/** 移除一部我的游戏：标记、关联、游玩记录、梯度表里的位置都去掉，可以撤销（封面文件下次启动时才删） */
export function removeMyGame(id: string) {
  const before = { custom: data.custom, marks: data.marks, local: data.local, tiers: data.tiers };
  const title = data.custom[id]?.title ?? "";
  Object.assign(data, withoutCustom(data, id));
  syncCustom(); save(); render();
  toast(`已移除：${title}`, () => { Object.assign(data, before); syncCustom(); save(); render(); });
}

export function bindMyGames() {
  $("#add-mygame").addEventListener("click", () => addMyGame().catch(e => toast(`添加失败：${e}`)));
  $("#mygame-pick-cover").addEventListener("click", async () => {
    const p = await open({ filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (typeof p !== "string") return;
    coverPath = p;
    $("#mygame-cover").textContent = p.split(/[\\/]/).pop()!;
  });
  $("#mygame-save").addEventListener("click", () => saveMyGame().catch(e => toast(`保存失败：${e}`)));
}
