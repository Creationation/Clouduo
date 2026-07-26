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
  IconMenu,
  IconDoc,
  IconTrash,
  IconRestore,
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
  { to: '/shared', key: 'nav.shared', Icon: IconShared },
  { to: '/upload', key: 'nav.upload', Icon: IconPlus, center: true },
  { to: '/inbox', key: 'nav.inbox', Icon: IconInbox },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
]

// Le burger remplace l'entrée Galerie et ne contient que l'espace personnel.
// Le Commun a sa propre entrée dans la barre et gère ses onglets lui-même.
const places: { to: string; key: TKey; Icon: typeof IconGallery }[] = [
  { to: '/', key: 'nav.gallery', Icon: IconGallery },
  { to: '/docs', key: 'nav.docs', Icon: IconDoc },
  { to: '/backup', key: 'backup.title', Icon: IconRestore },
  { to: '/trash', key: 'trash.title', Icon: IconTrash },
]

export default function Layout() {
  const { t } = useI18n()
  const inbox = useInboxCount()
  const loc = useLocation()
  const [menu, setMenu] = useState(false)
  // Le lecteur plein écran masque la barre (route viewer gérée à part).
  const hideBar = loc.pathname.startsWith('/view/')

  // Naviguer referme le menu.
  useEffect(() => setMenu(false), [loc.pathname])

  return (
    <div className="flex h-full">
      {/* Desktop: rail latéral. La barre du bas et son burger sont une
          réponse au pouce sur mobile; sur grand écran ils gaspillent de la
          hauteur et laissent la moitié des sections dans un menu. */}
      {!hideBar && (
        <aside className="glass-bar safe-top hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto p-3 md:flex">
          <span className="px-3 pb-3 pt-1 text-sm font-semibold">
            {t('app.name')}
          </span>
          {[...places, ...items].map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? 'glass-accent'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
                }`
              }
            >
              <span className="relative">
                <Icon size={19} />
                {key === 'nav.inbox' && inbox > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold text-white">
                    {inbox}
                  </span>
                )}
              </span>
              {t(key)}
            </NavLink>
          ))}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          {/* La clé de route relance l'animation d'entrée à chaque écran. */}
          <div key={loc.pathname} className="page-in">
            <Outlet />
          </div>
        </main>

        {!hideBar && (
          <div className="px-2 md:hidden">
            <InstallPrompt />
          </div>
        )}

        {!hideBar && (
          <div className="md:hidden">
          {/* Fond cliquable: refermer en touchant ailleurs, en fondu. */}
          <div
            onClick={() => setMenu(false)}
            className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 ${
              menu ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />

          <nav className="glass-bar safe-bottom sticky bottom-0 z-40">
            {/* Petit panneau de choix, juste au-dessus de la barre.
                pointer-events-none est indispensable: ce conteneur occupe une
                bande invisible sur toute la largeur au-dessus de la barre, et
                sans ça il avalait les clics des boutons en bas de page. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-full">
              <div className="mx-auto max-w-2xl px-2 pb-2">
                <div
                  className={`glass glass-menu w-60 origin-bottom-left rounded-2xl transition-all duration-200 ease-out ${
                    menu
                      ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
                      : 'pointer-events-none translate-y-2 scale-95 opacity-0'
                  }`}
                >
                  {/* Défilement si la liste dépasse la hauteur du panneau. */}
                  <div className="max-h-[45vh] overflow-y-auto p-1.5">
                    {places.map(({ to, key, Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                            isActive
                              ? 'glass-accent'
                              : 'text-[var(--color-text)] active:bg-[var(--color-surface-2)]'
                          }`
                        }
                      >
                        <Icon size={19} />
                        {t(key)}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto flex max-w-2xl items-stretch justify-around">
              <button
                onClick={() => setMenu((v) => !v)}
                aria-expanded={menu}
                className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
                  menu ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
                }`}
              >
                <IconMenu size={22} />
                <span>{t('nav.menu')}</span>
              </button>

              {items.map(({ to, key, Icon, center }) => (
                <NavLink
                  key={to}
                  to={to}
                  end
                  className={({ isActive }) =>
                    `relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
                      isActive
                        ? 'text-[var(--color-accent)]'
                        : 'text-[var(--color-muted)]'
                    }`
                  }
                >
                  {center ? (
                    <span className="-mt-4 flex h-12 w-12 items-center justify-center glass-accent rounded-full shadow-lg transition active:scale-95">
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
          </div>
        )}
      </div>
    </div>
  )
}
