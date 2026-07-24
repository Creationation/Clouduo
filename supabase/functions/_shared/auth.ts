import { createClient } from 'npm:@supabase/supabase-js@^2'

// Client "utilisateur": propage le JWT du client -> RLS s'applique.
export function userClient(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
}

// Client "service": bypass RLS (comptage de références, purge). À manier avec soin.
export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

// Vérifie et retourne l'utilisateur authentifié, sinon null.
export async function requireUser(req: Request) {
  const supabase = userClient(req)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
