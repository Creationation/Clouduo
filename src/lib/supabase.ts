import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Aide au debug: message clair si le .env.local n'est pas rempli.
  console.error(
    'Config Supabase manquante. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local',
  )
}

export const supabaseUrl = url
export const supabaseAnonKey = anonKey

/**
 * Le lien de réinitialisation revient avec `type=recovery` dans le fragment.
 * On le lit ICI, avant la création du client: `detectSessionInUrl` consomme
 * puis efface le fragment, et l'événement PASSWORD_RECOVERY peut partir avant
 * que React ait monté son écouteur. Se fier au seul événement fait manquer le
 * cas une fois sur deux, et l'utilisateur se retrouve simplement connecté
 * sans jamais voir l'écran de nouveau mot de passe.
 */
export const isRecoveryLink =
  typeof window !== 'undefined' &&
  window.location.hash.includes('type=recovery')

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
    detectSessionInUrl: true,
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
