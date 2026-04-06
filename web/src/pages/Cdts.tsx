import { useEffect, useState } from 'react'
import { api, type Session, type User, type Cdt } from '../lib/api'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar'
import { Card } from '../components/ui/card'
import { Separator } from '../components/ui/separator'

const roleVariant: Record<string, 'student' | 'mentor' | 'parent' | 'alumni'> = {
  student: 'student', mentor: 'mentor', parent: 'parent', alumni: 'alumni',
}

const ROLE_ORDER = ['student', 'mentor', 'parent', 'alumni']

function UserRow({ user, showRole }: { user: User; showRole: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Avatar size="sm" className="shrink-0">
        <AvatarImage src={user.avatar_url} />
        <AvatarFallback>{user.name[0]}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.name}</p>
      </div>
      {showRole && user.role
        ? <Badge variant={roleVariant[user.role]}>{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</Badge>
        : !showRole && <span className="text-xs text-muted-foreground shrink-0">—</span>}
    </div>
  )
}

function Group({ name, count, users, showRole }: { name: string; count: number; users: User[]; showRole: boolean }) {
  return (
    <div>
      <div className="px-4 py-2 bg-muted/30">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {name} · {count}
        </p>
      </div>
      {users.map((u, i) => (
        <div key={u.user_id}>
          <UserRow user={u} showRole={showRole} />
          {i < users.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  )
}

export function CdtsPage({ session }: { session: Session }) {
  const [users, setUsers] = useState<User[]>([])
  const [cdts, setCdts] = useState<Cdt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getUsers(), api.getCdts()]).then(([u, c]) => {
      setUsers(u); setCdts(c); setLoading(false)
    })
  }, [])

  if (loading) return (
    <Layout session={session}>
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Loading…</div>
    </Layout>
  )

  const cdtMap = new Map(cdts.map(c => [c.id, c]))
  const grouped: { name: string; members: User[] }[] = []
  const unassigned: User[] = []

  const sortedCdts = [...cdts].sort((a, b) => a.name.localeCompare(b.name))

  for (const cdt of sortedCdts) {
    const members = users.filter(u => u.cdt_id === cdt.id)
    if (members.length > 0) {
      grouped.push({ name: cdt.name, members })
    }
  }

  for (const u of users) {
    if (!u.cdt_id || !cdtMap.has(u.cdt_id)) {
      unassigned.push(u)
    }
  }

  const byRole = new Map<string, User[]>()
  for (const u of unassigned) {
    const role = u.role || 'unassigned'
    const arr = byRole.get(role) ?? []
    arr.push(u)
    byRole.set(role, arr)
  }

  const roleGroups: { name: string; members: User[] }[] = []
  for (const role of ROLE_ORDER) {
    const members = byRole.get(role)
    if (members && members.length > 0) {
      roleGroups.push({ name: role.charAt(0).toUpperCase() + role.slice(1), members })
      byRole.delete(role)
    }
  }
  const leftover = byRole.get('unassigned')
  if (leftover && leftover.length > 0) {
    roleGroups.push({ name: 'Unassigned', members: leftover })
  }

  const allGroups = [...grouped, ...roleGroups]
  const hasAny = allGroups.length > 0

  return (
    <Layout session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">CDTs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Team members organized by CDT and role.</p>
        </div>
        <Card className="overflow-hidden py-0">
          {!hasAny && (
            <p className="text-sm text-muted-foreground px-4 py-4">No team members yet.</p>
          )}
          {allGroups.map((group, gi) => (
            <div key={group.name}>
              <Group
                name={group.name}
                count={group.members.length}
                users={group.members}
                showRole={gi >= grouped.length}
              />
              {gi < allGroups.length - 1 && <Separator />}
            </div>
          ))}
        </Card>
      </div>
    </Layout>
  )
}
