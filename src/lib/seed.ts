import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { nanoid } from 'nanoid'
import { extractCrawledImages, downloadImage } from './crawler.js'
import { addImage, findByUrl, getCachePath } from './storage.js'
import { isAllowedMime } from './validate.js'
import { inferCategoryFromTags } from './tagger-lite.js'
import type { ImageMeta } from '../types.js'

export async function seedFromGalleries(): Promise<void> {
  const raw = process.env.SEED_GALLERIES ?? ''
  const urls = raw.split(',').map((u) => u.trim()).filter((u) => u.length > 0)
  if (urls.length === 0) return

  console.log(`[seed] Starting seed from ${urls.length} gallery URL(s)...`)

  for (const galleryUrl of urls) {
    console.log(`[seed] Crawling ${galleryUrl}`)
    let candidates: { imageUrl: string; htmlTags: string[]; sourceUrl: string }[]

    try {
      const crawled = await extractCrawledImages(galleryUrl)
      candidates = crawled.map((c) => ({ imageUrl: c.url, htmlTags: c.htmlTags, sourceUrl: galleryUrl }))
    } catch (err) {
      console.error(`[seed] Failed to crawl ${galleryUrl}: ${(err as Error).message}`)
      continue
    }

    let saved = 0
    let skipped = 0

    for (const candidate of candidates) {
      const imgUrl = candidate.imageUrl

      // Skip already indexed
      const existing = await findByUrl(imgUrl)
      if (existing) {
        // Ensure cache exists for already-indexed images
        const cachePath = getCachePath(existing.id)
        if (!existsSync(cachePath)) {
          try {
            const { buffer } = await downloadImage(imgUrl, galleryUrl)
            await writeFile(cachePath, buffer)
          } catch {
            // ignore cache failures
          }
        }
        skipped++
        continue
      }

      // Validate and download
      let buffer: Buffer
      let mime: string
      try {
        ;({ buffer, mime } = await downloadImage(imgUrl, galleryUrl))
      } catch {
        skipped++
        continue
      }

      if (!isAllowedMime(mime)) {
        skipped++
        continue
      }

      const id = nanoid()
      const tags = candidate.htmlTags
      const category = inferCategoryFromTags(tags) ?? '其他'

      const meta: ImageMeta = {
        id,
        url: imgUrl,
        sourceUrl: candidate.sourceUrl,
        mime,
        width: 0,
        height: 0,
        uploadedAt: new Date().toISOString(),
        tags,
        category,
      }

      await addImage(meta)

      // Write cache immediately
      try {
        await writeFile(getCachePath(id), buffer)
      } catch {
        // ignore cache write failures
      }

      saved++
    }

    console.log(`[seed] ${galleryUrl}: saved=${saved} skipped=${skipped}`)
  }

  console.log('[seed] Done.')
}
