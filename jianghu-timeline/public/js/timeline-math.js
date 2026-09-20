/**
 * timeline-math.js —— 时间轴全部几何/布局计算，均为无副作用纯函数。
 * 不依赖 DOM，可同时被浏览器与 Node（单测）引用。
 *
 * 坐标系约定：
 *   年份 year ──yearToWorldX──▶ 世界坐标 worldX（与缩放无关）
 *   世界坐标 worldX ──cam──▶ 屏幕坐标 screenX = worldX * scale - cam.x
 *   每个函数都提供逆映射，保证可往返（round-trip）。
 */

/* ---------------- 常量 ---------------- */

export const MIN_YEAR = -3000;          // 上古传说起点（兜底映射，见 README）
export const MAX_YEAR = 1950;
export const PX_PER_YEAR = 0.3;         // 世界坐标密度：1 年 = 0.3 世界像素
export const WORLD_WIDTH = (MAX_YEAR - MIN_YEAR) * PX_PER_YEAR;

export const SCALE_MAX = 80;            // 最大缩放
export const CENTURY_SCALE = 2.5;       // >= 此值进入「世纪」粒度
export const ITEM_SCALE = 14;           // >= 此值进入「单件」粒度

/**
 * 朝代序列表（start/end 均为闭区间，表内互不重叠，按 start 升序）。
 * estimated=true 表示该朝代起讫本身即推定值：
 *   上古传说 —— 无纪年，按传说时代兜底映射到 [-3000, -2071]；
 *   夏 / 商 —— 依「夏商周断代工程」推定 [-2070, -1601] / [-1600, -1047]；
 *   西周起于前 1046（武王克商年，断代工程结论）。
 */
export const DYNASTIES = [
  { name: '上古传说', start: -3000, end: -2071, estimated: true },
  { name: '夏',       start: -2070, end: -1601, estimated: true },
  { name: '商',       start: -1600, end: -1047, estimated: true },
  { name: '西周',     start: -1046, end: -771 },
  { name: '春秋',     start: -770,  end: -476 },
  { name: '战国',     start: -475,  end: -222 },
  { name: '秦',       start: -221,  end: -207 },
  { name: '西汉',     start: -206,  end: 8 },
  { name: '新',       start: 9,     end: 24 },
  { name: '东汉',     start: 25,    end: 219 },
  { name: '三国',     start: 220,   end: 264 },
  { name: '晋',       start: 265,   end: 419 },
  { name: '南北朝',   start: 420,   end: 580 },
  { name: '隋',       start: 581,   end: 617 },
  { name: '唐',       start: 618,   end: 906 },
  { name: '五代',     start: 907,   end: 959 },
  { name: '宋',       start: 960,   end: 1270 },
  { name: '元',       start: 1271,  end: 1367 },
  { name: '明',       start: 1368,  end: 1643 },
  { name: '清',       start: 1644,  end: 1912 },
  { name: '近代',     start: 1913,  end: 1949 },
];

/* ---------------- 刻度映射及其逆映射 ---------------- */

export function yearToWorldX(year) { return (year - MIN_YEAR) * PX_PER_YEAR; }
export function worldXToYear(x) { return x / PX_PER_YEAR + MIN_YEAR; }

export function worldToScreenX(worldX, cam) { return worldX * cam.scale - cam.x; }
export function screenToWorldX(screenX, cam) { return (screenX + cam.x) / cam.scale; }

/** 以屏幕上 sx 点为锚缩放：缩放前后该点对应的世界坐标不变。 */
export function zoomAt(cam, sx, nextScale) {
  const wx = screenToWorldX(sx, cam);
  return { scale: nextScale, x: wx * nextScale - sx };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** 三级粒度判定。 */
export function granularityForScale(scale) {
  if (scale >= ITEM_SCALE) return 'item';
  if (scale >= CENTURY_SCALE) return 'century';
  return 'dynasty';
}

export function formatYear(y) {
  const r = Math.round(y);
  return r < 0 ? `前${-r}` : `${r}`;
}

/* ---------------- 朝代映射（含兜底） ---------------- */

/** 按年份查朝代：二分查找（DYNASTIES 按 start 升序）。查不到返回 null。 */
export function dynastyForYear(year, dynasties = DYNASTIES) {
  let lo = 0, hi = dynasties.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = dynasties[mid];
    if (year < d.start) hi = mid - 1;
    else if (year > d.end) lo = mid + 1;
    else return d;
  }
  return null;
}

export function dynastyRangeByName(name, dynasties = DYNASTIES) {
  for (const d of dynasties) if (d.name === name) return d;
  return null;
}

/**
 * 归一化条目：补齐缺失朝代/年份，全部可解释。
 *  - 缺 year 但有朝代 → 取朝代区间中点，yearEstimated=true；
 *  - 缺 year 且缺朝代 → 置于纪年中点 0 年，yearEstimated=true；
 *  - 缺 dynasty（或朝代名不在表中）→ 按年份反查朝代，dynastyEstimated=true；
 *  - 朝代本身即推定（上古/夏/商）→ dynastyEstimated=true。
 * 返回新对象，附加 year / yearEstimated / dynastyName / dynastyEstimated / worldX。
 */
export function normalizeItem(item, dynasties = DYNASTIES) {
  const out = { ...item };
  let year = typeof item.year === 'number' && Number.isFinite(item.year) ? item.year : null;
  let yearEstimated = false;
  let dyn = item.dynasty ? dynastyRangeByName(item.dynasty, dynasties) : null;
  let dynastyEstimated = false;

  if (year === null) {
    year = dyn ? Math.round((dyn.start + dyn.end) / 2) : 0;
    yearEstimated = true;
  }
  if (!dyn) {
    dyn = dynastyForYear(year, dynasties);
    dynastyEstimated = true;
  }
  out.year = year;
  out.yearEstimated = yearEstimated;
  out.dynastyName = dyn ? dyn.name : '失考';
  out.dynastyEstimated = dynastyEstimated || (dyn ? !!dyn.estimated : false);
  out.worldX = yearToWorldX(year);
  return out;
}

/* ---------------- 泳道分配 ---------------- */

/** 估算「单件」粒度下节点（图标+文字）的屏幕宽度上限，用于保证不重叠。 */
export function estLabelW(name) { return 46 + String(name).length * 15; }

/**
 * 泳道分配（贪心区间划分）。输入按 worldX 升序的条目（各自带 screenW），
 * 输出每条所在泳道；泳道数超过 maxLanes 时，溢出条目按时间桶聚合为 cluster。
 * 保证：同一泳道内任意两节点水平间隔 >= gapPx；不同泳道垂直错开；
 * cluster 落在独立的溢出泳道 —— 因此任意两个已渲染节点互不重叠。
 * 返回 { laneOf: Map, laneCount, clusters: [{worldX, count, ids, start, end}] }
 */
export function assignLanes(items, scale, { gapPx = 10, maxLanes = Infinity, bucketPx = 160 } = {}) {
  const gapW = gapPx / scale;
  const laneRight = [];            // 每条泳道当前占用的世界坐标右缘
  const laneOf = new Map();
  const overflow = [];

  for (const it of items) {
    const half = (it.screenW || 100) / 2 / scale;
    const left = it.worldX - half, right = it.worldX + half;
    let lane = -1;
    for (let l = 0; l < laneRight.length; l++) {
      if (laneRight[l] + gapW <= left) { lane = l; break; }
    }
    if (lane === -1) {
      if (laneRight.length < maxLanes) { lane = laneRight.length; laneRight.push(-Infinity); }
      else { overflow.push(it); continue; }
    }
    laneRight[lane] = right;
    laneOf.set(it.id, lane);
  }

  const clusters = [];
  if (overflow.length) {
    const bucketW = bucketPx / scale;
    let cur = null;
    for (const it of overflow) {
      if (!cur || it.worldX - cur.start > bucketW) { cur = { start: it.worldX, ids: [] }; clusters.push(cur); }
      cur.ids.push(it.id); cur.end = it.worldX;
    }
    for (const c of clusters) { c.worldX = (c.start + c.end) / 2; c.count = c.ids.length; }
  }
  return { laneOf, laneCount: laneRight.length, clusters };
}

/* ---------------- 可视区计算（二分查找） ---------------- */

function lowerBound(arr, v) { // 第一个 worldX >= v 的下标
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].worldX < v) lo = m + 1; else hi = m; }
  return lo;
}
function upperBound(arr, v) { // 第一个 worldX > v 的下标
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].worldX <= v) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * 可视区计算：在按 worldX 升序的数组上二分出 [lo, hi) 候选区间。
 * maxHalfWorld 为条目的最大世界半径（= 最大屏宽/2/scale），
 * 保证候选区间覆盖所有可能与 [leftWorld, rightWorld] 相交的条目，
 * 调用方只需在候选区间内做精确边缘判断，无需全量过滤。
 */
export function findVisibleRange(sorted, leftWorld, rightWorld, maxHalfWorld) {
  const lo = lowerBound(sorted, leftWorld - maxHalfWorld);
  const hi = upperBound(sorted, rightWorld + maxHalfWorld);
  return [lo, hi];
}

/* ---------------- 刻度尺 ---------------- */

function pickStep(span, steps) {
  for (const s of steps) if (span / s <= 48) return s;
  return steps[steps.length - 1];
}

/** 生成 [leftYear, rightYear] 内的刻度，主刻度间隔 = 副刻度 × 5。 */
export function rulerTicks(leftYear, rightYear, granularity) {
  if (!(rightYear > leftYear)) return [];
  const span = rightYear - leftYear;
  const minor = granularity === 'item' ? pickStep(span, [5, 10, 25, 50])
    : granularity === 'century' ? pickStep(span, [25, 50, 100, 250])
    : pickStep(span, [100, 250, 500, 1000]);
  const major = minor * 5;
  const ticks = [];
  for (let y = Math.ceil(leftYear / minor) * minor; y <= rightYear; y += minor) {
    ticks.push({ year: y, major: y % major === 0 });
  }
  return ticks;
}

/* ---------------- 朝代聚合 chip（朝代粒度） ---------------- */

export function estChipW(label, count) {
  return String(label).length * 13 + 46 + String(count).length * 10;
}

/**
 * 朝代粒度下的聚合 chip 布局：输入按 worldX 升序的
 * [{key,label,count,worldX,fromWorld,toWorld,w}]，若相邻 chip 在屏幕上
 * 重叠则合并（label 加「~」，count 累加，区间并集），保证任意两 chip 不重叠。
 */
export function layoutChips(entries, cam, { gapPx = 10 } = {}) {
  const out = [];
  for (const e of entries) {
    const c = { ...e, x: worldToScreenX(e.worldX, cam) };
    const last = out[out.length - 1];
    if (last && c.x - c.w / 2 < last.x + last.w / 2 + gapPx) {
      last.count += c.count;
      last.toWorld = c.toWorld;
      last.label = last.label.replace(/~.*$/, '') + '~' + c.label.replace(/^.*~/, '');
      last.x = worldToScreenX((last.fromWorld + last.toWorld) / 2, cam);
      last.worldX = (last.fromWorld + last.toWorld) / 2;
      last.w = estChipW(last.label, last.count);
      last.merged = (last.merged || [last.key]).concat(c.key);
    } else {
      out.push(c);
    }
  }
  return out;
}
