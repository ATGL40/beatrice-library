// —— 我的梯度表：从「夯」到「拉完了」五档，档内的先后就是自排名（纯函数，方便单测） ——

export const TIERS = [["hang", "夯"], ["top", "顶级"], ["elite", "人上人"], ["npc", "NPC"], ["la", "拉完了"]] as const;
export type TierKey = (typeof TIERS)[number][0];
export type Tiers = Record<TierKey, string[]>;
export const TIER_KEYS: TierKey[] = TIERS.map(([k]) => k);
export const TIER_LABEL = Object.fromEntries(TIERS) as Record<TierKey, string>;
export const isTier = (k: unknown): k is TierKey => typeof k === "string" && (TIER_KEYS as string[]).includes(k);

export const emptyTiers = (): Tiers => ({ hang: [], top: [], elite: [], npc: [], la: [] });

/** 读进来的 tiers 整理一遍：只留字符串 id；同一个 id 只算第一次出现（按档从高到低、档内从前到后） */
export function cleanTiers(raw: unknown): Tiers {
  const out = emptyTiers();
  if (!raw || typeof raw !== "object") return out;
  const seen = new Set<string>();
  for (const k of TIER_KEYS) {
    const list = (raw as Record<string, unknown>)[k];
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      out[k].push(id);
    }
  }
  return out;
}

/** 这部作品在哪一档、第几（从 1 开始）；没分档是 null */
export function tierOf(t: Tiers, id: string): { tier: TierKey; pos: number } | null {
  for (const k of TIER_KEYS) {
    const i = t[k].indexOf(id);
    if (i >= 0) return { tier: k, pos: i + 1 };
  }
  return null;
}

/** 移出梯度表 */
export function removeFromTiers(t: Tiers, id: string): Tiers {
  const out = emptyTiers();
  for (const k of TIER_KEYS) out[k] = t[k].filter(x => x !== id);
  return out;
}

/** 放进某一档：before 是放在哪部作品前面（不在那一档就放到末尾）；原来在别处的先拿出来 */
export function placeInTier(t: Tiers, id: string, tier: TierKey, before?: string): Tiers {
  const out = removeFromTiers(t, id);
  const i = before && before !== id ? out[tier].indexOf(before) : -1;
  if (i >= 0) out[tier].splice(i, 0, id);
  else out[tier].push(id);
  return out;
}

/**
 * 在档内上移（-1）或下移（+1）一位。visible 是现在看得到的作品（按分类筛过），
 * 跟看得到的前一部 / 后一部换位置，中间夹着的别的分类作品不动
 */
export function moveInTier(t: Tiers, id: string, delta: -1 | 1, visible: (id: string) => boolean = () => true): Tiers {
  const at = tierOf(t, id);
  if (!at) return t;
  const list = t[at.tier];
  let j = at.pos - 1 + delta;
  while (j >= 0 && j < list.length && !visible(list[j])) j += delta;
  if (j < 0 || j >= list.length) return t;
  const out = { ...t, [at.tier]: [...list] } as Tiers;
  [out[at.tier][at.pos - 1], out[at.tier][j]] = [out[at.tier][j], out[at.tier][at.pos - 1]];
  return out;
}

/**
 * 把别人文件里的档位补进来：只补自己还没分档的作品，按对方的档、档内序号排好后接在各档末尾。
 * entries 是 [id, 档, 档内序号]；返回新的梯度表、补上的作品、和自己已经分在别的档的（算冲突）
 */
export function mergeTiers(t: Tiers, entries: [string, TierKey, number][]) {
  const out = { ...t } as Tiers;
  for (const k of TIER_KEYS) out[k] = [...t[k]];
  const added: string[] = [];
  let conflicts = 0;
  const sorted = [...entries].sort((a, b) => TIER_KEYS.indexOf(a[1]) - TIER_KEYS.indexOf(b[1]) || a[2] - b[2]);
  for (const [id, tier] of sorted) {
    const cur = tierOf(out, id);
    if (cur) { if (cur.tier !== tier) conflicts++; continue; }
    out[tier].push(id);
    added.push(id);
  }
  return { tiers: out, added, conflicts };
}
