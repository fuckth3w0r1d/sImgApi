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
/** Returns the next picIndex for a given setId (0-based). */
export async function nextPicIndex(setId) {
    const data = await readMeta();
    const members = data.filter((m) => m.setId === setId);
    return members.length;
}
/** Find existing setId for a given sourceUrl, or return null. */
export async function findSetIdBySourceUrl(sourceUrl) {
    const data = await readMeta();
    const match = data.find((m) => m.sourceUrl === sourceUrl);
    return match?.setId ?? null;
}
export async function listImages(page, limit, mime, setId) {
    let data = await readMeta();
    if (mime)
        data = data.filter((m) => m.mime === mime);
    if (setId)
        data = data.filter((m) => m.setId === setId);
    const total = data.length;
    const items = data.slice((page - 1) * limit, page * limit);
    return { items, total };
}
/** Group all images by setId, return one summary per set. */
export async function listSets(page, limit) {
    const data = await readMeta();
    const map = new Map();
    for (const m of data) {
        const arr = map.get(m.setId) ?? [];
        arr.push(m);
        map.set(m.setId, arr);
    }
    const sets = [];
    for (const [setId, members] of map) {
        const first = members.reduce((a, b) => a.picIndex < b.picIndex ? a : b);
        sets.push({
            setId,
            count: members.length,
            sourceUrl: first.sourceUrl,
            coverId: first.id,
            createdAt: first.uploadedAt,
        });
    }
    // Sort by createdAt descending
    sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = sets.length;
    const items = sets.slice((page - 1) * limit, page * limit);
    return { items, total };
}
