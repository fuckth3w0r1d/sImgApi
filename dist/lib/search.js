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
    // Chinese quality sources
    'pixiv.net', 'i.pximg.net',
    'konachan.com',
    'zerochan.net',
    'yande.re',
    'bilibili.com', 'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com',
    'sinaimg.cn',
    'photo.weibo.com',
];
export function isQualityDomain(url) {
    try {
        const hostname = new URL(url).hostname;
        return QUALITY_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
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
async function searchWithBaidu(query, count) {
    const url = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(query)}&pn=0&rn=${Math.min(count * 2, 60)}`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': 'https://image.baidu.com/',
        },
    });
    if (!res.ok)
        throw new Error(`Baidu search failed: ${res.status}`);
    const html = await res.text();
    const results = [];
    // Extract from "hoverURL" or "middleURL" in page data
    const re = /"hoverURL":"([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < count) {
        const imageUrl = m[1];
        if (imageUrl.startsWith('http')) {
            results.push({ imageUrl, sourceUrl: imageUrl, title: query });
        }
    }
    // Fallback: middleURL
    if (results.length === 0) {
        const re2 = /"middleURL":"([^"]+)"/g;
        while ((m = re2.exec(html)) !== null && results.length < count) {
            const imageUrl = m[1];
            if (imageUrl.startsWith('http')) {
                results.push({ imageUrl, sourceUrl: imageUrl, title: query });
            }
        }
    }
    return results;
}
async function searchWithBing(query, count) {
    const url = `https://cn.bing.com/images/search?q=${encodeURIComponent(query)}&count=${Math.min(count * 2, 50)}&form=HDRSC2`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
    });
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
function isChinese(text) {
    return /[\u4e00-\u9fff]/.test(text);
}
export async function searchImages(query, count) {
    const hasGoogle = process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX;
    if (isChinese(query)) {
        // Chinese query: try Baidu first, fall back to Bing Chinese
        try {
            const results = await searchWithBaidu(query, count);
            if (results.length > 0)
                return results;
        }
        catch {
            // fall through to Bing
        }
        return searchWithBing(query, count);
    }
    // Non-Chinese: Google CSE if configured, else Bing
    if (hasGoogle) {
        return searchWithGoogle(query, count);
    }
    return searchWithBing(query, count);
}
