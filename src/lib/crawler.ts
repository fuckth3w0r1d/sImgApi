import { parse } from 'node-html-parser'

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

const IMAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'cross-site',
}

export interface CrawledImage {
  url: string
  referer?: string
}

export async function extractCrawledImages(pageUrl: string): Promise<CrawledImage[]> {
  const res = await fetch(pageUrl, {
    headers: BROWSER_HEADERS,
  })
  if (!res.ok) throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`)

  const html = await res.text()
  const root = parse(html)
  const seen = new Set<string>()
  const results: CrawledImage[] = []

  const tryAdd = (raw: string | undefined) => {
    if (!raw) return
    raw = raw.trim()
    if (!raw || raw.startsWith('data:')) return
    try {
      const abs = new URL(raw, pageUrl).href
      if (!seen.has(abs)) {
        seen.add(abs)
        results.push({ url: abs, referer: pageUrl })
      }
    } catch {
      // invalid URL, skip
    }
  }

  for (const img of root.querySelectorAll('img')) {
    tryAdd(img.getAttribute('src'))
    tryAdd(img.getAttribute('data-src'))
    tryAdd(img.getAttribute('data-lazy-src'))
  }

  for (const meta of root.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
    tryAdd(meta.getAttribute('content'))
  }

  return results
}

export async function downloadImage(
  imgUrl: string,
  referer?: string
): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(imgUrl, {
    headers: {
      ...IMAGE_HEADERS,
      ...(referer ? { 'Referer': referer, 'Sec-Fetch-Site': 'same-site' } : {}),
    },
  })
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`)

  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  const buffer = Buffer.from(await res.arrayBuffer())

  return { buffer, mime }
}

export async function isImageUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: IMAGE_HEADERS,
    })
    const ct = res.headers.get('content-type') ?? ''
    return ct.startsWith('image/')
  } catch {
    return false
  }
}
