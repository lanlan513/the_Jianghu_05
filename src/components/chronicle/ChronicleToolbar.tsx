import { useEffect, useRef, useState } from 'react';
import { Search, SearchX, ZoomIn, ZoomOut, Gauge, Loader2 } from 'lucide-react';
import { GRANULARITY_LABEL, GRANULARITY_ORDER, type Granularity } from '../../chronicle/scale';

/**
 * 卷轴顶栏：搜索（定位名剑/剑客并高亮）、粒度切换、压力测试开关、实时渲染计数。
 * 纯受控组件：状态全部由页面持有，便于写入 URL。
 */
export interface ChronicleToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  searching: boolean;
  searchError: string;
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  stress: boolean;
  onStress: (on: boolean) => void;
  totalEntries: number;
  renderedCount: number;
}

export function ChronicleToolbar({
  query,
  onQuery,
  searching,
  searchError,
  granularity,
  onGranularity,
  stress,
  onStress,
  totalEntries,
  renderedCount,
}: ChronicleToolbarProps) {
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(query), [query]);

  const submit = () => onQuery(draft.trim());

  return (
    <header className="sticky top-16 z-40 bg-ink-100/92 backdrop-blur-sm border-b border-ink-200">
      <div className="px-3 md:px-6 py-2.5 flex flex-wrap items-center gap-2 md:gap-4">
        <div className="font-brush text-2xl text-ink-900 hidden sm:block whitespace-nowrap">
          江湖编年史
        </div>

        {/* 搜索 */}
        <form
          className="relative flex-1 min-w-[200px] max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-700" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="搜名剑或剑客，如：湛卢、赵云"
            className="w-full pl-8 pr-20 py-1.5 text-sm font-song bg-ink-50 border border-ink-300 focus:border-cinnabar-600 focus:outline-none rounded-sm"
            aria-label="搜索名剑或剑客"
          />
          <button
            type="submit"
            disabled={searching}
            className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-ink-800 text-ink-50 hover:bg-cinnabar-700 disabled:opacity-60 rounded-sm inline-flex items-center gap-1"
          >
            {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            定位
          </button>
        </form>

        {/* 粒度切换（显示当前粒度） */}
        <div className="inline-flex items-center border border-ink-300 rounded-sm overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const i = GRANULARITY_ORDER.indexOf(granularity);
              if (i > 0) onGranularity(GRANULARITY_ORDER[i - 1]);
            }}
            disabled={granularity === GRANULARITY_ORDER[0]}
            className="px-1.5 py-1 text-ink-800 hover:bg-ink-200 disabled:opacity-30"
            aria-label="缩小一级"
            title="缩小一级"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2 text-xs font-song text-ink-900 min-w-[3.2rem] text-center border-x border-ink-300 bg-ink-50 py-1" title="当前粒度">
            {GRANULARITY_LABEL[granularity]}
          </span>
          <button
            type="button"
            onClick={() => {
              const i = GRANULARITY_ORDER.indexOf(granularity);
              if (i < GRANULARITY_ORDER.length - 1) onGranularity(GRANULARITY_ORDER[i + 1]);
            }}
            disabled={granularity === GRANULARITY_ORDER[GRANULARITY_ORDER.length - 1]}
            className="px-1.5 py-1 text-ink-800 hover:bg-ink-200 disabled:opacity-30"
            aria-label="放大一级"
            title="放大一级（或 Ctrl/⌘ + 滚轮）"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <div className="hidden md:flex gap-1">
          {GRANULARITY_ORDER.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGranularity(g)}
              className={`px-2 py-1 text-xs rounded-sm border ${
                g === granularity
                  ? 'bg-cinnabar-600 text-ink-50 border-cinnabar-700'
                  : 'bg-ink-50 text-ink-800 border-ink-300 hover:border-ink-500'
              }`}
            >
              {GRANULARITY_LABEL[g]}
            </button>
          ))}
        </div>

        {/* 压力测试 */}
        <label className="inline-flex items-center gap-1.5 text-xs font-song text-ink-900 cursor-pointer select-none whitespace-nowrap" title="把数据确定性地复制扩充到上千条，验证虚拟化">
          <Gauge className="w-4 h-4 text-ink-700" />
          <input
            type="checkbox"
            checked={stress}
            onChange={(e) => onStress(e.target.checked)}
            className="accent-cinnabar-600"
          />
          千节点压测
        </label>

        {/* 实时计数：验证「渲染节点数常数级」 */}
        <div className="text-[11px] text-ink-700 whitespace-nowrap ml-auto" title="实际挂载到 DOM 的节点数（含缓冲带）">
          共 <span className="text-ink-900 font-semibold">{totalEntries.toLocaleString()}</span> 谱
          ｜ 实绘 <span className="text-cinnabar-700 font-semibold">{renderedCount}</span> 节点
        </div>
      </div>
      {searchError && (
        <div className="px-3 md:px-6 pb-2 text-xs text-cinnabar-700 inline-flex items-center gap-1">
          <SearchX className="w-3.5 h-3.5" /> {searchError}
        </div>
      )}
    </header>
  );
}
