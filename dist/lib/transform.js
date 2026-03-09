import sharp from 'sharp';
import { isAllowedFormat } from './validate.js';
export async function transformImage(inputPath, query, originalMime) {
    const hasParams = query.w || query.h || query.q || query.f;
    if (!hasParams) {
        const { readFile } = await import('node:fs/promises');
        const buffer = await readFile(inputPath);
        return { buffer, contentType: originalMime };
    }
    let pipeline = sharp(inputPath);
    if (query.w || query.h) {
        pipeline = pipeline.resize(query.w ? parseInt(query.w, 10) : undefined, query.h ? parseInt(query.h, 10) : undefined, { withoutEnlargement: true });
    }
    const quality = query.q ? Math.min(100, Math.max(1, parseInt(query.q, 10))) : 80;
    const fmt = query.f && isAllowedFormat(query.f) ? query.f : null;
    if (fmt === 'webp') {
        pipeline = pipeline.webp({ quality });
    }
    else if (fmt === 'avif') {
        pipeline = pipeline.avif({ quality });
    }
    else if (fmt === 'png') {
        pipeline = pipeline.png();
    }
    else if (fmt === 'jpeg') {
        pipeline = pipeline.jpeg({ quality });
    }
    else {
        // keep original format, apply quality if jpeg/webp
        if (originalMime === 'image/jpeg')
            pipeline = pipeline.jpeg({ quality });
        else if (originalMime === 'image/webp')
            pipeline = pipeline.webp({ quality });
    }
    const buffer = await pipeline.toBuffer();
    const contentType = fmt ? `image/${fmt === 'jpeg' ? 'jpeg' : fmt}` : originalMime;
    return { buffer, contentType };
}
