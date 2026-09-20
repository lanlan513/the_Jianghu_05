import { memo, useEffect, useRef } from 'react';
import { Sword, User } from 'lucide-react';
import type { LaidNode } from '../../chronicle/lanes';

/**
 * 卷轴节点：
 * - 剑 = 菱形墨符（rotate45° 墨底 + 剑形），剑客 = 朱砂圆圈 + 人形；
 * - 入场与光晕由 rAF 引擎直接写此节点 DOM。
 *
 * 生命周期：callback ref 只在「挂载/卸载」时向引擎注册/注销一次，
 * 父组件滚动导致的普通重渲染（如 order 变化）不会重放入场动画；
 * 节点被虚拟化回收（unmount）的同一帧，其入场与光晕一并注销，
 * 不存在脱离节点而独立存活的动画元素。
 */
export interface NodeMarkerProps {
  node: LaidNode;
  selected: boolean;
  focused: boolean;
  entranceRef: (key: string, el: HTMLElement | null, order: number) => void;
  glowRef: (key: string, el: HTMLElement | null, mode: 'focus' | 'selected' | null) => void;
  /** 挂载瞬间在可视序列中的序号，用于错落延迟 */
  order: number;
  onSelect: (node: LaidNode) => void;
}

function NodeMarkerInner({
  node,
  selected,
  focused,
  entranceRef,
  glowRef,
  order,
  onSelect,
}: NodeMarkerProps) {
  const { entry } = node;
  const isSword = entry.kind === 'sword';
  const elRef = useRef<HTMLButtonElement | null>(null);

  // 仅挂载/卸载时各执行一次：入场注册与回收
  useEffect(() => {
    entranceRef(entry.id, elRef.current, order);
    return () => entranceRef(entry.id, null, order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // 高亮状态变化或卸载时同步给 rAF 引擎
  useEffect(() => {
    glowRef(entry.id, elRef.current, focused ? 'focus' : selected ? 'selected' : null);
    return () => glowRef(entry.id, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, focused, selected]);

  return (
    <button
      ref={elRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      className="absolute flex flex-col items-center justify-start outline-none group"
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height + 26,
        willChange: 'transform, opacity',
        touchAction: 'manipulation',
      }}
      aria-label={`${isSword ? '名剑' : '剑客'}：${entry.name}`}
    >
      <span
        className={[
          'flex items-center justify-center transition-transform duration-200 group-hover:scale-110',
          isSword
            ? 'w-9 h-9 rotate-45 bg-gradient-to-br from-ink-700 to-ink-900 border border-gold-400/70 shadow-ink'
            : 'w-9 h-9 rounded-full bg-gradient-to-br from-cinnabar-500 to-cinnabar-700 border border-gold-300/70 shadow-ink',
          entry.generated ? 'opacity-70' : '',
        ].join(' ')}
      >
        {isSword ? (
          <Sword className="w-4 h-4 -rotate-45 text-gold-200" strokeWidth={1.8} />
        ) : (
          <User className="w-4 h-4 text-ink-50" strokeWidth={1.8} />
        )}
      </span>
      <span
        className={[
          'mt-1 text-[11px] leading-tight font-song text-ink-900 text-center max-w-[64px]',
          'truncate group-hover:text-cinnabar-700 transition-colors',
          selected ? 'text-cinnabar-700 font-semibold' : '',
        ].join(' ')}
      >
        {entry.name}
      </span>
      {entry.brokenSwordRefs.length > 0 && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-gold-400 border border-ink-900/40" title="佩剑已佚（名剑谱中查无此剑）" />
      )}
    </button>
  );
}

export const NodeMarker = memo(NodeMarkerInner);
