// Génère TOUTES les icônes à partir de public/favicon.svg.
// `node scripts/gen-icons.mjs`
import sharp from 'sharp'
import pngToIcoRaw from 'png-to-ico'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pngToIco = typeof pngToIcoRaw === 'function' ? pngToIcoRaw : pngToIcoRaw.default
const p = (rel) => fileURLToPath(new URL(rel, import.meta.url))

const svg = await readFile(p('../public/favicon.svg'))
await mkdir(p('../public/icons/'), { recursive: true })

// Le nuage seul et le fond seul, pour l'icône maskable et l'adaptative
// Android: ces formats sont rognés par le système, le carré arrondi du logo
// complet y serait coupé.
const cloudOnly = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M352 356H168a70 70 0 0 1-10-139 100 100 0 0 1 188-26 62 62 0 0 1 6 165z" fill="#ffffff"/>
  <circle cx="214" cy="272" r="14" fill="#3b6ef6" opacity="0.5"/>
  <circle cx="298" cy="272" r="14" fill="#3b6ef6" opacity="0.5"/>
</svg>`)

const bgOnly = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#7aa3ff"/><stop offset="55%" stop-color="#3b6ef6"/>
    <stop offset="100%" stop-color="#2f5ae0"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
</svg>`)

// Icônes standard (le SVG a déjà ses marges)
for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(p(`../public/icons/icon-${size}.png`))
}

// Maskable: plein cadre, le nuage dans la zone sûre (Android rogne jusqu'à
// 20% de chaque côté selon la forme choisie par le fabricant).
const cloud400 = await sharp(cloudOnly).resize(400, 400).png().toBuffer()
await sharp(bgOnly)
  .resize(512, 512)
  .composite([{ input: cloud400, gravity: 'center' }])
  .png()
  .toFile(p('../public/icons/icon-512-maskable.png'))

// apple-touch-icon (iOS applique lui-même son masque arrondi)
await sharp(svg).resize(180, 180).png().toFile(p('../public/apple-touch-icon.png'))

// favicon.ico: encore réclamé par de vieux navigateurs, certains agrégateurs
// et Google, qui vont chercher /favicon.ico avant de lire le HTML.
const icoSizes = await Promise.all(
  [16, 32, 48].map((s) => sharp(svg).resize(s, s).png().toBuffer()),
)
await writeFile(p('../public/favicon.ico'), await pngToIco(icoSizes))

// Icône de l'app bureau (Electron), même source.
await mkdir(p('../desktop/build/'), { recursive: true })
await sharp(svg).resize(512, 512).png().toFile(p('../desktop/build/icon.png'))
const ico256 = await sharp(svg).resize(256, 256).png().toBuffer()
await writeFile(p('../desktop/build/icon.ico'), await pngToIco([ico256]))

console.log('Icônes générées: PWA, maskable, apple-touch, favicon.ico, bureau.')
