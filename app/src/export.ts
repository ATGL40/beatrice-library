import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { APP_NAME, games, markBits, nameOf } from "./library";
import { exportable, filterMarks, makeMarksFile, marksHtml, withTiers } from "./marks";
import { score } from "./search";
import { data, KINDS, save, type Kind } from "./store";
import { $, esc, toast } from "./ui";

// —— 导出我的评分：按类型、按作品挑，导出前提醒；可以导出成网页（浏览器能看）或数据文件 ——

/** 名字放进默认文件名前，去掉 Windows 文件名里不能用的字符 */
export const fileSafe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "我";

/** 自己的标记加上梯度表的档位（导出时一起算） */
const myMarks = () => withTiers(data.marks, data.tiers);
const titleOf = (id: string) => (games.has(id) ? nameOf(games.get(id)!) : id);

function renderFormat() {
  for (const r of document.querySelectorAll<HTMLInputElement>("#export-format input")) r.checked = r.value === data.export.format;
}

function renderKinds() {
  $("#export-kinds").innerHTML = KINDS.map(([k, label]) =>
    `<label class="check"><input type="checkbox" data-kind="${k}"${data.export.kinds.includes(k) ? " checked" : ""} /> ${label}</label>`).join("");
}

function renderList() {
  const q = ($("#export-q") as HTMLInputElement).value.trim();
  const all = exportable(myMarks(), data.export.kinds);
  const list = Object.entries(all)
    .map(([id, m]) => {
      const g = games.get(id);
      const texts = g ? [g.title, g.names?.zh, g.names?.en, g.names?.ja, g.circle].filter(Boolean) as string[] : [id];
      return [id, m, score(q, texts)] as const;
    })
    .filter(([, , s]) => s > 0)
    .sort((a, b) => b[2] - a[2] || titleOf(a[0]).localeCompare(titleOf(b[0])));
  $("#export-list").innerHTML = list.length
    ? list.map(([id, m]) => {
        const off = data.export.skip.includes(id);
        const bits = [markBits(m), m.note ? "评论" : ""].filter(Boolean).join(" · ");
        return `<li class="${off ? "off" : ""}"><label><input type="checkbox" data-game="${esc(id)}"${off ? "" : " checked"} />
          <span class="path">${esc(titleOf(id))}</span><small>${esc(bits)}</small></label></li>`;
      }).join("")
    : `<li class="hint">${Object.keys(all).length ? "没有符合搜索的作品。" : "按现在选的类型，没有可以导出的内容。"}</li>`;
  const out = filterMarks(myMarks(), data.export.kinds, data.export.skip);
  const n = Object.keys(out).length, notes = Object.values(out).filter(m => m.note).length;
  const skipped = Object.keys(all).length - n;
  $("#export-summary").textContent = `将导出 ${n} 部作品${notes ? `（其中 ${notes} 条评论）` : ""}${skipped ? `，取消了 ${skipped} 部` : ""}。`;
  ($("#export-go") as HTMLButtonElement).disabled = !n;
}

export function openExport() {
  ($("#export-q") as HTMLInputElement).value = "";
  renderFormat();
  renderKinds();
  renderList();
  ($("#export") as HTMLDialogElement).showModal();
}

async function doExport() {
  const name = data.myName || "我";
  const file = makeMarksFile(myMarks(), data.export.kinds, data.export.skip, name, new Date().toISOString().slice(0, 10));
  const marks = file.marks;
  const html = data.export.format === "html";
  const ext = html ? "html" : "json";
  const path = await saveDialog({
    defaultPath: `${fileSafe(name)}的评分.${html ? "html" : "beatrice.json"}`,
    filters: [{ name: html ? "网页" : "评分文件", extensions: [ext] }],
  });
  if (!path) return;
  const text = html
    ? marksHtml(file, id => {
        const g = games.get(id);
        return { name: titleOf(id), orig: g ? g.names?.ja || g.title : "" };
      }, APP_NAME[data.ui.lang])
    : JSON.stringify(file, null, 1);
  await invoke("write_json_file", { path, text });
  ($("#export") as HTMLDialogElement).close();
  toast(`已导出 ${Object.keys(marks).length} 部的评分`);
}

export function bindExport() {
  $("#export-kinds").addEventListener("change", e => {
    const k = (e.target as HTMLInputElement).dataset.kind as Kind;
    if (!k) return;
    const on = (e.target as HTMLInputElement).checked;
    data.export.kinds = KINDS.map(([x]) => x).filter(x => (x === k ? on : data.export.kinds.includes(x)));
    save(); renderList();
  });
  $("#export-format").addEventListener("change", e => {
    data.export.format = (e.target as HTMLInputElement).value === "json" ? "json" : "html";
    save();
  });
  $("#export-q").addEventListener("input", renderList);
  $("#export-list").addEventListener("change", e => {
    const id = (e.target as HTMLInputElement).dataset.game;
    if (!id) return;
    const skip = data.export.skip.filter(x => x !== id);
    if (!(e.target as HTMLInputElement).checked) skip.push(id);
    data.export.skip = skip;
    save(); renderList();
  });
  $("#export-go").addEventListener("click", () => doExport().catch(e => toast(`导出失败：${e}`)));
}
