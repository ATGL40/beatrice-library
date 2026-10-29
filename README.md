# 碧翠子禁书库 · Beatrice Library

一个 Windows 桌面软件，用来浏览和管理自己收藏的同人 / 视觉小说类成人游戏（DLsite 上的 RPG、ADV、SLG、动作等）。它是一本离线的作品图鉴：看作品资料和排行，把电脑里的游戏文件夹和作品对上，一键启动，记下自己的标记、评分和评论。只做浏览和管理，不做多余的功能。

> 本软件只面向成年人。

## 功能

- **作品图鉴**：按分类（女主 RPG / 男主 RPG / ADV / SLG / 动作 / 其他）和年份浏览（按年份分组，年份跳转条一点就到），搜索，按 DLsite 题材标签筛选，按综合榜的档（神作、超大杯、大杯……、评价不足）筛选，按发售日、DLsite 评分、销量、我的评分、朋友评分、综合排名、名字、最近游玩、游玩时长排序（分组时每年里按选的排序排）；作品名可切换中文 / English / 日本語。详情页列出同社团的其他作品。
- **扫描游戏文件夹**：只在有把握时自动认出是哪部作品——文件夹名、启动程序名里的 RJ 号，或者引擎文件里写的标题、文件夹名和作品全名完全一样；拿不准的列出「可能是…」和原因，一键确认，也可以手动关联；一部作品只关联一个文件夹，不会自动换。认错了可以在作品菜单里点「认错了 / 报告」改过来，记下的识别报告（只有相对路径、启动程序名、标题，不含盘符和用户名）可以随评分一起提交，帮着改识别规则。
- **一键启动**：自动挑启动程序，猜错了可以换；可选用 MTool 生成的启动器启动，或用你指定的 Locale Emulator（LEProc.exe）转区启动。从软件启动的游戏会记下游玩时长和最后游玩时间。
- **我的标记**：想玩 / 已有 / 玩过、收藏、1～5 星、我的评论；不推荐的作品放进自己的黑榜（可以写理由，可以在图鉴里隐藏，不改分数）。
- **梯度表**：夯 / 顶级 / 人上人 / NPC / 拉完了五档，拖动排序，可导出成 PNG 图片。
- **排行榜**：民间榜单，以及按口碑、热度、上榜情况算出的图鉴综合榜、评分高但评价人数还少的冷门佳作榜（算法见 [方案.md](方案.md)）。分数是汇总各社区玩家评价的参考，不是定论：可能出错，不高不代表不好玩。
- **评分文件**：把自己的评分导出成 `.html` 或 `.beatrice.json` 发给朋友；导入朋友的评分并排显示，或者把自己的备份合并回来。
- **数据包**：导入 `.zip` 数据包更新作品资料和封面，不用重装软件。
- **自动备份**：每天第一次打开时备份数据，保留最近 7 天。

## 安全和隐私

- 软件本身**不联网**：页面有严格的内容安全策略，唯一的对外动作是把 https 商店页交给系统浏览器打开。
- **不读你的其他数据**：扫描游戏文件夹时只看文件夹名和 exe 文件名，只读游戏文件夹里这几个固定名字的文件来取标题（每个最多 64 KB，只读不写）：`Game.ini`（RPG Maker XP/VX/VX Ace、WOLF RPG Editor）、`package.json`、`www/package.json`、`resources/app/package.json`（RPG Maker MV/MZ、Electron）、`<名字>_Data/app.info`（Unity）、`game/options.rpy`（Ren'Py）、`data/system/Config.tjs`、`system/Config.tjs`（KiriKiri / TyranoScript）。
- **游玩时长只统计从软件启动的游戏**：启动时把它放进一个 Windows 作业对象，等它（和它启动的进程）退出后记下秒数；不看、不枚举电脑上的其他进程。Locale Emulator 只用你手动选的 `LEProc.exe`，软件不会自己去找。
- 所有数据只存在本机（`%APPDATA%\com.beatricelibrary.app\`）。
- 作品资料只靠你手动导入的数据包更新，导入前会检查格式、大小和文件名。

## 作品资料

作品资料单独放在 [beatrice-library-data](https://github.com/ATGL40/beatrice-library-data) 仓库里维护，数据包在它的 Releases 里下载，资料来源和授权也写在那边。

软件自带的作品目录（`app/public/catalog.json`）是发布时从 beatrice-library-data 复制过来的快照，**只有文字**：作品名、社团、发售日期、DLsite 评分和销量、民间榜单等，**不含封面图片**，界面上显示「暂无封面」。目前收录 1,663 部作品、30 份榜单，资料日期 2026-10-29。资料有错请到 beatrice-library-data 提，不要改这里的副本。

带封面的完整资料用数据包导入：**设置 → 作品资料 → 导入数据包**。数据包格式写在 [接口.md](接口.md) 里。

## 数据来源

自带的资料快照来自下面这些网站（详见 [beatrice-library-data](https://github.com/ATGL40/beatrice-library-data)）：

- 作品资料（名字、社团、日期、评分、销量、商店链接）：[DLsite](https://www.dlsite.com/)
- 民间榜单：[ErogameScape -エロゲー批評空間-](https://erogamescape.dyndns.org/)（批评空间）的年度中央值排行；[VNDB (The Visual Novel Database)](https://vndb.org/) 的评分排行。
- VNDB 的数据采用 [Open Database License (ODbL)](https://vndb.org/d17) 授权，使用时请注明出处。

各网站的资料版权归原网站和作品权利人所有。

## 从源码构建

需要：

- [Node.js](https://nodejs.org/)（LTS）
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- [Tauri 2 的 Windows 前置条件](https://v2.tauri.app/start/prerequisites/)（Microsoft C++ Build Tools、WebView2）

```sh
cd app
npm ci
npx tauri dev      # 开发模式运行
npx tauri build    # 打包安装程序（NSIS），输出在 app/src-tauri/target/release/bundle/
```

## 测试

```sh
cd app
node --test tests/*.test.mjs   # 前端逻辑（需要 Node 23.6+ 或 22.18+，能直接载入 .ts）
npx tsc --noEmit               # 类型检查
cd src-tauri
cargo test                     # 后端
```

## 名字

名字来自《Re:从零开始的异世界生活》里守护禁书库的碧翠子（Beatrice）。

## 许可

[MIT](LICENSE) © 2026 ATGL40

---

## English

**Beatrice Library** is a Windows desktop app (Tauri 2) for browsing and managing a personal collection of adult doujin / visual-novel games. It is an offline catalog: browse works and rankings, link the game folders on your PC to catalog entries, launch games in one click, and keep your own marks, ratings, notes and a tier list. It does browsing and managing only — no extra features. For adults only.

**Features:** catalog by category and year with search, DLsite genre-tag filtering and sorting (Chinese / English / Japanese titles); works by the same circle on the detail page; folder scanning by RJ code or title, with manual linking (one folder per work, never relinked automatically); one-click launch (optional MTool launcher, or Locale Emulator via a user-chosen LEProc.exe) with play time and last-played tracking; marks, favourites, 1–5 stars and notes; a five-tier list exportable as PNG; community rankings and a composite ranking; export/import of rating files to share with friends; data packs to update the catalog; daily automatic backups.

**Security and privacy:** the app never goes online by itself (strict CSP; https store links are only handed to the system browser), reads no other user data (scanning looks at folder and exe names plus the title in a few well-known engine files inside each game folder — Game.ini, package.json, *_Data/app.info, game/options.rpy, Config.tjs — read-only, 64 KB at most), measures play time only for games it launched itself (the process goes into a Windows Job Object and the app waits for it to exit; no other processes are inspected), keeps all data locally in `%APPDATA%\com.beatricelibrary.app\`, and the catalog is updated only by data packs you import by hand.

**Catalog:** catalog data lives in its own repo, [beatrice-library-data](https://github.com/ATGL40/beatrice-library-data); download data packs from its Releases. The bundled `app/public/catalog.json` is a snapshot copied from that repo at release time — text only (titles, circles, dates, DLsite ratings and sales, rankings), 1,663 works and 30 ranking lists as of 2026-10-29. **Covers are not included.** Please send data fixes to beatrice-library-data, not here. Import a pack via 设置 → 作品资料 → 导入数据包 (Settings → Catalog → Import data pack); the format is documented in [接口.md](接口.md) (Chinese).

**Data sources** (of the bundled snapshot; details in beatrice-library-data): product information from [DLsite](https://www.dlsite.com/); rankings from [ErogameScape](https://erogamescape.dyndns.org/) and [VNDB](https://vndb.org/). VNDB data is available under the [Open Database License (ODbL)](https://vndb.org/d17).

**Build:** install Node.js, Rust and the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then in `app/`: `npm ci`, `npx tauri dev` (run) or `npx tauri build` (installer). **Tests:** `node --test tests/*.test.mjs`, `npx tsc --noEmit`, and `cargo test` in `app/src-tauri`.

**Name:** after Beatrice, keeper of the forbidden library in *Re:Zero*.

**License:** [MIT](LICENSE) © 2026 ATGL40
