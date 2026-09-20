import { useCallback, useEffect, useRef } from 'react';

/**
 * 卷轴节点动画引擎（单一 rAF 循环，所有逐帧变化只写 DOM ref，绝不触发 React 渲染）。
 *
 * 两类动画：
 * 1. 错落淡入（entrance）：节点挂载即注册，按顺序延迟，写 opacity / transform；
 * 2. 剑影高亮（glow）：搜索聚焦 2 秒脉冲 + 选中常亮，写 box-shadow / outline。
 *
 * 生命周期铁律：注册以节点 callback ref 为准，节点被虚拟化回收（unmount）时
 * 立刻从两张注册表移除；若循环内已无任何元素，cancelAnimationFrame 停帧。
 * 因此不存在「节点已回收、动画仍在跑」的游离元素。
 */

type GlowMode = 'focus' | 'selected';

interface EntranceItem {
  el: HTMLElement;
  born: number;
  delay: number;
}

interface GlowItem {
  el: HTMLElement;
  mode: GlowMode;
}

const ENTRANCE_MS = 420;
const MAX_STAGGER_MS = 260;

export interface EntranceEngine {
  registerEntrance: (key: string, el: HTMLElement | null, order: number) => void;
  setGlow: (key: string, el: HTMLElement | null, mode: GlowMode | null) => void;
}

export function useEntranceEngine(): EntranceEngine {
  const entrance = useRef<Map<string, EntranceItem>>(new Map());
  const glow = useRef<Map<string, GlowItem>>(new Map());
  const rafId = useRef<number | null>(null);

  const stopIfIdle = useCallback(() => {
    if (entrance.current.size === 0 && glow.current.size === 0 && rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  const ensureLoop = useCallback(() => {
    if (rafId.current !== null) return;
    const tick = (now: number) => {
      // —— 入场：淡入 + 自卷轴上方错落飘落 ——
      for (const [key, item] of entrance.current) {
        const t = (now - item.born - item.delay) / ENTRANCE_MS;
        if (t < 0) {
          item.el.style.opacity = '0';
          continue;
        }
        if (t >= 1) {
          item.el.style.opacity = '1';
          item.el.style.transform = '';
          entrance.current.delete(key);
          continue;
        }
        // easeOutCubic
        const e = 1 - Math.pow(1 - t, 3);
        item.el.style.opacity = e.toFixed(3);
        item.el.style.transform = `translateY(${(1 - e) * 16}px)`;
      }

      // —— 剑影：朱砂描边 + 金芒呼吸 ——
      for (const item of glow.current.values()) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        if (item.mode === 'focus') {
          const a = 0.55 + pulse * 0.45;
          item.el.style.boxShadow =
            `0 0 ${10 + pulse * 14}px rgba(196,30,58,${a.toFixed(2)}), ` +
            `0 0 2px rgba(196,30,58,0.9)`;
          item.el.style.outline = `2px solid rgba(196,30,58,${(0.85 - pulse * 0.35).toFixed(2)})`;
        } else {
          item.el.style.boxShadow =
            `0 0 ${8 + pulse * 12}px rgba(212,175,55,${(0.35 + pulse * 0.4).toFixed(2)})`;
          item.el.style.outline = '';
        }
      }

      if (entrance.current.size === 0 && glow.current.size === 0) {
        rafId.current = null;
        return;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  }, []);

  const registerEntrance = useCallback(
    (key: string, el: HTMLElement | null, order: number) => {
      if (!el) {
        // 节点卸载（虚拟化回收）：立即摘除其全部动画，杜绝游离帧
        entrance.current.delete(key);
        glow.current.delete(key);
        stopIfIdle();
        return;
      }
      const delay = Math.min(MAX_STAGGER_MS, (order % 12) * 24);
      el.style.opacity = '0';
      entrance.current.set(key, { el, born: performance.now(), delay });
      ensureLoop();
    },
    [ensureLoop, stopIfIdle],
  );

  const setGlow = useCallback(
    (key: string, el: HTMLElement | null, mode: GlowMode | null) => {
      const existing = glow.current.get(key);
      if (existing && (!el || !mode)) {
        existing.el.style.boxShadow = '';
        existing.el.style.outline = '';
        glow.current.delete(key);
        stopIfIdle();
        return;
      }
      if (el && mode) {
        glow.current.set(key, { el, mode });
        ensureLoop();
      }
    },
    [ensureLoop, stopIfIdle],
  );

  useEffect(() => () => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    entrance.current.clear();
    glow.current.clear();
  }, []);

  return { registerEntrance, setGlow };
}
