import { openDetail } from "./detail";
import { ALL, CATS, games, inCat, nameOf, thumbAttrs } from "./library";
import { data } from "./store";
import { pickOne, todayCandidates } from "./today";
import { $, esc, toast } from "./ui";

// —— 今天玩什么：图鉴顶上的按钮，从想玩和已有里随便挑一部（看当前分类），窗口里能「换一个」「看详情」 ——

let current = "";
const dlg = () => $("#today") as HTMLDialogElement;

/** 挑一部打开窗口；again 是「换一个」（不再挑刚才那部）。没得挑时只提示一句 */
export function openToday(again = false) {
  const list = todayCandidates(games.values(), data.marks, data.blacklist, g => inCat(g));
  const g = pickOne(list, again ? games.get(current) : undefined);
  if (!g) {
    dlg().close();
    const cat = data.ui.cat === ALL ? "" : `「${CATS.find(([k]) => k === data.ui.cat)?.[1] ?? data.ui.cat}」分类的`;
    toast(`${cat}想玩和已有里还没有能挑的作品（玩过的、黑榜里的、开发中的不算）。在作品卡片上点「想玩」或「已有」就会出现在这里。`);
    return;
  }
  current = g.id;
  const status = data.marks[g.id]?.status === "have" ? "已有" : "想玩";
  const cover = g.cover ? `<img ${thumbAttrs(g)} alt="${esc(nameOf(g))} 封面">` : `<span class="none">暂无封面</span>`;
  $("#today-body").innerHTML = `<div class="today-pick" data-id="${esc(g.id)}">
      <div class="today-cover">${cover}</div>
      <div><p class="today-name">${esc(nameOf(g))}</p><p class="hint">${status} · 从 ${list.length} 部里挑的</p><p class="hint">${esc([g.circle, g.date].filter(Boolean).join(" · "))}</p></div>
    </div>`;
  ($("#today-again") as HTMLButtonElement).disabled = list.length < 2;
  if (!dlg().open) dlg().showModal();
}

export function bindToday() {
  $("#today-btn").addEventListener("click", () => openToday());
  $("#today-again").addEventListener("click", () => openToday(true));
  $("#today-open").addEventListener("click", () => { dlg().close(); if (games.has(current)) openDetail(current); });
}
