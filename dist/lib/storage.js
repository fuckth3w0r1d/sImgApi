import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const dataDir = process.env.DATA_DIR ?? './data';
const metaFile = join(dataDir, 'metadata.json');
const cacheDir = process.env.CACHE_DIR ?? './cache';
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
    flushTimer = setTimeout(() => {
        const tmp = metaFile + '.tmp';
        writeFile(tmp, JSON.stringify(store, null, 2))
            .then(() => rename(tmp, metaFile))
            .catch((err) => console.error('[storage] Failed to flush metadata:', err));
    }, 500);
}
export async function ensureDataDir() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    // Load existing metadata into memory
    if (existsSync(metaFile)) {
        try {
            const raw = await readFile(metaFile, 'utf-8');
            store = JSON.parse(raw);
            for (const m of store)
                indexRecord(m);
            console.log(`[storage] Loaded ${store.length} record(s) from metadata`);
        }
        catch (err) {
            console.error(`[storage] metadata.json corrupt, starting fresh: ${err.message}`);
            store = [];
            // Back up the corrupt file
            const backup = metaFile + '.corrupt.' + Date.now();
            await rename(metaFile, backup).catch(() => { });
        }
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
export function removeSet(setId) {
    const members = store.filter((m) => m.setId === setId);
    if (members.length === 0)
        return [];
    store = store.filter((m) => m.setId !== setId);
    for (const m of members) {
        byId.delete(m.id);
        byUrl.delete(m.url);
    }
    // Clean up sourceUrl index entries that belonged to this set
    for (const [src, sid] of bySourceUrl) {
        if (sid === setId)
            bySourceUrl.delete(src);
    }
    picCount.delete(setId);
    scheduleFlush();
    return members;
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
/** Pick a random set, return up to n random images from it. */
export function randomFromRandomSet(n) {
    if (store.length === 0)
        return [];
    // Collect all unique setIds
    const setIds = [...new Set(store.map((m) => m.setId))];
    const setId = setIds[Math.floor(Math.random() * setIds.length)];
    const members = store.filter((m) => m.setId === setId);
    // Fisher-Yates shuffle, take first n
    const arr = [...members];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
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
