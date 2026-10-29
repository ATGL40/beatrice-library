// —— 第一次打开时问「有没有不想看的题材？」：窗口里列哪些标签（纯函数，方便单测）——

/**
 * 没搜索时：部数最多的 top 个，再加上已经选了、但不在里面的；搜索时：名字（三种语言、id）里带搜索词的，最多 max 个。
 * counts 是 countGenres 的结果（部数多的在前），names(id) 是这个题材的各种叫法
 */
export function askTags(counts: [string, number][], selected: Iterable<string>, query: string, names: (id: string) => string[], top = 30, max = 60): string[] {
  const q = query.trim().toLowerCase();
  if (q) return counts.filter(([id]) => [id, ...names(id)].some(n => n.toLowerCase().includes(q))).slice(0, max).map(([id]) => id);
  const ids = counts.slice(0, top).map(([id]) => id), have = new Set(ids);
  const known = new Set(counts.map(([id]) => id));
  return [...ids, ...[...selected].filter(id => !have.has(id) && known.has(id))];
}
