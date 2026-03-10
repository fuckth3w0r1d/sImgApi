import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const dataDir = process.env.DATA_DIR ?? './data';
const metaFile = join(dataDir, 'metadata.json');
export const cacheDir = process.env.CACHE_DIR ?? './cache';
// In-memory store
let store = [];
const byId = new Map();
const byUrl = new Map();
const bySourceUrl = new Map(); // sourceUrl -> setId
const picCount = new Map(); // setId -> count
let flushTimer = null;
function indexRecord(m) {
    byId.set(m.id, m);
    byUrl.set(m.url, m);
    if (!bySourceUrl.has(m.sourceUrl))
        bySourceUrl.set(m.sourceUrl, m.setId);
    picCount.set(m.setId, (picCount.get(m.setId) ?? 0) + 1);
}
function scheduleFlush() {
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
        const tmp = metaFile + '.tmp';
        await writeFile(tmp, JSON.stringify(store, null, 2));
        await rename(tmp, metaFile);
    }, 500);
}
export async function ensureDataDir() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    // Load existing metadata into memory
    if (existsSync(metaFile)) {
        const raw = await readFile(metaFile, 'utf-8');
        store = JSON.parse(raw);
        for (const m of store)
            indexRecord(m);
    }
}
export function getCachePath(id, ext) {
    return join(cacheDir, ext ? `${id}.${ext}` : id);
}
export async function cacheExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
export function addImage(meta) {
    store.push(meta);
    indexRecord(meta);
    scheduleFlush();
}
export async function removeImage(id) {
    const meta = byId.get(id);
    if (!meta)
        return null;
    store = store.filter((m) => m.id !== id);
    byId.delete(id);
    byUrl.delete(meta.url);
    // Rebuild sourceUrl index for this setId if needed
    const stillHasSource = store.some((m) => m.sourceUrl === meta.sourceUrl);
    if (!stillHasSource)
        bySourceUrl.delete(meta.sourceUrl);
    const count = (picCount.get(meta.setId) ?? 1) - 1;
    if (count <= 0)
        picCount.delete(meta.setId);
    else
        picCount.set(meta.setId, count);
    scheduleFlush();
    return meta;
}
export function findById(id) {
    return byId.get(id) ?? null;
}
export function findByUrl(url) {
    return byUrl.get(url) ?? null;
}
export function nextPicIndex(setId) {
    return picCount.get(setId) ?? 0;
}
export function findSetIdBySourceUrl(sourceUrl) {
    return bySourceUrl.get(sourceUrl) ?? null;
}
export function listImages(page, limit, mime, setId) {
    let data = store;
    if (mime)
        data = data.filter((m) => m.mime === mime);
    if (setId)
        data = data.filter((m) => m.setId === setId);
    const total = data.length;
    const items = data.slice((page - 1) * limit, page * limit);
    return { items, total };
}
export function listSets(page, limit) {
    const map = new Map();
    for (const m of store) {
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
    sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = sets.length;
    const items = sets.slice((page - 1) * limit, page * limit);
    return { items, total };
}
