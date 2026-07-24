import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider } from './lib/i18n'
import { QueueProvider } from './lib/queue'
import { Spinner } from './components/ui'
import Layout from './components/Layout'
import Login from './screens/Login'

// Écrans chargés à la demande (bundle initial plus léger).
const Gallery = lazy(() => import('./screens/Gallery'))
const Shared = lazy(() => import('./screens/Shared'))
const Upload = lazy(() => import('./screens/Upload'))
const Inbox = lazy(() => import('./screens/Inbox'))
const Settings = lazy(() => import('./screens/Settings'))
const Trash = lazy(() => import('./screens/Trash'))
const Backup = lazy(() => import('./screens/Backup'))
const Viewer = lazy(() => import('./screens/Viewer'))

function Loader() {
  return (
    <div className="flex h-full items-center justify-center text-[var(--color-muted)]">
      <Spinner />
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <Loader />
  if (!session) return <Login />
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
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
