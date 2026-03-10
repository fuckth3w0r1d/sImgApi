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

export async function listImages(
  page: number,
  limit: number,
  mime?: string,
  tag?: string,
  category?: string
): Promise<{ items: ImageMeta[]; total: number }> {
  let data = await readMeta()
  if (mime) data = data.filter((m) => m.mime === mime)
  if (tag) data = data.filter((m) => m.tags.includes(tag))
  if (category) data = data.filter((m) => m.category === category)
  const total = data.length
  const items = data.slice((page - 1) * limit, page * limit)
  return { items, total }
}
