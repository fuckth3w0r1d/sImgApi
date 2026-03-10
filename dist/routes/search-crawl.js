import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { isAllowedMime } from '../lib/validate.js';
import { addImage, findByUrl, nextPicIndex, findSetIdBySourceUrl } from '../lib/storage.js';
import { extractCrawledImages } from '../lib/crawler.js';
import { searchImages, searchWebPages } from '../lib/search.js';
const searchCrawl = new Hono();
searchCrawl.post('/', async (c) => {
    let body;
    try {
        body = await c.req.json();
    }
    catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { tag, count = 10, mode = 'image', galleryUrl } = body;
    if (!galleryUrl && !tag) {
        return c.json({ error: 'Missing required field: tag or galleryUrl' }, 400);
    }
    const limit = Math.min(count, 50);
    // Resolve page-grouped candidates: each group shares a setId
    // groups: Map<sourceUrl, candidate[]>
    const groups = new Map();
    if (galleryUrl) {
        try {
            const crawled = await extractCrawledImages(galleryUrl);
            groups.set(galleryUrl, crawled.map((c) => ({ imageUrl: c.url, sourceUrl: galleryUrl })));
        }
        catch (err) {
            return c.json({ error: `Gallery fetch failed: ${err.message}` }, 502);
        }
    }
    else if (mode === 'page') {
        let pageUrls;
        try {
            pageUrls = await searchWebPages(tag, 5);
        }
        catch (err) {
            return c.json({ error: `Page search failed: ${err.message}` }, 502);
        }
        for (const pageUrl of pageUrls) {
            try {
                const crawled = await extractCrawledImages(pageUrl);
                groups.set(pageUrl, crawled.map((c) => ({ imageUrl: c.url, sourceUrl: pageUrl })));
            }
            catch {
                // skip pages that fail to load
            }
        }
    }
    else {
        // image mode: each image is its own set (no natural grouping)
        let searchResults;
        try {
            searchResults = await searchImages(tag, limit * 2);
        }
        catch (err) {
            return c.json({ error: `Search failed: ${err.message}` }, 502);
        }
        // Group by sourceUrl so images from same page share a set
        for (const r of searchResults) {
            const src = r.sourceUrl || r.imageUrl;
            const arr = groups.get(src) ?? [];
            arr.push({ imageUrl: r.imageUrl, sourceUrl: src });
            groups.set(src, arr);
        }
    }
    if (groups.size === 0) {
        return c.json({ saved: [], skipped: [], query: tag, galleryUrl, requested: limit });
    }
    const saved = [];
    const skipped = [];
    for (const [sourceUrl, candidates] of groups) {
        if (saved.length >= limit)
            break;
        // Reuse existing setId for this sourceUrl, or create a new one
        const setId = (await findSetIdBySourceUrl(sourceUrl)) ?? nanoid();
        let picIndex = await nextPicIndex(setId);
        for (const candidate of candidates) {
            if (saved.length >= limit)
                break;
            const imgUrl = candidate.imageUrl;
            // Skip already-indexed URLs
            const existing = await findByUrl(imgUrl);
            if (existing) {
                skipped.push({ url: imgUrl, reason: 'Already indexed' });
                continue;
            }
            // Validate via HEAD request
            let mime;
            try {
                const headRes = await fetch(imgUrl, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': sourceUrl,
                    },
                });
                if (!headRes.ok) {
                    skipped.push({ url: imgUrl, reason: `HEAD failed: ${headRes.status}` });
                    continue;
                }
                mime = (headRes.headers.get('content-type') ?? '').split(';')[0].trim();
            }
            catch (err) {
                skipped.push({ url: imgUrl, reason: `HEAD error: ${err.message}` });
                continue;
            }
            if (!isAllowedMime(mime)) {
                skipped.push({ url: imgUrl, reason: `Unsupported MIME type: ${mime}` });
                continue;
            }
            const id = nanoid();
            const imageMeta = {
                id,
                url: imgUrl,
                sourceUrl,
                mime,
                width: 0,
                height: 0,
                uploadedAt: new Date().toISOString(),
                setId,
                picIndex,
            };
            await addImage(imageMeta);
            saved.push(imageMeta);
            picIndex++;
        }
    }
    return c.json({ saved, skipped, query: tag, galleryUrl, requested: limit });
});
export default searchCrawl;
