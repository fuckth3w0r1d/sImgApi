import { Hono } from 'hono'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { writeFile } from 'node:fs/promises'
import { isAllowedMime, extForMime } from '../lib/validate.js'
import { addImage, getUploadPath, ensureUploadDir } from '../lib/storage.js'
import { CATEGORIES, type Category, type ImageMeta } from '../types.js'

function parseTags(raw: FormDataEntryValue | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String).map((t) => t.trim()).filter(Boolean)
  } catch {
    // not JSON, treat as comma-separated
  }
  return raw.split(',').map((t) => t.trim()).filter(Boolean)
}

function parseCategory(raw: FormDataEntryValue | undefined): Category {
  if (raw && typeof raw === 'string' && (CATEGORIES as readonly string[]).includes(raw.trim())) {
    return raw.trim() as Category
  }
  return '其他'
}

const upload = new Hono()

upload.post('/', async (c) => {
  const maxSize = parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'

  const body = await c.req.parseBody()
  const file = body['file']
  const tags = parseTags(body['tags'])
  const category = parseCategory(body['category'])

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file uploaded. Use multipart field name "file".' }, 400)
  }

  if (!isAllowedMime(file.type)) {
    return c.json({ error: `Unsupported file type: ${file.type}` }, 415)
  }

  if (file.size > maxSize) {
    return c.json({ error: `File too large. Max size: ${maxSize} bytes` }, 413)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const meta = await sharp(buffer).metadata()

  const id = nanoid()
  const ext = extForMime(file.type)
  const filename = `${id}.${ext}`
  const destPath = getUploadPath(filename)

  await ensureUploadDir()
  await writeFile(destPath, buffer)

  const imageMeta: ImageMeta = {
    id,
    filename,
    originalName: file.name,
    mime: file.type,
    size: file.size,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    uploadedAt: new Date().toISOString(),
    url: `${baseUrl}/i/${filename}`,
    tags,
    category,
  }

  await addImage(imageMeta)

  return c.json(imageMeta, 201)
})

export default upload
