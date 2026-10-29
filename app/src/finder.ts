import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { games, nameOf, render } from "./library";
import { bestCandidate } from "./custom";
import { matchFolder, ownerOf, replacing, sameDir } from "./match";
import { debounce } from "./performance";
import { data, linkFolder, save, type Found } from "./store";
import { $, esc, toast } from "./ui";

// —— 按作品找电脑里的游戏文件夹：在设置里添加的游戏文件夹里找，可模糊搜索 ——
let gameId = "";
let folders: Found[] = [];
let rows: { f: Found; group: number; owner?: string }[] = [];
let scan = 0;
const searchLater = debounce(renderList);

/**
 * 每个文件夹拿全部名字候选（文件夹名、外层文件夹、启动程序名、引擎标题）来比，按最像的那个排：
 * 输入了就比输入的字，没输入就比作品的名字；「可能是」这部的排最前，然后是认得出是这部的、还没关联的，已关联别的作品的最后
 */
function renderList() {
  const q = ($("#finder-q") as HTMLInputElement).value.trim();
  const g = games.get(gameId)!;
  const names = [...new Set([g.title, g.names?.zh, g.names?.en, g.names?.ja].filter(Boolean) as string[])];
  const best = (f: Found) => (q ? bestCandidate(q, f) : names.map(n => bestCandidate(n, f)).reduce((a, b) => (b && (!a || b.score > a.score) ? b : a), null));
  const found = rows.map(r => ({ ...r, hit: best(r.f) }))
    .filter(r => !q || r.hit);
  found.sort((a, b) => (q ? (b.hit?.score ?? 0) - (a.hit?.score ?? 0) : 0) || a.group - b.group || (b.hit?.score ?? 0) - (a.hit?.score ?? 0) || a.f.name.localeCompare(b.f.name));
  $("#finder-list").innerHTML = found.length
    ? found.slice(0, 50).map(({ f, hit, group, owner }) => {
        const tag = owner === gameId ? "现在的" : owner && games.has(owner) ? `已关联：${nameOf(games.get(owner)!)}` : group === 0 ? "可能是这部" : "";
        const exe = f.exes[0]?.split(/[\\/]/).pop() ?? "";
        const why = hit && hit.text !== f.name ? ` · ${hit.kind}：${hit.text}` : "";
        return `<li><button data-dir="${esc(f.dir)}">${esc(f.name)}${tag ? `<em>${esc(tag)}</em>` : ""}<small>${esc(f.dir)}</small><small>${esc(exe + why)}</small></button></li>`;
      }).join("")
    : `<li class="hint">${folders.length ? "没有符合搜索的文件夹。" : "游戏文件夹里没找到游戏。"}</li>`;
}

export async function openFinder(id: string) {
  searchLater.cancel();
  const request = ++scan;
  gameId = id;
  folders = [];
  rows = [];
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
    const found = await invoke<Found[]>("scan_roots", { roots: data.roots });
    if (request !== scan) return;
    folders = found;
  } catch (e) {
    toast(`扫描失败：${e}`);
  }
  if (request === scan) {
    // 归属、猜测、自动识别不随搜索词变，每次打开只算一次。
    // 先只拿这部比（快），像的再和全部作品比一遍：认出的是别的作品时不算「认得出是这部」
    const all = [...games.values()], g = games.get(id)!;
    const guessed = (f: Found) => data.unmatched.some(u => u.guess === id && sameDir(u.dir, f.dir));
    rows = folders.map(f => {
      const owner = ownerOf(f, data.local);
      const alone = matchFolder(f, [g], {});
      const m = alone.game || alone.guess ? matchFolder(f, all, {}) : alone;
      return { f, owner, group: guessed(f) || m.guess === g ? 0 : m.game === g ? 1 : owner ? 3 : 2 };
    });
    searchLater.cancel(); renderList(); q.focus();
  }
}

/** 自己选的启动程序当成一个文件夹 */
export function fromExe(exe: string): Found {
  const dir = exe.replace(/[\\/][^\\/]*$/, "");
  const name = dir.split(/[\\/]/).pop()!;
  return { dir, name, names: [name, exe.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "")], rj: null, exes: [exe] };
}

/** 关联选中的文件夹；会换掉原来的关联时先写明换掉什么，再点一次才关联 */
let confirming: Found | null = null;
function done(f: Found, sure = false) {
  const id = gameId, g = games.get(id)!;
  const { from, owner } = replacing(id, f.dir, data.local);
  if ((from || owner) && !sure) {
    const ow = owner ? games.get(owner) : undefined;
    $("#finder-confirm-text").textContent = [
      from ? `「${nameOf(g)}」现在关联着 ${from}，会改成选中的这个文件夹。` : "",
      owner ? `选中的文件夹现在关联着「${ow ? nameOf(ow) : owner}」，会改到「${nameOf(g)}」上（原来那部的游玩记录留着）。` : "",
    ].filter(Boolean).join("");
    confirming = f;
    $("#finder-confirm").hidden = false;
    return;
  }
  const local = { ...data.local }, unmatched = data.unmatched, suspects = data.suspects, m = data.marks[id];
  linkFolder(id, f, "manual");
  save(); render();
  ($("#finder") as HTMLDialogElement).close();
  toast(`已关联：${nameOf(g)}`, () => {
    data.local = local; data.unmatched = unmatched; data.suspects = suspects;
    if (m) data.marks[id] = m; else delete data.marks[id];
    save(); render();
  });
}

export function bindFinder() {
  $("#finder-q").addEventListener("input", () => searchLater());
  $("#finder").addEventListener("close", () => { searchLater.cancel(); scan++; $("#finder-confirm").hidden = true; confirming = null; });
  $("#finder-confirm-yes").addEventListener("click", () => { if (confirming) done(confirming, true); });
  $("#finder-confirm-no").addEventListener("click", () => { $("#finder-confirm").hidden = true; confirming = null; });
  $("#finder-list").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-dir]");
    const f = b && folders.find(x => x.dir === b.dataset.dir);
    $("#finder-confirm").hidden = true;
    if (f) done(f);
  });
  $("#finder-browse").addEventListener("click", async () => {
    const exe = await open({ filters: [{ name: "启动程序", extensions: ["exe", "bat"] }] });
    if (typeof exe !== "string") return;
    done(fromExe(exe));
  });
}
