import { Hono } from 'hono'
import { writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { findById, getCachePath, cacheExists } from '../lib/storage.js'
import { downloadImage } from '../lib/crawler.js'
import { extForMime, isAllowedMime } from '../lib/validate.js'

const proxy = new Hono()

proxy.get('/:id', async (c) => {
  const id = c.req.param('id')
  const meta = findById(id)
  if (!meta) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Always use stored mime for cache path (consistent across requests)
  const cachePath = getCachePath(id, extForMime(meta.mime))

  if (await cacheExists(cachePath)) {
    const stream = createReadStream(cachePath)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': meta.mime,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  let buffer: Buffer
  let mime: string
  try {
    ;({ buffer, mime } = await downloadImage(meta.url, meta.sourceUrl))
  } catch (err) {
    return c.json({ error: `Failed to fetch image: ${(err as Error).message}` }, 502)
  }

  // Validate MIME from live response before serving
  if (!isAllowedMime(mime)) {
    return c.json({ error: `Upstream returned unexpected content type: ${mime}` }, 502)
  }

  // Write cache using stored mime ext for consistency with cache-hit path
  await writeFile(cachePath, buffer).catch(() => {})

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400',
    },
  })
})

export default proxy
