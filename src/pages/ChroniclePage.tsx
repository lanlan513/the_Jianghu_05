import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { swordApi, swordsmanApi } from '@/api';
import {
  buildEraBands,
  buildTicks,
  createScale,
  GRANULARITY_LABEL,
  xToYear,
  yearToX,
  AXIS_HEIGHT,
  LANE_HEIGHT,
  type Granularity,
} from '@/chronicle/scale';
import {
  normalizeEntries,
  searchEntries,
  withStressEntries,
  type TimelineEntry,
} from '@/chronicle/entries';
import { buildLaneLayout, type LaidNode } from '@/chronicle/lanes';
import { makeViewWindow, visibleNodes } from '@/chronicle/viewport';
import { parseViewState, serializeViewState } from '@/chronicle/urlState';
import { useEntranceEngine } from '@/chronicle/useEntranceEngine';
import { ChronicleToolbar } from '@/components/chronicle/ChronicleToolbar';
import { NodeMarker } from '@/components/chronicle/NodeMarker';
import { NodeCard } from '@/components/chronicle/NodeCard';

const STRESS_TOTAL = 2048;
const CONTAINER_HEIGHT = 'calc(100vh - 7.5rem)';
/** 压测下泳道可能上百；限制内容层高度，纵向滚动浏览，避免页面无限拉高 */
const MAX_LANES_DOM = 10;

type LoadState = 'loading' | 'ready' | 'error';

export default function ChroniclePage() {
  const location = useLocation();
  const navigate = useNavigate();
  // 仅以首次挂载时的 URL 为准；后续视图状态由页面自己写回
  const [initial] = useState(() => parseViewState(location.search));

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [realEntries, setRealEntries] = useState<readonly TimelineEntry[]>([]);
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity);
  const [stress, setStress] = useState(initial.stress);
  const [query, setQuery] = useState(initial.focus);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [visible, setVisible] = useState<readonly LaidNode[]>([]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** 缩放/搜索后要保持在视口中心的年份；消费一次后清空 */
  const anchorYearRef = useRef<number | null>(initial.centerYear);
  /** 粒度切换完成后才执行的搜索（保证在新尺度上定位） */
  const pendingSearchRef = useRef<{ query: string; fromUrl: boolean } | null>(null);
  const rafScrollRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const didInitialLocateRef = useRef(false);
  const urlWriteTimerRef = useRef<number | null>(null);

  const engine = useEntranceEngine();

  // —— 数据：只走后端读取接口 ——
  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [swordRes, swordsmen] = await Promise.all([
        swordApi.getSwords({ limit: 10000, sortBy: 'name', sortOrder: 'asc' }),
        swordsmanApi.getSwordsmen(10000),
      ]);
      setRealEntries(normalizeEntries(swordRes.list, swordsmen));
      setLoadState('ready');
    } catch (err) {
      console.error('编年史数据加载失败', err);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // —— 派生（全部 useMemo，底层为纯函数）——
  const entries = useMemo(
    () => (stress ? withStressEntries(realEntries, STRESS_TOTAL) : realEntries),
    [realEntries, stress],
  );
  const scale = useMemo(() => createScale(granularity), [granularity]);
  const bands = useMemo(() => buildEraBands(scale), [scale]);
  const ticks = useMemo(() => buildTicks(scale), [scale]);
  const layout = useMemo(() => buildLaneLayout(entries, scale), [entries, scale]);
  const nodeById = useMemo(() => {
    const m = new Map<string, LaidNode>();
    for (const n of layout.nodes) m.set(n.entry.id, n);
    return m;
  }, [layout]);

  // —— 视口尺寸测量 ——
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loadState]);

  // —— 纯函数：当前视窗 → 二分查找可视节点 ——
  const recomputeVisible = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const win = makeViewWindow(el.scrollLeft, el.scrollTop, el.clientWidth, el.clientHeight);
    setVisible(visibleNodes(layout, win));
  }, [layout]);

  // 布局变化后立即重算（避免空白帧）
  useLayoutEffect(() => {
    recomputeVisible();
  }, [recomputeVisible, viewport.w, viewport.h]);

  // —— 定位滚动到指定节点（横向居中、纵向尽量居中）——
  const scrollToNode = useCallback(
    (node: LaidNode) => {
      const el = scrollerRef.current;
      if (!el) return;
      const x = node.x + node.width / 2 - el.clientWidth / 2;
      const y = node.y + node.height / 2 - el.clientHeight / 2;
      const maxScrollH = Math.max(0, layout.contentHeight - el.clientHeight);
      el.scrollTo({
        left: Math.max(0, Math.min(scale.totalWidth - el.clientWidth, x)),
        top: Math.max(0, Math.min(maxScrollH, y)),
        behavior: 'auto',
      });
      setScrollLeft(el.scrollLeft);
      setScrollTop(el.scrollTop);
      recomputeVisible();
    },
    [scale.totalWidth, layout.contentHeight, recomputeVisible],
  );

  // —— 搜索：纯函数匹配；无结果给内联提示 ——
  // 若需要切换粒度，先排队，等新尺度应用后的 layout effect 再定位。
  const runSearch = useCallback(
    (q: string, opts: { fromUrl?: boolean } = {}) => {
      const keyword = q.trim();
      setSearchError('');
      if (!keyword) {
        setFocusId(null);
        setQuery('');
        return;
      }
      setSearching(true);
      requestAnimationFrame(() => {
        const hits = searchEntries(entries, keyword);
        if (hits.length === 0) {
          setSearchError(`谱中查无「${keyword}」——可换个别名、朝代或简体写法再试。`);
          setFocusId(null);
          setSearching(false);
          return;
        }
        const hitEntry = hits[0].entry;
        setQuery(keyword);
        setFocusId(hitEntry.id);
        setSelectedId(hitEntry.id);
        if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = window.setTimeout(() => setFocusId(null), 2000);
        // 名剑/剑客搜索自动进入「单件」粒度，确保目标落在不重叠的泳道上；
        // 从 URL 恢复时若已是单件粒度则不打断；其余粒度排队等尺度切换后再定位
        if (granularity !== 'item' && !opts.fromUrl) {
          pendingSearchRef.current = { query: keyword, fromUrl: false };
          anchorYearRef.current = hitEntry.year;
          setGranularity('item');
        } else {
          const node = nodeById.get(hitEntry.id);
          if (node) scrollToNode(node);
        }
        setSearching(false);
      });
    },
    [entries, nodeById, granularity, scrollToNode],
  );

  // 新尺度挂载后：先应用锚点滚动；若有排队搜索，再在新布局上精确定位
  useLayoutEffect(() => {
    if (viewport.w === 0 || anchorYearRef.current === null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const x = yearToX(anchorYearRef.current, scale);
    el.scrollLeft = Math.max(0, Math.min(scale.totalWidth - el.clientWidth, x - el.clientWidth / 2));
    setScrollLeft(el.scrollLeft);
    anchorYearRef.current = null;
    recomputeVisible();

    const pending = pendingSearchRef.current;
    if (pending) {
      pendingSearchRef.current = null;
      const hits = searchEntries(entries, pending.query);
      const node = hits.length ? nodeById.get(hits[0].entry.id) : undefined;
      if (node) scrollToNode(node);
    }
  }, [scale, viewport.w, recomputeVisible, entries, nodeById, scrollToNode]);

  // —— 初始定位（URL 的 y）与初始搜索（URL 的 q）——
  useLayoutEffect(() => {
    if (loadState !== 'ready' || viewport.w === 0 || didInitialLocateRef.current) return;
    didInitialLocateRef.current = true;
    const el = scrollerRef.current!;
    const x = yearToX(initial.centerYear, scale);
    el.scrollLeft = Math.max(0, Math.min(scale.totalWidth - el.clientWidth, x - el.clientWidth / 2));
    setScrollLeft(el.scrollLeft);
    setScrollTop(el.scrollTop);
    recomputeVisible();
    if (initial.focus) {
      // 初始焦点：非单件粒度（来自分享链接）也排队切到单件，确保目标清晰可定位
      if (initial.granularity !== 'item') {
        pendingSearchRef.current = { query: initial.focus, fromUrl: true };
        const hits = searchEntries(entries, initial.focus);
        anchorYearRef.current = hits.length ? hits[0].entry.year : initial.centerYear;
        setGranularity('item');
      } else {
        runSearch(initial.focus, { fromUrl: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, viewport.w]);

  // —— 滚动事件：rAF 合帧后才 setState，避免逐帧 React 渲染 ——
  const onScroll = useCallback(() => {
    if (rafScrollRef.current !== null) return;
    rafScrollRef.current = requestAnimationFrame(() => {
      rafScrollRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      const { scrollLeft: sl, scrollTop: st } = el;
      setScrollLeft(sl);
      setScrollTop(st);
      recomputeVisible();
    });
  }, [recomputeVisible]);

  useEffect(() => () => {
    if (rafScrollRef.current !== null) cancelAnimationFrame(rafScrollRef.current);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    if (urlWriteTimerRef.current !== null) window.clearTimeout(urlWriteTimerRef.current);
  }, []);

  // —— 缩放：保持视口中心年份不动 ——
  const changeGranularity = useCallback(
    (next: Granularity) => {
      if (next === granularity) return;
      const el = scrollerRef.current;
      const centerYear = el
        ? xToYear(el.scrollLeft + el.clientWidth / 2, scale)
        : initial.centerYear;
      setSelectedId(null);
      setGranularity(next);
      anchorYearRef.current = centerYear;
    },
    [granularity, scale, initial.centerYear],
  );

  // Ctrl/⌘ + 滚轮缩放（触摸板横向滚动不受影响，规避移动端拖拽冲突）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const order = ['era', 'century', 'item'] as Granularity[];
      const idx = order.indexOf(granularity);
      const nextIdx = Math.max(0, Math.min(2, idx + dir));
      if (nextIdx !== idx) changeGranularity(order[nextIdx]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [granularity, changeGranularity]);

  // —— 鼠标拖拽滚动（仅鼠标；触屏交给原生触摸滚动，杜绝横向拖拽/滚动手势冲突）——
  const drag = useRef<{ startX: number; startY: number; startScrollX: number; startScrollY: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target as HTMLElement;
      if (t.closest('button, a, input, label, [data-no-drag]')) return;
      drag.current = { startX: e.clientX, startY: e.clientY, startScrollX: el.scrollLeft, startScrollY: el.scrollTop, moved: false };
      el.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true;
      el.scrollLeft = d.startScrollX - dx;
      el.scrollTop = d.startScrollY - dy;
    };
    const end = (e: PointerEvent) => {
      if (!drag.current) return;
      el.style.cursor = '';
      // 拖拽后抑制随之而来的 click，防止误弹卡片
      if (drag.current.moved) {
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          window.removeEventListener('click', swallow, true);
        };
        window.addEventListener('click', swallow, true);
      }
      drag.current = null;
      void e;
    };
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', end);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', end);
    };
  }, []);

  // —— URL：视口与搜索焦点写入；防抖 replaceState，刷新/分享回到同一视图 ——
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (urlWriteTimerRef.current !== null) window.clearTimeout(urlWriteTimerRef.current);
    urlWriteTimerRef.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      const centerYear = el
        ? xToYear(el.scrollLeft + el.clientWidth / 2, scale)
        : initial.centerYear;
      const next = serializeViewState({
        granularity,
        centerYear,
        stress,
        focus: query,
      });
      navigate(next, { replace: true });
    }, 320);
    return () => {
      if (urlWriteTimerRef.current !== null) window.clearTimeout(urlWriteTimerRef.current);
    };
  }, [scrollLeft, granularity, stress, query, loadState, scale, navigate, initial.centerYear]);

  // 浏览器前进/后退
  useEffect(() => {
    const onPop = () => {
      const s = parseViewState(window.location.search);
      setGranularity(s.granularity);
      setStress(s.stress);
      setQuery(s.focus);
      anchorYearRef.current = s.centerYear;
      if (!s.focus) setFocusId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  // 内容层高度：超过 MAX_LANES_DOM 条泳道时封顶（节点仍可经纵向滚动到达）
  const contentHeight = Math.min(
    layout.contentHeight,
    AXIS_HEIGHT + MAX_LANES_DOM * LANE_HEIGHT + 24,
  );
  // 横向也虚拟化刻度，避免上千刻度常驻 DOM
  const ticksInView = ticks.filter(
    (t) => t.x >= scrollLeft - 100 && t.x <= scrollLeft + viewport.w + 100,
  );
  const bandsInView = bands.filter(
    (b) => b.x0 + b.width >= scrollLeft - 120 && b.x0 <= scrollLeft + viewport.w + 120,
  );

  // 图例 / 兜底说明
  const legend = (
    <div className="absolute z-10 right-3 bottom-3 bg-ink-50/85 border border-ink-300 px-3 py-2 text-[11px] font-song text-ink-800 space-y-1 pointer-events-none">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rotate-45 bg-ink-800 border border-gold-400/70 inline-block" /> 名剑
        <span className="w-3 h-3 rounded-full bg-cinnabar-600 inline-block ml-2" /> 剑客
      </div>
      <div className="text-ink-600">当前粒度：{GRANULARITY_LABEL[granularity]} ｜ Ctrl+滚轮缩放</div>
      <div className="text-ink-600">横向拖动卷轴；触屏可直接滑动</div>
    </div>
  );

  return (
    <div className="pt-16 bg-ink-100">
      <ChronicleToolbar
        query={query}
        onQuery={(q) => runSearch(q)}
        searching={searching}
        searchError={searchError}
        granularity={granularity}
        onGranularity={changeGranularity}
        stress={stress}
        onStress={(on) => {
          setStress(on);
          setSelectedId(null);
          setFocusId(null);
        }}
        totalEntries={entries.length}
        renderedCount={visible.length}
      />

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="relative overflow-auto bg-ink-100 select-none"
        style={{
          height: CONTAINER_HEIGHT,
          overscrollBehaviorX: 'contain',
          touchAction: 'pan-x pan-y',
          cursor: 'grab',
        }}
        onClick={() => setSelectedId(null)}
      >
        {loadState === 'loading' && (
          <div className="h-full w-full flex items-center justify-center text-ink-700 font-song">
            正在展卷……
          </div>
        )}
        {loadState === 'error' && (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-ink-800 font-song">
            <p>卷轴尘封，数据未能取来。</p>
            <button onClick={load} className="px-4 py-1.5 bg-cinnabar-600 text-ink-50 text-sm">
              重新展卷
            </button>
          </div>
        )}
        {loadState === 'ready' && entries.length === 0 && (
          <div className="h-full w-full flex items-center justify-center text-ink-700 font-song">
            卷中无名，空无一物。
          </div>
        )}

        {loadState === 'ready' && entries.length > 0 && viewport.w > 0 && (
          <div
            className="relative"
            style={{ width: scale.totalWidth, height: contentHeight }}
          >
            {/* 朝代墨色带：相邻朝代交界处前后墨色渐变过渡（仅渲染视口内的带） */}
            <div className="absolute left-0 right-0" style={{ top: 0, height: AXIS_HEIGHT + 18 }}>
              {bandsInView.map((band) => {
                const globalIndex = bands.findIndex((b) => b.eraId === band.eraId);
                const isLast = globalIndex === bands.length - 1;
                const fade = 46;
                const fadeLeft = globalIndex === 0 ? 0 : fade;
                const fadeRight = isLast ? 0 : fade;
                return (
                  <div
                    key={band.eraId}
                    className="absolute top-0 h-full flex items-start justify-center"
                    style={{
                      left: band.x0,
                      width: band.width,
                      paddingTop: 8,
                      background: `linear-gradient(90deg, ${band.inkLeft} 0%, ${band.ink} ${Math.min(40, (fadeLeft / Math.max(1, band.width)) * 100)}%, ${band.ink} ${Math.max(60, 100 - (fadeRight / Math.max(1, band.width)) * 100)}%, ${band.inkRight} 100%)`,
                    }}
                    title={`${band.name}：${band.note}`}
                  >
                    {band.width > 54 && (
                      <span className="font-brush text-ink-800/80 text-sm md:text-base whitespace-nowrap pointer-events-none">
                        {band.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 主轴与刻度（同样横向虚拟化） */}
            <div className="absolute left-0 right-0" style={{ top: AXIS_HEIGHT - 6 }}>
              <div className="absolute left-0 right-0 h-px bg-ink-800/50" style={{ top: 0 }} />
              {ticksInView.map((tick, i) => (
                <div
                  key={`${tick.year}-${i}`}
                  className="absolute"
                  style={{ left: tick.x, top: 0 }}
                >
                  <div
                    className={tick.major ? 'w-px bg-ink-800/70' : 'w-px bg-ink-800/30'}
                    style={{ height: tick.major ? 12 : 7, marginLeft: -0.5 }}
                  />
                  {tick.major && (
                    <span className="absolute top-3 left-1 -translate-x-1/2 text-[10px] text-ink-700 whitespace-nowrap font-song">
                      {tick.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* 虚拟节点：只挂载可视区（二分查找）结果；卸载即随动画引擎回收 */}
            {visible.map((node, idx) => (
              <NodeMarker
                key={node.entry.id}
                node={node}
                order={idx}
                selected={selectedId === node.entry.id}
                focused={focusId === node.entry.id}
                entranceRef={engine.registerEntrance}
                glowRef={engine.setGlow}
                onSelect={(n) => {
                  setSelectedId(n.entry.id);
                }}
              />
            ))}

            {/* 选中卡片（与节点同处内容层，随滚动自然移动） */}
            {selectedNode && (
              <NodeCard
                node={selectedNode}
                scrollTop={scrollTop}
                viewportHeight={viewport.h}
                scrollLeft={scrollLeft}
                viewportWidth={viewport.w}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        )}
        {legend}
      </div>
    </div>
  );
}
