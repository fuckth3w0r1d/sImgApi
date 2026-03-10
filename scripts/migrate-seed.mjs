#!/usr/bin/env node
/**
 * Migrate SEED_GALLERIES env var to config/seed.json
 * Usage: node scripts/migrate-seed.mjs [tag-name]
 * Example: node scripts/migrate-seed.mjs 写真
 *
 * Reads SEED_GALLERIES from .env, groups all URLs under the given tag,
 * and writes/merges into config/seed.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Parse .env manually
function loadEnv(envPath) {
  if (!existsSync(envPath)) return {}
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = val
  }
  return env
}

const tag = process.argv[2] ?? '未分类'
const envPath = resolve('.env')
const configDir = resolve('config')
const seedPath = resolve('config/seed.json')

const env = loadEnv(envPath)
const raw = env['SEED_GALLERIES'] ?? ''

if (!raw.trim()) {
  console.error('SEED_GALLERIES is empty or not set in .env')
  process.exit(1)
}

// Parse all URLs from SEED_GALLERIES (support legacy comma-separated or tag|url format)
const urls = []
for (const segment of raw.split(';')) {
  const trimmed = segment.trim()
  if (!trimmed) continue
  if (trimmed.includes('|')) {
    const pipe = trimmed.indexOf('|')
    const segUrls = trimmed.slice(pipe + 1).split(',').map((u) => u.trim()).filter(Boolean)
    urls.push(...segUrls)
  } else {
    const segUrls = trimmed.split(',').map((u) => u.trim()).filter(Boolean)
    urls.push(...segUrls)
  }
}

if (urls.length === 0) {
  console.error('No URLs found in SEED_GALLERIES')
  process.exit(1)
}

// Load existing seed.json or start fresh
let existing = []
if (existsSync(seedPath)) {
  try {
    existing = JSON.parse(readFileSync(seedPath, 'utf-8'))
  } catch {
    console.warn('Could not parse existing seed.json, starting fresh')
  }
}

// Find or create entry for this tag
const entry = existing.find((e) => e.tag === tag)
if (entry) {
  const before = entry.urls.length
  const merged = [...new Set([...entry.urls, ...urls])]
  entry.urls = merged
  console.log(`Updated tag "${tag}": ${before} -> ${merged.length} URL(s)`)
} else {
  existing.push({ tag, urls })
  console.log(`Created tag "${tag}" with ${urls.length} URL(s)`)
}

mkdirSync(configDir, { recursive: true })
writeFileSync(seedPath, JSON.stringify(existing, null, 2) + '\n')
console.log(`Written to ${seedPath}`)
console.log('You can now remove or comment out SEED_GALLERIES from .env')
