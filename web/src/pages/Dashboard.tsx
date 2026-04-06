import { useEffect, useState } from 'react'
import { api, type Session, type User, type Meeting, type Cdt } from '../lib/api'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar'
import { Card, CardContent } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { Separator } from '../components/ui/separator'

const roleVariant: Record<string, 'student' | 'mentor' | 'parent' | 'alumni'> = {
  student: 'student', mentor: 'mentor', parent: 'parent', alumni: 'alumni',
}

function FeaturedMeeting({ meeting, onUpdate }: { meeting: Meeting; onUpdate: (id: number, status: Meeting['my_status'], note: string) => void }) {
  const [pending, setPending] = useState<'yes' | 'maybe' | 'no' | null>(null)
  const [note, setNote] = useState(meeting.my_note ?? '')
  const [saving, setSaving] = useState(false)

  const selectStatus = (s: 'yes' | 'maybe' | 'no') => {
    setPending(s)
    setNote(meeting.my_note ?? '')
  }

  const confirm = async () => {
    if (!pending || saving) return
    setSaving(true)
    try {
      await api.rsvp(meeting.id, pending, note)
      onUpdate(meeting.id, pending, note)
      setPending(null)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => { setPending(null); setNote(meeting.my_note ?? '') }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    if (pending) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  const active = pending ?? meeting.my_status
  const d = new Date(meeting.scheduled_at * 1000)
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
  const day = d.getDate()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex gap-5">
          <div className="shrink-0 w-16 flex flex-col items-center justify-start pt-1">
            <span className="text-[10px] font-semibold tracking-widest text-primary uppercase">{month}</span>
            <span className="text-4xl font-bold leading-tight text-foreground">{day}</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg leading-snug">{meeting.name}</p>
            <p className="text-sm text-muted-foreground mt-1">{weekday} · {time}</p>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-emerald-600">{meeting.yes_count} going</span>
              <span className="mx-1.5">·</span>
              <span className="text-amber-600">{meeting.maybe_count} maybe</span>
              <span className="mx-1.5">·</span>
              <span className="text-red-600">{meeting.no_count} can't go</span>
            </p>
            {meeting.description && (
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{meeting.description}</p>
            )}

            <div className="mt-4 space-y-2">
              <div className="flex gap-1.5">
                {(['yes', 'maybe', 'no'] as const).map(s => {
                  const labels = { yes: 'Going', maybe: 'Maybe', no: "Can't go" }
                  return (
                    <Button
                      key={s}
                      size="sm"
                      variant={active === s ? 'default' : 'outline'}
                      onClick={() => selectStatus(s)}
                    >
                      {labels[s]}
                    </Button>
                  )
                })}
              </div>

              {meeting.my_status && !pending && meeting.my_note && (
                <p className="text-xs text-muted-foreground italic pl-0.5">"{meeting.my_note}"</p>
              )}

              {pending && (
                <div className="flex gap-2 items-start">
                  <Textarea
                    className="flex-1 text-xs resize-none"
                    rows={2}
                    placeholder="Add a note (optional)"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm() } }}
                    autoFocus
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button size="sm" onClick={confirm} disabled={saving}>
                      {saving ? '…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={cancel}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CdtList({ cdts, users }: { cdts: Cdt[]; users: User[] }) {
  const cdtMap = new Map(cdts.map(c => [c.id, c]))
  const grouped = new Map<string, { cdt: Cdt; members: User[] }>()

  for (const u of users) {
    if (u.cdt_id && cdtMap.has(u.cdt_id)) {
      const cdt = cdtMap.get(u.cdt_id)!
      const arr = grouped.get(u.cdt_id)?.members ?? []
      arr.push(u)
      grouped.set(u.cdt_id, { cdt, members: arr })
    }
  }

  const sorted = [...grouped.values()].sort((a, b) => a.cdt.name.localeCompare(b.cdt.name))

  return (
    <Card className="overflow-hidden py-0">
      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground px-4 py-4">No CDTs yet.</p>
      )}
      {sorted.map(({ cdt, members }, ci) => (
        <div key={cdt.id}>
          <div className="px-4 py-2 bg-muted/30">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {cdt.name} · {members.length}
            </p>
          </div>
          {members.map((u, i) => (
            <div key={u.user_id}>
              <div className="flex items-center gap-3 px-4 py-2">
                <Avatar size="sm" className="shrink-0">
                  <AvatarImage src={u.avatar_url} />
                  <AvatarFallback>{u.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                </div>
                {u.role
                  ? <Badge variant={roleVariant[u.role]} className="text-[10px]">{u.role.charAt(0).toUpperCase() + u.role.slice(1)}</Badge>
                  : <span className="text-xs text-muted-foreground shrink-0">—</span>}
              </div>
              {(i < members.length - 1 || ci < sorted.length - 1) && <Separator />}
            </div>
          ))}
          {ci < sorted.length - 1 && <Separator />}
        </div>
      ))}
    </Card>
  )
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
  const d = new Date(meeting.scheduled_at * 1000)
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const day = d.getDate()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="shrink-0 w-10 flex flex-col items-center justify-start">
        <span className="text-[9px] font-semibold tracking-widest text-primary uppercase">{month}</span>
        <span className="text-lg font-bold leading-tight text-foreground">{day}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{meeting.name}</p>
        <p className="text-xs text-muted-foreground">{weekday} · {time}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground">
          <span className="text-emerald-600">{meeting.yes_count}</span>
          <span className="mx-0.5">/</span>
          <span className="text-amber-600">{meeting.maybe_count}</span>
          <span className="mx-0.5">/</span>
          <span className="text-red-600">{meeting.no_count}</span>
        </span>
        {meeting.my_status && (
          <Badge
            variant={
              meeting.my_status === 'yes' ? 'outline'
              : meeting.my_status === 'maybe' ? 'secondary'
              : 'destructive'
            }
            className="text-[10px]"
          >
            {meeting.my_status === 'yes' ? 'Going' : meeting.my_status === 'maybe' ? 'Maybe' : "Can't go"}
          </Badge>
        )}
      </div>
    </div>
  )
}

export function Dashboard({ session }: { session: Session }) {
  const [users, setUsers] = useState<User[]>([])
  const [cdts, setCdts] = useState<Cdt[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getUsers(), api.getCdts(), api.getMeetings()]).then(([u, c, m]) => {
      setUsers(u); setCdts(c); setMeetings(m); setLoading(false)
    })
  }, [])

  if (loading) return (
    <Layout session={session}>
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Loading…</div>
    </Layout>
  )

  const upcoming = meetings
    .filter(m => m.scheduled_at > Math.floor(Date.now() / 1000))
    .sort((a, b) => a.scheduled_at - b.scheduled_at)

  const featured = upcoming[0]
  const rest = upcoming.slice(1)

  const updateRsvp = (id: number, status: Meeting['my_status'], note: string) =>
    setMeetings(ms => ms.map(m => m.id === id ? { ...m, my_status: status, my_note: note } : m))

  return (
    <Layout session={session}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-6">
          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Next Meeting</h2>
            {featured ? (
              <FeaturedMeeting meeting={featured} onUpdate={updateRsvp} />
            ) : (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">No upcoming meetings.</p>
                  <a href="/meetings" className="text-sm text-primary hover:underline mt-1 inline-block">View all meetings</a>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              CDTs · {cdts.length}
            </h2>
            <CdtList cdts={cdts} users={users} />
          </div>
        </div>

        {rest.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              Upcoming · {rest.length}
            </h2>
            <Card className="overflow-hidden py-0">
              {rest.map((m, i) => (
                <div key={m.id}>
                  <a href="/meetings" className="block hover:bg-muted/30 transition-colors">
                    <MeetingRow meeting={m} />
                  </a>
                  {i < rest.length - 1 && <Separator />}
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
    </Layout>
  )
}
