import { Hono } from 'hono';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { findById, getCachePath } from '../lib/storage.js';
import { downloadImage } from '../lib/crawler.js';
const proxy = new Hono();
proxy.get('/:id', async (c) => {
    const id = c.req.param('id');
    const meta = await findById(id);
    if (!meta) {
        return c.json({ error: 'Not found' }, 404);
    }
    const cachePath = getCachePath(id);
    let buffer;
    let mime;
    if (existsSync(cachePath)) {
        buffer = await readFile(cachePath);
        mime = meta.mime;
    }
    else {
        try {
            ;
            ({ buffer, mime } = await downloadImage(meta.url, meta.sourceUrl));
        }
        catch (err) {
            return c.json({ error: `Failed to fetch image: ${err.message}` }, 502);
        }
        await writeFile(cachePath, buffer);
    }
    return new Response(new Uint8Array(buffer), {
        headers: {
            'Content-Type': mime,
            'Content-Length': String(buffer.length),
            'Cache-Control': 'public, max-age=86400',
        },
    });
});
export default proxy;
