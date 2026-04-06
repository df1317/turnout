import { useState } from 'react'
import { api, type Cdt, type CdtDetail, type User } from '../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Trash2, Pencil } from 'lucide-react'

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-cdt'

interface Props {
  cdts: Cdt[]
  setCdts: (c: Cdt[]) => void
  users: User[]
}

export function CdtsTab({ cdts, setCdts, users: _users }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editDetail, setEditDetail] = useState<CdtDetail | null>(null)
  const [editLoading, setEditLoading] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newHandle, setNewHandle] = useState('')
  const [newChannelId, setNewChannelId] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editChannelId, setEditChannelId] = useState('')
  const [saving, setSaving] = useState(false)

  const refreshCdts = () => api.getAdminCdts().then(setCdts)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await api.createCdt({
        name: newName.trim(),
        handle: newHandle.trim() || undefined,
        channel_id: newChannelId.trim() || undefined,
      })
      await refreshCdts()
      setCreateOpen(false)
      setNewName('')
      setNewHandle('')
      setNewChannelId('')
    } finally {
      setCreating(false)
    }
  }

  const handleOpenEdit = async (cdt: Cdt) => {
    setEditLoading(true)
    setEditOpen(true)
    setEditName(cdt.name)
    setEditChannelId(cdt.channel_id ?? '')
    try {
      const detail = await api.getCdt(cdt.id)
      setEditDetail(detail)
    } finally {
      setEditLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editDetail) return
    setSaving(true)
    try {
      await api.updateCdt(editDetail.id, {
        name: editName.trim() || undefined,
        channel_id: editChannelId.trim() || undefined,
      })
      await refreshCdts()
      setEditOpen(false)
      setEditDetail(null)
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!editDetail) return
    await api.setUserCdt(userId, null)
    const refreshed = await api.getCdt(editDetail.id)
    setEditDetail(refreshed)
    await refreshCdts()
  }

  const handleDelete = async (id: string) => {
    await api.deleteCdt(id)
    await refreshCdts()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{cdts.length} CDTs</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>New CDT</Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">Handle</TableHead>
              <TableHead className="px-4">Members</TableHead>
              <TableHead className="px-4 w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cdts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-xs text-muted-foreground">
                  No CDTs yet.
                </TableCell>
              </TableRow>
            ) : (
              cdts.map(cdt => (
                <TableRow key={cdt.id}>
                  <TableCell className="px-4 py-2.5 font-medium">{cdt.name}</TableCell>
                  <TableCell className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                    @{cdt.handle}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-muted-foreground">
                    {cdt.member_count}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleOpenEdit(cdt)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(cdt.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New CDT</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name <span className="text-destructive">*</span></label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Competition Driving Team"
                className="h-8 text-xs"
              />
              {newName && (
                <p className="text-xs text-muted-foreground">
                  Handle: @{newHandle || slugify(newName)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Custom Handle <span className="text-muted-foreground">(optional)</span></label>
              <Input
                value={newHandle}
                onChange={e => setNewHandle(e.target.value)}
                placeholder={newName ? slugify(newName) : 'auto-generated'}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Slack Channel ID <span className="text-muted-foreground">(optional)</span></label>
              <Input
                value={newChannelId}
                onChange={e => setNewChannelId(e.target.value)}
                placeholder="C01234567"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create CDT'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={open => { setEditOpen(open); if (!open) setEditDetail(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit CDT</DialogTitle>
          </DialogHeader>
          {editLoading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
          ) : editDetail ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Name</label>
                <Input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Slack Channel ID</label>
                <Input
                  value={editChannelId}
                  onChange={e => setEditChannelId(e.target.value)}
                  placeholder="C01234567"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Members ({editDetail.members.length})</p>
                {editDetail.members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No members yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {editDetail.members.map(m => (
                      <li key={m.user_id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Avatar size="sm">
                            <AvatarImage src={m.avatar_url} />
                            <AvatarFallback>{m.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{m.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMember(m.user_id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={saving || editLoading}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
