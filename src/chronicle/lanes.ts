/**
 * 泳道分配：纯函数。
 *
 * 每个节点在尺度上是一个横向区间 [left, right]（由年份跨度与最小碰撞宽决定）。
 * 区间重叠（含端点相接）的节点必须分到不同泳道——这是经典的「区间图着色」问题：
 * 按起点排序、扫描时回收已空闲的泳道，得到的泳道数即最大重叠度（区间图色数），
 * 因此保证任意两个节点都不重叠，且泳道数最少。
 *
 * 剑与剑客仍以形状区分；泳道只负责纵向避让，不承担类型区分。
 */
import type { TimelineEntry } from './entries';
import { AXIS_HEIGHT, LANE_HEIGHT, NODE_HEIGHT, NODE_WIDTH, type Scale, yearToX } from './scale';

export interface LaidNode {
  readonly entry: TimelineEntry;
  readonly lane: number;
  /** 节点左上角相对内容区坐标 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
}

export interface LaneLayout {
  readonly nodes: readonly LaidNode[];
  /** 按泳道分桶，桶内按 left 升序——可视区二分查找直接用 */
  readonly byLane: readonly (readonly LaidNode[])[];
  readonly laneCount: number;
  readonly contentHeight: number;
}

export interface Interval {
  readonly id: string;
  readonly left: number;
  readonly right: number;
}

/**
 * 纯函数：区间图着色（贪心 + 空闲泳道回收）。
 * 按起点升序扫描；freeAt <= 当前起点 的泳道可复用。返回的泳道数为最少解。
 */
export function assignLanes<T extends Interval>(
  intervals: readonly T[],
): ReadonlyMap<string, number> {
  const sorted = [...intervals].sort(
    (a, b) => a.left - b.left || a.right - b.right || (a.id < b.id ? -1 : 1),
  );

  const laneOf = new Map<string, number>();
  /** 仍占用的泳道：{ lane, freeAt } */
  const active: { lane: number; freeAt: number }[] = [];
  const freeLanes: number[] = [];
  let nextLane = 0;

  for (const it of sorted) {
    // 回收在 it.left 处（含）已经空出的泳道
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].freeAt <= it.left) {
        freeLanes.push(active[i].lane);
        active.splice(i, 1);
      }
    }
    let lane: number;
    if (freeLanes.length > 0) {
      // 优先复用编号最小的空闲泳道，让排布贴近卷轴主轴
      freeLanes.sort((a, b) => a - b);
      lane = freeLanes.shift()!;
    } else {
      lane = nextLane++;
    }
    laneOf.set(it.id, lane);
    active.push({ lane, freeAt: it.right });
  }
  return laneOf;
}

/**
 * 纯函数：给定尺度与归并后的节点，计算碰撞区间 → 分泳道 → 几何坐标。
 * 年份区间以 NODE_WIDTH 为最小碰撞宽度，并向外各撑 8px 安全间距；
 * 同点（年份完全相同）的剑与剑客也会因区间相接而分到不同泳道。
 */
export function buildLaneLayout(
  entries: readonly TimelineEntry[],
  scale: Scale,
): LaneLayout {
  const GAP = 8;
  const intervals: Interval[] = entries.map((entry) => {
    const cx = yearToX(entry.year, scale);
    const span = Math.max(entry.yearEnd - entry.year, 0);
    const spanPx = span > 0 ? yearToX(entry.yearEnd, scale) - cx : 0;
    const half = Math.max(NODE_WIDTH, spanPx + NODE_WIDTH) / 2 + GAP;
    return { id: entry.id, left: cx - half, right: cx + half };
  });

  const laneOf = assignLanes(intervals);
  const intervalById = new Map(intervals.map((it) => [it.id, it]));

  const nodes: LaidNode[] = entries.map((entry) => {
    const it = intervalById.get(entry.id)!;
    const lane = laneOf.get(entry.id) ?? 0;
    const cx = yearToX(entry.year, scale);
    const x = cx - NODE_WIDTH / 2;
    const y = AXIS_HEIGHT + lane * LANE_HEIGHT + (LANE_HEIGHT - NODE_HEIGHT) / 2;
    return {
      entry,
      lane,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      left: it.left,
      right: it.right,
    };
  });

  const laneCount = Math.max(1, ...nodes.map((n) => n.lane + 1));
  const byLane: LaidNode[][] = Array.from({ length: laneCount }, () => []);
  for (const node of nodes) byLane[node.lane].push(node);
  for (const bucket of byLane) bucket.sort((a, b) => a.left - b.left || a.entry.id.localeCompare(b.entry.id));

  return {
    nodes,
    byLane,
    laneCount,
    contentHeight: AXIS_HEIGHT + laneCount * LANE_HEIGHT + 24,
  };
}
