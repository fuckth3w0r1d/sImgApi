import { Hono } from 'hono';
import { listImages, listSets, removeImage, removeSet, randomFromRandomSet } from '../lib/storage.js';
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
// Return 3 random images from a random set
images.get('/random', (c) => {
    const items = randomFromRandomSet(3);
    if (items.length === 0) {
        return c.json({ error: 'No images available' }, 404);
    }
    return c.json({ data: items, setId: items[0].setId });
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
