import { writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { extractCrawledImages, downloadImage } from './crawler.js';
import { addImage, findByUrl, getCachePath, cacheExists, nextPicIndex, findSetIdBySourceUrl, updateTagBySourceUrl } from './storage.js';
import { isAllowedMime, extForMime } from './validate.js';
const CONCURRENCY = parseInt(process.env.SEED_CONCURRENCY ?? '5', 10);
async function processCandidate(imgUrl, sourceUrl, setId, picIndex, tag) {
    const existing = findByUrl(imgUrl);
    if (existing) {
        const cachePath = getCachePath(existing.id, extForMime(existing.mime));
        if (!await cacheExists(cachePath)) {
            let success = false;
            for (let attempt = 0; attempt <= 2; attempt++) {
                try {
                    const { buffer } = await downloadImage(imgUrl, sourceUrl);
                    await writeFile(cachePath, buffer);
                    success = true;
                    break;
                }
                catch { /* retry */ }
            }
            if (!success)
                return 'failed';
            return 'recached';
        }
        return 'cached';
    }
    let buffer;
    let mime;
    let success = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
        try {
            ;
            ({ buffer, mime } = await downloadImage(imgUrl, sourceUrl));
            success = true;
            break;
        }
        catch { /* retry */ }
    }
    if (!success)
        return 'failed';
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
        tag,
    };
    addImage(meta);
    try {
        await writeFile(getCachePath(id, extForMime(mime)), buffer);
    }
    catch { /* ignore cache write failure, proxy will re-fetch */ }
    return 'saved';
}
/**
 * Load seed config from config/seed.json (or SEED_CONFIG env var path).
 * Falls back to SEED_GALLERIES env var for legacy support.
 * Returns array of { tag, urls }
 */
export async function parseSeedConfig() {
    const configPath = process.env.SEED_CONFIG ?? './config/seed.json';
    try {
        const { readFile } = await import('node:fs/promises');
        const raw = await readFile(configPath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data))
            return data;
    }
    catch {
        // Fall back to legacy SEED_GALLERIES env var
    }
    const raw = process.env.SEED_GALLERIES ?? '';
    if (!raw.trim())
        return [];
    const groups = [];
    for (const segment of raw.split(';')) {
        const trimmed = segment.trim();
        if (!trimmed)
            continue;
        if (trimmed.includes('|')) {
            const pipe = trimmed.indexOf('|');
            const tag = trimmed.slice(0, pipe).trim();
            const urls = trimmed.slice(pipe + 1).split(',').map((u) => u.trim()).filter((u) => u.length > 0);
            if (urls.length > 0)
                groups.push({ tag, urls });
        }
        else {
            const urls = trimmed.split(',').map((u) => u.trim()).filter((u) => u.length > 0);
            if (urls.length > 0)
                groups.push({ urls });
        }
    }
    return groups;
}
export async function seedFromGalleries() {
    const groups = await parseSeedConfig();
    if (groups.length === 0)
        return;
    const allUrls = groups.flatMap((g) => g.urls);
    console.log(`[seed] Starting seed from ${allUrls.length} gallery URL(s)...`);
    for (const { tag, urls } of groups) {
        for (const galleryUrl of urls) {
            // Sync tag to already-indexed images from this sourceUrl
            if (tag) {
                const synced = updateTagBySourceUrl(galleryUrl, tag);
                if (synced > 0)
                    console.log(`[seed] Synced tag "${tag}" to ${synced} existing record(s) for ${galleryUrl}`);
            }
            console.log(`[seed] Crawling ${galleryUrl}${tag ? ` [${tag}]` : ''}`);
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
                const results = await Promise.allSettled(batch.map((url, j) => processCandidate(url, galleryUrl, setId, baseIndex + i + j, tag)));
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
    }
    console.log('[seed] Done.');
}
