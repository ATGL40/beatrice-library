import { bindDetail } from "./detail";
import { bindExport } from "./export";
import { bindFinder } from "./finder";
import { bindRank } from "./rank";
import { bindLibrary, render, setCatalog } from "./library";
import { bindSettings } from "./settings";
import { load, loadCatalog } from "./store";
import { $, toast } from "./ui";

async function boot() {
  const broken = await load();
  setCatalog(await loadCatalog());
  bindLibrary();
  bindSettings();
  bindFinder();
  bindDetail();
  bindExport();
  bindRank();
  render();
  if (broken) toast(broken);
}

boot().catch(e => {
  $("#list").innerHTML = `<p class="empty">启动出错：${String(e)}</p>`;
});
