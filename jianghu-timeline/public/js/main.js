/**
 * main.js —— 渲染与交互。
 * 原则：所有几何计算来自 timeline-math.js 纯函数；
 *       所有 DOM 写入只发生在 requestAnimationFrame 渲染帧内（元素引用即「ref」）；
 *       动画元素（.ink / .ring）是节点的子元素，随节点一起入池回收，同生命周期。
 */
import * as M from './timeline-math.js';
import { fetchAll, fetchDetail } from './api.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), nodesEl = $('#nodes'), bandsEl = $('#bands'),
  rulerEl = $('#ruler'), chipsEl = $('#chips'), cardEl = $('#card'),
  toastEl = $('#toast'), statsEl = $('#stats'), granEl = $('#granularity'),
  searchInput = $('#search'), detailEl = $('#detail');

const GRAN_LABEL = { dynasty: '朝代', century: '世纪', item: '单件' };
const LANE_CONF = {
  item:    { gapPx: 12, maxLanes: 8,  bucketPx: 160, laneH: 44 },
  century: { gapPx: 6,  maxLanes: 12, bucketPx: 160, laneH: 20 },
};

const state = {
  cam: { x: 0, scale: 1 }, target: { x: 0, scale: 1 },
  vw: 0, vh: 0,
  baseItems: [], items: [], byId: new Map(), aggregates: [],
  granularity: '', layout: null, layoutDirty: true,
  focusId: null, focusUntil: 0, selectedId: null, cardItem: null,
  urlFocusId: null, // 写入 URL 的持久焦点（刷新/分享后回到同一视图）
  stress: false,
};

/* ================= 节点池（虚拟化） ================= */

const nodePool = [];
const activeNodes = new Map(); // id -> el

function createNodeEl() {
  const el = document.createElement('div');
  // .ink 入场墨晕 / .ring 高亮环 —— 均为节点子元素，随节点同生命周期回收
  el.innerHTML = '<span class="ink"></span><span class="shape"></span><span class="label"></span><span class="ring"></span>';
  return el;
}

function bindNode(item, staggerIdx) {
  const el = nodePool.pop() || createNodeEl();
  el.className = 'node ' + (item.kind === 'sword' ? 'sword' : 'swordsman')
    + (state.granularity !== 'item' ? ' dot' : '');
  el.querySelector('.label').textContent = item.name;
  el.dataset.id = item.id;
  el.style.setProperty('--d', (staggerIdx % 10) * 45 + 'ms');
  el._item = item;
  nodesEl.appendChild(el);
  // 强制重排以重触发入场动画（元素复用时）
  void el.offsetWidth;
  el.classList.add('enter');
  activeNodes.set(item.id, el);
  return el;
}

function unbindNode(id) {
  const el = activeNodes.get(id);
  if (!el) return;
  activeNodes.delete(id);
  el.remove();          // 子动画元素随之离开文档，不会在回收后继续存在
  nodePool.push(el);
}

function clearNodes() {
  for (const id of [...activeNodes.keys()]) unbindNode(id);
  clearClusters();
}

/* ---- 聚合溢出 cluster（与节点同层、同池化策略） ---- */
const clusterPool = [];
const activeClusters = new Map(); // index -> el

function bindCluster(c, i, x, y) {
  let el = clusterPool.pop();
  if (!el) { el = document.createElement('div'); el.className = 'cluster'; }
  el.textContent = `+${c.count}`;
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  el._cluster = c;
  nodesEl.appendChild(el);
  activeClusters.set(i, el);
}
function clearClusters() {
  for (const [, el] of activeClusters) { el.remove(); clusterPool.push(el); }
  activeClusters.clear();
}

/* ---- 刻度尺池 ---- */
const tickPool = [];
const activeTicks = new Map(); // year -> el

function renderRuler(leftW, rightW) {
  const g = state.granularity;
  const ticks = M.rulerTicks(M.worldXToYear(leftW), M.worldXToYear(rightW), g);
  const seen = new Set();
  for (const t of ticks) {
    seen.add(t.year);
    let el = activeTicks.get(t.year);
    if (!el) {
      el = tickPool.pop();
      if (!el) { el = document.createElement('div'); el.innerHTML = '<span class="tlabel"></span>'; }
      rulerEl.appendChild(el);
      activeTicks.set(t.year, el);
    }
    // 粒度切换后同一年的主/副类别可能变化，每帧同步
    el.className = 'tick' + (t.major ? ' major' : '');
    el.querySelector('.tlabel').textContent = t.major ? M.formatYear(t.year) : '';
    el.style.transform = `translate3d(${M.worldToScreenX(M.yearToWorldX(t.year), state.cam)}px, 0, 0)`;
  }
  for (const [y, el] of [...activeTicks]) {
    if (!seen.has(y)) { activeTicks.delete(y); el.remove(); tickPool.push(el); }
  }
}

/* ================= 布局 ================= */

function rebuildLayout() {
  const g = state.granularity;
  const conf = LANE_CONF[g] || LANE_CONF.century;
  // 泳道在该粒度的最小缩放值上计算：粒度内继续放大时间距只会变大，保证任意缩放值下不重叠
  const laneScale = g === 'item' ? M.ITEM_SCALE : M.CENTURY_SCALE;
  for (const it of state.items) it.screenW = g === 'item' ? M.estLabelW(it.name) : 14;
  state.layout = M.assignLanes(state.items, laneScale, conf);
  state.layout.maxHalfWorld = Math.max(...state.items.map(i => i.screenW)) / 2 / laneScale;
  state.layoutDirty = false;
  clearNodes(); // 泳道变化，全部重绑
}

function laneY(lane) {
  const conf = LANE_CONF[state.granularity] || LANE_CONF.century;
  const mid = state.vh * 0.5;
  return mid + (lane - (state.layout.laneCount - 1) / 2) * conf.laneH;
}

/* ================= 每帧渲染 ================= */

function renderBands() {
  const cam = state.cam;
  for (const div of bandsEl.children) {
    const d = div._dyn;
    const x0 = M.worldToScreenX(M.yearToWorldX(d.start), cam);
    const x1 = M.worldToScreenX(M.yearToWorldX(d.end + 1), cam);
    if (x1 < -60 || x0 > state.vw + 60) { div.style.display = 'none'; continue; }
    div.style.display = '';
    div.style.transform = `translate3d(${x0}px, 0, 0)`;
    div.style.width = (x1 - x0) + 'px';
    div.firstChild.style.opacity = (x1 - x0) > 46 ? '' : '0';
  }
}

function renderNodes() {
  const cam = state.cam, scale = cam.scale;
  const leftW = M.screenToWorldX(0, cam), rightW = M.screenToWorldX(state.vw, cam);
  const buf = state.vw * 0.8 / scale; // 渲染缓冲区，快速滚动不露白
  const [lo, hi] = M.findVisibleRange(state.items, leftW - buf, rightW + buf, state.layout.maxHalfWorld);

  const seen = new Set();
  let stagger = 0;
  for (let i = lo; i < hi; i++) {
    const it = state.items[i];
    const lane = state.layout.laneOf.get(it.id);
    if (lane === undefined) continue; // 已并入 cluster
    const half = it.screenW / 2 / scale;
    if (it.worldX + half < leftW - buf || it.worldX - half > rightW + buf) continue; // 精确边缘判断
    seen.add(it.id);
    const el = activeNodes.get(it.id) || bindNode(it, stagger++);
    el.style.transform = `translate3d(${M.worldToScreenX(it.worldX, cam)}px, ${laneY(lane)}px, 0) translate(-50%, -50%)`;
  }
  for (const id of [...activeNodes.keys()]) if (!seen.has(id)) unbindNode(id);

  // 溢出 cluster（独立泳道，位于泳道区下方）
  const conf = LANE_CONF[state.granularity];
  const cy = state.vh * 0.5 + (state.layout.laneCount / 2) * conf.laneH + 26;
  const seenC = new Set();
  state.layout.clusters.forEach((c, i) => {
    const x = M.worldToScreenX(c.worldX, cam);
    if (x < -80 || x > state.vw + 80) return;
    seenC.add(i);
    if (!activeClusters.has(i)) bindCluster(c, i, x, cy);
    else activeClusters.get(i).style.transform = `translate3d(${x}px, ${cy}px, 0) translate(-50%, -50%)`;
  });
  for (const [i, el] of [...activeClusters]) {
    if (!seenC.has(i)) { activeClusters.delete(i); el.remove(); clusterPool.push(el); }
  }
}

const chipPool = [];
const activeChips = new Map(); // key -> el

function renderChips() {
  const chips = M.layoutChips(state.aggregates, state.cam, { gapPx: 10 });
  const seen = new Set();
  const y = state.vh * 0.5;
  for (const c of chips) {
    if (c.x < -160 || c.x > state.vw + 160) continue;
    seen.add(c.key);
    let el = activeChips.get(c.key);
    if (!el) {
      el = chipPool.pop();
      if (!el) { el = document.createElement('div'); el.className = 'chip'; }
      el._chip = c;
      chipsEl.appendChild(el);
      activeChips.set(c.key, el);
    }
    el._chip = c;
    el.textContent = `${c.label} · ${c.count}`;
    el.style.transform = `translate3d(${c.x}px, ${y}px, 0) translate(-50%, -50%)`;
  }
  for (const [k, el] of [...activeChips]) {
    if (!seen.has(k)) { activeChips.delete(k); el.remove(); chipPool.push(el); }
  }
}
function clearChips() {
  for (const [, el] of activeChips) { el.remove(); chipPool.push(el); }
  activeChips.clear();
}

function syncNodeStates(now) {
  for (const el of activeNodes.values()) {
    const id = el._item.id;
    el.classList.toggle('focused', id === state.focusId && now < state.focusUntil);
    el.classList.toggle('selected', id === state.selectedId);
  }
}

function positionCard() {
  if (!state.cardItem) return;
  const it = state.cardItem;
  const x = M.worldToScreenX(it.worldX, state.cam);
  if (x < -40 || x > state.vw + 40) { closeCard(); return; }
  const lane = state.layout && state.granularity !== 'dynasty' ? state.layout.laneOf.get(it.id) : undefined;
  const y = lane !== undefined ? laneY(lane) : state.vh * 0.5;
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
  const cx = M.clamp(x + 18, 8, state.vw - cw - 8);
  const cy = M.clamp(y - ch - 14, 8, state.vh - ch - 8);
  cardEl.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
}

/* ================= 主循环 ================= */

let frames = 0, fps = 0, lastFpsT = 0, lastUrlT = 0;

function loop(ts) {
  // 相机缓动（拖拽/捏合时 cam 已被直接同步，lerp 自然失效）
  const c = state.cam, t = state.target;
  c.x += (t.x - c.x) * 0.16;
  c.scale += (t.scale - c.scale) * 0.16;
  if (Math.abs(t.x - c.x) < 0.4) c.x = t.x;
  if (Math.abs(t.scale - c.scale) < 0.002) c.scale = t.scale;
  clampCam(t); clampCam(c);

  const g = M.granularityForScale(c.scale);
  if (g !== state.granularity) { state.granularity = g; state.layoutDirty = true; }
  if (state.layoutDirty && g !== 'dynasty') rebuildLayout();

  renderBands();
  const leftW = M.screenToWorldX(0, c), rightW = M.screenToWorldX(state.vw, c);
  renderRuler(leftW, rightW);
  if (g === 'dynasty') { clearNodes(); renderChips(); }
  else { clearChips(); if (!state.layout) rebuildLayout(); renderNodes(); }

  syncNodeStates(ts);
  positionCard();

  granEl.textContent = GRAN_LABEL[g];
  granEl.dataset.g = g;

  if (ts - lastUrlT > 250) { lastUrlT = ts; syncUrl(); }

  frames++;
  if (ts - lastFpsT > 1000) {
    fps = frames * 1000 / (ts - lastFpsT || 1); frames = 0; lastFpsT = ts;
    if (state.stress) {
      statsEl.textContent = `渲染节点 ${activeNodes.size + activeClusters.size} · 数据 ${state.items.length} 条 · ${fps.toFixed(0)} fps · 粒度 ${GRAN_LABEL[g]}`;
    }
    window.__stats = { rendered: activeNodes.size + activeClusters.size, total: state.items.length, fps, granularity: g };
  }
  requestAnimationFrame(loop);
}

/* ================= 相机 ================= */

function minScale() { return state.vw / M.WORLD_WIDTH * 0.9; }

function clampCam(c) {
  c.scale = M.clamp(c.scale, minScale(), M.SCALE_MAX);
  const worldW = M.WORLD_WIDTH * c.scale;
  const pad = state.vw * 0.25;
  if (worldW <= state.vw) c.x = (worldW - state.vw) / 2;
  else c.x = M.clamp(c.x, -pad, worldW - state.vw + pad);
}

function zoomTargetAt(nextScale, sx) {
  const ns = M.clamp(nextScale, minScale(), M.SCALE_MAX);
  const wx = M.screenToWorldX(sx, state.target);
  state.target.scale = ns;
  state.target.x = wx * ns - sx;
}

function fitAll() {
  state.target.scale = state.vw / M.WORLD_WIDTH * 0.92;
  state.target.x = (M.WORLD_WIDTH * state.target.scale - state.vw) / 2;
  state.cam = { ...state.target };
}

/* ================= 交互 ================= */

const pointers = new Map();
let downPos = null, dragged = false, pinch = null;

stage.addEventListener('pointerdown', e => {
  if (e.target.closest('#card, #detail')) return; // 卡片/详情内的点击不触发拖拽
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downPos = { x: e.clientX, y: e.clientY };
  dragged = false;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale0: state.target.scale };
  }
});

stage.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const dx = e.clientX - prev.x;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && pinch) {           // 双指捏合缩放
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const rect = stage.getBoundingClientRect();
    zoomTargetAt(pinch.scale0 * d / pinch.d0, (a.x + b.x) / 2 - rect.left);
    state.cam.scale = state.target.scale; state.cam.x = state.target.x;
    closeCard();
    return;
  }
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) dragged = true;
  if (dragged) {                                 // 横向拖拽平移
    state.target.x -= dx;
    state.cam.x = state.target.x;
    closeCard();
  }
});

stage.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!dragged && downPos) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) handleTap(el);
  }
  downPos = null; dragged = false;
});
stage.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; });

function handleTap(el) {
  const node = el.closest('.node');
  if (node && node._item) { selectItem(node._item, true); return; }
  const chip = el.closest('.chip');
  if (chip && chip._chip) { zoomToSpan(chip._chip.fromWorld, chip._chip.toWorld); return; }
  const cl = el.closest('.cluster');
  if (cl && cl._cluster) {
    const x = M.worldToScreenX(cl._cluster.worldX, state.cam);
    zoomTargetAt(state.target.scale * 2.2, x);
    return;
  }
  if (!el.closest('#card')) closeCard();
}

function zoomToSpan(fromWorld, toWorld) {
  const span = Math.max(toWorld - fromWorld, 1);
  state.target.scale = M.clamp(state.vw * 0.7 / span, minScale(), M.SCALE_MAX);
  state.target.x = (fromWorld + toWorld) / 2 * state.target.scale - state.vw / 2;
}

stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const rect = stage.getBoundingClientRect();
    zoomTargetAt(state.target.scale * Math.exp(-e.deltaY * 0.0022), e.clientX - rect.left);
  } else {
    state.target.x += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  }
  closeCard();
}, { passive: false });

stage.addEventListener('dblclick', e => {
  const rect = stage.getBoundingClientRect();
  zoomTargetAt(state.target.scale * 1.8, e.clientX - rect.left);
});

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') state.target.x -= state.vw * 0.25;
  else if (e.key === 'ArrowRight') state.target.x += state.vw * 0.25;
  else if (e.key === '+' || e.key === '=') zoomTargetAt(state.target.scale * 1.5, state.vw / 2);
  else if (e.key === '-') zoomTargetAt(state.target.scale / 1.5, state.vw / 2);
  else if (e.key === 'Escape') { closeCard(); closeDetail(); }
});

$('#zoomIn').addEventListener('click', () => zoomTargetAt(state.target.scale * 1.6, state.vw / 2));
$('#zoomOut').addEventListener('click', () => zoomTargetAt(state.target.scale / 1.6, state.vw / 2));

/* ================= 选中 / 卡片 / 详情 ================= */

function selectItem(item, openCard) {
  state.selectedId = item.id;
  if (openCard) showCard(item);
}

function yearsText(it) {
  if (it.start != null && it.end != null && it.start !== it.end) {
    return `${M.formatYear(it.start)} — ${M.formatYear(it.end)}`;
  }
  return M.formatYear(it.year) + (it.yearEstimated ? '（推定）' : '');
}

function relButtons(item) {
  const parts = [];
  if (item.kind === 'swordsman') {
    const sw = item.swordId ? state.byId.get(item.swordId) : null;
    if (sw) parts.push(`<span class="rel-label">佩剑</span><button class="rel" data-goto="${sw.id}">${sw.name}</button>`);
    else if (item.swordName) parts.push(`<span class="rel-label">佩剑</span><span class="rel-miss">${item.swordName}，未见于谱</span>`);
  } else {
    const wielders = state.items.filter(p => p.kind === 'swordsman' && p.swordId === item.id.split('@')[0]);
    if (wielders.length) {
      parts.push('<span class="rel-label">持剑者</span>' + wielders.map(w => `<button class="rel" data-goto="${w.id}">${w.name}</button>`).join(''));
    }
  }
  return parts.length ? `<div class="rel-row">${parts.join('')}</div>` : '';
}

function showCard(item) {
  state.cardItem = item;
  const est = item.yearEstimated || item.dynastyEstimated;
  cardEl.innerHTML = `
    <div class="card-head">
      <span class="badge ${item.kind}">${item.kind === 'sword' ? '剑' : '客'}</span>
      <b>${item.name}</b>
      <span class="src">${item.source || ''}</span>
      <button class="x" aria-label="关闭">×</button>
    </div>
    <div class="meta">${est ? '约 · ' : ''}${item.dynastyName} · ${yearsText(item)}</div>
    <p>${item.summary || ''}</p>
    ${relButtons(item)}
    <button class="detail-btn">查看详情</button>`;
  cardEl.classList.add('open');
  cardEl.querySelector('.x').addEventListener('click', closeCard);
  cardEl.querySelector('.detail-btn').addEventListener('click', () => openDetail(item));
  for (const b of cardEl.querySelectorAll('.rel')) {
    b.addEventListener('click', () => {
      const t = state.byId.get(b.dataset.goto);
      if (t) focusItem(t);
    });
  }
}

function closeCard() {
  if (!state.cardItem) return;
  state.cardItem = null;
  state.selectedId = null;
  cardEl.classList.remove('open');
}

async function openDetail(item) {
  try {
    const d = await fetchDetail(item.kind, item.id);
    const est = item.yearEstimated || item.dynastyEstimated;
    detailEl.innerHTML = `
      <div class="detail-panel">
        <button class="x" aria-label="关闭">×</button>
        <div class="card-head">
          <span class="badge ${item.kind}">${item.kind === 'sword' ? '名剑' : '剑客'}</span>
          <b>${d.name}</b><span class="src">${d.source || ''}</span>
        </div>
        <div class="meta">${est ? '约 · ' : ''}${item.dynastyName} · ${yearsText(item)}${d.maker ? ` · 铸者 ${d.maker}` : ''}${d.role ? ` · ${d.role}` : ''}</div>
        <p>${d.summary || ''}</p>
        <p class="story">${d.story || ''}</p>
        ${relButtons(item)}
        <div class="detail-actions">
          <button class="copy-link">复制分享链接</button>
        </div>
      </div>`;
    detailEl.classList.add('open');
    detailEl.querySelector('.x').addEventListener('click', closeDetail);
    detailEl.querySelector('.copy-link').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#f=${String(item.id).split('@')[0]}`;
      try { await navigator.clipboard.writeText(url); showToast('链接已复制，分享后对方将看到同一视图'); }
      catch { showToast(url); }
    });
    for (const b of detailEl.querySelectorAll('.rel')) {
      b.addEventListener('click', () => {
        const t = state.byId.get(b.dataset.goto);
        if (t) { closeDetail(); focusItem(t); }
      });
    }
  } catch {
    showToast('详情获取失败');
  }
}
function closeDetail() { detailEl.classList.remove('open'); }
detailEl.addEventListener('click', e => { if (e.target === detailEl) closeDetail(); });

/* ================= 搜索 / 聚焦 ================= */

let focusTimer = 0;

function focusItem(item, jump = false) {
  const scale = Math.max(state.target.scale, M.ITEM_SCALE * 1.4);
  state.target.scale = scale;
  state.target.x = item.worldX * scale - state.vw / 2;
  clampCam(state.target);
  if (jump) state.cam = { ...state.target };
  state.focusId = item.id;
  state.focusUntil = performance.now() + 2400; // 高亮约 2 秒
  state.urlFocusId = String(item.id).split('@')[0]; // 持久焦点写入 URL
  selectItem(item, true);
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { if (state.focusId === item.id) state.focusId = null; }, 2400);
}

$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  const exact = state.items.filter(i => i.name === q);
  const pool = exact.length ? exact : state.items.filter(i => i.name.includes(q));
  if (!pool.length) { showToast(`未寻得「${q}」—— 江湖茫茫，查无此人此剑`); return; }
  pool.sort((a, b) =>
    ((a.kind === 'sword' ? 0 : 1) - (b.kind === 'sword' ? 0 : 1)) ||
    ((a.id.includes('@') ? 1 : 0) - (b.id.includes('@') ? 1 : 0)));
  focusItem(pool[0]);
  showToast(`已寻得「${pool[0].name}」`);
});

let toastTimer = 0;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ================= URL 状态 ================= */

function syncUrl() {
  const c = state.cam;
  let h = `#x=${Math.round(c.x)}&s=${c.scale.toFixed(2)}`;
  if (state.urlFocusId) h += `&f=${state.urlFocusId}`;
  history.replaceState(null, '', h);
}

function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const x = parseFloat(p.get('x')), s = parseFloat(p.get('s'));
  return { x: Number.isFinite(x) ? x : null, s: Number.isFinite(s) ? s : null, f: p.get('f') };
}

/* ================= 压力测试 ================= */

function expandForStress(items, K = 30) {
  const out = [];
  for (let k = 0; k < K; k++) {
    for (const it of items) {
      if (k === 0) { out.push(it); continue; } // k=0 保留原 id，搜索/链接不受影响
      const jitter = ((k * 37) % 61) - 30 + (k % 3);
      out.push({ ...it, id: `${it.id}@${k}`, year: it.year + jitter, worldX: M.yearToWorldX(it.year + jitter) });
    }
  }
  return out.sort((a, b) => a.worldX - b.worldX);
}

function applyItems() {
  state.items = state.stress ? expandForStress(state.baseItems) : state.baseItems;
  state.byId = new Map(state.items.map(i => [i.id, i]));
  const counts = new Map();
  for (const it of state.items) counts.set(it.dynastyName, (counts.get(it.dynastyName) || 0) + 1);
  state.aggregates = M.DYNASTIES
    .filter(d => counts.get(d.name))
    .map(d => ({
      key: d.name, label: d.name, count: counts.get(d.name),
      worldX: M.yearToWorldX((d.start + d.end) / 2),
      fromWorld: M.yearToWorldX(d.start), toWorld: M.yearToWorldX(d.end),
      w: M.estChipW(d.name, counts.get(d.name)),
    }));
  state.layoutDirty = true;
  state.layout = null;
  clearNodes(); clearChips();
}

$('#stressBtn').addEventListener('click', () => {
  state.stress = !state.stress;
  applyItems();
  $('#stressBtn').classList.toggle('on', state.stress);
  statsEl.classList.toggle('show', state.stress);
  showToast(state.stress ? `压力测试已开启：数据复制至 ${state.items.length} 条` : '压力测试已关闭');
});

/* ================= 启动 ================= */

function createBands() {
  const tints = M.DYNASTIES.map((_, i) => `rgba(46, 42, 38, ${0.045 + (i % 2) * 0.05})`);
  M.DYNASTIES.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'band';
    div._dyn = d;
    const prev = tints[Math.max(0, i - 1)];
    // 相邻朝代之间用渐变墨色过渡
    div.style.background = `linear-gradient(90deg, ${prev} 0, ${tints[i]} 44px)`;
    div.innerHTML = `<span class="band-name">${d.name}${d.estimated ? '<i>推定</i>' : ''}</span>`;
    bandsEl.appendChild(div);
  });
}

function resize() {
  state.vw = stage.clientWidth;
  state.vh = stage.clientHeight;
  clampCam(state.target); clampCam(state.cam);
}
window.addEventListener('resize', resize);
// iOS Safari 双指捏合默认会缩放整页，拦截后交由 pointer 事件处理
document.addEventListener('gesturestart', e => e.preventDefault());

async function init() {
  const [sw, sm] = await fetchAll();
  const all = [
    ...sw.items.map(i => ({ ...i, kind: 'sword' })),
    ...sm.items.map(i => ({ ...i, kind: 'swordsman' })),
  ];
  state.baseItems = all.map(i => M.normalizeItem(i)).sort((a, b) => a.worldX - b.worldX);
  applyItems();
  createBands();
  resize();

  const h = parseHash();
  if (h && h.x !== null && h.s !== null) {
    state.cam = { x: h.x, scale: h.s };
    state.target = { x: h.x, scale: h.s };
    clampCam(state.cam); clampCam(state.target);
  } else {
    fitAll();
  }
  requestAnimationFrame(loop);

  if (h && h.f) {
    const it = state.byId.get(h.f);
    if (it) setTimeout(() => focusItem(it, true), 350);
    else showToast('链接指向的条目未收录');
  }
}

init().catch(err => {
  console.error(err);
  showToast('数据加载失败，请确认后端已启动');
});
