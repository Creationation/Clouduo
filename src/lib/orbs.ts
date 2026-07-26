/**
 * Bulles de verre du fond: rebond sur les bords ET entre elles.
 *
 * Les keyframes CSS ne peuvent pas gérer le choc entre deux bulles (il faut
 * connaître les positions à chaque image), d'où cette petite boucle. Elle ne
 * touche que `transform`, donc tout reste sur le compositeur.
 */

interface Orb {
  el: HTMLElement
  r: number
  x: number
  y: number
  vx: number
  vy: number
  m: number
  /** Vitesse imposée: un choc change la direction, jamais l'allure. */
  speed: number
}

// Vitesses en px/s: lent, c'est un décor, pas une animation de jeu.
const SPEEDS = [26, 34, 20]
const ANGLES = [0.6, 2.4, 4.1] // radians, départs bien séparés
const START = [
  { x: 0.12, y: 0.2 },
  { x: 0.68, y: 0.62 },
  { x: 0.4, y: 0.82 },
]

export function startOrbs() {
  const layer = document.querySelector<HTMLElement>('.orb-layer')
  if (!layer) return
  // Sur petit écran le CSS n'en laisse qu'une (backdrop-filter coûte cher sur
  // mobile): on ignore celles qui sont masquées, largeur nulle.
  const els = Array.from(layer.querySelectorAll<HTMLElement>('.orb')).filter(
    (el) => el.offsetWidth > 0,
  )
  if (!els.length) return

  let W = layer.clientWidth
  let H = layer.clientHeight

  const orbs: Orb[] = els.map((el, i) => {
    const r = el.offsetWidth / 2
    const speed = SPEEDS[i % SPEEDS.length]
    const a = ANGLES[i % ANGLES.length]
    const s = START[i % START.length]
    return {
      el,
      r,
      x: Math.min(Math.max(s.x * W, r), W - r),
      y: Math.min(Math.max(s.y * H, r), H - r),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      // Masse proportionnelle à la surface: la grosse pousse la petite.
      m: r * r,
      speed,
    }
  })

  const draw = () => {
    for (const o of orbs) {
      o.el.style.transform = `translate3d(${o.x - o.r}px, ${o.y - o.r}px, 0)`
    }
  }

  // Réglage système "moins d'animations": on place et on s'arrête là.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (reduced.matches) {
    draw()
    return
  }

  const resize = () => {
    W = layer.clientWidth
    H = layer.clientHeight
    for (const o of orbs) {
      o.x = Math.min(Math.max(o.x, o.r), Math.max(o.r, W - o.r))
      o.y = Math.min(Math.max(o.y, o.r), Math.max(o.r, H - o.r))
    }
  }
  window.addEventListener('resize', resize)

  let last = performance.now()
  let raf = 0

  const step = (now: number) => {
    // Onglet en arrière-plan puis retour: sans plafond, dt vaudrait plusieurs
    // secondes et les bulles traverseraient les murs d'un coup.
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now

    for (const o of orbs) {
      o.x += o.vx * dt
      o.y += o.vy * dt

      // Rebond sur les bords: on replace au contact puis on inverse.
      if (o.x - o.r < 0) {
        o.x = o.r
        o.vx = Math.abs(o.vx)
      } else if (o.x + o.r > W) {
        o.x = W - o.r
        o.vx = -Math.abs(o.vx)
      }
      if (o.y - o.r < 0) {
        o.y = o.r
        o.vy = Math.abs(o.vy)
      } else if (o.y + o.r > H) {
        o.y = H - o.r
        o.vy = -Math.abs(o.vy)
      }
    }

    // Chocs entre bulles, élastiques.
    for (let i = 0; i < orbs.length; i++) {
      for (let j = i + 1; j < orbs.length; j++) {
        const a = orbs[i]
        const b = orbs[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const min = a.r + b.r
        if (dist === 0 || dist >= min) continue

        const nx = dx / dist
        const ny = dy / dist

        // Séparer d'abord, sinon elles se collent et vibrent.
        const overlap = (min - dist) / 2
        a.x -= nx * overlap
        a.y -= ny * overlap
        b.x += nx * overlap
        b.y += ny * overlap

        // Vitesse relative projetée sur la normale du contact.
        const sep = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (sep >= 0) continue // elles s'éloignent déjà
        const imp = (2 * sep) / (a.m + b.m)
        a.vx += imp * b.m * nx
        a.vy += imp * b.m * ny
        b.vx -= imp * a.m * nx
        b.vy -= imp * a.m * ny
      }
    }

    // Un choc élastique redistribue la vitesse: une bulle repart au ralenti,
    // l'autre accélère. On garde donc la direction issue du choc mais on
    // rétablit l'allure d'origine, pour un mouvement régulier et propre.
    for (const o of orbs) {
      const s = Math.hypot(o.vx, o.vy)
      if (s > 0.001) {
        o.vx = (o.vx / s) * o.speed
        o.vy = (o.vy / s) * o.speed
      }
    }

    draw()
    raf = requestAnimationFrame(step)
  }

  // Onglet caché: inutile de tourner, on repart proprement au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
      raf = 0
    } else if (!raf) {
      last = performance.now()
      raf = requestAnimationFrame(step)
    }
  })

  draw()
  raf = requestAnimationFrame(step)
}
