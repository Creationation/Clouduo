import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import { QueueProvider } from './lib/queue'
import { Spinner } from './components/ui'
import Layout from './components/Layout'
import Login from './screens/Login'

// Écrans chargés à la demande (bundle initial plus léger).
const Gallery = lazy(() => import('./screens/Gallery'))
const Shared = lazy(() => import('./screens/Shared'))
const Docs = lazy(() => import('./screens/Docs'))
const SharedDocs = lazy(() => import('./screens/SharedDocs'))
const Upload = lazy(() => import('./screens/Upload'))
const Inbox = lazy(() => import('./screens/Inbox'))
const Settings = lazy(() => import('./screens/Settings'))
const Trash = lazy(() => import('./screens/Trash'))
const Backup = lazy(() => import('./screens/Backup'))
const Viewer = lazy(() => import('./screens/Viewer'))
const ResetPassword = lazy(() => import('./screens/ResetPassword'))

function Loader() {
  return (
    <div className="flex h-full items-center justify-center text-[var(--color-muted)]">
      <Spinner />
    </div>
  )
}

function Gate() {
  const { session, loading, recovery } = useAuth()
  if (loading) return <Loader />
  if (!session) return <Login />
  // Lien de réinitialisation: nouveau mot de passe obligatoire avant d'entrer.
  if (recovery)
    return (
      <Suspense fallback={<Loader />}>
        <ResetPassword />
      </Suspense>
    )
  return (
    <QueueProvider>
      <Suspense fallback={<Loader />}>
        <AppRoutes />
      </Suspense>
    </QueueProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Gallery />} />
        <Route path="/shared" element={<Shared />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/shared/docs" element={<SharedDocs />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/backup" element={<Backup />} />
      </Route>
      {/* Visionneuse plein écran (hors layout) */}
      <Route path="/view/:scope/:id" element={<Viewer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    // AuthProvider est au-dessus: I18nProvider lit la langue du profil.
    <ThemeProvider>
      <AuthProvider>
        <I18nProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </I18nProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
