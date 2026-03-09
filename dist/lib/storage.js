import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
const metaFile = join(uploadDir, 'metadata.json');
export async function migrateMetadata() {
    if (!existsSync(metaFile))
        return;
    const raw = await readFile(metaFile, 'utf-8');
    const data = JSON.parse(raw);
    let dirty = false;
    for (const m of data) {
        if (!m.tags) {
            m.tags = [];
            dirty = true;
        }
        if (!m.category) {
            m.category = '其他';
            dirty = true;
        }
    }
    if (dirty)
        await writeFile(metaFile, JSON.stringify(data, null, 2));
}
export async function ensureUploadDir() {
    await mkdir(uploadDir, { recursive: true });
}
export function getUploadPath(filename) {
    return join(uploadDir, filename);
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
    try {
        await unlink(getUploadPath(removed.filename));
    }
    catch {
        // file already gone
    }
    return removed;
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
export async function findByFilename(filename) {
    const data = await readMeta();
    return data.find((m) => m.filename === filename) ?? null;
}
