import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { extractCrawledImages, downloadImage } from './crawler.js';
import { addImage, findByUrl, getCachePath, nextPicIndex, findSetIdBySourceUrl } from './storage.js';
import { isAllowedMime } from './validate.js';
export async function seedFromGalleries() {
    const raw = process.env.SEED_GALLERIES ?? '';
    const urls = raw.split(',').map((u) => u.trim()).filter((u) => u.length > 0);
    if (urls.length === 0)
        return;
    console.log(`[seed] Starting seed from ${urls.length} gallery URL(s)...`);
    for (const galleryUrl of urls) {
        // Skip if already seeded (setId exists and has images)
        const existingSetId = await findSetIdBySourceUrl(galleryUrl);
        if (existingSetId && (await nextPicIndex(existingSetId)) > 0) {
            console.log(`[seed] Skipping ${galleryUrl} (already seeded)`);
            continue;
        }
        console.log(`[seed] Crawling ${galleryUrl}`);
        let candidates;
        try {
            const crawled = await extractCrawledImages(galleryUrl);
            candidates = crawled.map((c) => ({ imageUrl: c.url, sourceUrl: galleryUrl }));
        }
        catch (err) {
            console.error(`[seed] Failed to crawl ${galleryUrl}: ${err.message}`);
            continue;
        }
        // Reuse existing setId for this gallery URL, or create a new one
        const setId = existingSetId ?? nanoid();
        let picIndex = await nextPicIndex(setId);
        let saved = 0;
        let skipped = 0;
        for (const candidate of candidates) {
            const imgUrl = candidate.imageUrl;
            // Skip already indexed
            const existing = await findByUrl(imgUrl);
            if (existing) {
                const cachePath = getCachePath(existing.id);
                if (!existsSync(cachePath)) {
                    try {
                        const { buffer } = await downloadImage(imgUrl, galleryUrl);
                        await writeFile(cachePath, buffer);
                    }
                    catch {
                        // ignore cache failures
                    }
                }
                skipped++;
                continue;
            }
            let buffer;
            let mime;
            try {
                ;
                ({ buffer, mime } = await downloadImage(imgUrl, galleryUrl));
            }
            catch {
                skipped++;
                continue;
            }
            if (!isAllowedMime(mime)) {
                skipped++;
                continue;
            }
            const id = nanoid();
            const meta = {
                id,
                url: imgUrl,
                sourceUrl: galleryUrl,
                mime,
                width: 0,
                height: 0,
                uploadedAt: new Date().toISOString(),
                setId,
                picIndex,
            };
            await addImage(meta);
            try {
                await writeFile(getCachePath(id), buffer);
            }
            catch {
                // ignore cache write failures
            }
            saved++;
            picIndex++;
        }
        console.log(`[seed] ${galleryUrl}: saved=${saved} skipped=${skipped}`);
    }
    console.log('[seed] Done.');
}
