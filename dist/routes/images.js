import { Hono } from 'hono';
import { listImages, listSets, removeImage, removeSet, randomFromTag } from '../lib/storage.js';
const images = new Hono();
// List all images (optionally filtered by setId or mime)
images.get('/', (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)));
    const mime = c.req.query('mime');
    const setId = c.req.query('setId');
    const { items, total } = listImages(page, limit, mime, setId);
    return c.json({
        data: items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    });
});
// List all sets (grouped by setId)
images.get('/sets', (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)));
    const { items, total } = listSets(page, limit);
    return c.json({
        data: items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    });
});
// Return 3 random images from a random set (optionally filtered by tag)
images.get('/random', (c) => {
    const tag = c.req.query('tag');
    const items = randomFromTag(3, tag);
    if (items.length === 0) {
        return c.json({ error: tag ? `No images found for tag: ${tag}` : 'No images available' }, 404);
    }
    return c.json({ data: items, setId: items[0].setId, tag: items[0].tag });
});
images.delete('/sets/:setId', (c) => {
    const setId = c.req.param('setId');
    const removed = removeSet(setId);
    if (removed.length === 0) {
        return c.json({ error: 'Set not found' }, 404);
    }
    return c.json({ message: 'Deleted', setId, count: removed.length });
});
images.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await removeImage(id);
    if (!removed) {
        return c.json({ error: 'Image not found' }, 404);
    }
    return c.json({ message: 'Deleted', id });
});
export default images;
