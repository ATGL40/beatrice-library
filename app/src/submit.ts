import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { bandTag, catalogInfo, finalFor, games, nameOf, openLink, ranking } from "./library";
import { cmpFinal } from "./scoring2";
import { makeSubmission, SUBMIT_MAIL, voteProblem } from "./marks";
import { data, save, type Game, type Vote } from "./store";
import { $, esc, toast } from "./ui";

// —— 提交给碧翠子禁书库：我的星级和神作复议票做成一个文件，用户自己贴到 GitHub 表单或发邮件；软件不联网、不替用户发送 ——

declare const __APP_VERSION__: string;
const FORM_URL = "https://github.com/ATGL40/beatrice-library-data/issues/new?template=submit-ratings.yml";
const MAIL_URL = `mailto:${SUBMIT_MAIL}?subject=${encodeURIComponent("碧翠子禁书库 评分与投票提交")}`;
/** 哪种票要写理由、至少几个字：配方里写的，没有就是反对要写、至少 20 字 */
const rule = () => ({ required: ranking.v2?.canon.reasonRequired ?? "oppose", min: ranking.v2?.canon.reasonMinChars ?? 20 });
/** 这次不提交的星级（只在内存里，每次打开都是全选） */
const skip = new Set<string>();
const dlg = () => $("#submit") as HTMLDialogElement;

/** 我打过星的作品（我的游戏不算） */
const rated = () => Object.entries(data.marks)
  .filter(([id, m]) => m.score >= 1 && m.score <= 5 && games.get(id) && games.get(id)!.src !== "local")
  .map(([id]) => games.get(id)!)
  .sort((a, b) => data.marks[b.id].score - data.marks[a.id].score || nameOf(a).localeCompare(nameOf(b)));
/** 可以投票的：神作和神作提名 */
const voteGames = () => [...games.values()].filter(g => { const f = finalFor(g); return !!f && (!!f.canon || f.nominee); })
  .sort((a, b) => cmpFinal(finalFor(a)!, finalFor(b)!));

/** 要提交的内容：勾着的星级，和现在还是神作 / 神作提名的作品的票 */
function file() {
  const ratings = Object.fromEntries(rated().filter(g => !skip.has(g.id)).map(g => [g.id, data.marks[g.id].score]));
  const votes = Object.fromEntries(voteGames().filter(g => data.votes[g.id]).map(g => [g.id, data.votes[g.id]]));
  return makeSubmission(__APP_VERSION__, catalogInfo.updated, ratings, votes, rule());
}

const reasonHint = () => {
  const { required, min } = rule();
  return required === "all" ? `理由：都要写，至少 ${min} 字` : required === "none" ? "理由：可以不写" : `理由：反对要写，至少 ${min} 字；支持可以不写`;
};

function voteRow(g: Game) {
  const v: Vote | undefined = data.votes[g.id], f = finalFor(g)!;
  const radio = (val: string, label: string) =>
    `<label class="check"><input type="radio" name="vote-${esc(g.id)}" value="${val}"${(v?.vote ?? "") === val ? " checked" : ""} /> ${label}</label>`;
  return `<li data-vote-id="${esc(g.id)}"><div><b>${esc(nameOf(g))}</b> ${bandTag(f)}</div>
    <div class="kinds">${radio("support", "支持")}${radio("oppose", "反对")}${radio("", "不投")}</div>
    <textarea rows="2" maxlength="2000" placeholder="${esc(reasonHint())}"${v ? "" : " disabled"}>${esc(v?.reason ?? "")}</textarea>
    <small class="err"></small></li>`;
}

/** 每张票的提示和按钮状态（打字时只更新这些，不重画列表） */
function check() {
  let bad = 0;
  for (const li of document.querySelectorAll<HTMLElement>("#submit-votes [data-vote-id]")) {
    const v = data.votes[li.dataset.voteId!], p = v ? voteProblem(v, rule()) : "";
    li.querySelector(".err")!.textContent = p;
    if (p) bad++;
  }
  const f = file(), n = Object.keys(f.ratings).length, nv = Object.keys(f.votes).length;
  $("#submit-summary").textContent = bad ? `有 ${bad} 张票还没写够理由，改好后才能导出。` : `将提交 ${n} 部的星级${nv ? `、${nv} 张票` : ""}。`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#submit [data-out]")) b.disabled = !!bad || !(n + nv);
}

function renderSubmit() {
  const rs = rated();
  $("#submit-ratings").innerHTML = rs.length
    ? rs.map(g => `<li><label><input type="checkbox" data-rate="${esc(g.id)}"${skip.has(g.id) ? "" : " checked"} />
        <span class="path">${esc(nameOf(g))}</span><small>${"★".repeat(data.marks[g.id].score)}</small></label></li>`).join("")
    : `<li class="hint">还没有打过星的作品。</li>`;
  const vs = voteGames();
  $("#submit-votes").innerHTML = vs.length ? vs.map(voteRow).join("") : `<li class="hint">现在没有神作或神作提名的作品。</li>`;
  check();
}

/** 打开提交窗口；从详情页打开时滚到那部作品的投票 */
export function openSubmit(focus?: string) {
  skip.clear();
  renderSubmit();
  if (!dlg().open) dlg().showModal();
  if (focus) document.querySelector(`#submit-votes [data-vote-id="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
}

const text = () => JSON.stringify(file(), null, 1);

export function bindSubmit() {
  $("#open-submit").addEventListener("click", () => openSubmit());
  $("#submit-ratings").addEventListener("change", e => {
    const id = (e.target as HTMLInputElement).dataset.rate;
    if (!id) return;
    if ((e.target as HTMLInputElement).checked) skip.delete(id); else skip.add(id);
    check();
  });
  const votes = $("#submit-votes");
  votes.addEventListener("change", e => {
    const r = e.target as HTMLInputElement, li = r.closest<HTMLElement>("[data-vote-id]");
    if (r.type !== "radio" || !li) return;
    const id = li.dataset.voteId!, area = li.querySelector("textarea")!;
    // 选「不投」就删掉这张票；理由框里的字留着，换回来还在
    if (r.value === "support" || r.value === "oppose") data.votes[id] = { ...data.votes[id], vote: r.value, reason: area.value };
    else delete data.votes[id];
    area.disabled = !data.votes[id];
    save(); check();
  });
  votes.addEventListener("input", e => {
    const a = e.target as HTMLTextAreaElement, id = a.closest<HTMLElement>("[data-vote-id]")?.dataset.voteId;
    if (a.tagName !== "TEXTAREA" || !id || !data.votes[id]) return;
    data.votes[id].reason = a.value;
    save(); check();
  });
  $("#submit-save").addEventListener("click", async () => {
    try {
      const path = await saveDialog({ defaultPath: `碧翠子禁书库提交-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "提交文件", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_json_file", { path, text: text() });
      toast("已保存提交文件");
    } catch (e) { toast(`保存失败：${e}`); }
  });
  $("#submit-copy").addEventListener("click", () =>
    navigator.clipboard.writeText(text()).then(() => toast("已复制，可以粘贴到 GitHub 表单或邮件里"), e => toast(`复制失败：${e}`)));
  $("#submit-form").addEventListener("click", () => openLink(FORM_URL));
  $("#submit-mail").addEventListener("click", () => openLink(MAIL_URL));
}
