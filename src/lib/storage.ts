import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageMeta } from '../types.js'

const dataDir = process.env.DATA_DIR ?? './data'
const metaFile = join(dataDir, 'metadata.json')
const cacheDir = process.env.CACHE_DIR ?? './cache'

// In-memory store
let store: ImageMeta[] = []
const byId = new Map<string, ImageMeta>()
const byUrl = new Map<string, ImageMeta>()
const bySourceUrl = new Map<string, string>() // sourceUrl -> setId
const picCount = new Map<string, number>()    // setId -> count

let flushTimer: ReturnType<typeof setTimeout> | null = null

function indexRecord(m: ImageMeta): void {
  byId.set(m.id, m)
  byUrl.set(m.url, m)
  if (!bySourceUrl.has(m.sourceUrl)) bySourceUrl.set(m.sourceUrl, m.setId)
  picCount.set(m.setId, (picCount.get(m.setId) ?? 0) + 1)
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const tmp = metaFile + '.tmp'
    writeFile(tmp, JSON.stringify(store, null, 2))
      .then(() => rename(tmp, metaFile))
      .catch((err) => console.error('[storage] Failed to flush metadata:', err))
  }, 500)
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  // Load existing metadata into memory
  if (existsSync(metaFile)) {
    try {
      const raw = await readFile(metaFile, 'utf-8')
      store = JSON.parse(raw) as ImageMeta[]
      for (const m of store) indexRecord(m)
      console.log(`[storage] Loaded ${store.length} record(s) from metadata`)
    } catch (err) {
      console.error(`[storage] metadata.json corrupt, starting fresh: ${(err as Error).message}`)
      store = []
      // Back up the corrupt file
      const backup = metaFile + '.corrupt.' + Date.now()
      await rename(metaFile, backup).catch(() => {})
    }
  }
}

export function getCachePath(id: string, ext?: string): string {
  return join(cacheDir, ext ? `${id}.${ext}` : id)
}

export async function cacheExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function addImage(meta: ImageMeta): void {
  store.push(meta)
  indexRecord(meta)
  scheduleFlush()
}

export async function removeImage(id: string): Promise<ImageMeta | null> {
  const meta = byId.get(id)
  if (!meta) return null
  store = store.filter((m) => m.id !== id)
  byId.delete(id)
  byUrl.delete(meta.url)
  // Rebuild sourceUrl index for this setId if needed
  const stillHasSource = store.some((m) => m.sourceUrl === meta.sourceUrl)
  if (!stillHasSource) bySourceUrl.delete(meta.sourceUrl)
  const count = (picCount.get(meta.setId) ?? 1) - 1
  if (count <= 0) picCount.delete(meta.setId)
  else picCount.set(meta.setId, count)
  scheduleFlush()
  return meta
}

export function findById(id: string): ImageMeta | null {
  return byId.get(id) ?? null
}

export function findByUrl(url: string): ImageMeta | null {
  return byUrl.get(url) ?? null
}

export function nextPicIndex(setId: string): number {
  return picCount.get(setId) ?? 0
}

export function findSetIdBySourceUrl(sourceUrl: string): string | null {
  return bySourceUrl.get(sourceUrl) ?? null
}

export function listImages(
  page: number,
  limit: number,
  mime?: string,
  setId?: string
): { items: ImageMeta[]; total: number } {
  let data = store
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

export function listSets(
  page: number,
  limit: number
): { items: SetSummary[]; total: number } {
  const map = new Map<string, ImageMeta[]>()
  for (const m of store) {
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
  sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const total = sets.length
  const items = sets.slice((page - 1) * limit, page * limit)
  return { items, total }
}
