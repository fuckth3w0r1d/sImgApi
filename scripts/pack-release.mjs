#!/usr/bin/env node
// Sync compiled dist/ into release/ for server deployment
// Server: git clone -> copy release/* to dist/ -> npm ci --omit=dev -> start
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const releaseDir = join(root, 'release')

mkdirSync(releaseDir, { recursive: true })

// Sync dist/ -> release/ (delete files no longer in dist)
execSync(`rsync -a --delete dist/ release/`, { cwd: root, stdio: 'inherit' })

console.log('release/ updated with compiled output from dist/')
console.log()
console.log('On server after git clone:')
console.log('  cp -r release/* dist/')
console.log('  npm ci --omit=dev')
console.log('  node dist/index.js')
