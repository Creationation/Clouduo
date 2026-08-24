/**
 * File unique des travaux réseau.
 *
 * Envois et enregistrements partagent la MEME ligne d'attente, et sont
 * traités un par un, dans l'ordre où ils ont été demandés. C'est un choix
 * délibéré: sur un téléphone, lancer trois envois et deux enregistrements en
 * même temps ne va pas plus vite, la bande passante est la même. Cela
 * multiplie seulement les délais d'attente, les URL signées qui expirent
 * pendant qu'on patiente, et les échecs qui n'ont l'air d'avoir aucune cause.
 *
 * Le fait de passer d'un écran à l'autre ne change rien: la file vit au
 * niveau de l'application, pas de l'écran affiché.
 */

type Task<T> = () => Promise<T>

let tail: Promise<unknown> = Promise.resolve()
let waiting = 0
let active = false

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Nombre de travaux en attente ou en cours. */
export function laneSize(): number {
  return waiting + (active ? 1 : 0)
}

/** Prévient à chaque changement (sert à afficher un compteur). */
export function onLaneChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Exécute la tâche quand son tour vient. Rend exactement ce que la tâche
 * rend, et laisse passer ses erreurs: la file avance quoi qu'il arrive, un
 * travail qui échoue ne bloque jamais les suivants.
 */
export function runExclusive<T>(task: Task<T>): Promise<T> {
  waiting += 1
  notify()
  const result = tail.then(async () => {
    waiting -= 1
    active = true
    notify()
    try {
      return await task()
    } finally {
      active = false
      notify()
    }
  })
  // La queue suit le résultat sans jamais rejeter, sinon une seule erreur
  // casserait la chaîne pour tous les travaux suivants.
  tail = result.catch(() => {})
  return result
}
