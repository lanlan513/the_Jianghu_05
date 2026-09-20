/**
 * 编年史纯函数自检（非测试框架，直接 tsx 运行：npx tsx scripts/verify-chronicle.ts）
 * 覆盖：尺度正反映射互逆、泳道零重叠、二分可视区 == 全量过滤结果、
 *      兜底映射确定性、压测节点规模。
 */
import { createScale, yearToX, xToYear, GRANULARITY_ORDER } from '../src/chronicle/scale';
import { buildLaneLayout } from '../src/chronicle/lanes';
import { visibleNodes, makeViewWindow } from '../src/chronicle/viewport';
import { normalizeEntries, withStressEntries } from '../src/chronicle/entries';
import { swords } from '../api/src/data/swords';
import { swordsmen } from '../api/src/data/swordsmen';
import { ERAS } from '../src/chronicle/eras';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  } else {
    console.log('  ✓', msg);
  }
};

console.log('1) 尺度：年份→x→年份 往返一致（舍入容差 1px/年）');
for (const g of GRANULARITY_ORDER) {
  const scale = createScale(g);
  const years = [-3000, -2070, -771, -221, 0, 208, 618, 1279, 1644, 1912, 2099];
  let maxErr = 0;
  for (const y of years) {
    const back = xToYear(yearToX(y, scale), scale);
    const xErr = Math.abs(yearToX(back, scale) - yearToX(y, scale));
    maxErr = Math.max(maxErr, xErr);
  }
  assert(maxErr < 1.5, `${g}: 往返像素误差 ${maxErr.toFixed(3)}px < 1.5px，尺度域 [0, ${scale.totalWidth}]`);
  // 严格单调
  let mono = true;
  let prev = -Infinity;
  for (let y = scale.yearMin; y <= scale.yearMax; y += 37) {
    const x = yearToX(y, scale);
    if (x < prev) mono = false;
    prev = x;
  }
  assert(mono, `${g}: yearToX 严格单调递增`);
  // 边界夹取
  assert(yearToX(-99999, scale) === 0, `${g}: 早于卷轴 → 0`);
  assert(yearToX(99999, scale) === scale.totalWidth, `${g}: 晚于卷轴 → totalWidth`);
}

console.log('2) 泳道：任意节点对不重叠（含压测 2048 条）');
const real = normalizeEntries(swords, swordsmen);
for (const [label, entries] of [['真实数据', real], ['压测数据', withStressEntries(real, 2048)]] as const) {
  for (const g of GRANULARITY_ORDER) {
    const scale = createScale(g);
    const layout = buildLaneLayout(entries, scale);
    // 同一泳道内任意两节点的碰撞区间不得相交（端点可相切于 right<=left，此处区间含 GAP，要求 right <= 下一 left）
    let collision = false;
    for (const bucket of layout.byLane) {
      for (let i = 1; i < bucket.length; i++) {
        if (bucket[i].left < bucket[i - 1].right) {
          collision = true;
        }
      }
    }
    assert(!collision, `${label}/${g}: ${entries.length} 节点、${layout.laneCount} 泳道，同泳道零重叠`);
  }
}

console.log('3) 可视区：二分查找结果 === 全量过滤结果');
{
  const scale = createScale('item');
  const entries = withStressEntries(real, 2048);
  const layout = buildLaneLayout(entries, scale);
  const W = 1280;
  const H = 720;
  let equal = true;
  for (const sl of [0, 5000, 12345, scale.totalWidth - W]) {
    for (const st of [0, 200, 900]) {
      const win = makeViewWindow(sl, st, W, H);
      // 全量参照（故意写得朴素）
      const refSet = new Set(
        layout.nodes
          .filter((n) =>
            n.right >= win.x0 - 240 && n.left <= win.x1 + 240 &&
            n.y + n.height >= win.y0 - 120 && n.y <= win.y1 + 120)
          .map((n) => n.entry.id),
      );
      const got = new Set(visibleNodes(layout, win).map((n) => n.entry.id));
      if (got.size !== refSet.size || [...got].some((id) => !refSet.has(id))) equal = false;
      assert(got.size < 260, `视口 (${sl},${st}) 实绘 ${got.size} 节点（常数级，与 2048 总量无关）`);
    }
  }
  assert(equal, '全部抽样视口下二分结果与全量过滤完全一致');
}

console.log('4) 兜底映射：缺失/矛盾朝代的解释性定位');
{
  const byId = new Map(real.map((e) => [e.id, e]));
  const lost = byId.get('sword:16');
  assert(Boolean(lost && lost!.inferred && lost!.eraId === 'unknown'), '断水剑：无朝代无年份 → 附卷·无考，标注推定');
  const anon = byId.get('swordsman:14');
  assert(Boolean(anon && anon!.eraId === 'unknown'), '无名剑客：空朝代 → 附卷·无考');
  const yuenv = byId.get('swordsman:9');
  assert(Boolean(yuenv && yuenv!.brokenSwordRefs.includes('lost-yuenu-blade')), '越女阿青：佩剑查无名剑 → 断链标注');
  const lv = byId.get('swordsman:13');
  assert(Boolean(lv && lv!.brokenSwordRefs.includes('lost-lv-blade')), '吕四娘：佩剑佚失 → 断链标注');
  const yitian = byId.get('sword:13');
  assert(Boolean(yitian && yitian!.inferred && yitian!.dynastyName === '三国'), '倚天剑：非标准朝代「漢」+ 年份 208 → 按年归入三国并说明');
  const xuanyuan = byId.get('sword:1');
  assert(Boolean(xuanyuan && xuanyuan!.inferred && xuanyuan!.yearNote.includes('前2697')), '轩辕剑：上古无精确纪年 → 可解释象征年份');
}

console.log('5) 压测确定性');
{
  const a = withStressEntries(real, 2048);
  const b = withStressEntries(real, 2048);
  assert(a.length === 2048 && b.length === 2048, `补足到 2048 条（真实 ${real.length} 条）`);
  assert(a.every((n, i) => n.id === b[i].id && n.year === b[i].year), '两次生成逐节点一致（可随 URL 复现）');
  assert(a.every((n) => n.year >= ERAS[0].domain[0] && n.year <= ERAS[ERAS.length - 1].domain[1]), '生成年份全部落在卷轴定义域内');
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
