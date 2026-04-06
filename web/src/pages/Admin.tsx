import { useEffect, useState } from 'react'
import { api, type User, type Cdt } from '../lib/api'
import { Layout } from '../components/Layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { UsersTab } from './admin/UsersTab'
import { CdtsTab } from './admin/CdtsTab'
import type { Session } from '../lib/api'

export function AdminPage({ session }: { session: Session }) {
  const [users, setUsers] = useState<User[]>([])
  const [cdts, setCdts] = useState<Cdt[]>([])

  useEffect(() => {
    api.getUsers().then(setUsers)
    api.getCdts().then(setCdts)
  }, [])

  return (
    <Layout session={session}>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage team members and CDTs.</p>
        </div>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="cdts">CDTs</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersTab users={users} setUsers={setUsers} cdts={cdts} />
          </TabsContent>
          <TabsContent value="cdts" className="mt-4">
            <CdtsTab cdts={cdts} setCdts={setCdts} users={users} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  )
}
