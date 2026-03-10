import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const dataDir = process.env.DATA_DIR ?? './data';
const metaFile = join(dataDir, 'metadata.json');
export const cacheDir = process.env.CACHE_DIR ?? './cache';
export async function ensureDataDir() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
}
export function getCachePath(id) {
    return join(cacheDir, id);
}
async function readMeta() {
    if (!existsSync(metaFile))
        return [];
    const raw = await readFile(metaFile, 'utf-8');
    return JSON.parse(raw);
}
async function writeMeta(data) {
    await writeFile(metaFile, JSON.stringify(data, null, 2));
}
export async function addImage(meta) {
    const data = await readMeta();
    data.push(meta);
    await writeMeta(data);
}
export async function removeImage(id) {
    const data = await readMeta();
    const idx = data.findIndex((m) => m.id === id);
    if (idx === -1)
        return null;
    const [removed] = data.splice(idx, 1);
    await writeMeta(data);
    return removed;
}
export async function findById(id) {
    const data = await readMeta();
    return data.find((m) => m.id === id) ?? null;
}
export async function findByUrl(url) {
    const data = await readMeta();
    return data.find((m) => m.url === url) ?? null;
}
export async function listImages(page, limit, mime, tag, category) {
    let data = await readMeta();
    if (mime)
        data = data.filter((m) => m.mime === mime);
    if (tag)
        data = data.filter((m) => m.tags.includes(tag));
    if (category)
        data = data.filter((m) => m.category === category);
    const total = data.length;
    const items = data.slice((page - 1) * limit, page * limit);
    return { items, total };
}
