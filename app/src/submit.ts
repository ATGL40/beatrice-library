import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { bandTag, catalogInfo, finalFor, games, genreKnown, genreLabel, nameOf, openLink, ranking } from "./library";
import { renderBatches } from "./performance";
import { submissionLists, submissionState } from "./submission";
import { makeSubmission, SUBMIT_MAIL, voteProblem } from "./marks";
import { currentTagReports, type TagReport } from "./tagreport";
import { data, save, type Game, type Vote } from "./store";
import { $, esc, toast } from "./ui";

// —— 提交给碧翠子禁书库：我的星级和神作复议票做成一个文件，用户自己贴到 GitHub 表单或发邮件；软件不联网、不替用户发送 ——

declare const __APP_VERSION__: string;
const FORM_URL = "https://github.com/ATGL40/beatrice-library-data/issues/new?template=submit-ratings.yml";
const MAIL_URL = `mailto:${SUBMIT_MAIL}?subject=${encodeURIComponent("碧翠子禁书库 评分与投票提交")}`;
/** 哪种票要写理由、至少几个字：配方里写的，没有就是反对要写、至少 20 字 */
const rule = () => ({ required: ranking.v2?.canon.reasonRequired ?? "oppose", min: ranking.v2?.canon.reasonMinChars ?? 20 });
/** 这次不提交的星级、黑榜作品、识别报告（报告按序号）、标签报告（只在内存里，每次打开都是全选） */
const skip = new Set<string>(), skipBlack = new Set<string>(), skipRecog = new Set<number>(), skipTags = new Set<string>();
/** 勾着的识别报告 */
const reports = () => data.reports.filter((_, i) => !skipRecog.has(i));
const dlg = () => $("#submit") as HTMLDialogElement;
let lists: { rated: Game[]; votes: Game[]; black: Game[]; tagged: Game[] } = { rated: [], votes: [], black: [], tagged: [] };
/** 按现在的资料筛过的标签报告（每次打开算一次） */
let tags: Record<string, TagReport> = {};
let stopRatings = () => {}, stopVotes = () => {}, stopBlack = () => {};
const state = () => submissionState(lists, data.marks, data.votes, skip, rule(), data.blacklist, skipBlack, tags, skipTags);

/** 要提交的内容：勾着的星级、现在还是神作 / 神作提名的作品的票、勾着的黑榜、识别报告和标签报告 */
function file() {
  const s = state();
  return makeSubmission(__APP_VERSION__, catalogInfo.updated, s.ratings, s.votes, rule(), s.blacklist, reports(), s.tags);
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
    <small class="err">${esc(v ? voteProblem(v, rule()) : "")}</small></li>`;
}

/** 每张票的提示和按钮状态（打字时只更新这些，不重画列表） */
function check(id?: string) {
  const f = state(), bad = f.problems.size;
  if (id) {
    const err = document.querySelector(`#submit-votes [data-vote-id="${CSS.escape(id)}"] .err`);
    if (err) err.textContent = f.problems.get(id) ?? "";
  }
  const n = Object.keys(f.ratings).length, nv = Object.keys(f.votes).length, nb = Object.keys(f.blacklist).length, nr = reports().length, nt = Object.keys(f.tags).length;
  $("#submit-summary").textContent = bad ? `有 ${bad} 张票还没写够理由，改好后才能导出。` : `将提交 ${n} 部的星级${nv ? `、${nv} 张票` : ""}${nb ? `、黑榜 ${nb} 部` : ""}${nr ? `、${nr} 条识别报告` : ""}${nt ? `、${nt} 部的标签报告` : ""}。`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#submit [data-out]")) b.disabled = !!bad || !(n + nv + nb + nr + nt);
}

function renderSubmit(focus?: string) {
  stopRatings(); stopVotes(); stopBlack();
  tags = currentTagReports(data.tagReports, games, genreKnown);
  lists = submissionLists(games, data.marks, ranking.voteIds, ranking.finals, nameOf, data.blacklist, tags);
  const rs = $("#submit-ratings"), vs = $("#submit-votes"), bs = $("#submit-black");
  rs.innerHTML = lists.rated.length ? "" : `<li class="hint">还没有打过星的作品。</li>`;
  vs.innerHTML = lists.votes.length ? "" : `<li class="hint">现在没有神作或神作提名的作品。</li>`;
  bs.innerHTML = lists.black.length ? "" : `<li class="hint">黑榜是空的。</li>`;
  // 识别报告：每条一行，写出要提交的内容（文件夹、启动程序、标题，认成了哪部、应该是哪部）
  const name = (id?: string) => { const g = id ? games.get(id) : undefined; return g ? nameOf(g) : id ?? ""; };
  $("#submit-recog").innerHTML = data.reports.length ? data.reports.map((r, i) => `<li><label><input type="checkbox" data-recog="${i}"${skipRecog.has(i) ? "" : " checked"} />
      <span class="path">${esc(r.folder)}</span><small>${esc([r.exes.join("、"), r.titles.join("、")].filter(Boolean).join(" · "))}</small>
      <small>${esc(`${r.matched ? `认成「${name(r.matched)}」` : "没认出"}${r.correct ? `，应该是「${name(r.correct)}」` : ""}`)}</small></label></li>`).join("")
    : `<li class="hint">还没有识别报告（作品菜单里的「认错了 / 报告」、没认出的文件夹的「不是」会记下）。</li>`;
  // 标签报告：每部一行，写出不对的、少了的标签和说明（要提交的就是这些）
  const labels = (ids: string[]) => ids.map(genreLabel).join("、");
  $("#submit-tags").innerHTML = lists.tagged.length ? lists.tagged.map(g => {
    const r = tags[g.id], what = [r.wrong.length ? `不对：${labels(r.wrong)}` : "", r.missing.length ? `少了：${labels(r.missing)}` : "", r.note ?? ""];
    return `<li><label><input type="checkbox" data-tags="${esc(g.id)}"${skipTags.has(g.id) ? "" : " checked"} />
      <span class="path">${esc(nameOf(g))}</span><small>${esc(what.filter(Boolean).join(" · "))}</small></label></li>`;
  }).join("")
    : `<li class="hint">还没有标签报告（作品详情页题材旁的「标签不对？」会记下）。</li>`;
  // 黑榜：每部一行，理由写在名字下面（要提交的就是这些字）
  stopBlack = renderBatches(lists.black, part => bs.insertAdjacentHTML("beforeend", part.map(g => {
    const reason = (data.blacklist[g.id]?.reason ?? "").trim();
    return `<li><label><input type="checkbox" data-black="${esc(g.id)}"${skipBlack.has(g.id) ? "" : " checked"} />
      <span class="path">${esc(nameOf(g))}</span><small>${reason ? esc(reason) : "（没写理由）"}</small></label></li>`;
  }).join("")));
  stopRatings = renderBatches(lists.rated, part => rs.insertAdjacentHTML("beforeend", part.map(g =>
    `<li><label><input type="checkbox" data-rate="${esc(g.id)}"${skip.has(g.id) ? "" : " checked"} />
      <span class="path">${esc(nameOf(g))}</span><small>${"★".repeat(data.marks[g.id].score)}</small></label></li>`).join("")));
  stopVotes = renderBatches(lists.votes, part => {
    vs.insertAdjacentHTML("beforeend", part.map(voteRow).join(""));
    if (focus && part.some(g => g.id === focus)) {
      vs.querySelector(`[data-vote-id="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
    }
  });
  check();
}

/** 打开提交窗口；从详情页打开时滚到那部作品的投票 */
export function openSubmit(focus?: string) {
  skip.clear(); skipBlack.clear(); skipRecog.clear(); skipTags.clear();
  if (!dlg().open) dlg().showModal();
  renderSubmit(focus);
}

const text = () => JSON.stringify(file(), null, 1);

export function bindSubmit() {
  dlg().addEventListener("close", () => { stopRatings(); stopVotes(); stopBlack(); });
  $("#submit-black").addEventListener("change", e => {
    const id = (e.target as HTMLInputElement).dataset.black;
    if (!id) return;
    if ((e.target as HTMLInputElement).checked) skipBlack.delete(id); else skipBlack.add(id);
    check();
  });
  $("#submit-recog").addEventListener("change", e => {
    const i = (e.target as HTMLInputElement).dataset.recog;
    if (i === undefined) return;
    if ((e.target as HTMLInputElement).checked) skipRecog.delete(Number(i)); else skipRecog.add(Number(i));
    check();
  });
  $("#submit-tags").addEventListener("change", e => {
    const id = (e.target as HTMLInputElement).dataset.tags;
    if (!id) return;
    if ((e.target as HTMLInputElement).checked) skipTags.delete(id); else skipTags.add(id);
    check();
  });
  $("#open-submit").addEventListener("click", () => openSubmit());
  // 「分数是怎么算的」窗口最后的「想参与」：关掉说明，打开提交窗口
  $("#score-help-submit").addEventListener("click", () => { ($("#score-help") as HTMLDialogElement).close(); openSubmit(); });
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
    save(); check(id);
  });
  votes.addEventListener("input", e => {
    const a = e.target as HTMLTextAreaElement, id = a.closest<HTMLElement>("[data-vote-id]")?.dataset.voteId;
    if (a.tagName !== "TEXTAREA" || !id || !data.votes[id]) return;
    data.votes[id].reason = a.value;
    save(); check(id);
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
