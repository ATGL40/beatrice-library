import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { games, nameOf, render } from "./library";
import { matchFolder } from "./match";
import { score } from "./search";
import { data, linkFolder, save, type Found } from "./store";
import { $, esc, toast } from "./ui";

// —— 按作品找电脑里的游戏文件夹：在设置里添加的游戏文件夹里找，可模糊搜索 ——
let gameId = "";
let folders: Found[] = [];

/** 这个文件夹现在关联在哪部作品上 */
const ownerOf = (dir: string) => Object.entries(data.local).find(([, l]) => l.dir === dir)?.[0];
/** 搜索时也看上一层文件夹名（「RPG\Velmorin\www」里的 Velmorin） */
const textsOf = (f: Found) => [f.name, f.dir.split(/[\\/]/).slice(-2).join(" ")];

function renderList() {
  const q = ($("#finder-q") as HTMLInputElement).value.trim();
  const g = games.get(gameId)!;
  let list: Found[];
  if (q) {
    list = folders
      .map(f => [f, score(q, textsOf(f))] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f);
  } else {
    // 没输入时：像这部作品的排最前，然后是还没关联的，最后是已关联别的作品的
    const rank = (f: Found) => (matchFolder(f, [g], {}).game ? 0 : ownerOf(f.dir) ? 2 : 1);
    list = [...folders].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  $("#finder-list").innerHTML = list.length
    ? list.slice(0, 50).map(f => {
        const owner = ownerOf(f.dir);
        const tag = owner === gameId ? "现在的" : owner && games.has(owner) ? `已关联：${nameOf(games.get(owner)!)}` : "";
        return `<li><button data-dir="${esc(f.dir)}">${esc(f.name)}${tag ? `<em>${esc(tag)}</em>` : ""}<small>${esc(f.dir)}</small></button></li>`;
      }).join("")
    : `<li class="hint">${folders.length ? "没有符合搜索的文件夹。" : "游戏文件夹里没找到游戏。"}</li>`;
}

export async function openFinder(id: string) {
  gameId = id;
  folders = [];
  $("#finder-title").textContent = `找「${nameOf(games.get(id)!)}」`;
  const q = $("#finder-q") as HTMLInputElement;
  q.value = "";
  ($("#finder") as HTMLDialogElement).showModal();
  if (!data.roots.length) {
    $("#finder-list").innerHTML = `<li class="hint">还没添加游戏文件夹（在设置里添加）。也可以点「自己选启动程序」。</li>`;
    return;
  }
  $("#finder-list").innerHTML = `<li class="hint">正在看游戏文件夹…</li>`;
  try {
    folders = await invoke<Found[]>("scan_roots", { roots: data.roots });
  } catch (e) {
    toast(`扫描失败：${e}`);
  }
  if (gameId === id) { renderList(); q.focus(); }
}

/** 自己选的启动程序当成一个文件夹 */
export function fromExe(exe: string): Found {
  const dir = exe.replace(/[\\/][^\\/]*$/, "");
  const name = dir.split(/[\\/]/).pop()!;
  return { dir, name, names: [name, exe.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "")], rj: null, exes: [exe] };
}

function done(f: Found) {
  const id = gameId, local = { ...data.local }, unmatched = data.unmatched, m = data.marks[id];
  linkFolder(id, f);
  save(); render();
  ($("#finder") as HTMLDialogElement).close();
  toast(`已关联：${nameOf(games.get(id)!)}`, () => {
    data.local = local; data.unmatched = unmatched;
    if (m) data.marks[id] = m; else delete data.marks[id];
    save(); render();
  });
}

export function bindFinder() {
  $("#finder-q").addEventListener("input", renderList);
  $("#finder-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-dir]");
    const f = b && folders.find(x => x.dir === b.dataset.dir);
    if (f) done(f);
  });
  $("#finder-browse").addEventListener("click", async () => {
    const exe = await open({ filters: [{ name: "启动程序", extensions: ["exe", "bat"] }] });
    if (typeof exe !== "string") return;
    done(fromExe(exe));
  });
}
