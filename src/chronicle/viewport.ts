/**
 * 可视区计算：纯函数 + 二分查找。
 *
 * 不做全量过滤：每条泳道的节点已按 left 升序，
 * 用「左边界二分」找到第一个 right >= 视窗左缘的候选，再顺序收集到越界即停。
 * 复杂度 O(可视泳道数 · log n + 可见节点数)，与数据总量无关。
 */
import type { LaidNode, LaneLayout } from './lanes';

export interface ViewWindow {
  /** 内容坐标系下的视窗左缘 */
  readonly x0: number;
  /** 视窗右缘 */
  readonly x1: number;
  /** 纵向滚动偏移 */
  readonly y0: number;
  /** 纵向视窗高度 */
  readonly y1: number;
}

/** 二分下界：桶内第一个 right >= leftBound 的下标（桶按 left 升序） */
function lowerBoundByRight(bucket: readonly LaidNode[], leftBound: number): number {
  let lo = 0;
  let hi = bucket.length; // hi 指向下界游标
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bucket[mid].right < leftBound) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 纯函数：返回视窗内节点（含缓冲区 overscanPx / overscanYPx）。
 * 返回结果已按泳道、再按 left 排序；调用方据此做虚拟化渲染。
 */
export function visibleNodes(
  layout: LaneLayout,
  win: ViewWindow,
  overscanPx = 240,
  overscanYPx = 120,
): readonly LaidNode[] {
  const x0 = win.x0 - overscanPx;
  const x1 = win.x1 + overscanPx;
  const yTop = win.y0 - overscanYPx;
  const yBottom = win.y1 + overscanYPx;

  const out: LaidNode[] = [];
  for (const bucket of layout.byLane) {
    if (bucket.length === 0) continue;
    // 纵向先裁剪整条泳道
    const first = bucket[0];
    const laneTop = first.y;
    const laneBottom = first.y + first.height;
    if (laneBottom < yTop || laneTop > yBottom) continue;

    const start = lowerBoundByRight(bucket, x0);
    for (let i = start; i < bucket.length; i++) {
      const node = bucket[i];
      if (node.left > x1) break; // 已按 left 升序，后面的全部越界
      if (node.right >= x0) out.push(node);
    }
  }
  return out;
}

/** 纯函数：由滚动容器的 scrollLeft/scrollTop 与容器尺寸求视窗 */
export function makeViewWindow(
  scrollLeft: number,
  scrollTop: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewWindow {
  return {
    x0: scrollLeft,
    x1: scrollLeft + viewportWidth,
    y0: scrollTop,
    y1: scrollTop + viewportHeight,
  };
}
