import { writeFile } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { extractCrawledImages, downloadImage } from './crawler.js'
import { addImage, findByUrl, getCachePath, cacheExists, nextPicIndex, findSetIdBySourceUrl, updateTagBySourceUrl } from './storage.js'
import { isAllowedMime, extForMime } from './validate.js'
import type { ImageMeta } from '../types.js'

const CONCURRENCY = parseInt(process.env.SEED_CONCURRENCY ?? '5', 10)

type CandidateResult = 'saved' | 'cached' | 'recached' | 'failed' | 'invalid'

async function processCandidate(
  imgUrl: string,
  sourceUrl: string,
  setId: string,
  picIndex: number,
  tag?: string
): Promise<CandidateResult> {
  const existing = findByUrl(imgUrl)
  if (existing) {
    const cachePath = getCachePath(existing.id, extForMime(existing.mime))
    if (!await cacheExists(cachePath)) {
      let success = false
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const { buffer } = await downloadImage(imgUrl, sourceUrl)
          await writeFile(cachePath, buffer)
          success = true
          break
        } catch { /* retry */ }
      }
      if (!success) return 'failed'
      return 'recached'
    }
    return 'cached'
  }

  let buffer!: Buffer
  let mime!: string
  let success = false
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      ;({ buffer, mime } = await downloadImage(imgUrl, sourceUrl))
      success = true
      break
    } catch { /* retry */ }
  }
  if (!success) return 'failed'

  if (!isAllowedMime(mime)) return 'invalid'

  const id = nanoid()
  const meta: ImageMeta = {
    id,
    url: imgUrl,
    sourceUrl,
    mime,
    width: 0,
    height: 0,
    uploadedAt: new Date().toISOString(),
    setId,
    picIndex,
    tag,
  }

  addImage(meta)

  try {
    await writeFile(getCachePath(id, extForMime(mime)), buffer)
  } catch { /* ignore cache write failure, proxy will re-fetch */ }

  return 'saved'
}

/**
 * Load seed config from config/seed.json (or SEED_CONFIG env var path).
 * Returns array of { tag, urls }
 */
export async function parseSeedConfig(): Promise<{ tag?: string; urls: string[] }[]> {
  const configPath = process.env.SEED_CONFIG ?? './config/seed.json'
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const data = JSON.parse(raw) as { tag?: string; urls: string[] }[]
    if (Array.isArray(data)) return data
  } catch {}
  return []
}

async function processGallery(galleryUrl: string, tag: string | undefined, skipExisting: boolean): Promise<void> {
  if (skipExisting && findSetIdBySourceUrl(galleryUrl) !== null) {
    console.log(`[seed] Skipping already-seeded ${galleryUrl}`)
    return
  }

  if (tag) {
    const synced = updateTagBySourceUrl(galleryUrl, tag)
    if (synced > 0) console.log(`[seed] Synced tag "${tag}" to ${synced} existing record(s) for ${galleryUrl}`)
  }

  console.log(`[seed] Crawling ${galleryUrl}${tag ? ` [${tag}]` : ''}`)
  let candidates: string[]

  try {
    const crawled = await extractCrawledImages(galleryUrl)
    candidates = crawled.map((c) => c.url)
    console.log(`[seed] Found ${candidates.length} image(s) on page`)
  } catch (err) {
    console.error(`[seed] Failed to crawl ${galleryUrl}: ${(err as Error).message}`)
    return
  }

  const setId = findSetIdBySourceUrl(galleryUrl) ?? nanoid()
  const baseIndex = nextPicIndex(setId)
  let saved = 0, cached = 0, recached = 0, failed = 0, invalid = 0
  let completed = 0

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((url, j) => processCandidate(url, galleryUrl, setId, baseIndex + i + j, tag))
    )
    for (const r of results) {
      const val = r.status === 'fulfilled' ? r.value : 'failed'
      if (val === 'saved') saved++
      else if (val === 'cached') cached++
      else if (val === 'recached') recached++
      else if (val === 'invalid') invalid++
      else failed++
      completed++
      if (completed % 10 === 0) {
        console.log(`[seed] Progress: ${completed}/${candidates.length} — saved=${saved} recached=${recached} cached=${cached} failed=${failed} invalid=${invalid}`)
      }
    }
  }

  console.log(`[seed] ${galleryUrl} done — saved=${saved} recached=${recached} cached=${cached} failed=${failed} invalid=${invalid}`)
}

export async function seedFromGalleries(): Promise<void> {
  const groups = await parseSeedConfig()
  if (groups.length === 0) return

  const allUrls = groups.flatMap((g) => g.urls)
  console.log(`[seed] Starting seed from ${allUrls.length} gallery URL(s)...`)

  for (const { tag, urls } of groups) {
    for (const galleryUrl of urls) {
      await processGallery(galleryUrl, tag, true)
    }
  }

  console.log('[seed] Initial seed done.')
}

/** Refresh galleries from seed config, optionally filtered by tag. Never skips existing sets. */
export async function refreshByTag(filterTag?: string): Promise<{ queued: number }> {
  const groups = await parseSeedConfig()
  const filtered = filterTag ? groups.filter((g) => g.tag === filterTag) : groups
  if (filtered.length === 0) return { queued: 0 }

  const allUrls = filtered.flatMap((g) => g.urls)
  console.log(`[seed] Refresh starting — ${allUrls.length} gallery URL(s)${filterTag ? ` for tag "${filterTag}"` : ''}...`)

  // Run in background
  ;(async () => {
    for (const { tag, urls } of filtered) {
      for (const galleryUrl of urls) {
        await processGallery(galleryUrl, tag, false)
      }
    }
    console.log('[seed] Refresh done.')
  })().catch((err) => console.error('[seed] Refresh error:', err))

  return { queued: allUrls.length }
}
