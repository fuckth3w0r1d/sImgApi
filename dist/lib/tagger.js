import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from '../types.js';
function cleanTags(raw) {
    return [
        ...new Set(raw
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 1 && t.length < 50 && !/^\d+$/.test(t))),
    ];
}
const CATEGORY_KEYWORDS = {
    '二次元': ['anime', 'manga', 'illustration', 'cartoon', 'art', 'drawing', 'painted', '动漫', '插画', '二次元'],
    '真人模特': ['model', 'fashion', 'portrait', 'woman', 'man', 'girl', 'boy', 'person', 'people', 'studio', '模特', '写真'],
    '风景': ['landscape', 'nature', 'scenery', 'mountain', 'forest', 'sky', 'ocean', 'sea', 'river', 'lake', 'sunset', '风景', '自然'],
    '人像': ['face', 'headshot', 'selfie', 'close-up', 'closeup', '人像', '肖像'],
    '动物': ['animal', 'cat', 'dog', 'bird', 'wildlife', 'pet', 'fish', 'horse', 'lion', 'tiger', '动物', '猫', '狗'],
    '美食': ['food', 'meal', 'dish', 'cooking', 'recipe', 'cuisine', 'restaurant', 'dessert', 'cake', '美食', '食物'],
    '建筑': ['architecture', 'building', 'city', 'urban', 'house', 'bridge', 'tower', 'street', '建筑', '城市'],
    '其他': [],
};
export function inferCategoryFromTags(tags) {
    const lower = tags.map((t) => t.toLowerCase());
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (cat === '其他')
            continue;
        if (keywords.some((kw) => lower.some((t) => t.includes(kw))))
            return cat;
    }
    return undefined;
}
function isValidCategory(val) {
    return typeof val === 'string' && CATEGORIES.includes(val);
}
export function extractTagsFromHtml(imgEl, _pageUrl) {
    const candidates = [];
    const alt = imgEl.getAttribute('alt');
    if (alt)
        candidates.push(...alt.split(/[,/|]+/));
    const title = imgEl.getAttribute('title');
    if (title)
        candidates.push(...title.split(/[,/|]+/));
    // Look for nearby <figcaption>
    const fig = imgEl.closest('figure');
    if (fig) {
        const caption = fig.querySelector('figcaption');
        if (caption)
            candidates.push(...caption.text.split(/[,/|]+/));
    }
    return cleanTags(candidates);
}
export async function analyzeWithAI(buffer, existingTags, existingCategory) {
    // Skip AI if tags are sufficient and category is known
    if (existingTags.length >= 3 && existingCategory) {
        return { tags: existingTags, category: existingCategory };
    }
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    if (!baseURL && !process.env.ANTHROPIC_API_KEY) {
        return { tags: existingTags, category: existingCategory ?? '其他' };
    }
    try {
        const apiKey = process.env.ANTHROPIC_API_KEY ?? 'placeholder';
        const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
        const base64 = buffer.toString('base64');
        // Determine media type from buffer magic bytes
        let mediaType = 'image/jpeg';
        if (buffer[0] === 0x89 && buffer[1] === 0x50)
            mediaType = 'image/png';
        else if (buffer[0] === 0x47 && buffer[1] === 0x49)
            mediaType = 'image/gif';
        else if (buffer[0] === 0x52 && buffer[4] === 0x57)
            mediaType = 'image/webp';
        const categoryList = CATEGORIES.join('","');
        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                        {
                            type: 'text',
                            text: `Analyze this image and return a JSON object with two fields:\n- "tags": array of up to 8 short descriptive tags (subjects, people, objects, style, author if visible)\n- "category": one of ["${categoryList}"]\n\nReturn ONLY the JSON object, nothing else.\nExample: {"tags":["woman","studio","fashion"],"category":"model"}`,
                        },
                    ],
                },
            ],
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match)
            return { tags: existingTags, category: existingCategory ?? '其他' };
        const parsed = JSON.parse(match[0]);
        const aiTags = Array.isArray(parsed.tags) ? parsed.tags.map(String) : [];
        const aiCategory = isValidCategory(parsed.category) ? parsed.category : '其他';
        return {
            tags: cleanTags([...existingTags, ...aiTags]),
            category: existingCategory ?? aiCategory,
        };
    }
    catch {
        return { tags: existingTags, category: existingCategory ?? '其他' };
    }
}
