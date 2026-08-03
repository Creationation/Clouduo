import { useEffect, useRef } from 'react'

/**
 * Fermeture au toucher sur le fond sombre, sans que le panneau se referme
 * tout seul dans la seconde.
 *
 * Le panneau s'ouvre pile sous le doigt qui vient d'appuyer sur le bouton.
 * Sur les Android où le délai de double-tap est encore actif (WebView
 * ancienne, ou surtout « Forcer l'activation du zoom » dans les réglages
 * d'accessibilité, qui annule le maximum-scale de la page), le navigateur
 * émet un second clic fantôme environ 300 ms après l'appui, aux mêmes
 * coordonnées. Ce clic-là tombe sur le fond du panneau tout juste affiché et
 * le referme aussitôt: à l'écran, la fenêtre clignote et rien ne se passe.
 * Le même appareil peut donc « bloquer » là où un autre fonctionne.
 *
 * Deux garde-fous:
 * 1. rien n'est écouté pendant les 500 premières ms d'affichage;
 * 2. seul un geste dont l'appui ET le relâchement ont eu lieu sur le fond
 *    ferme le panneau, ce qui évite aussi la fermeture quand le doigt part
 *    d'un bouton du panneau et se relève à côté.
 *
 * Repli volontaire: si les évènements pointer ne remontent pas, on ferme
 * quand même au clic sur le fond. Mieux vaut une fermeture de trop qu'un
 * panneau dont on ne peut plus sortir.
 */
export function useBackdropDismiss(onClose: () => void) {
  const armed = useRef(false)
  const startedInside = useRef(false)

  useEffect(() => {
    const id = setTimeout(() => {
      armed.current = true
    }, 500)
    return () => clearTimeout(id)
  }, [])

  return {
    onPointerDown: (e: React.PointerEvent) => {
      startedInside.current = e.target !== e.currentTarget
    },
    onClick: (e: React.MouseEvent) => {
      if (!armed.current) return
      if (e.target !== e.currentTarget) return
      if (startedInside.current) return
      onClose()
    },
  }
}
