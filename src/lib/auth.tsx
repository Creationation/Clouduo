import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, invokePublic, isRecoveryLink } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** L'autre utilisateur (il n'y en a que 2) — pour "Envoyer à...". */
  other: Profile | null
  profiles: Profile[]
  loading: boolean
  /** Session ouverte via un lien de réinitialisation: imposer un nouveau mdp. */
  recovery: boolean
  signIn: (
    username: string,
    password: string,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  requestPasswordReset: (username: string) => Promise<void>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  endRecovery: () => void
  refreshProfiles: () => Promise<void>
}

const AuthContext = createContext<AuthState>({} as AuthState)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  // État initial lu depuis l'URL, pas seulement depuis l'événement.
  const [recovery, setRecovery] = useState(isRecoveryLink)

  const loadProfiles = async () => {
    const { data } = await supabase.from('profiles').select('*')
    if (data) setProfiles(data as Profile[])
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      // Lien de réinitialisation cliqué: la session est ouverte mais on doit
      // exiger un nouveau mot de passe avant de laisser entrer.
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) loadProfiles()
    else setProfiles([])
  }, [session])

  const uid = session?.user.id
  const profile = profiles.find((p) => p.id === uid) ?? null
  const other = profiles.find((p) => p.id !== uid) ?? null

  // Connexion par NOM D'UTILISATEUR: l'Edge Function résout le compte et
  // renvoie la session, l'email n'est jamais exposé au navigateur.
  const signIn = async (username: string, password: string) => {
    const { ok, status, data } = await invokePublic<{
      access_token: string
      refresh_token: string
    }>('auth-username', { action: 'login', username: username.trim(), password })
    // 429: trop d'échecs, compte bloqué quelques minutes.
    if (status === 429) return { error: 'too_many' }
    if (!ok || !data?.access_token) return { error: 'invalid' }
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
    return { error: error ? error.message : null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  // Le lien part sur l'email du compte. Réponse volontairement identique que
  // le nom existe ou non.
  const requestPasswordReset = async (username: string) => {
    await invokePublic('auth-username', {
      action: 'reset',
      username: username.trim(),
      redirectTo: window.location.origin,
    })
  }

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error ? error.message : null }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        other,
        profiles,
        loading,
        recovery,
        signIn,
        signOut,
        requestPasswordReset,
        updatePassword,
        endRecovery: () => {
          setRecovery(false)
          // Nettoyer le fragment: sans ça, un rafraîchissement de la page
          // relancerait l'écran de nouveau mot de passe indéfiniment.
          if (window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname)
          }
        },
        refreshProfiles: loadProfiles,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
