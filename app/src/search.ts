/**
 * 模糊搜索：中日英三种名字一起搜。
 * 统一写法（全角转半角、大小写、片假名转平假名、去掉标点空格）后，
 * 依次看：开头就是 100 > 包含 90 > 按顺序含有这些字、隔得不远（少打几个字）41～60 > 打错一两个字 20～30。
 */
export function fold(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\-_~～〜・·:：!！?？。、,，.'"`「」『』【】\[\]()（）]/g, "");
}

/**
 * 按顺序含有 q 的每个字（中间可以隔着别的字）时，返回覆盖这些字的最短一段有多长；没有返回 Infinity。
 * 用最短一段来判断，免得长名字里零散凑出来的字也算匹配。
 */
function subsequenceSpan(q: string, t: string): number {
  const a = [...q], b = [...t];
  let best = Infinity;
  for (let s = 0; s < b.length; s++) {
    if (b[s] !== a[0]) continue;
    let i = 1, j = s + 1;
    while (i < a.length && j < b.length) { if (b[j] === a[i]) i++; j++; }
    if (i === a.length) best = Math.min(best, j - s);
  }
  return best;
}

/** q 和 t 里最像的一段之间差几个字（编辑距离，t 里从哪开始都行） */
function bestEditDistance(q: string, t: string): number {
  const a = [...q], b = [...t];
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev);
}

/** 分数越高越像；0 表示不算匹配 */
export function score(query: string, texts: string[]): number {
  const q = fold(query);
  if (!q) return 1;
  let best = 0;
  for (const raw of texts) {
    const t = fold(raw);
    if (!t) continue;
    if (t.startsWith(q)) best = Math.max(best, 100);
    else if (t.includes(q)) best = Math.max(best, 90);
    else {
      // 少打几个字：这些字之间隔得不远（最短一段不超过搜索词的 3 倍）才算，越紧凑分越高
      const span = q.length >= 2 ? subsequenceSpan(q, t) : Infinity;
      if (span <= q.length * 3) best = Math.max(best, 60 - Math.min(19, span - q.length));
      if (q.length >= 3) {
        const allowed = q.length >= 8 ? 2 : 1;
        const d = bestEditDistance(q, t);
        if (d <= allowed) best = Math.max(best, 40 - d * 10);
      }
    }
  }
  return best;
}
