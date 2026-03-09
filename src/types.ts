export const CATEGORIES = [
  '二次元',
  '真人模特',
  '风景',
  '人像',
  '动物',
  '美食',
  '建筑',
  '其他',
] as const

export type Category = typeof CATEGORIES[number]

export interface ImageMeta {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  uploadedAt: string;
  url: string;
  tags: string[];
  category: Category;
}

export interface ListQuery {
  page?: string;
  limit?: string;
  mime?: string;
  tag?: string;
  category?: string;
}

export interface ServeQuery {
  w?: string;
  h?: string;
  q?: string;
  f?: string;
}
