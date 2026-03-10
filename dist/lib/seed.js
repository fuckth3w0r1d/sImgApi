import { writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { extractCrawledImages, downloadImage } from './crawler.js';
import { addImage, findByUrl, getCachePath, cacheExists, nextPicIndex, findSetIdBySourceUrl } from './storage.js';
import { isAllowedMime, extForMime } from './validate.js';
const CONCURRENCY = parseInt(process.env.SEED_CONCURRENCY ?? '5', 10);
async function processCandidate(imgUrl, sourceUrl, setId, picIndex) {
    const existing = findByUrl(imgUrl);
    if (existing) {
        const cachePath = getCachePath(existing.id, extForMime(existing.mime));
        if (!await cacheExists(cachePath)) {
            try {
                const { buffer } = await downloadImage(imgUrl, sourceUrl);
                await writeFile(cachePath, buffer);
                return 'recached';
            }
            catch {
                return 'failed';
            }
        }
        return 'cached';
    }
    let buffer;
    let mime;
    try {
        ;
        ({ buffer, mime } = await downloadImage(imgUrl, sourceUrl));
    }
    catch {
        return 'failed';
    }
    if (!isAllowedMime(mime))
        return 'invalid';
    const id = nanoid();
    const meta = {
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
    addImage(meta);
    try {
        await writeFile(getCachePath(id, extForMime(mime)), buffer);
    }
    catch { /* ignore cache write failure, proxy will re-fetch */ }
    return 'saved';
}
export async function seedFromGalleries() {
    const raw = process.env.SEED_GALLERIES ?? '';
    const urls = raw.split(',').map((u) => u.trim()).filter((u) => u.length > 0);
    if (urls.length === 0)
        return;
    console.log(`[seed] Starting seed from ${urls.length} gallery URL(s)...`);
    for (const galleryUrl of urls) {
        console.log(`[seed] Crawling ${galleryUrl}`);
        let candidates;
        try {
            const crawled = await extractCrawledImages(galleryUrl);
            candidates = crawled.map((c) => c.url);
            console.log(`[seed] Found ${candidates.length} image(s) on page`);
        }
        catch (err) {
            console.error(`[seed] Failed to crawl ${galleryUrl}: ${err.message}`);
            continue;
        }
        const setId = findSetIdBySourceUrl(galleryUrl) ?? nanoid();
        const baseIndex = nextPicIndex(setId);
        let saved = 0, cached = 0, recached = 0, failed = 0, invalid = 0;
        let completed = 0;
        for (let i = 0; i < candidates.length; i += CONCURRENCY) {
            const batch = candidates.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(batch.map((url, j) => processCandidate(url, galleryUrl, setId, baseIndex + i + j)));
            for (const r of results) {
                const val = r.status === 'fulfilled' ? r.value : 'failed';
                if (val === 'saved')
                    saved++;
                else if (val === 'cached')
                    cached++;
                else if (val === 'recached')
                    recached++;
                else if (val === 'invalid')
                    invalid++;
                else
                    failed++;
                completed++;
                if (completed % 10 === 0) {
                    console.log(`[seed] Progress: ${completed}/${candidates.length} — saved=${saved} recached=${recached} cached=${cached} failed=${failed} invalid=${invalid}`);
                }
            }
        }
        console.log(`[seed] ${galleryUrl} done — saved=${saved} recached=${recached} cached=${cached} failed=${failed} invalid=${invalid}`);
    }
    console.log('[seed] Done.');
}
