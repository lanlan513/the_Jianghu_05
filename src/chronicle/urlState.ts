/**
 * 视口与搜索焦点的 URL 编解码：纯函数。
 *
 * 查询参数：
 *   g  粒度 era | century | item（非法值回退 era）
 *   y  视口中心年份（公元纪年，负为公元前；非法则默认春秋中段）
 *   t  压力测试开关 1/0（1 时数据集确定性扩到上千条）
 *   q  搜索焦点名剑（进入即定位并高亮两秒）
 */
import { GRANULARITY_ORDER, type Granularity } from './scale';
import { ERAS } from './eras';

export interface ChronicleViewState {
  readonly granularity: Granularity;
  readonly centerYear: number;
  readonly stress: boolean;
  readonly focus: string;
}

export function defaultViewState(): ChronicleViewState {
  const chunqiu = ERAS.find((e) => e.id === 'chunqiu')!;
  return {
    granularity: 'era',
    centerYear: Math.round((chunqiu.domain[0] + chunqiu.domain[1]) / 2),
    stress: false,
    focus: '',
  };
}

function parseGranularity(v: string | null): Granularity {
  return (GRANULARITY_ORDER as string[]).includes(v ?? '')
    ? (v as Granularity)
    : 'era';
}

/** 纯函数：解析 URL 查询串。任何字段缺失/非法均回退默认值，保证刷新不白屏 */
export function parseViewState(search: string): ChronicleViewState {
  const fallback = defaultViewState();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return fallback;
  }

  const yearRaw = params.get('y');
  let centerYear = fallback.centerYear;
  if (yearRaw !== null) {
    const n = Number(yearRaw);
    const min = ERAS[0].domain[0];
    const max = ERAS[ERAS.length - 1].domain[1];
    if (Number.isFinite(n)) centerYear = Math.min(max, Math.max(min, n));
  }

  const focus = (params.get('q') ?? '').trim().slice(0, 24);

  return {
    granularity: parseGranularity(params.get('g')),
    centerYear,
    stress: params.get('t') === '1',
    focus,
  };
}

/** 纯函数：序列化视图状态（只写与默认不同的字段，URL 短而稳定） */
export function serializeViewState(state: ChronicleViewState): string {
  const def = defaultViewState();
  const params = new URLSearchParams();
  if (state.granularity !== def.granularity) params.set('g', state.granularity);
  if (Math.round(state.centerYear) !== Math.round(def.centerYear)) {
    params.set('y', String(Math.round(state.centerYear)));
  }
  if (state.stress) params.set('t', '1');
  if (state.focus) params.set('q', state.focus);
  const qs = params.toString();
  return qs ? `/chronicle?${qs}` : '/chronicle';
}
