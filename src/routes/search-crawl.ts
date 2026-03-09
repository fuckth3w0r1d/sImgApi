import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { writeFile } from 'node:fs/promises'
import { isAllowedMime, extForMime } from '../lib/validate.js'
import { addImage, getUploadPath, ensureUploadDir } from '../lib/storage.js'
import { downloadImage, extractCrawledImages } from '../lib/crawler.js'
import { analyzeWithAI, inferCategoryFromTags } from '../lib/tagger.js'
import { searchImages, isQualityDomain } from '../lib/search.js'
import { CATEGORIES, type Category, type ImageMeta } from '../types.js'

const searchCrawl = new Hono()

/** Read image dimensions from buffer magic bytes (JPEG, PNG, GIF, WebP). */
function imageDimensions(buf: Buffer): { width: number; height: number } {
  // PNG: 8-byte sig, then IHDR chunk at offset 8: width at 16, height at 20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: scan for SOF marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  // GIF: width at 6, height at 8 (little-endian)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf.length >= 10) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // WebP: RIFF....WEBP VP8 .... width/height at specific offsets
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.length >= 30) {
    // VP8 lossy: width at 26 (14 bits), height at 28 (14 bits)
    if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
      return {
        width: (buf.readUInt16LE(26) & 0x3fff) + 1,
        height: (buf.readUInt16LE(28) & 0x3fff) + 1,
      }
    }
  }
  return { width: 0, height: 0 }
}

searchCrawl.post('/', async (c) => {
  const maxSize = parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'

  let body: {
    tag?: string
    count?: number
    minWidth?: number
    minHeight?: number
    qualityOnly?: boolean
    galleryUrl?: string
    category?: string
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { tag, count = 10, qualityOnly = true, galleryUrl } = body
  let { minWidth = 0, minHeight = 0 } = body

  if (!galleryUrl && !tag) {
    return c.json({ error: 'Missing required field: tag or galleryUrl' }, 400)
  }

  const filterCategory: Category | undefined =
    body.category && (CATEGORIES as readonly string[]).includes(body.category)
      ? (body.category as Category)
      : undefined

  if (!galleryUrl && qualityOnly) {
    if (!minWidth) minWidth = 400
    if (!minHeight) minHeight = 400
  }

  const limit = Math.min(count, 50)

  // Resolve candidates
  let candidates: { imageUrl: string; htmlTags: string[]; referer?: string }[]

  if (galleryUrl) {
    try {
      const crawled = await extractCrawledImages(galleryUrl)
      candidates = crawled.map((c) => ({ imageUrl: c.url, htmlTags: c.htmlTags, referer: c.referer }))
    } catch (err) {
      return c.json({ error: `Gallery fetch failed: ${(err as Error).message}` }, 502)
    }
  } else {
    let searchResults
    try {
      searchResults = await searchImages(tag!, limit * 2)
    } catch (err) {
      return c.json({ error: `Search failed: ${(err as Error).message}` }, 502)
    }
    candidates = searchResults.map((r) => ({
      imageUrl: r.imageUrl,
      htmlTags: r.title
        ? r.title.split(/[\s,/|]+/).map((t) => t.trim()).filter((t) => t.length > 1)
        : tag ? [tag] : [],
    }))
  }

  if (candidates.length === 0) {
    return c.json({ saved: [], skipped: [], query: tag, galleryUrl, requested: limit })
  }

  await ensureUploadDir()

  const saved: ImageMeta[] = []
  const skipped: { url: string; reason: string }[] = []

  for (const candidate of candidates) {
    const referer = candidate.referer
    if (saved.length >= limit) break

    const imgUrl = candidate.imageUrl

    // Quality domain filter only applies to search engine mode
    if (!galleryUrl && qualityOnly && !isQualityDomain(imgUrl)) {
      skipped.push({ url: imgUrl, reason: 'Not a quality image source' })
      continue
    }

    let buffer: Buffer
    let mime: string
    let originalName: string

    try {
      ;({ buffer, mime, originalName } = await downloadImage(imgUrl, referer))
    } catch (err) {
      skipped.push({ url: imgUrl, reason: `Download failed: ${(err as Error).message}` })
      continue
    }

    if (!isAllowedMime(mime)) {
      skipped.push({ url: imgUrl, reason: `Unsupported MIME type: ${mime}` })
      continue
    }

    if (buffer.length > maxSize) {
      skipped.push({ url: imgUrl, reason: `File too large: ${buffer.length} bytes` })
      continue
    }

    const { width, height } = imageDimensions(buffer)
    if (width < minWidth || height < minHeight) {
      skipped.push({ url: imgUrl, reason: `Too small: ${width}x${height} (min ${minWidth}x${minHeight})` })
      continue
    }

    const inferredCategory = inferCategoryFromTags(candidate.htmlTags)
    const { tags, category } = await analyzeWithAI(buffer, candidate.htmlTags, inferredCategory)

    // Category filter
    if (filterCategory && category !== filterCategory) {
      skipped.push({ url: imgUrl, reason: `Category mismatch: got "${category}", want "${filterCategory}"` })
      continue
    }

    const id = nanoid()
    const ext = extForMime(mime)
    const filename = `${id}.${ext}`

    await writeFile(getUploadPath(filename), buffer)

    const imageMeta: ImageMeta = {
      id,
      filename,
      originalName,
      mime,
      size: buffer.length,
      width,
      height,
      uploadedAt: new Date().toISOString(),
      url: `${baseUrl}/i/${filename}`,
      tags,
      category,
    }

    await addImage(imageMeta)
    saved.push(imageMeta)
  }

  return c.json({ saved, skipped, query: tag, galleryUrl, requested: limit })
})

export default searchCrawl
