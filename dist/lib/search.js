// High-quality image source domains
const QUALITY_DOMAINS = [
    'unsplash.com', 'images.unsplash.com',
    'pinterest.com', 'i.pinimg.com',
    '500px.com',
    'pixabay.com', 'cdn.pixabay.com',
    'pexels.com', 'images.pexels.com',
    'flickr.com', 'live.staticflickr.com',
    'deviantart.com',
    'artstation.com', 'cdna.artstation.com',
    'behance.net',
    'pixiv.net', 'i.pximg.net',
    'konachan.com',
    'zerochan.net',
    'yande.re',
    'bilibili.com', 'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com',
    'sinaimg.cn',
    'photo.weibo.com',
];
// Domains for page-search mode (model/portrait/coser platforms)
const PAGE_SEARCH_DOMAINS = [
    'weibo.com',
    'huaban.com',
    'tuchong.com',
    'pinterest.com',
    'instagram.com',
    'xiaohongshu.com',
    'xhslink.com',
    'douban.com',
    'meitulu.com',
    'cosplay.com',
    'coserzone.com',
];
const BING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
export function isQualityDomain(url) {
    try {
        const hostname = new URL(url).hostname;
        return QUALITY_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
    }
    catch {
        return false;
    }
}
function isPageSearchDomain(url) {
    try {
        const hostname = new URL(url).hostname;
        return PAGE_SEARCH_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
    }
    catch {
        return false;
    }
}
async function searchWithGoogle(query, count) {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    const results = [];
    let start = 1;
    while (results.length < count) {
        const num = Math.min(10, count - results.length);
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&searchType=image&num=${num}&start=${start}&key=${apiKey}&cx=${cx}`;
        const res = await fetch(url);
        if (!res.ok)
            break;
        const data = await res.json();
        if (!data.items?.length)
            break;
        for (const item of data.items) {
            results.push({
                imageUrl: item.link,
                sourceUrl: item.image?.contextLink ?? item.link,
                title: item.title,
            });
        }
        start += num;
        if (start > 91)
            break;
    }
    return results;
}
async function searchWithBing(query, count) {
    const url = `https://cn.bing.com/images/search?q=${encodeURIComponent(query)}&count=${Math.min(count * 2, 50)}&form=HDRSC2`;
    const res = await fetch(url, { headers: BING_HEADERS });
    if (!res.ok)
        throw new Error(`Bing search failed: ${res.status}`);
    const html = await res.text();
    const results = [];
    const re = /murl&quot;:&quot;([^&]+)&quot;/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < count) {
        try {
            const imageUrl = decodeURIComponent(m[1]);
            results.push({ imageUrl, sourceUrl: imageUrl, title: query });
        }
        catch {
            // skip malformed
        }
    }
    if (results.length === 0) {
        const re2 = /"murl":"([^"]+)"/g;
        while ((m = re2.exec(html)) !== null && results.length < count) {
            results.push({ imageUrl: m[1], sourceUrl: m[1], title: query });
        }
    }
    return results;
}
export async function searchImages(query, count) {
    const hasGoogle = process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX;
    if (hasGoogle) {
        return searchWithGoogle(query, count);
    }
    return searchWithBing(query, count);
}
/**
 * Search Bing web (not image search) for pages matching query,
 * return URLs from known model/portrait/coser platforms.
 */
export async function searchWebPages(query, count) {
    const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${count * 3}&form=QBLH`;
    const res = await fetch(url, { headers: BING_HEADERS });
    if (!res.ok)
        throw new Error(`Bing web search failed: ${res.status}`);
    const html = await res.text();
    const results = [];
    const seen = new Set();
    // Extract URLs from <cite> tags (Bing renders result URLs in <cite>)
    const citeRe = new RegExp('<cite[^>]*>(https?://[^<]+)</cite>', 'g');
    let m;
    while ((m = citeRe.exec(html)) !== null) {
        const rawUrl = m[1].replace(/<[^>]+>/g, '').trim();
        try {
            const parsed = new URL(rawUrl);
            const href = parsed.href;
            if (!seen.has(href) && isPageSearchDomain(href)) {
                seen.add(href);
                results.push(href);
            }
        }
        catch { /* skip */ }
    }
    // Fallback: extract from href attributes
    if (results.length === 0) {
        const hrefRe = new RegExp('href="(https?://(?:(?!bing\.com|microsoft\.com)[^"]+))"', 'g');
        while ((m = hrefRe.exec(html)) !== null && results.length < count) {
            const href = m[1];
            if (!seen.has(href) && isPageSearchDomain(href)) {
                seen.add(href);
                results.push(href);
            }
        }
    }
    return results.slice(0, count);
}
