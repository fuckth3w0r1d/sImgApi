import { Hono } from 'hono';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { writeFile } from 'node:fs/promises';
import { isAllowedMime, extForMime } from '../lib/validate.js';
import { addImage, getUploadPath, ensureUploadDir } from '../lib/storage.js';
import { downloadImage } from '../lib/crawler.js';
import { analyzeWithAI, inferCategoryFromTags } from '../lib/tagger.js';
import { searchImages, isQualityDomain } from '../lib/search.js';
import { fetchFromGallery } from '../lib/gallery.js';
import { CATEGORIES } from '../types.js';
const searchCrawl = new Hono();
searchCrawl.post('/', async (c) => {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10);
    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    let body;
    try {
        body = await c.req.json();
    }
    catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { tag, count = 10, qualityOnly = true, galleryUrl } = body;
    let { minWidth = 0, minHeight = 0 } = body;
    if (!galleryUrl && !tag) {
        return c.json({ error: 'Missing required field: tag or galleryUrl' }, 400);
    }
    const filterCategory = body.category && CATEGORIES.includes(body.category)
        ? body.category
        : undefined;
    if (!galleryUrl && qualityOnly) {
        if (!minWidth)
            minWidth = 400;
        if (!minHeight)
            minHeight = 400;
    }
    const limit = Math.min(count, 50);
    // Resolve candidates
    let candidates;
    if (galleryUrl) {
        try {
            candidates = await fetchFromGallery(galleryUrl, tag, limit * 2);
        }
        catch (err) {
            return c.json({ error: `Gallery fetch failed: ${err.message}` }, 502);
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
            htmlTags: r.title
                ? r.title.split(/[\s,/|]+/).map((t) => t.trim()).filter((t) => t.length > 1)
                : tag ? [tag] : [],
        }));
    }
    if (candidates.length === 0) {
        return c.json({ saved: [], skipped: [], query: tag, galleryUrl, requested: limit });
    }
    await ensureUploadDir();
    const saved = [];
    const skipped = [];
    for (const candidate of candidates) {
        if (saved.length >= limit)
            break;
        const imgUrl = candidate.imageUrl;
        // Quality domain filter only applies to search engine mode
        if (!galleryUrl && qualityOnly && !isQualityDomain(imgUrl)) {
            skipped.push({ url: imgUrl, reason: 'Not a quality image source' });
            continue;
        }
        let buffer;
        let mime;
        let originalName;
        try {
            ;
            ({ buffer, mime, originalName } = await downloadImage(imgUrl));
        }
        catch (err) {
            skipped.push({ url: imgUrl, reason: `Download failed: ${err.message}` });
            continue;
        }
        if (!isAllowedMime(mime)) {
            skipped.push({ url: imgUrl, reason: `Unsupported MIME type: ${mime}` });
            continue;
        }
        if (buffer.length > maxSize) {
            skipped.push({ url: imgUrl, reason: `File too large: ${buffer.length} bytes` });
            continue;
        }
        let width;
        let height;
        try {
            const meta = await sharp(buffer).metadata();
            width = meta.width ?? 0;
            height = meta.height ?? 0;
        }
        catch {
            skipped.push({ url: imgUrl, reason: 'Failed to read image metadata' });
            continue;
        }
        if (width < minWidth || height < minHeight) {
            skipped.push({ url: imgUrl, reason: `Too small: ${width}x${height} (min ${minWidth}x${minHeight})` });
            continue;
        }
        const inferredCategory = inferCategoryFromTags(candidate.htmlTags);
        const { tags, category } = await analyzeWithAI(buffer, candidate.htmlTags, inferredCategory);
        // Category filter
        if (filterCategory && category !== filterCategory) {
            skipped.push({ url: imgUrl, reason: `Category mismatch: got "${category}", want "${filterCategory}"` });
            continue;
        }
        const id = nanoid();
        const ext = extForMime(mime);
        const filename = `${id}.${ext}`;
        await writeFile(getUploadPath(filename), buffer);
        const imageMeta = {
            id,
            filename,
            originalName,
            mime,
            size: buffer.length,
            width,
            height,
            uploadedAt: new Date().toISOString(),
            url: `${baseUrl}/i/${filename}`,
            tags,
            category,
        };
        await addImage(imageMeta);
        saved.push(imageMeta);
    }
    return c.json({ saved, skipped, query: tag, galleryUrl, requested: limit });
});
export default searchCrawl;
