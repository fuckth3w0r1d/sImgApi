import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { isAllowedMime } from '../lib/validate.js';
import { addImage, findByUrl } from '../lib/storage.js';
import { extractCrawledImages } from '../lib/crawler.js';
import { inferCategoryFromTags } from '../lib/tagger-lite.js';
import { searchImages, searchWebPages } from '../lib/search.js';
import { CATEGORIES } from '../types.js';
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
    const { minWidth = 0, minHeight = 0 } = body;
    if (!galleryUrl && !tag) {
        return c.json({ error: 'Missing required field: tag or galleryUrl' }, 400);
    }
    const filterCategory = body.category && CATEGORIES.includes(body.category)
        ? body.category
        : undefined;
    const limit = Math.min(count, 50);
    // Resolve candidates
    let candidates;
    if (galleryUrl) {
        try {
            const crawled = await extractCrawledImages(galleryUrl);
            candidates = crawled.map((c) => ({ imageUrl: c.url, htmlTags: c.htmlTags, sourceUrl: galleryUrl }));
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
        candidates = [];
        for (const pageUrl of pageUrls) {
            try {
                const crawled = await extractCrawledImages(pageUrl);
                for (const c of crawled) {
                    candidates.push({ imageUrl: c.url, htmlTags: c.htmlTags, sourceUrl: pageUrl });
                }
            }
            catch {
                // skip pages that fail to load
            }
        }
    }
    else {
        let searchResults;
        try {
            searchResults = await searchImages(tag, limit * 2);
        }
        catch (err) {
            return c.json({ error: `Search failed: ${err.message}` }, 502);
        }
        candidates = searchResults.map((r) => ({
            imageUrl: r.imageUrl,
            sourceUrl: r.sourceUrl,
            htmlTags: r.title
                ? r.title.split(/[\s,/|]+/).map((t) => t.trim()).filter((t) => t.length > 1)
                : tag ? [tag] : [],
        }));
    }
    if (candidates.length === 0) {
        return c.json({ saved: [], skipped: [], query: tag, galleryUrl, requested: limit });
    }
    const saved = [];
    const skipped = [];
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
        // Validate it's a real image via HEAD request
        let mime;
        try {
            const headRes = await fetch(imgUrl, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...(candidate.sourceUrl ? { 'Referer': candidate.sourceUrl } : {}),
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
        const tags = candidate.htmlTags;
        const category = inferCategoryFromTags(tags);
        // Category filter
        if (filterCategory && category !== filterCategory) {
            skipped.push({ url: imgUrl, reason: `Category mismatch: got "${category}", want "${filterCategory}"` });
            continue;
        }
        const id = nanoid();
        const imageMeta = {
            id,
            url: imgUrl,
            sourceUrl: candidate.sourceUrl,
            mime,
            width: 0,
            height: 0,
            uploadedAt: new Date().toISOString(),
            tags,
            category: category ?? '其他',
        };
        await addImage(imageMeta);
        saved.push(imageMeta);
    }
    return c.json({ saved, skipped, query: tag, galleryUrl, requested: limit });
});
export default searchCrawl;
