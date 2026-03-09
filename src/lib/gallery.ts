import { extractCrawledImages } from './crawler.js'

export interface GalleryImage {
  imageUrl: string
  htmlTags: string[]
}

async function fetchUnsplash(tag: string | undefined, count: number): Promise<GalleryImage[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY!
  const url = tag
    ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(tag)}&per_page=${Math.min(count, 30)}`
    : `https://api.unsplash.com/photos?per_page=${Math.min(count, 30)}`
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } })
  if (!res.ok) throw new Error(`Unsplash API error: ${res.status}`)
  const data = await res.json() as {
    results?: { urls: { regular: string }; alt_description?: string; description?: string }[]
  } | { urls: { regular: string }; alt_description?: string; description?: string }[]

  const items = Array.isArray(data) ? data : (data.results ?? [])
  return items.map((p) => ({
    imageUrl: p.urls.regular,
    htmlTags: [p.alt_description, p.description]
      .filter(Boolean)
      .flatMap((s) => s!.split(/[\s,/|]+/))
      .map((t) => t.trim())
      .filter((t) => t.length > 1),
  }))
}

async function fetchPixabay(tag: string | undefined, count: number): Promise<GalleryImage[]> {
  const key = process.env.PIXABAY_API_KEY!
  const q = tag ? `&q=${encodeURIComponent(tag)}` : ''
  const url = `https://pixabay.com/api/?key=${key}${q}&image_type=photo&per_page=${Math.min(count, 200)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Pixabay API error: ${res.status}`)
  const data = await res.json() as { hits: { largeImageURL: string; tags: string }[] }
  return data.hits.map((h) => ({
    imageUrl: h.largeImageURL,
    htmlTags: h.tags.split(',').map((t) => t.trim()).filter(Boolean),
  }))
}

async function fetchPexels(tag: string | undefined, count: number): Promise<GalleryImage[]> {
  const key = process.env.PEXELS_API_KEY!
  const path = tag
    ? `/v1/search?query=${encodeURIComponent(tag)}&per_page=${Math.min(count, 80)}`
    : `/v1/curated?per_page=${Math.min(count, 80)}`
  const res = await fetch(`https://api.pexels.com${path}`, {
    headers: { Authorization: key },
  })
  if (!res.ok) throw new Error(`Pexels API error: ${res.status}`)
  const data = await res.json() as { photos: { src: { original: string }; alt?: string }[] }
  return data.photos.map((p) => ({
    imageUrl: p.src.original,
    htmlTags: p.alt ? p.alt.split(/[\s,/|]+/).map((t) => t.trim()).filter((t) => t.length > 1) : [],
  }))
}

async function fetchGeneric(galleryUrl: string): Promise<GalleryImage[]> {
  const crawled = await extractCrawledImages(galleryUrl)
  return crawled.map((c) => ({ imageUrl: c.url, htmlTags: c.htmlTags }))
}

export async function fetchFromGallery(
  galleryUrl: string,
  tag: string | undefined,
  count: number
): Promise<GalleryImage[]> {
  let hostname: string
  try {
    hostname = new URL(galleryUrl).hostname.replace(/^www\./, '')
  } catch {
    throw new Error(`Invalid gallery URL: ${galleryUrl}`)
  }

  if (hostname === 'unsplash.com') {
    if (!process.env.UNSPLASH_ACCESS_KEY) throw new Error('Unsplash requires UNSPLASH_ACCESS_KEY (free at unsplash.com/developers)')
    return fetchUnsplash(tag, count)
  }
  if (hostname === 'pixabay.com') {
    if (!process.env.PIXABAY_API_KEY) throw new Error('Pixabay is protected by Cloudflare and requires PIXABAY_API_KEY (free at pixabay.com/api/docs)')
    return fetchPixabay(tag, count)
  }
  if (hostname === 'pexels.com') {
    if (!process.env.PEXELS_API_KEY) throw new Error('Pexels requires PEXELS_API_KEY (free at pexels.com/api)')
    return fetchPexels(tag, count)
  }

  // Generic fallback: crawl the page
  return fetchGeneric(galleryUrl)
}
