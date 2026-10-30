import { invoke } from "@tauri-apps/api/core";
import { data, save } from "./store";
import { $ } from "./ui";

// —— 360 的主动防御在运行时提醒一次「改动可能存不进硬盘」。
//    被它关进隔离沙箱的程序，读写都被改道，软件自己读回来也是沙箱里那份，从里面查不出来；只能看服务有没有在运行。
//    avNoticed 记着提醒过没有（关掉对话框就算看过）。别的窗口开着时等它关了再弹 ——

/** 该提醒就提醒：提醒过了、360 的主动防御没在运行就什么都不做 */
export async function maybeWarnAv() {
  if (data.avNoticed === true) return;
  if (!(await invoke<boolean>("av_running").catch(() => false))) return;
  show();
}

function show() {
  const dlg = $("#av-notice") as HTMLDialogElement;
  if (dlg.open) return;
  const other = [...document.querySelectorAll<HTMLDialogElement>("dialog")].find(d => d.open);
  if (other) { other.addEventListener("close", show, { once: true }); return; }
  dlg.addEventListener("close", () => { data.avNoticed = true; save(); }, { once: true });
  dlg.showModal();
}
