import { bindDetail } from "./detail";
import { bindExport } from "./export";
import { bindFinder } from "./finder";
import { bindRank } from "./rank";
import { bindLibrary, initMyGames, render, setCatalog } from "./library";
import { bindMisrecog } from "./misrecog";
import { bindMyGames } from "./mygames";
import { bindSettings } from "./settings";
import { bindSubmit } from "./submit";
import { bindToTop } from "./totop";
import { load, loadCatalog } from "./store";
import { $, toast } from "./ui";

async function boot() {
  const broken = await load();
  await initMyGames();
  setCatalog(await loadCatalog());
  bindLibrary();
  bindSettings();
  bindFinder();
  bindDetail();
  bindExport();
  bindSubmit();
  bindMyGames();
  bindMisrecog();
  bindRank();
  bindToTop();
  render();
  if (broken) toast(broken);
}

boot().catch(e => {
  $("#list").innerHTML = `<p class="empty">启动出错：${String(e)}</p>`;
});
