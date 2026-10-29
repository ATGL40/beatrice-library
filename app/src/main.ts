import { bindBackup } from "./backupui";
import { bindDetail } from "./detail";
import { bindExport } from "./export";
import { bindFinder } from "./finder";
import { bindRank } from "./rank";
import { bindToday } from "./todayui";
import { bindLibrary, initMyGames, render, setCatalog } from "./library";
import { bindMisrecog } from "./misrecog";
import { bindMyGames } from "./mygames";
import { bindNews, noteCatalog } from "./newsui";
import { bindSettings } from "./settings";
import { bindSubmit } from "./submit";
import { bindToTop } from "./totop";
import { load, loadCatalog } from "./store";
import { $, toast } from "./ui";

async function boot() {
  const broken = await load();
  await initMyGames();
  const cat = await loadCatalog();
  setCatalog(cat);
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
  bindNews();
  bindBackup();
  bindToday();
  render();
  if (broken) toast(broken);
  // 资料比上次看过的新（比如软件自带的资料更新了）：弹资料更新小结
  noteCatalog(cat);
}

boot().catch(e => {
  $("#list").innerHTML = `<p class="empty">启动出错：${String(e)}</p>`;
});
