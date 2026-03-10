import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageMeta } from '../types.js'

const dataDir = process.env.DATA_DIR ?? './data'
const metaFile = join(dataDir, 'metadata.json')
export const cacheDir = process.env.CACHE_DIR ?? './cache'

export async function ensureDataDir(): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
}

export function getCachePath(id: string): string {
  return join(cacheDir, id)
}

async function readMeta(): Promise<ImageMeta[]> {
  if (!existsSync(metaFile)) return []
  const raw = await readFile(metaFile, 'utf-8')
  return JSON.parse(raw) as ImageMeta[]
}

async function writeMeta(data: ImageMeta[]): Promise<void> {
  await writeFile(metaFile, JSON.stringify(data, null, 2))
}

export async function addImage(meta: ImageMeta): Promise<void> {
  const data = await readMeta()
  data.push(meta)
  await writeMeta(data)
}

export async function removeImage(id: string): Promise<ImageMeta | null> {
  const data = await readMeta()
  const idx = data.findIndex((m) => m.id === id)
  if (idx === -1) return null
  const [removed] = data.splice(idx, 1)
  await writeMeta(data)
  return removed
}

export async function findById(id: string): Promise<ImageMeta | null> {
  const data = await readMeta()
  return data.find((m) => m.id === id) ?? null
}

export async function findByUrl(url: string): Promise<ImageMeta | null> {
  const data = await readMeta()
  return data.find((m) => m.url === url) ?? null
}

/** Returns the next picIndex for a given setId (0-based). */
export async function nextPicIndex(setId: string): Promise<number> {
  const data = await readMeta()
  const members = data.filter((m) => m.setId === setId)
  return members.length
}

/** Find existing setId for a given sourceUrl, or return null. */
export async function findSetIdBySourceUrl(sourceUrl: string): Promise<string | null> {
  const data = await readMeta()
  const match = data.find((m) => m.sourceUrl === sourceUrl)
  return match?.setId ?? null
}

export async function listImages(
  page: number,
  limit: number,
  mime?: string,
  setId?: string
): Promise<{ items: ImageMeta[]; total: number }> {
  let data = await readMeta()
  if (mime) data = data.filter((m) => m.mime === mime)
  if (setId) data = data.filter((m) => m.setId === setId)
  const total = data.length
  const items = data.slice((page - 1) * limit, page * limit)
  return { items, total }
}

export interface SetSummary {
  setId: string;
  count: number;
  sourceUrl: string;
  coverId: string;
  createdAt: string;
}

/** Group all images by setId, return one summary per set. */
export async function listSets(
  page: number,
  limit: number
): Promise<{ items: SetSummary[]; total: number }> {
  const data = await readMeta()
  const map = new Map<string, ImageMeta[]>()
  for (const m of data) {
    const arr = map.get(m.setId) ?? []
    arr.push(m)
    map.set(m.setId, arr)
  }
  const sets: SetSummary[] = []
  for (const [setId, members] of map) {
    const first = members.reduce((a, b) => a.picIndex < b.picIndex ? a : b)
    sets.push({
      setId,
      count: members.length,
      sourceUrl: first.sourceUrl,
      coverId: first.id,
      createdAt: first.uploadedAt,
    })
  }
  // Sort by createdAt descending
  sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const total = sets.length
  const items = sets.slice((page - 1) * limit, page * limit)
  return { items, total }
}
