import { useEffect, useState } from 'react'
import { api, type Session, type Meeting, type AdminMeeting } from '../lib/api'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Card, CardContent } from '../components/ui/card'
import { DataTable } from '../components/data-table'
import { Input } from '../components/ui/input'
import { Separator } from '../components/ui/separator'
import { Calendar } from '../components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '../lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { type ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2, Plus } from 'lucide-react'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  }) + ' · ' + new Date(unix * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })

const fromUnix = (unix: number) => new Date(unix * 1000)
const toUnix = (d: Date) => Math.floor(d.getTime() / 1000)

function DatePicker({ date, onSelect, placeholder = 'Pick a date', className }: {
  date: Date | undefined
  onSelect: (date: Date | undefined) => void
  placeholder?: string
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-empty={!date}
          className={cn('h-8 justify-start text-left font-normal text-xs data-[empty=true]:text-muted-foreground', className)}
        >
          <CalendarIcon className="size-3.5 mr-1.5 shrink-0" />
          {date ? format(date, 'MMM d, yyyy') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  )
}

function RsvpCard({ meeting, onUpdate }: { meeting: Meeting; onUpdate: (id: number, status: Meeting['my_status'], note: string) => void }) {
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
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const day = d.getDate()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-4">
          <div className="shrink-0 w-11 flex flex-col items-center justify-start pt-0.5">
            <span className="text-[10px] font-semibold tracking-widest text-primary uppercase">{month}</span>
            <span className="text-2xl font-bold leading-tight text-foreground">{day}</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[15px] leading-snug">{meeting.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{weekday} · {time}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="text-emerald-600">{meeting.yes_count} going</span>
              <span className="mx-1.5">·</span>
              <span className="text-amber-600">{meeting.maybe_count} maybe</span>
              <span className="mx-1.5">·</span>
              <span className="text-red-600">{meeting.no_count} can't go</span>
            </p>
            {meeting.description && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{meeting.description}</p>
            )}

            <div className="mt-3 space-y-2">
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

function CreateMeetingDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (m: AdminMeeting) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState<Date>()
  const [time, setTime] = useState('')
  const [channel, setChannel] = useState('')
  const [creating, setCreating] = useState(false)

  const [isRecurring, setIsRecurring] = useState(false)
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [endDate, setEndDate] = useState<Date>()

  const toggleDay = (d: number) => {
    setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  const handleCreate = async () => {
    if (!name.trim() || !date || !time) return
    setCreating(true)
    try {
      const [hours, minutes] = time.split(':').map(Number)
      const dt = new Date(date)
      dt.setUTCHours(hours, minutes, 0, 0)
      const scheduledAt = toUnix(dt)

      if (isRecurring && selectedDays.length > 0 && endDate) {
        const timeOfDayMinutes = hours * 60 + minutes
        const endDt = new Date(endDate)
        endDt.setUTCHours(23, 59, 59, 0)
        const endUnix = toUnix(endDt)
        const created = await api.createMeetingSeries({
          name: name.trim(),
          description: desc.trim() || undefined,
          scheduled_at: scheduledAt,
          channel_id: channel.trim() || undefined,
          days_of_week: selectedDays,
          time_of_day_minutes: timeOfDayMinutes,
          end_date: endUnix,
        })
        onCreated(created)
      } else {
        const created = await api.createMeeting({
          name: name.trim(),
          description: desc.trim() || undefined,
          scheduled_at: scheduledAt,
          channel_id: channel.trim() || undefined,
        })
        onCreated(created)
      }

      setName(''); setDesc(''); setDate(undefined); setTime(''); setChannel('')
      setIsRecurring(false); setSelectedDays([]); setEndDate(undefined)
      onClose()
    } finally {
      setCreating(false)
    }
  }

  const isValid = name.trim() && date && time && (!isRecurring || (selectedDays.length > 0 && endDate))

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Meeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name <span className="text-destructive">*</span></label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Build Session" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description <span className="text-muted-foreground">(optional)</span></label>
            <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's happening at this meeting?" className="text-xs min-h-16 resize-none" rows={3} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Date & Time <span className="text-destructive">*</span></label>
            <div className="flex gap-2">
              <DatePicker date={date} onSelect={setDate} placeholder="Pick a date" className="flex-1" />
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="h-8 w-28 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Slack Channel ID <span className="text-muted-foreground">(for announcement)</span></label>
            <Input value={channel} onChange={e => setChannel(e.target.value)} placeholder="C01234567" className="h-8 text-xs" />
          </div>

          <Separator />

          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-2 text-xs font-medium cursor-pointer"
              onClick={() => setIsRecurring(!isRecurring)}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isRecurring ? 'bg-primary border-primary' : 'border-input'}`}>
                {isRecurring && <span className="text-[10px] text-primary-foreground">✓</span>}
              </div>
              Recurring meeting
            </button>

            {isRecurring && (
              <div className="space-y-2 pl-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Repeat on</label>
                  <div className="flex gap-1">
                    {DAY_LABELS.map((label, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`w-9 h-7 rounded text-[11px] font-medium transition-colors ${
                          selectedDays.includes(i)
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => toggleDay(i)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">End date <span className="text-destructive">*</span></label>
                  <DatePicker date={endDate} onSelect={setEndDate} placeholder="Pick end date" />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={creating || !isValid}>
            {creating ? 'Creating…' : 'Create Meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditMeetingDialog({ meeting, onClose, onSaved }: { meeting: AdminMeeting; onClose: () => void; onSaved: (m: AdminMeeting) => void }) {
  const initial = fromUnix(meeting.scheduled_at)
  const [name, setName] = useState(meeting.name)
  const [desc, setDesc] = useState(meeting.description ?? '')
  const [date, setDate] = useState<Date>(initial)
  const [time, setTime] = useState(
    `${String(initial.getUTCHours()).padStart(2, '0')}:${String(initial.getUTCMinutes()).padStart(2, '0')}`
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      let scheduledAt: number | undefined = undefined
      if (date && time) {
        const [hours, minutes] = time.split(':').map(Number)
        const dt = new Date(date)
        dt.setUTCHours(hours, minutes, 0, 0)
        scheduledAt = toUnix(dt)
      }
      await api.updateMeeting(meeting.id, {
        name: name.trim() || undefined,
        description: desc.trim() || undefined,
        scheduled_at: scheduledAt,
      })
      onSaved({
        ...meeting,
        name: name.trim() || meeting.name,
        description: desc.trim(),
        scheduled_at: scheduledAt ?? meeting.scheduled_at,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!meeting} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Meeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea value={desc} onChange={e => setDesc(e.target.value)} className="text-xs min-h-16 resize-none" rows={3} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Date & Time</label>
            <div className="flex gap-2">
              <DatePicker date={date} onSelect={d => { if (d) setDate(d) }} placeholder="Pick a date" className="flex-1" />
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="h-8 w-28 text-xs"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdminMeetingsView() {
  const [meetings, setMeetings] = useState<AdminMeeting[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editMeeting, setEditMeeting] = useState<AdminMeeting | null>(null)
  const now = Math.floor(Date.now() / 1000)

  useEffect(() => {
    api.getAdminMeetings().then(setMeetings)
  }, [])

  const handleCancel = async (m: AdminMeeting) => {
    const newVal = !m.cancelled
    setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, cancelled: newVal } : x))
    await api.cancelMeeting(m.id, newVal).catch(() => {
      setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, cancelled: m.cancelled } : x))
    })
  }

  const handleDelete = async (id: number) => {
    await api.deleteMeeting(id)
    setMeetings(prev => prev.filter(x => x.id !== id))
  }

  const columns: ColumnDef<AdminMeeting, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.series_id && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Series</Badge>}
        </div>
      ),
    },
    {
      id: 'date',
      header: 'Date',
      accessorFn: row => row.scheduled_at,
      cell: ({ row }) => (
        <span className="text-muted-foreground whitespace-nowrap">{formatDate(row.original.scheduled_at)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: row => row.cancelled ? 0 : row.scheduled_at,
      cell: ({ row }) => {
        const m = row.original
        if (m.cancelled) return <Badge variant="destructive">Cancelled</Badge>
        if (m.scheduled_at < now) return <Badge variant="secondary">Past</Badge>
        return <Badge variant="outline">Upcoming</Badge>
      },
    },
    {
      id: 'rsvp',
      header: 'RSVP',
      cell: ({ row }) => {
        const m = row.original
        return (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-emerald-600">✓{m.yes_count}</span>
            <span className="text-amber-600">?{m.maybe_count}</span>
            <span className="text-red-600">✗{m.no_count}</span>
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const m = row.original
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" onClick={() => setEditMeeting(m)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => handleCancel(m)}
            >
              {m.cancelled ? 'Restore' : 'Cancel'}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              onClick={() => handleDelete(m.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{meetings.length} meetings</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-3.5 mr-1" />New Meeting</Button>
      </div>
      <DataTable columns={columns} data={meetings} filterPlaceholder="Filter meetings…" />

      <CreateMeetingDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={m => setMeetings(prev => [m, ...prev])}
      />

      {editMeeting && (
        <EditMeetingDialog
          meeting={editMeeting}
          onClose={() => setEditMeeting(null)}
          onSaved={m => setMeetings(prev => prev.map(x => x.id === m.id ? m : x))}
        />
      )}
    </div>
  )
}

export function MeetingsPage({ session }: { session: Session }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getMeetings().then(m => { setMeetings(m); setLoading(false) })
  }, [])

  const updateRsvp = (id: number, status: Meeting['my_status'], note: string) =>
    setMeetings(ms => ms.map(m => m.id === id ? { ...m, my_status: status, my_note: note } : m))

  if (loading) return (
    <Layout session={session}>
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Loading…</div>
    </Layout>
  )

  return (
    <Layout session={session}>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">RSVP to upcoming meetings.</p>
        </div>

        {session.is_admin ? (
          <Tabs defaultValue="upcoming">
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="manage">Manage</TabsTrigger>
            </TabsList>
            <TabsContent value="upcoming" className="mt-4">
              {meetings.length === 0
                ? (<p className="text-sm text-muted-foreground py-4">No upcoming meetings.</p>)
                : (<div className="flex flex-col gap-3">{meetings.map(m => <RsvpCard key={m.id} meeting={m} onUpdate={updateRsvp} />)}</div>)}
            </TabsContent>
            <TabsContent value="manage" className="mt-4">
              <AdminMeetingsView />
            </TabsContent>
          </Tabs>
        ) : (
          meetings.length === 0
            ? (<p className="text-sm text-muted-foreground py-4">No upcoming meetings.</p>)
            : (<div className="flex flex-col gap-3">{meetings.map(m => <RsvpCard key={m.id} meeting={m} onUpdate={updateRsvp} />)}</div>)
        )}
      </div>
    </Layout>
  )
}
