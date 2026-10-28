// —— 梯度表导出图片的排版（纯函数，方便单测）：宽度固定，每档一行，封面放不下就换行 ——

export const IMG = {
  width: 1200, pad: 40, headH: 128, labelW: 150, coverW: 132, coverH: 99, capH: 28, gap: 14, rowGap: 12, footH: 56,
};
export type ImgOpts = typeof IMG;

/** 一行能放几张封面 */
export function perRow(o: ImgOpts = IMG): number {
  const room = o.width - o.pad * 2 - o.labelW - o.gap; // 档名块右边留给封面的宽度
  return Math.max(1, Math.floor((room + o.gap) / (o.coverW + o.gap)));
}

export interface RowLayout { y: number; h: number; cells: { x: number; y: number }[] }

/** counts 是每档有几部；返回整张图的高度和每档每张封面的位置。空档也占一行高 */
export function layoutTiers(counts: number[], o: ImgOpts = IMG): { width: number; height: number; perRow: number; rows: RowLayout[] } {
  const per = perRow(o);
  const cellH = o.coverH + o.capH;
  const left = o.pad + o.labelW + o.gap;
  let y = o.headH;
  const rows = counts.map(n => {
    const lines = Math.max(1, Math.ceil(n / per));
    const h = lines * cellH + (lines - 1) * o.gap + o.gap * 2;
    const cells = Array.from({ length: n }, (_, i) => ({
      x: left + (i % per) * (o.coverW + o.gap),
      y: y + o.gap + Math.floor(i / per) * (cellH + o.gap),
    }));
    const row = { y, h, cells };
    y += h + o.rowGap;
    return row;
  });
  return { width: o.width, height: y - o.rowGap + o.footH, perRow: per, rows };
}

/** 文字太长就截断加「…」，measure 量文字宽度（画图时用 canvas 的，测试时用假的） */
export function ellipsize(text: string, maxW: number, measure: (s: string) => number): string {
  if (measure(text) <= maxW) return text;
  const chars = [...text];
  while (chars.length && measure(chars.join("") + "…") > maxW) chars.pop();
  return chars.join("") + "…";
}

/** 导出图片时这张封面交给哪个后端命令读：custom-covers 下的是我的游戏的封面，别的是数据包的；地址里的 ?v= 不要 */
export function coverCommand(src: string): [string, string] {
  const parts = decodeURIComponent(new URL(src).pathname).split(/[\\/]/), name = parts.pop()!;
  return [parts.pop() === "custom-covers" ? "read_custom_cover" : "read_pack_cover", name];
}
