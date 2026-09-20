/**
 * 朝代年代学表。
 *
 * 两套区间各司其职：
 * - range：史料/通行说法的政治纪年区间，用于绘制墨色带，允许重叠（如三国与汉末）；
 * - domain：时间轴上互不重叠的「尺度域」。并立或过渡朝代以建立年取整切分，
 *   从而保证 年份→x 是严格单调的单射（重叠区间在尺度上不再重叠）。
 *
 * 年份约定：整数公元纪年，负数 = 公元前（1:1 粗略映射，不做「公元零年」天文换算）。
 */

export interface EraDef {
  id: string;
  name: string;
  /** 政治纪年区间（墨色带展示用，半开区间，可与邻朝重叠） */
  range: [number, number];
  /** 时间轴尺度域（互不重叠、首尾相接） */
  domain: [number, number];
  /** 朝代粒度下该段像素宽 */
  width: number;
  /** 墨色带主色（低透明度墨色，交替偏赭/偏青） */
  ink: string;
  /** 一句话纪年依据，用于「兜底映射说明」 */
  note: string;
}

export const ERAS: EraDef[] = [
  {
    id: 'shanggu', name: '上古', range: [-3000, -2070], domain: [-3000, -2070], width: 268,
    ink: 'rgba(86, 66, 44, 0.16)',
    note: '传说时代无确切纪年，取黄帝至夏建立前的象征性区间 前3000–前2070。',
  },
  {
    id: 'xiashang', name: '夏商', range: [-2070, -1046], domain: [-2070, -1046], width: 208,
    ink: 'rgba(60, 52, 40, 0.12)',
    note: '夏（约前2070–前1600）与商（约前1600–前1046）合段，据夏商周断代工程约数。',
  },
  {
    id: 'xizhou', name: '西周', range: [-1046, -771], domain: [-1046, -771], width: 140,
    ink: 'rgba(70, 62, 72, 0.11)',
    note: '武王克商（前1046）至平王东迁（前770）。',
  },
  {
    id: 'chunqiu', name: '春秋', range: [-770, -476], domain: [-771, -453], width: 186,
    ink: 'rgba(52, 66, 58, 0.12)',
    note: '春秋止于前476；与战国（始于前403/前475）的尺度分界取两者中位点前453。',
  },
  {
    id: 'zhanguo', name: '战国', range: [-475, -221], domain: [-453, -221], width: 186,
    ink: 'rgba(78, 56, 48, 0.12)',
    note: '三家分晋至秦统一（前221）。',
  },
  {
    id: 'qin', name: '秦', range: [-221, -202], domain: [-221, -202], width: 104,
    ink: 'rgba(64, 56, 52, 0.13)',
    note: '含秦末楚汉相争（前206–前202），故尺度域止于汉建立。',
  },
  {
    id: 'han', name: '汉', range: [-202, 220], domain: [-202, 208], width: 232,
    ink: 'rgba(54, 60, 72, 0.11)',
    note: '西汉（前202–8）与东汉（25–220），含新莽；尺度上以建安十三年（208）赤壁前后为汉末/三国之分。',
  },
  {
    id: 'sanguo', name: '三国', range: [220, 280], domain: [208, 280], width: 140,
    ink: 'rgba(72, 58, 44, 0.12)',
    note: '通常以220年曹丕代汉为始；尺度上提前到208年（赤壁之战、长坂坡之岁）以容纳汉末三国人物。',
  },
  {
    id: 'jin', name: '晋', range: [266, 420], domain: [280, 420], width: 132,
    ink: 'rgba(52, 66, 66, 0.11)',
    note: '两晋（266–420）；与三国重叠的266–280归入三国尺度域。',
  },
  {
    id: 'nanbeichao', name: '南北朝', range: [420, 589], domain: [420, 585], width: 152,
    ink: 'rgba(66, 54, 64, 0.12)',
    note: '420 年刘宋代晋至 589 年隋灭陈；与隋的尺度分界取 585。',
  },
  {
    id: 'sui', name: '隋', range: [581, 618], domain: [585, 618], width: 92,
    ink: 'rgba(56, 60, 50, 0.13)',
    note: '隋（581–618）与北朝末期重叠，尺度域取其中段。',
  },
  {
    id: 'tang', name: '唐', range: [618, 907], domain: [618, 960], width: 214,
    ink: 'rgba(58, 62, 72, 0.11)',
    note: '唐（618–907）；尺度域兼收五代十国（907–960）。',
  },
  {
    id: 'song', name: '宋', range: [960, 1279], domain: [960, 1279], width: 206,
    ink: 'rgba(70, 58, 50, 0.12)',
    note: '两宋（960–1279），与辽金并立。',
  },
  {
    id: 'yuan', name: '元', range: [1271, 1368], domain: [1279, 1368], width: 118,
    ink: 'rgba(56, 54, 64, 0.12)',
    note: '元（1271–1368）；尺度域自宋亡（1279）起。',
  },
  {
    id: 'ming', name: '明', range: [1368, 1644], domain: [1368, 1644], width: 184,
    ink: 'rgba(60, 64, 56, 0.11)',
    note: '明（1368–1644）。',
  },
  {
    id: 'qing', name: '清', range: [1644, 1912], domain: [1644, 1912], width: 184,
    ink: 'rgba(66, 56, 52, 0.12)',
    note: '清兵入关（1644）至溥仪退位（1912）。',
  },
  {
    id: 'unknown', name: '附卷·无考', range: [1912, 2100], domain: [1912, 2100], width: 130,
    ink: 'rgba(80, 80, 84, 0.10)',
    note: '无朝代、无年份的条目，按录入次序均匀安置在卷末附卷，属可解释的兜底映射。',
  },
];

/** 数据中可能出现的朝代别名 → 正式朝代 id（秦末、蜀汉、东西晋等） */
export const DYNASTY_ALIASES: Record<string, string> = {
  上古: 'shanggu',
  夏: 'xiashang', 夏商: 'xiashang', 商: 'xiashang', 殷商: 'xiashang',
  西周: 'xizhou', 周: 'xizhou', 东周: 'chunqiu',
  春秋: 'chunqiu', 战国: 'zhanguo', 战国末: 'zhanguo',
  秦: 'qin', 秦末: 'qin', 楚汉: 'qin',
  汉: 'han', 西汉: 'han', 东汉: 'han', 汉末: 'han',
  三国: 'sanguo', 蜀汉: 'sanguo', 魏: 'sanguo', 吴: 'sanguo',
  晋: 'jin', 西晋: 'jin', 东晋: 'jin',
  南北朝: 'nanbeichao', 南朝: 'nanbeichao', 北朝: 'nanbeichao',
  隋: 'sui', 隋唐: 'tang',
  唐: 'tang', 唐末: 'tang', 五代: 'tang', 五代十国: 'tang',
  宋: 'song', 北宋: 'song', 南宋: 'song',
  元: 'yuan', 元末: 'yuan',
  明: 'ming', 明末: 'ming',
  清: 'qing', 清末: 'qing',
};

export const UNKNOWN_ERA_ID = 'unknown';

export const eraById = (id: string): EraDef | undefined => ERAS.find((e) => e.id === id);

/** 数据里的朝代名字符串 → 朝代定义；无法识别返回 undefined（调用方走无考兜底） */
export function resolveEra(dynasty: string | undefined | null): EraDef | undefined {
  if (!dynasty) return undefined;
  const id = DYNASTY_ALIASES[dynasty.trim()];
  return id ? eraById(id) : undefined;
}

/** 按精确年份反查所属尺度域（即使条目朝代缺失/写错也能定位）；越界年份夹到卷轴两端 */
export function eraAtYear(year: number): EraDef {
  if (year <= ERAS[0].domain[0]) return ERAS[0];
  const last = ERAS[ERAS.length - 1];
  if (year >= last.domain[1]) return last;
  for (const era of ERAS) {
    const [a, b] = era.domain;
    if (year >= a && year < b) return era;
  }
  return last;
}
