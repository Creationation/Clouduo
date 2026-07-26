import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string

/**
 * Une clé SECRÈTE ne doit jamais atteindre un navigateur: elle contourne la
 * RLS et donnerait à n'importe quel visiteur un accès total aux deux espaces
 * privés. C'est arrivé le 2026-07-26 via une variable d'hébergeur mal
 * renseignée, et rien dans le code ne s'y opposait. Ce garde-fou rend la
 * même erreur impossible: on refuse la clé plutôt que de la publier.
 */
function safeKey(candidate: string | undefined): string {
  if (!candidate) return ''
  if (candidate.startsWith('sb_secret_')) {
    console.error(
      "SÉCURITÉ: une clé secrète Supabase a été fournie au client. Elle est ignorée. Utilise la clé 'publishable'.",
    )
    return ''
  }
  // Clé legacy service_role (JWT dont la charge utile contient le rôle).
  try {
    const payload = JSON.parse(atob(candidate.split('.')[1] ?? ''))
    if (payload?.role === 'service_role') {
      console.error(
        'SÉCURITÉ: la clé service_role a été fournie au client. Elle est ignorée.',
      )
      return ''
    }
  } catch {
    /* pas un JWT: rien à vérifier de plus */
  }
  return candidate
}

// UNE SEULE variable est lue, et surtout pas VITE_SUPABASE_ANON_KEY.
// Vite remplace `import.meta.env.VITE_X` par la valeur littérale au build:
// la simple présence de cette expression dans le code suffisait à recopier
// la clé de l'hébergeur dans le bundle public, garde-fou ou pas. Ne plus la
// nommer est le seul moyen sûr.
const anonKey = safeKey(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
)

if (!url || !anonKey) {
  console.error(
    'Config Supabase manquante ou refusée. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabaseUrl = url
export const supabaseAnonKey = anonKey

/**
 * Le lien de réinitialisation revient avec les jetons dans le fragment.
 *
 * On le lit ICI, avant la création du client, et on ouvre la session
 * nous-mêmes (voir auth.tsx). `detectSessionInUrl` est désactivé exprès:
 * observé en production, il déclenchait bien son traitement (l'avertissement
 * gotrue sur l'ancienneté de l'URL apparaissait) mais n'émettait jamais la
 * requête de validation du jeton, ne stockait aucune session et laissait le
 * fragment en place, sans la moindre erreur. L'utilisateur voyait alors un
 * lien parfaitement valide traité comme expiré.
 *
 * setSession() est le chemin déjà utilisé par la connexion par mot de passe,
 * donc éprouvé, et le comportement devient déterministe.
 */
function readRecoveryFromHash() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash.includes('type=recovery')) return null
  const p = new URLSearchParams(hash.slice(1))
  const access_token = p.get('access_token')
  const refresh_token = p.get('refresh_token')
  if (!access_token || !refresh_token) return null
  return { access_token, refresh_token }
}

export const recoveryTokens = readRecoveryFromHash()
export const isRecoveryLink = recoveryTokens !== null

/** Appel d'une Edge Function SANS session (connexion, mot de passe oublié). */
export async function invokePublic<T>(
  name: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data: data as T | null }
}

// Valeurs de repli pour éviter un crash au chargement si .env.local est vide:
// l'app s'affiche (écran de connexion) et la connexion échouera proprement.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Volontairement désactivé: on traite le fragment nous-mêmes, cf. plus haut.
    detectSessionInUrl: false,
  },
})

/** Invoque une Edge Function en passant le JWT de session automatiquement. */
export async function invokeFunction<T>(
  name: string,
  body: unknown,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body as Record<string, unknown>,
  })
  if (error) throw error
  return data as T
}
