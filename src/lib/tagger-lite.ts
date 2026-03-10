import type { HTMLElement } from 'node-html-parser'
import { CATEGORIES, type Category } from '../types.js'

function cleanTags(raw: string[]): string[] {
  return [
    ...new Set(
      raw
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 1 && t.length < 50 && !/^\d+$/.test(t))
    ),
  ]
}

export function extractTagsFromHtml(imgEl: HTMLElement, _pageUrl: string): string[] {
  const candidates: string[] = []

  const alt = imgEl.getAttribute('alt')
  if (alt) candidates.push(...alt.split(/[,/|]+/))

  const title = imgEl.getAttribute('title')
  if (title) candidates.push(...title.split(/[,/|]+/))

  const fig = imgEl.closest('figure')
  if (fig) {
    const caption = fig.querySelector('figcaption')
    if (caption) candidates.push(...caption.text.split(/[,/|]+/))
  }

  return cleanTags(candidates)
}

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  '二次元': ['anime', 'manga', 'illustration', 'cartoon', 'art', 'drawing', 'painted', '动漫', '插画', '二次元'],
  '真人模特': ['model', 'fashion', 'portrait', 'woman', 'man', 'girl', 'boy', 'person', 'people', 'studio', '模特', '写真', 'coser', 'cosplay'],
  '风景': ['landscape', 'nature', 'scenery', 'mountain', 'forest', 'sky', 'ocean', 'sea', 'river', 'lake', 'sunset', '风景', '自然'],
  '人像': ['face', 'headshot', 'selfie', 'close-up', 'closeup', '人像', '肖像'],
  '动物': ['animal', 'cat', 'dog', 'bird', 'wildlife', 'pet', 'fish', 'horse', 'lion', 'tiger', '动物', '猫', '狗'],
  '美食': ['food', 'meal', 'dish', 'cooking', 'recipe', 'cuisine', 'restaurant', 'dessert', 'cake', '美食', '食物'],
  '建筑': ['architecture', 'building', 'city', 'urban', 'house', 'bridge', 'tower', 'street', '建筑', '城市'],
  '其他': [],
}

export function inferCategoryFromTags(tags: string[]): Category | undefined {
  const lower = tags.map((t) => t.toLowerCase())
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    if (cat === '其他') continue
    if (keywords.some((kw) => lower.some((t) => t.includes(kw)))) return cat
  }
  return undefined
}
