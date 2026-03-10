export interface ImageMeta {
  id: string;
  url: string;
  sourceUrl: string;
  mime: string;
  width: number;
  height: number;
  uploadedAt: string;
  setId: string;
  picIndex: number;
}

export interface ListQuery {
  page?: string;
  limit?: string;
  mime?: string;
  setId?: string;
}
