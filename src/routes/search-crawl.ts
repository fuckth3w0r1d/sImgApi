import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { isAllowedMime } from '../lib/validate.js'
import { addImage, findByUrl, nextPicIndex, findSetIdBySourceUrl } from '../lib/storage.js'
import { extractCrawledImages } from '../lib/crawler.js'
import type { ImageMeta } from '../types.js'

const CONCURRENCY = parseInt(process.env.SEED_CONCURRENCY ?? '5', 10)
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '15000', 10)

const searchCrawl = new Hono()

async function probeMime(imgUrl: string, referer: string): Promise<string | null> {
  // Try HEAD first
  const headRes = await fetch(imgUrl, {
    method: 'HEAD',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null)

  if (headRes?.ok) {
    const mime = (headRes.headers.get('content-type') ?? '').split(';')[0].trim()
    if (mime) return mime
  }

  // Fall back to GET with Range to minimize data transfer
  const getRes = await fetch(imgUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer,
      'Range': 'bytes=0-1023',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null)

  if (!getRes || (!getRes.ok && getRes.status !== 206)) return null
  return (getRes.headers.get('content-type') ?? '').split(';')[0].trim() || null
}

/**
 * POST /search-crawl
 * Body (one of):
 *   { galleryUrl: string, count?: number }  — crawl a page and index all images
 *   { urls: string[], sourceUrl?: string }  — index a list of direct image URLs
 */
searchCrawl.post('/', async (c) => {
  let body: {
    galleryUrl?: string
    urls?: string[]
    sourceUrl?: string
    count?: number
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { galleryUrl, urls, count = 50 } = body
  const limit = Math.min(count, 200)

  if (!galleryUrl && (!urls || urls.length === 0)) {
    return c.json({ error: 'Missing required field: galleryUrl or urls' }, 400)
  }

  // groups: Map<sourceUrl, imageUrl[]>
  const groups = new Map<string, string[]>()

  if (galleryUrl) {
    try {
      const crawled = await extractCrawledImages(galleryUrl)
      groups.set(galleryUrl, crawled.map((c) => c.url))
    } catch (err) {
      return c.json({ error: `Gallery fetch failed: ${(err as Error).message}` }, 502)
    }
  } else {
    const sourceUrl = body.sourceUrl ?? 'direct'
    groups.set(sourceUrl, urls!)
  }

  const saved: ImageMeta[] = []
  const skipped: { url: string; reason: string }[] = []

  for (const [sourceUrl, imageUrls] of groups) {
    if (saved.length >= limit) break

    const setId = findSetIdBySourceUrl(sourceUrl) ?? nanoid()
    let picIndex = nextPicIndex(setId)

    type Validated = { url: string; mime: string; picIndex: number } | { url: string; reason: string }

    const toProcess = imageUrls.slice(0, limit - saved.length)
    const results: Validated[] = []

    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map(async (imgUrl, j): Promise<Validated> => {
          if (findByUrl(imgUrl)) return { url: imgUrl, reason: 'Already indexed' }

          const mime = await probeMime(imgUrl, sourceUrl)
          if (!mime) return { url: imgUrl, reason: 'Fetch failed' }
          if (!isAllowedMime(mime)) return { url: imgUrl, reason: `Unsupported MIME: ${mime}` }

          return { url: imgUrl, mime, picIndex: picIndex + i + j }
        })
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value)
        else results.push({ url: '', reason: r.reason?.message ?? 'Unknown error' })
      }
    }

    // Commit valid results
    for (const r of results) {
      if ('reason' in r) {
        if (r.url) skipped.push({ url: r.url, reason: r.reason })
        continue
      }
      const id = nanoid()
      const imageMeta: ImageMeta = {
        id,
        url: r.url,
        sourceUrl,
        mime: r.mime,
        width: 0,
        height: 0,
        uploadedAt: new Date().toISOString(),
        setId,
        picIndex: r.picIndex,
      }
      addImage(imageMeta)
      saved.push(imageMeta)
      picIndex++
    }
  }

  return c.json({ saved, skipped, requested: limit })
})

export default searchCrawl
