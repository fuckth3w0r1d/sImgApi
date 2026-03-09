import { Hono } from 'hono'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { writeFile } from 'node:fs/promises'
import { isAllowedMime, extForMime } from '../lib/validate.js'
import { addImage, getUploadPath, ensureUploadDir } from '../lib/storage.js'
import { extractCrawledImages, downloadImage, isImageUrl } from '../lib/crawler.js'
import { analyzeWithAI, inferCategoryFromTags } from '../lib/tagger.js'
import type { ImageMeta } from '../types.js'

const crawl = new Hono()

crawl.post('/', async (c) => {
  const maxSize = parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'

  let body: { url?: string; minWidth?: number; minHeight?: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { url, minWidth = 0, minHeight = 0 } = body
  if (!url) return c.json({ error: 'Missing required field: url' }, 400)

  // Determine if url is a direct image link or a webpage
  let crawledImages: { url: string; htmlTags: string[]; referer?: string }[]
  try {
    const direct = await isImageUrl(url)
    crawledImages = direct ? [{ url, htmlTags: [] }] : await extractCrawledImages(url)
  } catch (err) {
    return c.json({ error: `Failed to process URL: ${(err as Error).message}` }, 502)
  }

  if (crawledImages.length === 0) {
    return c.json({ saved: [], skipped: [], message: 'No image URLs found on page' })
  }

  await ensureUploadDir()

  const saved: ImageMeta[] = []
  const skipped: { url: string; reason: string }[] = []

  for (const { url: imgUrl, htmlTags, referer } of crawledImages) {
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

    let width: number
    let height: number
    try {
      const meta = await sharp(buffer).metadata()
      width = meta.width ?? 0
      height = meta.height ?? 0
    } catch {
      skipped.push({ url: imgUrl, reason: 'Failed to read image metadata' })
      continue
    }

    if (width < minWidth || height < minHeight) {
      skipped.push({ url: imgUrl, reason: `Too small: ${width}x${height} (min ${minWidth}x${minHeight})` })
      continue
    }

    const inferredCategory = inferCategoryFromTags(htmlTags)
    const { tags, category } = await analyzeWithAI(buffer, htmlTags, inferredCategory)

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

  return c.json({ saved, skipped }, 200)
})

export default crawl
