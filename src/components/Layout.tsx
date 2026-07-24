import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n, type TKey } from '../lib/i18n'
import {
  IconGallery,
  IconShared,
  IconPlus,
  IconInbox,
  IconSettings,
} from './icons'
import InstallPrompt from './InstallPrompt'

function useInboxCount() {
  const { session } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!session) return
    const load = async () => {
      const { count } = await supabase
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .eq('to_user', session.user.id)
        .eq('status', 'pending')
      setCount(count ?? 0)
    }
    load()
    // Temps réel: badge mis à jour dès qu'un transfert arrive.
    const ch = supabase
      .channel('inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfers' },
        load,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [session])

  return count
}

const items: {
  to: string
  key: TKey
  Icon: typeof IconGallery
  center?: boolean
}[] = [
  { to: '/', key: 'nav.gallery', Icon: IconGallery },
  { to: '/shared', key: 'nav.shared', Icon: IconShared },
  { to: '/upload', key: 'nav.upload', Icon: IconPlus, center: true },
  { to: '/inbox', key: 'nav.inbox', Icon: IconInbox },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
]

export default function Layout() {
  const { t } = useI18n()
  const inbox = useInboxCount()
  const loc = useLocation()
  // Le lecteur plein écran masque la barre (route viewer gérée à part).
  const hideBar = loc.pathname.startsWith('/view/')

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {!hideBar && (
        <div className="px-2">
          <InstallPrompt />
        </div>
      )}

      {!hideBar && (
        <nav className="safe-bottom sticky bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-stretch justify-around">
            {items.map(({ to, key, Icon, center }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] ${
                    isActive
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-muted)]'
                  }`
                }
              >
                {center ? (
                  <span className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-lg">
                    <Icon size={24} />
                  </span>
                ) : (
                  <span className="relative">
                    <Icon size={22} />
                    {key === 'nav.inbox' && inbox > 0 && (
                      <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold text-white">
                        {inbox}
                      </span>
                    )}
                  </span>
                )}
                <span>{t(key)}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
