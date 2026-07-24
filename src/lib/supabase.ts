import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Aide au debug: message clair si le .env.local n'est pas rempli.
  console.error(
    'Config Supabase manquante. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local',
  )
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
