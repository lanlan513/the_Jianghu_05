export interface Sword {
  id: string;
  name: string;
  alias: string;
  dynasty: string;
  owner: string;
  sect: string;
  description: string;
  history: string;
  legend: string;
  imageUrl: string;
  /**
   * 精确年份（公元纪年，负数表示公元前）。
   * 缺失时由前端年代学纯函数按朝代兜底映射。
   */
  year?: number;
  /** 有年份区间时的结束年份（如铸剑跨度数年、传说流传区间） */
  yearEnd?: number;
  /** 兜底说明：当年份为推断值时，向用户解释映射依据 */
  yearNote?: string;
  attributes: {
    sharpness: number;
    hardness: number;
    flexibility: number;
    craftsmanship: number;
  };
  popularity: number;
  createdAt: string;
}

export interface Swordsman {
  id: string;
  name: string;
  title: string;
  dynasty: string;
  sect: string;
  biography: string;
  avatarUrl: string;
  /** 佩剑 id 列表，引用 Sword.id；可能指向不存在的名剑（需容错） */
  swords: string[];
  /** 精确年份（公元纪年，负数表示公元前），可缺失 */
  year?: number;
  yearEnd?: number;
  yearNote?: string;
  createdAt: string;
}

export interface Sect {
  id: string;
  name: string;
  location: string;
  foundingDynasty: string;
  description: string;
  emblemUrl: string;
  skills: string[];
  notableSwords: string[];
  popularity: number;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface SwordListResponse {
  list: Sword[];
  total: number;
  page: number;
  limit: number;
}

export interface SwordFilterParams {
  page?: number;
  limit?: number;
  dynasty?: string;
  sect?: string;
  keyword?: string;
  sortBy?: 'popularity' | 'dynasty' | 'name';
  sortOrder?: 'asc' | 'desc';
}
