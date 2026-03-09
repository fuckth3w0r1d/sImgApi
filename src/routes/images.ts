import { Hono } from 'hono'
import { listImages, removeImage } from '../lib/storage.js'

const images = new Hono()

images.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)))
  const mime = c.req.query('mime')
  const tag = c.req.query('tag')
  const category = c.req.query('category')

  const { items, total } = await listImages(page, limit, mime, tag, category)

  return c.json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
})

images.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const removed = await removeImage(id)

  if (!removed) {
    return c.json({ error: 'Image not found' }, 404)
  }

  return c.json({ message: 'Deleted', id })
})

export default images
