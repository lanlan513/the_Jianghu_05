/**
 * 数据归一层：后端 Sword/Swordsman → 时间轴节点（全部为纯函数）。
 *
 * 负责：
 * - 精确年份优先、无年份走「可解释」的朝代兜底锚点；
 * - 朝代缺失 / 朝代名无法识别 / 朝代与年份互相矛盾 的容错定位；
 * - 剑客佩剑引用不到名剑（断链）的标注；
 * - 压力测试数据的确定性生成（同一开关在任何机器、任何 URL 复现同一批数据）；
 * - 搜索匹配（纯函数，找不到时由调用方提示）。
 */
import type { Sword, Swordsman } from '../../shared/types';
import {
  ERAS,
  UNKNOWN_ERA_ID,
  eraAtYear,
  resolveEra,
  type EraDef,
} from './eras';

export type EntryKind = 'sword' | 'swordsman';

export interface TimelineEntry {
  /** `${kind}:${rawId}` */
  readonly id: string;
  readonly kind: EntryKind;
  readonly rawId: string;
  readonly name: string;
  /** 剑：称号；剑客：名号 */
  readonly sub: string;
  readonly dynastyName: string;
  readonly eraId: string;
  /** 定位年份（公元纪年，负为公元前） */
  readonly year: number;
  readonly yearEnd: number;
  /** true 表示年份非史料精确值，来自兜底映射 */
  readonly inferred: boolean;
  /** 面向用户的映射说明（卡片中展示） */
  readonly yearNote: string;
  /** 剑客佩剑中找不到对应名剑的引用 id（断链） */
  readonly brokenSwordRefs: readonly string[];
  readonly generated?: boolean;
}

/** 确定性字符串散列（FNV-1a 改写），兜底锚点用它把同朝条目错开到不同位置 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fallbackAnchor(era: EraDef, seedKey: string, salt: number): number {
  const [a, b] = era.domain;
  const span = b - a;
  const frac = 0.16 + (((hashString(seedKey) + salt * 7919) % 1000) / 1000) * 0.68;
  return Math.round(a + span * frac);
}

interface NormalizeContext {
  /** 在「附卷·无考」中的位置（0 起）与同批总数 */
  unknownOrdinal: number;
  unknownCount: number;
  swordIdSet: ReadonlySet<string>;
}

function normalizeSword(raw: Sword, ctx: NormalizeContext): TimelineEntry {
  const declaredEra = resolveEra(raw.dynasty);
  let year: number;
  let yearEnd: number;
  let era: EraDef;
  let inferred = false;
  let note: string;

  if (Number.isFinite(raw.year)) {
    const y = raw.year as number;
    era = eraAtYear(y);
    year = Math.round(y);
    yearEnd = Number.isFinite(raw.yearEnd) ? Math.max(Math.round(raw.yearEnd as number), year) : year;
    if (!declaredEra) {
      inferred = true;
      note = `原数据未注明可识别朝代（「${raw.dynasty || '空'}」），按所记年份 ${year} 定位于「${era.name}」。`;
    } else if (declaredEra.id !== era.id) {
      inferred = true;
      note = `条目自称「${declaredEra.name}」，所记年份 ${year} 落在「${era.name}」纪年，为免朝代带相互矛盾，按年份定位。`;
    } else {
      // 约定：附 yearNote 的年份为据史事推定（非精确纪年）；只有 year 无 note 才视为精确
      inferred = Boolean(raw.yearNote);
      note = raw.yearNote
        ? `${raw.yearNote}（推定定位，非精确纪年。）`
        : `按所记确切年份 ${year} 定位。`;
    }
  } else {
    if (declaredEra) {
      era = declaredEra;
      year = fallbackAnchor(era, raw.id, raw.popularity ?? 0);
      yearEnd = year;
      inferred = true;
      note = `${era.note} 此剑无确切年份，按朝代纪年的相对位置（${era.name} 中段）安置。`;
    } else {
      era = ERAS.find((e) => e.id === UNKNOWN_ERA_ID)!;
      const [a, b] = era.domain;
      const span = b - a;
      year = Math.round(a + 24 + (span - 48) * (ctx.unknownCount <= 1 ? 0.5 : ctx.unknownOrdinal / (ctx.unknownCount - 1)));
      yearEnd = year;
      inferred = true;
      note = `朝代与年份俱缺（原值「${raw.dynasty || '空'}」），列入卷末「附卷·无考」，按录入次序定位。`;
    }
  }

  return {
    id: `sword:${raw.id}`,
    kind: 'sword',
    rawId: raw.id,
    name: raw.name,
    sub: raw.alias,
    dynastyName: era.name,
    eraId: era.id,
    year,
    yearEnd,
    inferred,
    yearNote: raw.yearNote && !inferred ? raw.yearNote : note,
    brokenSwordRefs: [],
  };
}

function normalizeSwordsman(raw: Swordsman, ctx: NormalizeContext): TimelineEntry {
  const declaredEra = resolveEra(raw.dynasty);
  let year: number;
  let era: EraDef;
  let inferred = false;
  let note: string;

  if (Number.isFinite(raw.year)) {
    const y = raw.year as number;
    era = eraAtYear(y);
    year = Math.round(y);
    if (!declaredEra) {
      inferred = true;
      note = `原数据朝代字段无法识别（「${raw.dynasty || '空'}」），按所记年份 ${year} 定位于「${era.name}」。`;
    } else if (declaredEra.id !== era.id) {
      inferred = true;
      note = `条目自称「${declaredEra.name}」，所记年份 ${year} 落在「${era.name}」纪年，按年份定位（跨朝之人以主要事迹之年为准）。`;
    } else {
      inferred = Boolean(raw.yearNote);
      note = raw.yearNote
        ? `${raw.yearNote}（据活动年代推定定位。）`
        : `按所记确切年份 ${year} 定位。`;
    }
  } else if (declaredEra) {
    era = declaredEra;
    year = fallbackAnchor(era, raw.id, raw.name.length * 131);
    inferred = true;
    note = `${era.note} 剑客生卒年不详，按其活动朝代（${era.name}）的相对位置安置。`;
  } else {
    era = ERAS.find((e) => e.id === UNKNOWN_ERA_ID)!;
    const [a, b] = era.domain;
    const span = b - a;
    year = Math.round(a + 24 + (span - 48) * (ctx.unknownCount <= 1 ? 0.5 : ctx.unknownOrdinal / (ctx.unknownCount - 1)));
    inferred = true;
    note = `朝代与年份俱缺（原值「${raw.dynasty || '空'}」），列入卷末「附卷·无考」。`;
  }

  const broken = (raw.swords || []).filter((sid) => !ctx.swordIdSet.has(sid));
  if (broken.length > 0) {
    note = `${note} 其所佩之剑（编号 ${broken.join('、')}）在名剑谱中查无对应，已作「剑佚」标注。`;
  }

  return {
    id: `swordsman:${raw.id}`,
    kind: 'swordsman',
    rawId: raw.id,
    name: raw.name,
    sub: raw.title,
    dynastyName: era.name,
    eraId: era.id,
    year,
    yearEnd: year,
    inferred,
    yearNote: note,
    brokenSwordRefs: broken,
  };
}

/** 纯函数：归并接口数据为按年排序的节点表 */
export function normalizeEntries(swords: readonly Sword[], swordsmen: readonly Swordsman[]): TimelineEntry[] {
  const swordIdSet = new Set(swords.map((s) => String(s.id)));
  const unknownSwords = swords.filter((s) => !resolveEra(s.dynasty) && !Number.isFinite(s.year));
  const unknownMen = swordsmen.filter((m) => !resolveEra(m.dynasty) && !Number.isFinite(m.year));
  const unknownCount = unknownSwords.length + unknownMen.length;
  const swordOrdinals = new Map<string, number>();
  unknownSwords.forEach((s, i) => swordOrdinals.set(s.id, i));
  const manOrdinals = new Map<string, number>();
  unknownMen.forEach((m, i) => manOrdinals.set(m.id, unknownSwords.length + i));

  const swordCtx = (s: Sword): NormalizeContext => ({
    unknownOrdinal: swordOrdinals.get(s.id) ?? 0,
    unknownCount,
    swordIdSet,
  });
  const manCtx = (m: Swordsman): NormalizeContext => ({
    unknownOrdinal: manOrdinals.get(m.id) ?? 0,
    unknownCount,
    swordIdSet,
  });

  const entries = [
    ...swords.map((s) => normalizeSword(s, swordCtx(s))),
    ...swordsmen.map((m) => normalizeSwordsman(m, manCtx(m))),
  ];
  entries.sort((a, b) => a.year - b.year || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh'));
  return entries;
}

/** 确定性伪随机（mulberry32），保证压力数据在任意客户端可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRESS_SEED = 20260920;
const STRESS_NAME_SWORD = ['寒星', '断水', '惊雷', '藏锋', '照胆', '霜鸣', '裂云', '沉沙', '辟邪', '拂月'];
const STRESS_NAME_MAN = ['青衫客', '燕南归', '醉道人', '铁筝生', '无名叟', '听雨楼主', '踏雪郎', '横江叟', '披裘客', '枕戈生'];

/**
 * 纯函数：在真实数据基础上确定性地补足到 targetTotal 条（压力测试）。
 * 年份覆盖整条卷轴且向名剑辈出的春秋战国倾斜，制造密集重叠。
 */
export function withStressEntries(
  real: readonly TimelineEntry[],
  targetTotal: number,
): TimelineEntry[] {
  const need = Math.max(0, targetTotal - real.length);
  if (need === 0) return [...real];

  const rand = mulberry32(STRESS_SEED);
  // 按朝代宽度加权抽样；春秋、战国、唐、宋权重再提，形成密集簇
  const weighted = ERAS.filter((e) => e.id !== UNKNOWN_ERA_ID).map((era) => {
    const weight = era.width * (['chunqiu', 'zhanguo', 'tang', 'song'].includes(era.id) ? 2.2 : 1);
    return { era, weight };
  });
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const pickEra = (): EraDef => {
    let r = rand() * totalWeight;
    for (const w of weighted) {
      r -= w.weight;
      if (r <= 0) return w.era;
    }
    return weighted[0].era;
  };

  const generated: TimelineEntry[] = [];
  for (let i = 0; i < need; i++) {
    const era = pickEra();
    const [a, b] = era.domain;
    // 年份量化到 6 年：在「单件」粒度（5.6px/年）下制造大量 < 节点宽 的重叠，压测泳道
    const year = a + Math.floor(rand() * (b - a) / 6) * 6;
    const kind: EntryKind = rand() < 0.5 ? 'sword' : 'swordsman';
    const pool = kind === 'sword' ? STRESS_NAME_SWORD : STRESS_NAME_MAN;
    const label = pool[i % pool.length];
    const no = i + 1;
    generated.push({
      id: `${kind}:gen-${i}`,
      kind,
      rawId: `gen-${i}`,
      name: kind === 'sword' ? `压测剑·${label}${no}` : `压测客·${label}${no}`,
      sub: kind === 'sword' ? '压测之刃' : '压测之人',
      dynastyName: era.name,
      eraId: era.id,
      year,
      yearEnd: year,
      inferred: true,
      yearNote: '压力测试由确定性种子生成的模拟条目，仅用于验证虚拟化与泳道性能。',
      brokenSwordRefs: [],
      generated: true,
    });
  }

  const all = [...real, ...generated];
  all.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  return all;
}

export interface SearchHit {
  readonly entry: TimelineEntry;
  readonly rank: number;
}

/** 纯函数：名称/别名/朝代子串匹配并按相关度排序；空结果返回空数组（调用方提示无结果） */
export function searchEntries(entries: readonly TimelineEntry[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const sub = (entry.sub || '').toLowerCase();
    const dynasty = entry.dynastyName.toLowerCase();
    let rank = -1;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (sub.includes(q)) rank = 3;
    else if (dynasty.includes(q)) rank = 4;
    if (rank >= 0) hits.push({ entry, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.entry.year - b.entry.year);
  return hits;
}
