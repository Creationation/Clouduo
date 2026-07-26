// Drapeaux dessinés en SVG plutôt qu'en emoji: les emoji drapeau ne sont pas
// rendus du tout sous Windows (on y voit "FR", "AT") et changent d'allure
// d'une plateforme à l'autre. Proportions officielles 2:3.

type P = { className?: string; size?: number }

// Bleu #002F67, blanc, rouge #EF4135. Trois bandes verticales égales.
export const FlagFR = ({ className, size = 22 }: P) => (
  <svg
    width={size}
    height={(size * 2) / 3}
    viewBox="0 0 3 2"
    className={className}
    role="img"
    aria-label="Français"
  >
    <rect width="3" height="2" fill="#FFFFFF" />
    <rect width="1" height="2" fill="#002F67" />
    <rect x="2" width="1" height="2" fill="#EF4135" />
  </svg>
)

// Rouge Pantone 186 C (#C8102E), blanc, rouge. Trois bandes horizontales.
export const FlagAT = ({ className, size = 22 }: P) => (
  <svg
    width={size}
    height={(size * 2) / 3}
    viewBox="0 0 3 2"
    className={className}
    role="img"
    aria-label="Deutsch"
  >
    <rect width="3" height="2" fill="#C8102E" />
    <rect y="0.6667" width="3" height="0.6667" fill="#FFFFFF" />
  </svg>
)
