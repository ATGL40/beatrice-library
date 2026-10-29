import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { bindActions, catalogInfo, games, nameOf, render, setCatalog } from "./library";
import { openExport } from "./export";
import { cleanMarks, friendFromFile, mergeMine, parseMarksFile, upsertFriend, type MarksFile } from "./marks";
import { keptStamp, planScan, replacing, reviewLinks, sameDir, under, type Suspect } from "./match";
import { openMyGame } from "./mygames";
import { score } from "./search";
import { normalizeCatalog } from "./catalog";
import { data, linked, linkFolder, save, unlinkFolder, withPackCovers, type Found, type Friend } from "./store";
import { $, esc, toast } from "./ui";

declare const __APP_VERSION__: string; // vite.config.ts 里从 package.json 取的版本号

/** Locale Emulator 只认这个文件名（后端也会查） */
export const LE_EXE = "LEProc.exe";

function renderRoots() {
  $("#roots").innerHTML = data.roots.length
    ? data.roots.map((r, i) => {
        const hit = Object.values(data.local).filter(l => linked(l) && under(l.dir, r)).length;
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
       <input id="unmatched-q" type="search" placeholder="搜文件夹名、标题、RJ 号" aria-label="搜没认出的文件夹" />
       <ul class="unmatched" id="unmatched-list"></ul></details>`
    : "";
  if (um.length) renderUnmatched();
  renderSuspects();
}

/** 文件夹在设置里显示的短路径：在哪个游戏文件夹里就去掉那一段 */
const shortDir = (dir: string) => { const r = data.roots.find(x => under(dir, x)); return r ? dir.slice(r.replace(/[\\/]+$/, "").length + 1) || dir : dir; };
const exeName = (exe: string, dir: string) => (under(exe, dir) ? exe.slice(dir.replace(/[\\/]+$/, "").length + 1) : exe);

/** 关联可能有误：重新扫描时发现的，软件不自己改，每条让主人选「改成…」或「保持」 */
function renderSuspects() {
  const box = $("#suspects");
  const list = data.suspects.filter(s => linked(data.local[s.id]) && sameDir(data.local[s.id].dir!, s.dir));
  const wasOpen = box.querySelector("details")?.open ?? true;
  const name = (id: string) => { const g = games.get(id); return g ? nameOf(g) : id; };
  box.innerHTML = list.length
    ? `<details${wasOpen ? " open" : ""}><summary>关联可能有误（${list.length}）</summary>
       <p class="hint">重新扫描时发现这些关联和文件夹里写的名字对不上，或者启动程序像是工具。软件不会自己改，请确认。</p>
       <ul class="unmatched suspects">${list.map(s => {
         const i = data.suspects.indexOf(s), l = data.local[s.id]!;
         const to = s.to ? games.get(s.to) : undefined, maybe = s.maybe ? games.get(s.maybe) : undefined;
         const from = to ? replacing(to.id, s.dir, data.local).from : undefined;
         const lines = [
           s.why ? `文件夹里写的是「${esc(s.why)}」` : "",
           to ? `像是「${esc(nameOf(to))}」${from ? `（它现在关联的 ${esc(shortDir(from))} 会换成这个文件夹）` : ""}` : maybe ? `可能是「${esc(nameOf(maybe))}」` : "",
           s.exe ? `启动程序 ${esc(exeName(l.exe!, s.dir))} 像是工具，游戏的应该是 ${esc(exeName(s.exe, s.dir))}` : "",
         ].filter(Boolean).map(x => `<small class="guess">${x}</small>`).join("");
         const fix = to ? `<button class="btn small" data-fix="${i}">改成「${esc(nameOf(to))}」</button>`
           : s.exe ? `<button class="btn small" data-fix="${i}">改用 ${esc(exeName(s.exe, s.dir))}</button>`
           : `<button class="btn small" data-fix="${i}">取消关联</button>`;
         return `<li title="${esc(s.dir)}"><span class="path">「${esc(name(s.id))}」← ${esc(shortDir(s.dir))}${lines}</span>${fix}<button class="btn small ghost" data-keep="${i}">保持</button></li>`;
       }).join("")}</ul></details>`
    : "";
}

/** 处理一条「关联可能有误」：fix 按这条的建议改（改成另一部 / 换启动程序 / 取消关联），否则「保持」（记下来，文件夹和启动程序都没变就不再提）；可以撤销 */
function settleSuspect(s: Suspect, fix: boolean) {
  const before = { local: structuredClone(data.local), unmatched: data.unmatched, suspects: data.suspects, marks: structuredClone(data.marks) };
  const l = data.local[s.id]!;
  let text = "已保持现在的关联";
  if (!fix) data.local[s.id] = { ...l, kept: keptStamp({ ...l, dir: l.dir!, exe: l.exe! }) };
  else if (s.to && games.has(s.to)) {
    const exe = s.exe ?? l.exe!;
    linkFolder(s.to, { dir: l.dir!, name: "", names: [], rj: null, exes: [exe] });
    text = `已改成：${nameOf(games.get(s.to)!)}`;
  } else if (s.exe) { data.local[s.id] = { ...l, exe: s.exe }; text = "已换启动程序"; }
  else { unlinkFolder(s.id); text = "已取消关联"; }
  data.suspects = data.suspects.filter(x => x !== s);
  save(); render(); renderRoots();
  toast(text, () => { Object.assign(data, before); save(); render(); renderRoots(); });
}

/** 没认出的文件夹：单独一个能上下滚动的框，可模糊搜索 */
function renderUnmatched() {
  const q = ($("#unmatched-q") as HTMLInputElement).value.trim();
  const list = data.unmatched
    .map((f, i) => [f, i, score(q, [f.name, f.dir, ...(f.names ?? []), ...(f.rjs ?? []), f.guess ?? ""])] as const)
    .filter(([, , s]) => s > 0)
    .sort((a, b) => b[2] - a[2]);
  // 像某部作品、但没把握的，写一行「可能是」；点「关联」时先搜它
  const guess = (f: Found) => { const g = f.guess ? games.get(f.guess) : undefined; return g ? `<small class="guess">可能是：${esc(nameOf(g))}</small>` : ""; };
  $("#unmatched-list").innerHTML = list.length
    ? list.map(([f, i]) => `<li title="${esc(f.dir)}"><span class="path">${esc(f.name)}${guess(f)}</span>
         <small>${esc(data.roots.find(r => under(f.dir, r)) ?? "")}</small>
         <button class="btn small" data-link="${i}">关联</button><button class="btn small ghost" data-mine="${i}">添加为我的游戏</button></li>`).join("")
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
  // 已经关联着别的文件夹的作品不自动换：后来的文件夹进「没认出」，写上「可能是」
  const { link, unmatched } = planScan(found, [...games.values()], data.local);
  for (const [g, f] of link) linkFolder(g.id, f);
  data.unmatched = unmatched;
  // 已有的关联不自动改：看着不对的列进「关联可能有误」，让主人确认
  data.suspects = reviewLinks(found, [...games.values()], data.local);
  save(); render(); renderRoots();
  const n = data.suspects.length;
  $("#scan-status").textContent = `找到 ${found.length} 个游戏文件夹，认出 ${link.length} 部${n ? `，${n} 条关联可能有误` : ""}。`;
}

// —— Locale Emulator：只认手动选的 LEProc.exe，不在硬盘上找 ——
function renderLe() {
  $("#le-path").textContent = data.lePath || "还没选择。选了以后，作品菜单里可以打开「转区启动」。";
  ($("#le-clear") as HTMLButtonElement).hidden = !data.lePath;
}

async function pickLe() {
  const path = await open({ filters: [{ name: LE_EXE, extensions: ["exe"] }] });
  if (typeof path !== "string") return;
  if (path.split(/[\\/]/).pop()!.toLowerCase() !== LE_EXE.toLowerCase()) { toast(`请选择 Locale Emulator 的 ${LE_EXE}`); return; }
  data.lePath = path;
  save(); renderLe();
}

// —— 手动关联 ——
let linking: Found | null = null;
function renderPick() {
  const q = ($("#linker-q") as HTMLInputElement).value;
  $("#linker-confirm").hidden = true;
  const list = [...games.values()]
    .map(g => [g, score(q, [g.title, g.names?.ja, g.names?.zh, g.names?.en, ...(g.aliases ?? []), g.circle, g.id].filter(Boolean) as string[])] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([g]) => g);
  // 已经关联着别的文件夹的作品标出来：选它会换掉原来的关联
  $("#linker-list").innerHTML = list.map(g => {
    const l = data.local[g.id];
    const tag = linked(l) ? `<em>${linking && sameDir(l.dir, linking.dir) ? "现在的" : "已关联别的文件夹"}</em>` : "";
    return `<li><button data-pick="${esc(g.id)}">${esc(nameOf(g))}${tag}<small>${esc(g.circle)}</small></button></li>`;
  }).join("");
}

/** 选好作品后关联；会换掉原来的关联时先写明换掉什么，再点一次才关联 */
function pick(id: string, sure = false) {
  if (!linking) return;
  const g = games.get(id)!, f = linking;
  const { from, owner } = replacing(id, f.dir, data.local);
  if ((from || owner) && !sure) {
    const ow = owner ? games.get(owner) : undefined;
    $("#linker-confirm-text").textContent = [
      from ? `「${nameOf(g)}」现在关联着 ${from}，会改成这个文件夹。` : "",
      owner ? `这个文件夹现在关联着「${ow ? nameOf(ow) : owner}」，会改到「${nameOf(g)}」上（原来那部的游玩记录留着）。` : "",
    ].filter(Boolean).join("");
    ($("#linker-confirm-yes") as HTMLButtonElement).dataset.id = id;
    $("#linker-confirm").hidden = false;
    return;
  }
  const before = { local: structuredClone(data.local), unmatched: data.unmatched, suspects: data.suspects, marks: structuredClone(data.marks) };
  linkFolder(id, f);
  save(); render(); renderRoots();
  ($("#linker") as HTMLDialogElement).close();
  toast(`已关联到：${nameOf(g)}`, () => { Object.assign(data, before); save(); render(); renderRoots(); });
}
function openLinker(f: Found) {
  linking = f;
  $("#linker-dir").textContent = f.dir;
  const q = $("#linker-q") as HTMLInputElement;
  const g = f.guess ? games.get(f.guess) : undefined;
  q.value = g ? nameOf(g) : "";
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
    const builtIn = normalizeCatalog(await (await fetch("catalog.json")).json());
    const text = await invoke<string>("import_pack", { path, minUpdated: builtIn.updated, minRevision: builtIn.revision });
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
  // 同名的朋友已经导入过：更新他的评分，不重复加；可以撤销
  const before = data.friends, { friends, updated } = upsertFriend(data.friends, friend);
  data.friends = friends;
  ($("#import-choice") as HTMLDialogElement).close();
  save(); render(); renderFriends();
  const n = Object.keys(friend.marks).length;
  if (updated) toast(`已更新 ${friend.name} 的评分（${n} 部）`, () => { data.friends = before; save(); render(); renderFriends(); });
  else toast(`已导入 ${friend.name} 的 ${n} 部评分`);
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
  $("#app-version").textContent = __APP_VERSION__;
  bindActions($("#about")); // 「关于」里的链接交给系统浏览器
  $("#open-settings").addEventListener("click", () => {
    nameInput.value = data.myName;
    ($("#mtool") as HTMLInputElement).checked = data.mtool;
    ($("#hide-black") as HTMLInputElement).checked = data.hideBlack;
    renderRoots(); renderFriends(); renderCatalogInfo(); renderLe();
    $("#scan-status").textContent = "";
    dlg.showModal();
  });
  const mtool = $("#mtool") as HTMLInputElement;
  mtool.addEventListener("change", () => { data.mtool = mtool.checked; save(); });
  const hideBlack = $("#hide-black") as HTMLInputElement;
  hideBlack.addEventListener("change", () => { data.hideBlack = hideBlack.checked; save(); render(); });
  $("#le-pick").addEventListener("click", () => pickLe().catch(e => toast(`选择失败：${e}`)));
  $("#le-clear").addEventListener("click", () => { data.lePath = ""; save(); renderLe(); });
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
    const m = (e.target as HTMLElement).closest<HTMLElement>("[data-mine]");
    if (m) openMyGame({ found: data.unmatched[Number(m.dataset.mine)] });
  });

  $("#linker-q").addEventListener("input", renderPick);
  $("#linker-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (b) pick(b.dataset.pick!);
  });
  $("#linker-confirm-yes").addEventListener("click", e => pick((e.currentTarget as HTMLElement).dataset.id!, true));
  $("#linker-confirm-no").addEventListener("click", () => { $("#linker-confirm").hidden = true; });
  $("#suspects").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-fix],[data-keep]");
    const s = b && data.suspects[Number(b.dataset.fix ?? b.dataset.keep)];
    if (s) settleSuspect(s, b.dataset.fix !== undefined);
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
