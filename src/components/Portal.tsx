import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Sort un panneau de l'arbre de la page pour l'accrocher directement au body.
 *
 * Ceinture et bretelles après la panne du sélecteur de dossier: un panneau en
 * position fixed n'est calé sur l'écran que si AUCUN de ses parents ne porte
 * de transform, de filter ou de will-change. Un seul suffit à le recadrer
 * silencieusement sur la hauteur du contenu, et la fenêtre part alors hors du
 * champ de vision sans la moindre erreur. Attaché au body, plus aucun parent
 * ne peut le déplacer, quoi qu'on ajoute plus tard dans la mise en page.
 */
export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
