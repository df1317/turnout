import { useEffect, useState } from 'react'
import { api, type Session } from './lib/api'
import { Dashboard } from './pages/Dashboard'
import { AdminPage } from './pages/Admin'
import { MeetingsPage } from './pages/Meetings'
import { CdtsPage } from './pages/Cdts'

export default function App() {
  const [session, setSession] = useState<Session | null | 'loading'>('loading')

  useEffect(() => {
    api.getMe().then(setSession).catch(() => setSession(null))
  }, [])

  if (session === 'loading') return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>
  )

  if (!session) {
    window.location.href = '/login'
    return null
  }

  const path = window.location.pathname
  if (path.startsWith('/cdts')) return <CdtsPage session={session} />
  if (path.startsWith('/meetings')) return <MeetingsPage session={session} />
  if (path.startsWith('/admin') && session.is_admin) return <AdminPage session={session} />
  return <Dashboard session={session} />
}
