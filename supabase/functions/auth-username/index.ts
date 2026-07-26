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

async function emailFor(username: string): Promise<string | null> {
  const admin = createClient(URL, SERVICE)
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .ilike('username', escapeLike(username))
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

      // Toutes les tentatives arrivent ici avec l'IP de la Edge Function: la
      // limitation par IP de Supabase ne protège plus rien, on compte donc
      // les échecs nous-mêmes, par nom d'utilisateur.
      const { data: allowed } = await admin.rpc('login_allowed', {
        p_username: name,
      })
      if (allowed === false) return json({ error: 'too_many' }, 429)

      const email = await emailFor(name)
      // Même réponse si le compte n'existe pas ou si le mot de passe est faux.
      if (!email) {
        await admin.rpc('login_record', { p_username: name, p_success: false })
        return json({ error: 'invalid' }, 401)
      }

      const client = createClient(URL, ANON)
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password: String(password ?? ''),
      })
      if (error || !data.session) {
        await admin.rpc('login_record', { p_username: name, p_success: false })
        return json({ error: 'invalid' }, 401)
      }

      await admin.rpc('login_record', { p_username: name, p_success: true })
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
