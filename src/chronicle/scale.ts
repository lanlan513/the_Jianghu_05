/**
 * 时间轴尺度：年份 ↔ 像素 的正反映射（独立纯函数）。
 *
 * 所有粒度都表示为「分段线性、严格单调递增」的段表，因此：
 * - yearToX / xToYear 互为逆映射（在整数舍入误差内）；
 * - 逆映射用二分查找，不做全量遍历。
 */
import { ERAS } from './eras';

export type Granularity = 'era' | 'century' | 'item';

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  era: '朝代',
  century: '世纪',
  item: '单件',
};

export const GRANULARITY_ORDER: Granularity[] = ['era', 'century', 'item'];

/** 节点（碰撞体）尺寸常量，泳道与可视区共用同一份口径 */
export const NODE_WIDTH = 58;
export const NODE_HEIGHT = 52;
export const LANE_HEIGHT = 92;
export const AXIS_HEIGHT = 64;

/** 世纪 / 单件粒度下的像素密度（像素 / 年） */
const PX_PER_YEAR: Record<Exclude<Granularity, 'era'>, number> = {
  century: 1.34, // 约 134px / 百年
  item: 5.6, // 约 560px / 百年，足以逐件阅读
};

export interface ScaleSegment {
  /** 段像素区间（左闭右开，末段右闭） */
  readonly x0: number;
  readonly x1: number;
  /** 段年份区间 */
  readonly y0: number;
  readonly y1: number;
}

export interface Scale {
  readonly granularity: Granularity;
  readonly totalWidth: number;
  readonly yearMin: number;
  readonly yearMax: number;
  readonly segments: readonly ScaleSegment[];
  readonly pxPerYear: number | null;
}

/** 纯函数：按粒度构造尺度（朝代粒度为分段宽度；世纪/单件为匀速尺度） */
export function createScale(granularity: Granularity): Scale {
  const yearMin = ERAS[0].domain[0];
  const yearMax = ERAS[ERAS.length - 1].domain[1];

  if (granularity === 'era') {
    let cursor = 0;
    const segments: ScaleSegment[] = ERAS.map((era) => {
      const [y0, y1] = era.domain;
      const seg: ScaleSegment = { x0: cursor, x1: cursor + era.width, y0, y1 };
      cursor += era.width;
      return seg;
    });
    return { granularity, totalWidth: cursor, yearMin, yearMax, segments, pxPerYear: null };
  }

  const pxPerYear = PX_PER_YEAR[granularity];
  const totalWidth = Math.round((yearMax - yearMin) * pxPerYear);
  return {
    granularity,
    totalWidth,
    yearMin,
    yearMax,
    segments: [{ x0: 0, x1: totalWidth, y0: yearMin, y1: yearMax }],
    pxPerYear,
  };
}

/** 二分：找到满足 seg.y0 <= year 的最后一段（段表按年份升序） */
function segmentIndexForYear(segments: readonly ScaleSegment[], year: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  // 先夹住定义域
  if (year <= segments[0].y0) return 0;
  const last = segments[hi];
  if (year >= last.y1) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].y0 <= year) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 二分：找到满足 seg.x0 <= x 的最后一段（段表按像素升序） */
function segmentIndexForX(segments: readonly ScaleSegment[], x: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  if (x <= 0) return 0;
  if (x >= segments[hi].x1) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].x0 <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 正映射：年份 → 横轴像素。纯函数。
 * 超出定义域的年份被夹到卷轴两端。
 */
export function yearToX(year: number, scale: Scale): number {
  const y = Math.min(scale.yearMax, Math.max(scale.yearMin, year));
  const i = segmentIndexForYear(scale.segments, y);
  const s = scale.segments[i];
  const ratio = (y - s.y0) / (s.y1 - s.y0);
  return s.x0 + ratio * (s.x1 - s.x0);
}

/**
 * 逆映射：横轴像素 → 年份。纯函数，yearToX 的逆运算。
 */
export function xToYear(x: number, scale: Scale): number {
  const px = Math.min(scale.totalWidth, Math.max(0, x));
  const i = segmentIndexForX(scale.segments, px);
  const s = scale.segments[i];
  const ratio = (px - s.x0) / (s.x1 - s.x0);
  return s.y0 + ratio * (s.y1 - s.y0);
}

/** 年份格式化（公元前 / 公元后） */
export function formatYear(year: number): string {
  const y = Math.round(year);
  if (y < 0) return `前${Math.abs(y)}`;
  if (y === 0) return '公元元年';
  return `${y}`;
}

export interface Tick {
  readonly x: number;
  readonly year: number;
  readonly label: string;
  readonly major: boolean;
}

/** 纯函数：生成刻度（朝代粒度出朝代界碑；世纪粒度每百年；单件每五十年，刻线每十年） */
export function buildTicks(scale: Scale): Tick[] {
  const ticks: Tick[] = [];
  const push = (year: number, major: boolean) => {
    ticks.push({ x: yearToX(year, scale), year, label: formatYear(year), major });
  };

  if (scale.granularity === 'era') {
    for (const era of ERAS) push(era.domain[0], true);
    push(ERAS[ERAS.length - 1].domain[1], true);
    return ticks;
  }

  const majorStep = scale.granularity === 'century' ? 100 : 50;
  const minorStep = scale.granularity === 'century' ? 50 : 10;
  const start = Math.ceil(scale.yearMin / minorStep) * minorStep;
  for (let y = start; y <= scale.yearMax; y += minorStep) {
    push(y, y % majorStep === 0);
  }
  return ticks;
}

export interface EraBand {
  readonly eraId: string;
  readonly name: string;
  readonly x0: number;
  readonly width: number;
  readonly centerX: number;
  readonly ink: string;
  readonly inkLeft: string;
  readonly inkRight: string;
  readonly note: string;
}

/**
 * 纯函数：朝代墨色带在当前尺度下的几何位置。
 * 相邻朝代在交界处以前后两朝墨色做渐变带过渡；
 * 政治纪年重叠的朝代（如三国/汉末）由尺度域切分，故色带首尾相接而不重叠。
 */
export function buildEraBands(scale: Scale): EraBand[] {
  return ERAS.map((era, i) => {
    const x0 = yearToX(era.domain[0], scale);
    const x1 = yearToX(era.domain[1], scale);
    const prev = ERAS[i - 1];
    const next = ERAS[i + 1];
    return {
      eraId: era.id,
      name: era.name,
      x0,
      width: Math.max(0, x1 - x0),
      centerX: (x0 + x1) / 2,
      ink: era.ink,
      inkLeft: prev ? prev.ink : era.ink,
      inkRight: next ? next.ink : era.ink,
      note: era.note,
    };
  });
}
