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
  tag?: string;
}

export interface NestedSetBlock {
  sourceUrl: string;
  uploadedAt: string;
  images: Omit<ImageMeta, 'tag' | 'setId' | 'sourceUrl'>[];
}

export interface NestedTagBlock {
  sets: Record<string, NestedSetBlock>;
}

export interface NestedMetadata {
  tags: Record<string, NestedTagBlock>;
}
