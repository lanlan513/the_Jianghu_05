import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as M from '../public/js/timeline-math.js';

const ROOT = new URL('..', import.meta.url).pathname;
const swords = JSON.parse(await readFile(ROOT + 'data/swords.json', 'utf8'));
;
const swordsmen = JSON.parse(await readFile(ROOT + 'data/swordsmen.json', 'utf8'));

const base = [
  ...swords.map(i => ({ ...i, kind: 'sword' })),
  ...swordsmen.map(i => ({ ...i, kind: 'swordsman' })),
].map(i => M.normalizeItem(i)).sort((a, b) => a.worldX - b.worldX);

function expandForStress(items, K = 30) {
  const out = [];
  for (let k = 0; k < K; k++) {
    for (const it of items) {
      if (k === 0) { out.push(it); continue; }
      const jitter = ((k * 37) % 61) - 30 + (k % 3);
      out.push({ ...it, id: `${it.id}@${k}`, year: it.year + jitter, worldX: M.yearToWorldX(it.year + jitter) });
    }
  }
  return out.sort((a, b) => a.worldX - b.worldX);
}

test('真实数据归一化后无 NaN，且按 worldX 升序', () => {
  assert.equal(base.length, swords.length + swordsmen.length);
  for (const it of base) {
    assert.ok(Number.isFinite(it.worldX), `${it.name} worldX NaN`);
    assert.ok(it.dynastyName, `${it.name} 缺朝代名`);
  }
  for (let i = 1; i < base.length; i++) assert.ok(base[i].worldX >= base[i - 1].worldX);
});

test('压测：数据过千时任意相机位置渲染数为常数级且不漏渲染', () => {
  // 渲染峰值随数据总量变化应保持基本不变（O(视口) 而非 O(数据量)）
  function maxRenderedFor(K) {
    const items = expandForStress(base, K);
    const vw = 1200;
    let peak = 0;
    for (const [gran, laneScale, maxLanes] of [['item', M.ITEM_SCALE, 8], ['century', M.CENTURY_SCALE, 12]]) {
      for (const it of items) it.screenW = gran === 'item' ? M.estLabelW(it.name) : 14;
      const layout = M.assignLanes(items, laneScale, { gapPx: 12, maxLanes });
      const maxHalfWorld = Math.max(...items.map(i => i.screenW)) / 2 / laneScale;
      const scale = gran === 'item' ? M.ITEM_SCALE * 1.5 : M.CENTURY_SCALE * 2;
      let s = 7;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let t = 0; t < 300; t++) {
        const camX = rnd() * (M.WORLD_WIDTH * scale - vw);
        const cam = { x: camX, scale };
        const leftW = M.screenToWorldX(0, cam), rightW = M.screenToWorldX(vw, cam);
        const buf = vw * 0.8 / scale;
        const [lo, hi] = M.findVisibleRange(items, leftW - buf, rightW + buf, maxHalfWorld);
        const rendered = new Set();
        for (let i = lo; i < hi; i++) {
          const it = items[i];
          if (!layout.laneOf.has(it.id)) continue;
          const half = it.screenW / 2 / scale;
          if (it.worldX + half < leftW - buf || it.worldX - half > rightW + buf) continue;
          rendered.add(it.id);
        }
        // 不变量：全量扫描出的视口内条目必须全部被虚拟化渲染（快速滚动不露白）
        for (const it of items) {
          if (!layout.laneOf.has(it.id)) continue;
          const half = it.screenW / 2 / scale;
          if (it.worldX + half >= leftW && it.worldX - half <= rightW) {
            assert.ok(rendered.has(it.id), `${gran} 粒度漏渲染 ${it.id}`);
          }
        }
        peak = Math.max(peak, rendered.size);
      }
    }
    return peak;
  }

  const items30 = expandForStress(base, 30);
  assert.ok(items30.length > 1000, `压测数据量 ${items30.length} 应过千`);
  const peak30 = maxRenderedFor(30);   // 2070 条
  const peak60 = maxRenderedFor(60);   // 4140 条
  assert.ok(peak30 < 500, `渲染峰值 ${peak30} 应远小于数据总量`);
  assert.ok(peak60 <= peak30 * 1.3 + 10,
    `数据量翻倍后渲染峰值 ${peak30} → ${peak60} 应保持常数级`);
});

test('佩剑引用完整性：swordId 均能在名剑表解析（未解析者走 swordName 兜底）', () => {
  const swordIds = new Set(swords.map(s => s.id));
  for (const p of swordsmen) {
    if (p.swordId) assert.ok(swordIds.has(p.swordId), `${p.name} 的 swordId ${p.swordId} 悬空`);
    else assert.ok(p.swordName === undefined || typeof p.swordName === 'string');
  }
  // 至少存在一条「佩剑找不到」的兜底样本（裴旻）
  assert.ok(swordsmen.some(p => !p.swordId && p.swordName), '应保留佩剑失录的兜底样本');
});
