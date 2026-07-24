// Génère les icônes PWA (PNG) à partir du SVG. `node scripts/gen-icons.mjs`
import sharp from 'sharp'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url))

const svg = await readFile(p('../public/favicon.svg'))
await mkdir(p('../public/icons/'), { recursive: true })

// Icône standard (le SVG a déjà ses marges)
for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(p(`../public/icons/icon-${size}.png`))
}

// Icône maskable: fond plein + logo dans la zone sûre
const bg = { create: { width: 512, height: 512, channels: 4, background: '#0b0f14' } }
const logo = await sharp(svg).resize(400, 400).png().toBuffer()
await sharp(bg)
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile(p('../public/icons/icon-512-maskable.png'))

// apple-touch-icon
await sharp(svg).resize(180, 180).png().toFile(p('../public/apple-touch-icon.png'))

console.log('Icônes générées.')
