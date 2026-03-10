import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import images from './routes/images.js';
import searchCrawl from './routes/search-crawl.js';
import proxy from './routes/proxy.js';
import { ensureDataDir } from './lib/storage.js';
import { seedFromGalleries } from './lib/seed.js';
const app = new Hono();
app.use('*', logger());
app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/images', images);
app.route('/search-crawl', searchCrawl);
app.route('/proxy', proxy);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
});
const port = parseInt(process.env.PORT ?? '3000', 10);
await ensureDataDir();
serve({ fetch: app.fetch, port }, () => {
    console.log(`sImgApi running at http://localhost:${port}`);
    seedFromGalleries().catch((err) => console.error('[seed] Fatal error:', err));
});
