// Edge Function: auth-username
// Connexion et mot de passe oublié par NOM D'UTILISATEUR.
//
// L'email reste l'identifiant technique de Supabase Auth, mais il ne doit pas
// être exposé au client: la résolution username -> email se fait donc ici,
// avec la clé service_role, et seule la session est renvoyée.
import { createClient } from 'npm:@supabase/supabase-js@^2'
import { json, preflight } from '../_shared/cors.ts'

const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// % et _ sont des jokers pour ilike: les neutraliser pour que la comparaison
// reste une égalité insensible à la casse.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

/**
 * Résout ce que l'utilisateur a tapé vers l'email du compte.
 * Accepte le nom d'utilisateur OU l'email: se souvenir duquel des deux on
 * s'est servi à l'inscription est une charge inutile, et l'email reste
 * l'identifiant naturel dans la tête des gens.
 */
async function emailFor(input: string): Promise<string | null> {
  const admin = createClient(URL, SERVICE)

  if (input.includes('@')) {
    const { data } = await admin.auth.admin.listUsers()
    const found = data?.users.find(
      (u) => u.email?.toLowerCase() === input.toLowerCase(),
    )
    return found?.email ?? null
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .ilike('username', escapeLike(input))
    .limit(1)
    .maybeSingle()
  if (!profile) return null
  const { data } = await admin.auth.admin.getUserById(profile.id)
  return data.user?.email ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  try {
    const { action, username, password, redirectTo } = await req.json()
    const name = String(username ?? '').trim()
    if (!name) return json({ error: 'username manquant' }, 400)

    if (action === 'login') {
      const admin = createClient(URL, SERVICE)
      const email = await emailFor(name)

      // Compteur d'échecs indexé sur l'email résolu: sans ça, username et
      // email donneraient deux compteurs séparés pour le même compte, et
      // doubleraient le nombre d'essais possibles.
      const key = email ?? name

      // Toutes les tentatives arrivent ici avec l'IP de la Edge Function: la
      // limitation par IP de Supabase ne protège donc plus rien.
      const { data: allowed } = await admin.rpc('login_allowed', {
        p_username: key,
      })
      if (allowed === false) return json({ error: 'too_many' }, 429)

      // Même réponse si le compte n'existe pas ou si le mot de passe est faux.
      if (!email) {
        await admin.rpc('login_record', { p_username: key, p_success: false })
        return json({ error: 'invalid' }, 401)
      }

      const client = createClient(URL, ANON)
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password: String(password ?? ''),
      })
      if (error || !data.session) {
        await admin.rpc('login_record', { p_username: key, p_success: false })
        return json({ error: 'invalid' }, 401)
      }

      await admin.rpc('login_record', { p_username: key, p_success: true })
      return json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
    }

    if (action === 'reset') {
      const email = await emailFor(name)
      if (email) {
        const client = createClient(URL, ANON)
        // redirectTo est validé par Supabase contre la liste des URL de
        // redirection autorisées: pas de redirection arbitraire possible.
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo ? String(redirectTo) : undefined,
        })
      }
      // Toujours ok: ne pas révéler quels noms existent.
      return json({ ok: true })
    }

    return json({ error: `action inconnue: ${action}` }, 400)
  } catch (e) {
    console.error('auth-username', e)
    return json({ error: String(e) }, 500)
  }
})
