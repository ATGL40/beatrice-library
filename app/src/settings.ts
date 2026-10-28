import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { catalogInfo, games, nameOf, render, setCatalog } from "./library";
import { openExport } from "./export";
import { cleanMarks, friendFromFile, mergeMine, parseMarksFile, type MarksFile } from "./marks";
import { matchFolder } from "./match";
import { score } from "./search";
import { data, linkFolder, save, withPackCovers, type Catalog, type Found, type Friend } from "./store";
import { $, esc, toast } from "./ui";


/** 路径在不在这个游戏文件夹里 */
const under = (dir: string, root: string) => dir.toLowerCase().startsWith(root.toLowerCase().replace(/[\\/]*$/, "\\"));

function renderRoots() {
  $("#roots").innerHTML = data.roots.length
    ? data.roots.map((r, i) => {
        const hit = Object.values(data.local).filter(l => under(l.dir, r)).length;
        const miss = data.unmatched.filter(f => under(f.dir, r)).length;
        return `<li><span class="path">${esc(r)}</span><span class="count">认出 ${hit} · 没认出 ${miss}</span>
          <button class="btn small ghost" data-root="${i}">移除</button></li>`;
      }).join("")
    : `<li class="hint">还没添加游戏文件夹。</li>`;
  const um = data.unmatched;
  const box = $("#unmatched");
  const wasOpen = box.querySelector("details")?.open ?? false;
  box.innerHTML = um.length
    ? `<details${wasOpen ? " open" : ""}><summary>没认出的文件夹（${um.length}）</summary>
       <p class="hint">多半是图鉴还没收录的作品。是收录了的，点「关联」选它是哪部，以后再扫描就会记住。</p>
       <input id="unmatched-q" type="search" placeholder="搜文件夹名" aria-label="搜没认出的文件夹" />
       <ul class="unmatched" id="unmatched-list"></ul></details>`
    : "";
  if (um.length) renderUnmatched();
}

/** 没认出的文件夹：单独一个能上下滚动的框，可模糊搜索 */
function renderUnmatched() {
  const q = ($("#unmatched-q") as HTMLInputElement).value.trim();
  const list = data.unmatched
    .map((f, i) => [f, i, score(q, [f.name, f.dir])] as const)
    .filter(([, , s]) => s > 0)
    .sort((a, b) => b[2] - a[2]);
  $("#unmatched-list").innerHTML = list.length
    ? list.map(([f, i]) => `<li title="${esc(f.dir)}"><span class="path">${esc(f.name)}</span>
         <small>${esc(data.roots.find(r => under(f.dir, r)) ?? "")}</small>
         <button class="btn small" data-link="${i}">关联</button></li>`).join("")
    : `<li class="hint">没有符合搜索的文件夹。</li>`;
}

function renderFriends() {
  $("#friends").innerHTML = data.friends.map(f => {
    const n = Object.keys(f.marks).length;
    return `<li><span>${esc(f.name)} · ${n} 部的评分</span><button class="btn small ghost" data-friend="${esc(f.id)}">删除</button></li>`;
  }).join("");
}

export async function scan() {
  if (!data.roots.length) { $("#scan-status").textContent = "先添加一个游戏文件夹。"; return; }
  $("#scan-status").textContent = "扫描中…";
  const found = await invoke<Found[]>("scan_roots", { roots: data.roots });
  const list = [...games.values()];
  const unmatched: Found[] = [];
  let hit = 0;
  for (const f of found) {
    const g = matchFolder(f, list, data.local);
    if (g) { linkFolder(g.id, f); hit++; } else unmatched.push(f);
  }
  data.unmatched = unmatched;
  save(); render(); renderRoots();
  $("#scan-status").textContent = `找到 ${found.length} 个游戏文件夹，认出 ${hit} 部。`;
}

// —— 手动关联 ——
let linking: Found | null = null;
function renderPick() {
  const q = ($("#linker-q") as HTMLInputElement).value;
  const list = [...games.values()]
    .map(g => [g, score(q, [g.title, g.names?.zh, g.names?.en, g.circle].filter(Boolean) as string[])] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([g]) => g);
  $("#linker-list").innerHTML = list.map(g =>
    `<li><button data-pick="${esc(g.id)}">${esc(nameOf(g))}<small>${esc(g.circle)}</small></button></li>`).join("");
}
function openLinker(f: Found) {
  linking = f;
  $("#linker-dir").textContent = f.dir;
  const q = $("#linker-q") as HTMLInputElement;
  q.value = "";
  renderPick();
  ($("#linker") as HTMLDialogElement).showModal();
  q.focus();
}

// —— 作品资料 ——
function renderCatalogInfo() {
  $("#catalog-info").textContent = `现在的资料：${catalogInfo.updated} 更新 · ${games.size} 部作品。拿到新的数据包（.zip）后在这里导入，不用重装软件；你的标记、评分和关联都不受影响。`;
}

async function importPack() {
  const path = await open({ filters: [{ name: "数据包", extensions: ["zip"] }] });
  if (typeof path !== "string") return;
  try {
    // 比软件自带资料旧、或者版本比软件新的包，后端在替换之前就拒绝，现有的包不动
    const builtIn: Catalog = await (await fetch("catalog.json")).json();
    const text = await invoke<string>("import_pack", { path, minUpdated: builtIn.updated });
    const pack = await invoke<[string, string] | null>("read_pack");
    const cat = withPackCovers(JSON.parse(text), pack![1]);
    setCatalog(cat);
    render(); renderCatalogInfo();
    toast(`已导入数据包：${cat.updated} · ${cat.games.length} 部作品`);
  } catch (e) {
    toast(`导入失败：${e instanceof Error ? e.message : e}`);
  }
}

// —— 导入评分文件：选好文件后问一句，是别人的评分，还是我自己的（合并进我的评分） ——
let pending: { file: MarksFile; fallback: string } | null = null;
const known = (id: string) => games.has(id);

/** 文件解析好以后打开选择框；单独拆出来，测试时可以不经过系统的选文件窗口 */
function openImportChoice(text: string, fallback: string) {
  const file = parseMarksFile(text);
  const marks = cleanMarks(file.marks, known);
  const n = Object.keys(marks).length, notes = Object.values(marks).filter(m => m.note).length;
  pending = { file, fallback };
  const name = String(file.name || fallback).slice(0, 20);
  $("#import-summary").textContent = `${name} 的评分 · ${n} 部作品${notes ? `（其中 ${notes} 条评论）` : ""}`;
  // 文件上的名字就是自己设的名字时，「这是我的」放在显眼的位置，但还是要自己点
  const mineLikely = !!data.myName && file.name === data.myName;
  const mine = $("#import-as-mine"), friend = $("#import-as-friend");
  mine.classList.toggle("primary", mineLikely);
  friend.classList.toggle("primary", !mineLikely);
  ($("#import-choice") as HTMLDialogElement).showModal();
  (mineLikely ? mine : friend).focus();
}

async function importMarksFile() {
  const path = await open({ filters: [{ name: "评分文件", extensions: ["html", "json"] }] });
  if (typeof path !== "string") return;
  try {
    const fallback = path.split(/[\\/]/).pop()!.replace(/\.(beatrice|galshelf)\.json$|\.json$|\.html$/i, "");
    openImportChoice(await invoke<string>("read_json_file", { path }), fallback);
  } catch (e) {
    toast(`导入失败：${e instanceof Error ? e.message : e}`);
  }
}

function importAsFriend() {
  if (!pending) return;
  const friend: Friend = friendFromFile(pending.file, `${Date.now()}`, pending.fallback, known);
  data.friends.push(friend);
  ($("#import-choice") as HTMLDialogElement).close();
  save(); render(); renderFriends();
  toast(`已导入 ${friend.name} 的 ${Object.keys(friend.marks).length} 部评分`);
}

function importAsMine() {
  if (!pending) return;
  const before = structuredClone(data.marks), beforeTiers = data.tiers;
  const { marks, tiers, filled, conflicts } = mergeMine(data.marks, pending.file.marks, known, data.tiers);
  data.marks = marks;
  data.tiers = tiers ?? data.tiers;
  ($("#import-choice") as HTMLDialogElement).close();
  save(); render();
  const text = filled || conflicts
    ? `已合并：补上 ${filled} 部作品的内容${conflicts ? `，${conflicts} 处不一样，保留了你现有的` : ""}`
    : "文件里没有可以补上的内容";
  toast(text, () => { data.marks = before; data.tiers = beforeTiers; save(); render(); });
}

export function bindSettings() {
  const dlg = $("#settings") as HTMLDialogElement;
  const nameInput = $("#my-name") as HTMLInputElement;
  $("#open-settings").addEventListener("click", () => {
    nameInput.value = data.myName;
    ($("#mtool") as HTMLInputElement).checked = data.mtool;
    renderRoots(); renderFriends(); renderCatalogInfo();
    $("#scan-status").textContent = "";
    dlg.showModal();
  });
  const mtool = $("#mtool") as HTMLInputElement;
  mtool.addEventListener("change", () => { data.mtool = mtool.checked; save(); });
  nameInput.addEventListener("change", () => { data.myName = nameInput.value.trim(); save(); });

  $("#add-root").addEventListener("click", async () => {
    const dir = await open({ directory: true });
    if (typeof dir !== "string" || data.roots.includes(dir)) return;
    data.roots.push(dir);
    save(); renderRoots();
    await scan().catch(e => toast(`扫描失败：${e}`));
  });
  $("#rescan").addEventListener("click", () => scan().catch(e => toast(`扫描失败：${e}`)));
  $("#roots").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-root]");
    if (!b) return;
    const i = Number(b.dataset.root), dir = data.roots[i];
    data.roots.splice(i, 1);
    save(); renderRoots();
    toast("已移除这个文件夹（已认出的作品还在）", () => { data.roots.splice(i, 0, dir); save(); renderRoots(); });
  });
  $("#unmatched").addEventListener("input", renderUnmatched);
  $("#unmatched").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-link]");
    if (b) openLinker(data.unmatched[Number(b.dataset.link)]);
  });

  $("#linker-q").addEventListener("input", renderPick);
  $("#linker-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!b || !linking) return;
    const g = games.get(b.dataset.pick!)!;
    linkFolder(g.id, linking);
    save(); render(); renderRoots();
    ($("#linker") as HTMLDialogElement).close();
    toast(`已关联到：${nameOf(g)}`);
  });

  $("#import-pack").addEventListener("click", importPack);
  $("#open-backups").addEventListener("click", () => invoke("open_backups").catch(e => toast(`打不开备份文件夹：${e}`)));
  $("#export-marks").addEventListener("click", openExport);
  $("#import-friend").addEventListener("click", importMarksFile);
  $("#import-as-friend").addEventListener("click", importAsFriend);
  $("#import-as-mine").addEventListener("click", importAsMine);
  // 测试用：直接拿一段文件内容打开选择框（页面脚本受内容安全策略限制，外面插不进来）
  $("#import-choice").addEventListener("beatrice-open", e => {
    const { text, fallback } = (e as CustomEvent<{ text: string; fallback: string }>).detail;
    try { openImportChoice(text, fallback); } catch (err) { toast(`导入失败：${err instanceof Error ? err.message : err}`); }
  });
  $("#friends").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-friend]");
    if (!b) return;
    const i = data.friends.findIndex(f => f.id === b.dataset.friend);
    const [gone] = data.friends.splice(i, 1);
    save(); render(); renderFriends();
    toast(`已删除 ${gone.name} 的评分`, () => { data.friends.splice(i, 0, gone); save(); render(); renderFriends(); });
  });
}
