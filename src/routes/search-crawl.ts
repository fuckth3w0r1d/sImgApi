import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { isAllowedMime } from '../lib/validate.js'
import { addImage, findByUrl, nextPicIndex, findSetIdBySourceUrl } from '../lib/storage.js'
import { extractCrawledImages } from '../lib/crawler.js'
import type { ImageMeta } from '../types.js'

const searchCrawl = new Hono()

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

  if (groups.size === 0) {
    return c.json({ saved: [], skipped: [], requested: limit })
  }

  const saved: ImageMeta[] = []
  const skipped: { url: string; reason: string }[] = []

  for (const [sourceUrl, imageUrls] of groups) {
    if (saved.length >= limit) break

    const setId = (await findSetIdBySourceUrl(sourceUrl)) ?? nanoid()
    let picIndex = await nextPicIndex(setId)

    for (const imgUrl of imageUrls) {
      if (saved.length >= limit) break

      const existing = await findByUrl(imgUrl)
      if (existing) {
        skipped.push({ url: imgUrl, reason: 'Already indexed' })
        continue
      }

      let mime: string
      try {
        const headRes = await fetch(imgUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': sourceUrl,
          },
          signal: AbortSignal.timeout(15000),
        })
        if (!headRes.ok) {
          skipped.push({ url: imgUrl, reason: `HEAD failed: ${headRes.status}` })
          continue
        }
        mime = (headRes.headers.get('content-type') ?? '').split(';')[0].trim()
      } catch (err) {
        skipped.push({ url: imgUrl, reason: `HEAD error: ${(err as Error).message}` })
        continue
      }

      if (!isAllowedMime(mime)) {
        skipped.push({ url: imgUrl, reason: `Unsupported MIME: ${mime}` })
        continue
      }

      const id = nanoid()
      const imageMeta: ImageMeta = {
        id,
        url: imgUrl,
        sourceUrl,
        mime,
        width: 0,
        height: 0,
        uploadedAt: new Date().toISOString(),
        setId,
        picIndex,
      }

      await addImage(imageMeta)
      saved.push(imageMeta)
      picIndex++
    }
  }

  return c.json({ saved, skipped, requested: limit })
})

export default searchCrawl
