import test from 'node:test';
import assert from 'node:assert/strict';
import {
  yearToWorldX, worldXToYear, worldToScreenX, screenToWorldX, zoomAt,
  granularityForScale, CENTURY_SCALE, ITEM_SCALE,
  dynastyForYear, dynastyRangeByName, normalizeItem, DYNASTIES,
  estLabelW, assignLanes, findVisibleRange, rulerTicks, layoutChips, estChipW,
  MIN_YEAR, MAX_YEAR,
} from '../public/js/timeline-math.js';

/* ---------- 刻度映射及其逆映射 ---------- */

test('year ↔ worldX 往返一致', () => {
  for (const y of [-3000, -2070, -515, -221, 0, 618, 1420, 1912]) {
    assert.ok(Math.abs(worldXToYear(yearToWorldX(y)) - y) < 1e-9, `year ${y}`);
  }
});

test('worldX ↔ screenX 往返一致（任意相机）', () => {
  const cams = [{ x: 0, scale: 1 }, { x: 1234.5, scale: 7.7 }, { x: -500, scale: 0.6 }];
  for (const cam of cams) {
    for (const wx of [0, 100.5, 1485]) {
      assert.ok(Math.abs(screenToWorldX(worldToScreenX(wx, cam), cam) - wx) < 1e-9);
    }
  }
});

test('zoomAt 保持锚点世界坐标不变', () => {
  const cam = { x: 300, scale: 3 };
  const next = zoomAt(cam, 250, 12);
  assert.ok(Math.abs(screenToWorldX(250, next) - screenToWorldX(250, cam)) < 1e-9);
});

test('三级粒度阈值', () => {
  assert.equal(granularityForScale(0.5), 'dynasty');
  assert.equal(granularityForScale(CENTURY_SCALE), 'century');
  assert.equal(granularityForScale(ITEM_SCALE), 'item');
  assert.equal(granularityForScale(ITEM_SCALE * 2), 'item');
});

/* ---------- 朝代映射与兜底 ---------- */

test('dynastyForYear 二分查找', () => {
  assert.equal(dynastyForYear(-221).name, '秦');
  assert.equal(dynastyForYear(-770).name, '春秋');
  assert.equal(dynastyForYear(9).name, '新');
  assert.equal(dynastyForYear(219).name, '东汉');
  assert.equal(dynastyForYear(220).name, '三国');
  assert.equal(dynastyForYear(1912).name, '清');
  assert.equal(dynastyForYear(5000), null);
  assert.equal(dynastyForYear(-9999), null);
});

test('朝代表自身无重叠且升序', () => {
  for (let i = 1; i < DYNASTIES.length; i++) {
    assert.ok(DYNASTIES[i].start > DYNASTIES[i - 1].end,
      `${DYNASTIES[i - 1].name} 与 ${DYNASTIES[i].name} 重叠`);
  }
});

test('兜底：缺朝代按年份反查并标记推定', () => {
  const it = normalizeItem({ id: 'x', name: '掩日剑', dynasty: null, year: -620 });
  assert.equal(it.dynastyName, '春秋');
  assert.equal(it.dynastyEstimated, true);
  assert.equal(it.yearEstimated, false);
});

test('兜底：缺年份取朝代中点并标记推定', () => {
  const it = normalizeItem({ id: 'y', name: '青霜剑', dynasty: '清', year: null });
  assert.equal(it.year, Math.round((1644 + 1912) / 2));
  assert.equal(it.yearEstimated, true);
  assert.equal(it.dynastyName, '清');
});

test('兜底：上古/夏商本身即推定映射', () => {
  const it = normalizeItem({ id: 'z', name: '轩辕剑', dynasty: '上古传说', year: -2700 });
  assert.equal(it.dynastyEstimated, true);
  assert.equal(it.dynastyName, '上古传说');
});

test('兜底：朝代与年份俱缺 → 纪年中点 + 推定', () => {
  const it = normalizeItem({ id: 'w', name: '无名', dynasty: null, year: null });
  assert.equal(it.year, 0);
  assert.equal(it.yearEstimated, true);
  assert.equal(it.dynastyEstimated, true);
});

/* ---------- 泳道分配 ---------- */

function makeItems(n, seed = 42) {
  // 确定性伪随机
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ id: `i${i}`, worldX: rnd() * 1485, screenW: 60 + rnd() * 80 });
  }
  return items.sort((a, b) => a.worldX - b.worldX);
}

test('泳道内任意两节点不重叠，且所有条目被安置（泳道或聚合）', () => {
  const items = makeItems(2000);
  const scale = 14, gapPx = 12;
  const { laneOf, clusters } = assignLanes(items, scale, { gapPx, maxLanes: 8 });
  const byLane = new Map();
  const placed = new Set();
  for (const it of items) {
    const lane = laneOf.get(it.id);
    if (lane === undefined) continue;
    placed.add(it.id);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(it);
  }
  for (const c of clusters) for (const id of c.ids) placed.add(id);
  assert.equal(placed.size, items.length, '每条数据要么入泳道要么入聚合');
  for (const [, arr] of byLane) {
    arr.sort((a, b) => a.worldX - b.worldX);
    for (let i = 1; i < arr.length; i++) {
      const prevRight = arr[i - 1].worldX + arr[i - 1].screenW / 2 / scale;
      const left = arr[i].worldX - arr[i].screenW / 2 / scale;
      assert.ok(prevRight + gapPx / scale <= left + 1e-9, '同泳道节点不得重叠');
    }
  }
});

test('无泳道上限时任意条目均不重叠', () => {
  const items = makeItems(500, 7);
  const scale = 14, gapPx = 10;
  const { laneOf, clusters } = assignLanes(items, scale, { gapPx });
  assert.equal(clusters.length, 0);
  assert.equal(laneOf.size, items.length);
});

test('cluster 计数守恒且互不重叠（时间桶间隔 >= bucketPx）', () => {
  const items = makeItems(3000, 9).map(i => ({ ...i, worldX: (i.worldX % 300) })); // 刻意挤在一起
  items.sort((a, b) => a.worldX - b.worldX);
  const { clusters } = assignLanes(items, 14, { maxLanes: 4, bucketPx: 160 });
  const total = clusters.reduce((s, c) => s + c.count, 0);
  assert.ok(total > 0);
  for (let i = 1; i < clusters.length; i++) {
    assert.ok(clusters[i].worldX - clusters[i - 1].worldX > 0);
  }
});

/* ---------- 可视区计算（二分查找） ---------- */

test('findVisibleRange 与全量过滤结果一致', () => {
  const items = makeItems(5000, 11);
  const maxHalfWorld = Math.max(...items.map(i => i.screenW)) / 2 / 14;
  for (const [l, r] of [[0, 100], [300.3, 512.7], [1400, 1600], [-50, 0]]) {
    const [lo, hi] = findVisibleRange(items, l, r, maxHalfWorld);
    const brute = items.filter(it =>
      it.worldX + it.screenW / 2 / 14 >= l && it.worldX - it.screenW / 2 / 14 <= r);
    const cand = items.slice(lo, hi).filter(it =>
      it.worldX + it.screenW / 2 / 14 >= l && it.worldX - it.screenW / 2 / 14 <= r);
    assert.deepEqual(cand.map(i => i.id), brute.map(i => i.id));
    assert.ok(hi - lo < items.length, '候选区间应远小于全量');
  }
});

/* ---------- 刻度尺 ---------- */

test('rulerTicks 覆盖范围、升序、主刻度对齐', () => {
  const ticks = rulerTicks(-2070, -1600, 'century');
  assert.ok(ticks.length > 0 && ticks.length <= 60);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].year > ticks[i - 1].year);
  for (const t of ticks) assert.ok(t.year >= -2070 && t.year <= -1600);
  const majors = ticks.filter(t => t.major);
  assert.ok(majors.length > 0);
});

/* ---------- 朝代聚合 chip ---------- */

test('layoutChips 合并后不重叠且计数守恒', () => {
  const cam = { x: 0, scale: 0.6 };
  const entries = DYNASTIES.filter((_, i) => i % 2 === 0).map(d => ({
    key: d.name, label: d.name, count: 3,
    worldX: yearToWorldX((d.start + d.end) / 2),
    fromWorld: yearToWorldX(d.start), toWorld: yearToWorldX(d.end),
    w: estChipW(d.name, 3),
  }));
  const total = entries.reduce((s, e) => s + e.count, 0);
  const chips = layoutChips(entries, cam, { gapPx: 10 });
  assert.equal(chips.reduce((s, c) => s + c.count, 0), total);
  const sorted = [...chips].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].x - sorted[i].w / 2 >= sorted[i - 1].x + sorted[i - 1].w / 2 + 10 - 1e-9,
      'chip 不得重叠');
  }
});

test('estLabelW 随名称长度单调递增', () => {
  assert.ok(estLabelW('湛卢') < estLabelW('越王勾践剑'));
});
