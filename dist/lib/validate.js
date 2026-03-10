const ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
]);
const EXT_MAP = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
};
export function isAllowedMime(mime) {
    return ALLOWED_MIME.has(mime);
}
export function extForMime(mime) {
    return EXT_MAP[mime] ?? 'bin';
}
