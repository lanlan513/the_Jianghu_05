import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Sword, User, MapPin, AlertTriangle, HelpCircle } from 'lucide-react';
import type { LaidNode } from '../../chronicle/lanes';
import { formatYear } from '../../chronicle/scale';

/**
 * 节点卡片：以内容坐标绝对定位在节点旁（因此随卷轴原生滚动而移动，零 JS 跟随）。
 * 它不是动画节点，不参与虚拟化——关闭即卸载；位置在渲染时按视口横向夹取。
 */
export interface NodeCardProps {
  node: LaidNode;
  /** 纵向视口信息，用于决定卡片展于节点上方还是下方 */
  scrollTop: number;
  viewportHeight: number;
  scrollLeft: number;
  viewportWidth: number;
  onClose: () => void;
}

const CARD_WIDTH = 300;
const CARD_ESTIMATE_HEIGHT = 260;
const GAP = 14;

export function NodeCard({
  node,
  scrollTop,
  viewportHeight,
  scrollLeft,
  viewportWidth,
  onClose,
}: NodeCardProps) {
  const { entry } = node;
  const isSword = entry.kind === 'sword';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 横向夹取：卡片中心尽量对齐节点，但不超出当前视口
  const targetCenter = node.x + node.width / 2;
  let cardX = targetCenter - CARD_WIDTH / 2;
  const minX = scrollLeft + 12;
  const maxX = scrollLeft + viewportWidth - CARD_WIDTH - 12;
  cardX = maxX > minX ? Math.min(maxX, Math.max(minX, cardX)) : scrollLeft + 8;

  // 纵向：下方放不下（超出视口）则翻到上方
  const belowTop = node.y + node.height + GAP;
  const aboveTop = node.y - CARD_ESTIMATE_HEIGHT - GAP;
  const placeAbove =
    belowTop + CARD_ESTIMATE_HEIGHT > scrollTop + viewportHeight && aboveTop > scrollTop - 40;
  const cardTop = Math.max(scrollTop + 8, placeAbove ? aboveTop : belowTop);

  const detailTo = isSword ? `/swords/${entry.rawId}` : `/swordsmen/${entry.rawId}`;

  return (
    <div
      className="absolute z-30"
      style={{ left: cardX, width: CARD_WIDTH, top: cardTop }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ink-card rounded-sm p-4 shadow-ink-hover animate-ink-spread bg-ink-50">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`flex items-center justify-center w-7 h-7 shrink-0 ${isSword ? 'bg-ink-800 text-gold-300 rotate-45' : 'rounded-full bg-cinnabar-600 text-ink-50'}`}>
              {isSword ? <Sword className="w-3.5 h-3.5 -rotate-45" /> : <User className="w-3.5 h-3.5" />}
            </span>
            <div>
              <div className="font-brush text-xl leading-none text-ink-900">{entry.name}</div>
              <div className="text-xs text-ink-700 mt-1">{entry.sub}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-700 hover:text-cinnabar-600 p-1 -m-1"
            aria-label="关闭卡片"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-ink-200/70 text-ink-900">
            <MapPin className="w-3 h-3" />{entry.dynastyName}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gold-100 text-gold-800">
            {formatYear(entry.year)} 年
          </span>
          {entry.inferred && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-bronze-100 text-bronze-800" title={entry.yearNote}>
              <HelpCircle className="w-3 h-3" />推定
            </span>
          )}
          {entry.brokenSwordRefs.length > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-cinnabar-100 text-cinnabar-800"
              title={`佚剑编号：${entry.brokenSwordRefs.join('、')}`}
            >
              <AlertTriangle className="w-3 h-3" />佩剑已佚
            </span>
          )}
          {entry.generated && (
            <span className="inline-flex items-center px-2 py-0.5 bg-ink-300/70 text-ink-900">压测模拟</span>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-700 line-clamp-4">{entry.yearNote}</p>

        <div className="mt-3 flex items-center justify-between">
          {!entry.generated ? (
            <Link
              to={detailTo}
              className="text-sm text-cinnabar-700 hover:text-cinnabar-900 font-song underline underline-offset-4"
            >
              观其详情 →
            </Link>
          ) : (
            <span className="text-xs text-ink-600">模拟条目，无详情页</span>
          )}
          <span className="text-[11px] text-ink-600">Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
