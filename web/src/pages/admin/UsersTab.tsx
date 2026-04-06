import { useState, useEffect } from 'react'
import { api, type User, type Cdt, type UserMeeting } from '../../lib/api'
import { DataTable } from '../../components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { type ColumnDef } from '@tanstack/react-table'

const ROLES = ['student', 'mentor', 'parent', 'alumni'] as const
const roleVariant: Record<string, 'student' | 'mentor' | 'parent' | 'alumni'> = {
  student: 'student', mentor: 'mentor', parent: 'parent', alumni: 'alumni',
}

const statusColor: Record<string, string> = {
  yes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  maybe: 'bg-amber-50 text-amber-700 border-amber-200',
  no: 'bg-red-50 text-red-700 border-red-200',
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface Props {
  users: User[]
  setUsers: (u: User[]) => void
  cdts: Cdt[]
}

export function UsersTab({ users, setUsers, cdts }: Props) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [userMeetings, setUserMeetings] = useState<UserMeeting[]>([])
  const [meetingsLoading, setMeetingsLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)

  const [selectedRows, setSelectedRows] = useState<User[]>([])
  const [bulkRole, setBulkRole] = useState('')
  const [bulkCdt, setBulkCdt] = useState('')
  const [applying, setApplying] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedUser) return
    setMeetingsLoading(true)
    api.getUserMeetings(selectedUser.user_id)
      .then(setUserMeetings)
      .finally(() => setMeetingsLoading(false))
  }, [selectedUser?.user_id])

  const handleRoleChange = async (userId: string, role: string) => {
    const newRole = role || null
    await api.setRole(userId, newRole)
    setUsers(users.map(u => u.user_id === userId ? { ...u, role: newRole } : u))
    if (selectedUser?.user_id === userId) {
      setSelectedUser(prev => prev ? { ...prev, role: newRole } : prev)
    }
  }

  const handleCdtChange = async (userId: string, cdtId: string) => {
    const newCdtId = cdtId || null
    await api.setUserCdt(userId, newCdtId)
    const cdt = cdts.find(c => c.id === newCdtId)
    setUsers(users.map(u => u.user_id === userId
      ? { ...u, cdt_id: newCdtId, cdt_name: cdt?.name ?? null }
      : u
    ))
    if (selectedUser?.user_id === userId) {
      setSelectedUser(prev => prev ? { ...prev, cdt_id: newCdtId, cdt_name: cdt?.name ?? null } : prev)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.syncUsers()
      const fresh = await api.getUsers()
      setUsers(fresh)
      setSyncDone(true)
      setTimeout(() => setSyncDone(false), 3000)
    } finally {
      setSyncing(false)
    }
  }

  const applyBulkRole = async () => {
    if (!selectedRows.length) return
    setApplying('role')
    try {
      await api.bulkSetRole(selectedRows.map(u => u.user_id), bulkRole || null)
      const role = bulkRole || null
      setUsers(users.map(u =>
        selectedRows.some(s => s.user_id === u.user_id) ? { ...u, role } : u
      ))
      setSelectedRows([])
      setBulkRole('')
    } finally {
      setApplying(null)
    }
  }

  const applyBulkCdt = async () => {
    if (!selectedRows.length) return
    setApplying('cdt')
    try {
      await api.bulkSetCdt(selectedRows.map(u => u.user_id), bulkCdt || null)
      const cdtId = bulkCdt || null
      const cdt = cdts.find(c => c.id === cdtId)
      setUsers(users.map(u =>
        selectedRows.some(s => s.user_id === u.user_id)
          ? { ...u, cdt_id: cdtId, cdt_name: cdt?.name ?? null }
          : u
      ))
      setSelectedRows([])
      setBulkCdt('')
    } finally {
      setApplying(null)
    }
  }

  const openUser = (user: User) => {
    setSelectedUser(user)
    setUserMeetings([])
    setSheetOpen(true)
  }

  const columns: ColumnDef<User, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Member',
      cell: ({ row }) => {
        const u = row.original
        return (
          <div className="flex items-center gap-2.5">
            <Avatar size="sm" className="shrink-0">
              <AvatarImage src={u.avatar_url} />
              <AvatarFallback>{u.name[0]}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{u.name}</span>
            {u.is_admin && (
              <Badge variant="outline" className="text-[0.6rem] h-4 px-1.5">Admin</Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => {
        const role = row.original.role
        if (!role) return <span className="text-muted-foreground">—</span>
        return <Badge variant={roleVariant[role]}>{role.charAt(0).toUpperCase() + role.slice(1)}</Badge>
      },
    },
    {
      accessorKey: 'cdt_name',
      header: 'CDT',
      cell: ({ row }) => {
        const name = row.original.cdt_name
        return name ? <span>{name}</span> : <span className="text-muted-foreground">—</span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{users.length} members</span>
        <div className="flex items-center gap-2">
          {syncDone && (
            <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
              Synced successfully
            </Badge>
          )}
          <Button onClick={handleSync} disabled={syncing} size="sm">
            {syncing ? 'Syncing…' : 'Sync from Slack'}
          </Button>
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          <span className="text-xs font-medium">{selectedRows.length} selected</span>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2">
            <Select value={bulkRole} onChange={e => setBulkRole(e.target.value)} className="h-7 text-xs w-28">
              <option value="">Set role…</option>
              {ROLES.map(r => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
              <option value="">Clear role</option>
            </Select>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!bulkRole || applying === 'role'} onClick={applyBulkRole}>
              {applying === 'role' ? '…' : 'Apply'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={bulkCdt} onChange={e => setBulkCdt(e.target.value)} className="h-7 text-xs w-36">
              <option value="">Set CDT…</option>
              {cdts.map(cdt => (
                <option key={cdt.id} value={cdt.id}>{cdt.name}</option>
              ))}
            </Select>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={(!bulkCdt && bulkCdt !== '') || applying === 'cdt'} onClick={applyBulkCdt}>
              {applying === 'cdt' ? '…' : 'Apply'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelectedRows([])}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={users}
        filterPlaceholder="Filter members…"
        onRowClick={openUser}
        enableRowSelection
        onSelectionChange={setSelectedRows}
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {selectedUser && (
            <>
              <SheetHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <Avatar size="lg">
                    <AvatarImage src={selectedUser.avatar_url} />
                    <AvatarFallback>{selectedUser.name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle className="text-base">{selectedUser.name}</SheetTitle>
                    {selectedUser.is_admin && (
                      <Badge variant="outline" className="mt-1 text-[0.6rem] h-4 px-1.5">Admin</Badge>
                    )}
                  </div>
                </div>
              </SheetHeader>

              <div className="px-6 space-y-4">
                <Separator />

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Role</label>
                  <Select
                    value={selectedUser.role ?? ''}
                    onChange={e => handleRoleChange(selectedUser.user_id, e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="">No role</option>
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">CDT</label>
                  <Select
                    value={selectedUser.cdt_id ?? ''}
                    onChange={e => handleCdtChange(selectedUser.user_id, e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="">No CDT</option>
                    {cdts.map(cdt => (
                      <option key={cdt.id} value={cdt.id}>{cdt.name}</option>
                    ))}
                  </Select>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-medium">Meeting Attendance</p>
                  {meetingsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : userMeetings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No attendance records.</p>
                  ) : (
                    <ul className="space-y-2">
                      {userMeetings.map(m => (
                        <li key={m.id} className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium leading-snug">{m.name}</p>
                            <p className="text-[0.65rem] text-muted-foreground">{formatDate(m.scheduled_at)}</p>
                          </div>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-medium shrink-0 ${statusColor[m.status] ?? ''}`}>
                            {m.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
