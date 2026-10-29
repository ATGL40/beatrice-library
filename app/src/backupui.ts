import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { autoBackupName, backupFileName, fromBase64, isPng, makeBackup, parseBackup, summarize, toBase64, type Backup } from "./backup";
import type { Custom } from "./custom";
import { data, type Data } from "./store";
import { $, esc, toast } from "./ui";

// —— 设置 → 备份：「导出全部数据」「从备份恢复」 ——

declare const __APP_VERSION__: string; // vite.config.ts 里从 package.json 取的版本号
const appVersion = () => (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "");
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dirOf = async () => (await appDataDir()).replace(/[\\/]+$/, "");
const sepOf = (dir: string) => (dir.includes("\\") ? "\\" : "/");

/** 现在的全部数据做成备份：我的游戏的封面用 read_custom_cover 读进来（读不到的记下名字） */
async function backupNow(): Promise<Backup> {
  const covers: Record<string, string> = {}, missing: string[] = [];
  for (const c of Object.values(data.custom)) {
    if (!c.cover || c.cover in covers) continue;
    try { covers[c.cover] = toBase64(new Uint8Array(await invoke<ArrayBuffer>("read_custom_cover", { name: c.cover }))); }
    catch { missing.push(c.cover); }
  }
  return makeBackup(structuredClone(data), appVersion(), new Date().toISOString(), covers, missing);
}

/** 「导出全部数据」：选保存位置，写一个 .json */
export async function exportAll() {
  const backup = await backupNow();
  const path = await saveDialog({ defaultPath: backupFileName(localDay()), filters: [{ name: "全部数据备份", extensions: ["json"] }] });
  if (!path) return;
  await invoke("write_json_file", { path, text: JSON.stringify(backup, null, 1) });
  const n = backup.missingCovers?.length;
  toast(n ? `已导出全部数据；有 ${n} 张封面没读到，要自己复制 custom-covers 文件夹` : "已导出全部数据。文件里有你的文件夹路径和评分，不要发给别人");
}

// —— 从备份恢复：选文件 → 看看会换掉什么 → 先自动备份现在的数据 → 换上、重新载入 ——
let pending: Backup | null = null;

/** 恢复窗口的内容（单独拆出来，方便测试） */
export function restoreHtml(b: Backup, now: Record<string, unknown>) {
  const when = b.date ? new Date(b.date) : null;
  const info = [when && !isNaN(+when) ? `备份时间 ${localDay(when)} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}` : "", b.app ? `软件版本 ${b.app}` : ""].filter(Boolean).join(" · ");
  const a = summarize(now), z = summarize(b.data);
  const rows = a.map(([label, n], i) => `<tr><th>${esc(label)}</th><td>${n}</td><td>${z[i][1]}</td></tr>`).join("");
  const covers = Object.keys(b.covers).length, missing = b.missingCovers?.length ?? 0;
  return `<p class="hint">${esc(info || "备份文件")}${covers ? ` · 带 ${covers} 张我的游戏封面` : ""}</p>
    <table class="restore-table"><thead><tr><th></th><th>现在</th><th>备份里</th></tr></thead><tbody>${rows}</tbody></table>
    ${missing ? `<p class="hint">备份里少了 ${missing} 张我的游戏封面（做备份时没读到），恢复后这些作品可能没有封面，可以自己把封面复制进 custom-covers 文件夹。</p>` : ""}
    <p class="warn">恢复会用备份里的数据换掉现在的全部数据：标记、评分、评论、黑榜、关联、我的游戏、梯度表、设置都按备份来。换之前会先把现在的数据自动备份到备份文件夹（restore-before-日期-时间.json，不会被每天的自动备份删掉），恢复完软件会重新载入。</p>`;
}

/** 「从备份恢复」：选文件，检查过再打开确认窗口 */
export async function pickRestore() {
  const path = await open({ filters: [{ name: "全部数据备份", extensions: ["json"] }] });
  if (typeof path !== "string") return;
  const r = parseBackup(await invoke<string>("read_json_file", { path }));
  if (!r.backup) { toast(`没有恢复：${r.error}`); return; }
  pending = r.backup;
  $("#restore-body").innerHTML = restoreHtml(r.backup, data as unknown as Record<string, unknown>);
  ($("#restore") as HTMLDialogElement).showModal();
}

/** 换成 PNG：后端只能直接写 PNG（write_png），jpg / webp 在这里画一遍 */
async function pngOf(bytes: Uint8Array): Promise<Uint8Array> {
  if (isPng(bytes)) return bytes;
  const img = await createImageBitmap(new Blob([bytes as BlobPart]));
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("封面转换失败");
  return new Uint8Array(await blob.arrayBuffer());
}
const writePng = (path: string, bytes: Uint8Array) => invoke("write_png", bytes, { headers: { path: encodeURIComponent(path) } });

/**
 * 把备份里的封面放回 custom-covers：本机已经有一模一样的就不动；不然写成 <id>.png，封面文件名跟着改。
 * custom-covers 文件夹还没有时（新电脑），先写到数据文件夹里的 custom-cover-restore.png，再交给 import_custom_cover 复制进去（它会建文件夹）。
 * 返回没放回去的张数（这些作品去掉封面，显示「暂无封面」）
 */
async function restoreCovers(b: Backup, custom: Record<string, Custom>, dir: string): Promise<number> {
  const sep = sepOf(dir);
  let failed = 0;
  for (const [id, c] of Object.entries(custom)) {
    const b64 = c.cover ? b.covers[c.cover] : undefined;
    if (!c.cover || !b64) continue;
    try {
      const here = toBase64(new Uint8Array(await invoke<ArrayBuffer>("read_custom_cover", { name: c.cover })));
      if (here === b64) continue;
    } catch { /* 本机没有这张，下面写 */ }
    try {
      const png = await pngOf(fromBase64(b64));
      try { await writePng([dir, "custom-covers", `${id}.png`].join(sep), png); c.cover = `${id}.png`; }
      catch {
        const tmp = [dir, "custom-cover-restore.png"].join(sep);
        await writePng(tmp, png);
        c.cover = await invoke<string>("import_custom_cover", { path: tmp, id });
      }
      c.coverVersion = Date.now();
    } catch {
      delete c.cover; delete c.coverVersion;
      failed++;
    }
  }
  return failed;
}

/** 确认以后：先备份现在的数据（备份文件夹写不进就写在数据文件夹里，都不行就不恢复），放回封面，换上数据，写盘，重新载入 */
export async function doRestore() {
  const b = pending;
  if (!b) return;
  const dir = await dirOf(), sep = sepOf(dir), name = autoBackupName(new Date());
  const mine = JSON.stringify(await backupNow(), null, 1);
  let saved = "";
  for (const p of [[dir, "backups", name], [dir, name]].map(x => x.join(sep))) {
    try { await invoke("write_json_file", { path: p, text: mine }); saved = p; break; } catch { /* 换下一个位置 */ }
  }
  if (!saved) { toast("没能先备份现在的数据，这次没有恢复"); return; }
  const next = structuredClone(b.data) as unknown as Data;
  const custom = (next.custom && typeof next.custom === "object" ? next.custom : {}) as Record<string, Custom>;
  const failed = await restoreCovers(b, custom, dir);
  const before = structuredClone(data);
  // 先换内存里的（之前排着的自动保存写的也是新的），再马上写盘
  for (const k of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[k];
  Object.assign(data, next);
  try { await invoke("write_data", { text: JSON.stringify(data, null, 1) }); }
  catch (e) {
    for (const k of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[k];
    Object.assign(data, before);
    toast(`恢复失败，数据没有改：${e}`);
    return;
  }
  pending = null;
  ($("#restore") as HTMLDialogElement).close();
  toast(failed ? `已恢复，${failed} 张封面没放回去；正在重新载入…` : "已恢复，正在重新载入…");
  location.reload();
}

export function bindBackup() {
  $("#export-all").addEventListener("click", () => exportAll().catch(e => toast(`导出失败：${e}`)));
  $("#restore-all").addEventListener("click", () => pickRestore().catch(e => toast(`读不了备份文件：${e}`)));
  $("#restore-go").addEventListener("click", () => doRestore().catch(e => toast(`恢复失败：${e}`)));
}
