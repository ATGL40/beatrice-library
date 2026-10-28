import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { nameOf } from "./library";
import { catLabel, tierRowsForCat } from "./rank";
import { data } from "./store";
import { ellipsize, IMG, layoutTiers } from "./tierlayout";
import { toast } from "./ui";

// —— 梯度表导出成 PNG（晒图用）：只画名字和作品名，不放路径和别的个人信息 ——

/** 档名块的颜色：夯最醒目，往下变淡，拉完了是灰色（和界面里的一致） */
export const TIER_COLORS: Record<string, string> = { hang: "#ff4d6d", top: "#ff9248", elite: "#f2c94c", npc: "#7cc6a4", la: "#7a7484" };
const C = { bg: "#17121b", panel: "#221b28", ink: "#efe8f3", muted: "#a79cb1", line: "#382e40" };
const FONT = `"Microsoft YaHei UI", "Yu Gothic UI", "PingFang SC", system-ui, sans-serif`;
const pad2 = (n: number) => String(n).padStart(2, "0");
const today = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 封面读成位图再画，canvas 不会被「污染」：自带的封面用 fetch 读（同源）；
 * 数据包里的封面（asset.localhost）交给后端 read_pack_cover 读，只认 pack/covers 下的图片
 */
async function loadCover(src: string): Promise<ImageBitmap | null> {
  if (!src) return null;
  try {
    let blob: Blob;
    if (src.startsWith("http://asset.localhost/") || src.startsWith("asset://")) {
      const name = decodeURIComponent(src).split(/[\\/]/).pop()!;
      blob = new Blob([await invoke<ArrayBuffer>("read_pack_cover", { name })]);
    } else {
      blob = await (await fetch(src)).blob();
    }
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** 像 CSS 的 object-fit: cover 一样裁切着画 */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

export async function drawTierImage(): Promise<HTMLCanvasElement> {
  const rows = tierRowsForCat();
  const L = layoutTiers(rows.map(r => r.games.length));
  const canvas = document.createElement("canvas");
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // 标题和副标题
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink;
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(`${data.myName || "我"}的黄油梯度表`, IMG.pad, 66);
  ctx.fillStyle = C.muted;
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`${catLabel()} · ${today()}`, IMG.pad, 100);

  const covers = await Promise.all(rows.map(r => Promise.all(r.games.map(g => loadCover(g.cover)))));
  rows.forEach((r, i) => {
    const row = L.rows[i];
    // 整行底色 + 左边的彩色档名块
    ctx.fillStyle = C.panel;
    ctx.fillRect(IMG.pad, row.y, L.width - IMG.pad * 2, row.h);
    ctx.fillStyle = TIER_COLORS[r.key];
    ctx.fillRect(IMG.pad, row.y, IMG.labelW, row.h);
    ctx.fillStyle = r.key === "la" ? C.ink : "#1b1320";
    ctx.font = `bold ${r.label.length > 2 ? 26 : 34}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.label, IMG.pad + IMG.labelW / 2, row.y + row.h / 2);
    ctx.textAlign = "left";
    // 封面和短名
    ctx.font = `15px ${FONT}`;
    r.games.forEach((g, j) => {
      const { x, y } = row.cells[j];
      const img = covers[i][j];
      ctx.fillStyle = C.line;
      ctx.fillRect(x, y, IMG.coverW, IMG.coverH);
      if (img) drawCover(ctx, img, x, y, IMG.coverW, IMG.coverH);
      ctx.fillStyle = C.ink;
      ctx.textBaseline = "top";
      ctx.fillText(ellipsize(nameOf(g), IMG.coverW, s => ctx.measureText(s).width), x, y + IMG.coverH + 6);
    });
  });

  // 右下角的小字
  ctx.fillStyle = C.muted;
  ctx.font = `14px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("碧翠子禁书库", L.width - IMG.pad, L.height - 22);
  return canvas;
}

export async function exportTierImage() {
  const canvas = await drawTierImage();
  const path = await saveDialog({ defaultPath: `黄油梯度表-${today()}.png`, filters: [{ name: "图片", extensions: ["png"] }] });
  if (!path) return;
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("画不出图片");
  // 图片字节直接放在请求体里，保存路径放在请求头（转成 ASCII）
  await invoke("write_png", new Uint8Array(await blob.arrayBuffer()), { headers: { path: encodeURIComponent(path) } });
  toast("梯度表图片已保存");
}
