import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { findByFilename, getUploadPath } from '../lib/storage.js';
import { transformImage } from '../lib/transform.js';
const serve = new Hono();
serve.get('/:filename', async (c) => {
    const filename = c.req.param('filename');
    const filePath = getUploadPath(filename);
    if (!existsSync(filePath)) {
        return c.json({ error: 'Image not found' }, 404);
    }
    const record = await findByFilename(filename);
    const originalMime = record?.mime ?? 'image/jpeg';
    const query = {
        w: c.req.query('w'),
        h: c.req.query('h'),
        q: c.req.query('q'),
        f: c.req.query('f'),
    };
    const { buffer, contentType } = await transformImage(filePath, query, originalMime);
    return new Response(buffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000',
        },
    });
});
export default serve;
