import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChannelPicker } from "../components/ChannelPicker";
import { Layout } from "../components/Layout";
import { UserPicker } from "../components/UserPicker";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../components/ui/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../components/ui/tabs";
import {
	api,
	type Cdt,
	type CdtDetail,
	type Session,
	type User,
} from "../lib/api";

const roleVariant: Record<string, "student" | "mentor" | "parent" | "alumni"> =
	{
		student: "student",
		mentor: "mentor",
		parent: "parent",
		alumni: "alumni",
	};

const slugify = (name: string) =>
	`${name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")}-cdt`;

function UserRow({ user, showRole }: { user: User; showRole: boolean }) {
	return (
		<div className="flex items-center gap-3 px-4 py-2.5">
			<Avatar size="sm" className="shrink-0">
				<AvatarImage src={user.avatar_url} />
				<AvatarFallback>{user.name[0]}</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{user.name}</p>
			</div>
			{showRole && user.role ? (
				<Badge variant={roleVariant[user.role]}>
					{user.role.charAt(0).toUpperCase() + user.role.slice(1)}
				</Badge>
			) : (
				!showRole && (
					<span className="shrink-0 text-muted-foreground text-xs">—</span>
				)
			)}
		</div>
	);
}

function Group({
	name,
	count,
	users,
	showRole,
}: {
	name: string;
	count: number;
	users: User[];
	showRole: boolean;
}) {
	return (
		<div>
			<div className="bg-muted/30 px-4 py-2">
				<p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
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
	);
}

function CdtsListView({ users, cdts }: { users: User[]; cdts: Cdt[] }) {
	const grouped: { name: string; members: User[] }[] = [];

	const sortedCdts = [...cdts].sort((a, b) => a.name.localeCompare(b.name));

	for (const cdt of sortedCdts) {
		const members = users.filter((u) => u.cdt_id === cdt.id);
		if (members.length > 0) {
			grouped.push({ name: cdt.name, members });
		}
	}

	const hasAny = grouped.length > 0;

	return (
		<Card className="overflow-hidden py-0">
			{!hasAny && (
				<p className="px-4 py-4 text-muted-foreground text-sm">
					No team members assigned to CDTs yet.
				</p>
			)}
			{grouped.map((group, gi) => (
				<div key={group.name}>
					<Group
						name={group.name}
						count={group.members.length}
						users={group.members}
						showRole={true}
					/>
					{gi < grouped.length - 1 && <Separator />}
				</div>
			))}
		</Card>
	);
}

function AdminCdtsView() {
	const [cdts, setCdts] = useState<Cdt[]>([]);
	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [editDetail, setEditDetail] = useState<CdtDetail | null>(null);
	const [editLoading, setEditLoading] = useState(false);

	const [newName, setNewName] = useState("");
	const [newHandle, setNewHandle] = useState("");
	const [newChannelId, setNewChannelId] = useState("");
	const [newMembers, setNewMembers] = useState<User[]>([]);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState("");

	const [editName, setEditName] = useState("");
	const [editChannelId, setEditChannelId] = useState("");
	const [editMembers, setEditMembers] = useState<User[]>([]);
	const [saving, setSaving] = useState(false);
	const [editError, setEditError] = useState("");

	useEffect(() => {
		api.getAdminCdts().then(setCdts);
	}, []);

	const refreshCdts = () => api.getAdminCdts().then(setCdts);

	const handleCreate = async () => {
		if (!newName.trim()) return;
		setCreating(true);
		setCreateError("");
		try {
			const cdt = await api.createCdt({
				name: newName.trim(),
				handle: newHandle.trim() || undefined,
				channel_id: newChannelId || undefined,
			});
			if (newMembers.length > 0) {
				await api.bulkSetCdt(
					newMembers.map((m) => m.user_id),
					cdt.id,
				);
			}
			await refreshCdts();
			setCreateOpen(false);
			setNewName("");
			setNewHandle("");
			setNewChannelId("");
			setNewMembers([]);
		} catch (e: unknown) {
			setCreateError((e as Error).message || "An error occurred");
		} finally {
			setCreating(false);
		}
	};

	const handleOpenEdit = async (cdt: Cdt) => {
		setEditLoading(true);
		setEditOpen(true);
		setEditName(cdt.name);
		setEditChannelId(cdt.channel_id ?? "");
		setEditMembers([]);
		try {
			const detail = await api.getCdt(cdt.id);
			setEditDetail(detail);
			setEditMembers(
				detail.members.map(
					(m) =>
						({
							...m,
							role: null,
							is_admin: false,
							cdt_id: cdt.id,
							cdt_name: cdt.name,
						}) as User,
				),
			);
		} finally {
			setEditLoading(false);
		}
	};

	const handleSaveEdit = async () => {
		if (!editDetail) return;
		setSaving(true);
		setEditError("");
		try {
			await api.updateCdt(editDetail.id, {
				name: editName.trim() || undefined,
				channel_id: editChannelId || undefined,
				members: editMembers.map((m) => m.user_id),
			});
			await refreshCdts();
			setEditOpen(false);
			setEditDetail(null);
		} catch (e: unknown) {
			setEditError((e as Error).message || "An error occurred while saving");
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		await api.deleteCdt(id);
		await refreshCdts();
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<span className="text-muted-foreground text-xs">
					{cdts.length} CDTs
				</span>
				<Button size="sm" onClick={() => setCreateOpen(true)}>
					New CDT
				</Button>
			</div>

			<div className="overflow-hidden rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="px-4">Name</TableHead>
							<TableHead className="px-4">Handle</TableHead>
							<TableHead className="px-4">Members</TableHead>
							<TableHead className="w-24 px-4">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{cdts.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={4}
									className="py-10 text-center text-muted-foreground text-xs"
								>
									No CDTs yet.
								</TableCell>
							</TableRow>
						) : (
							cdts.map((cdt) => (
								<TableRow key={cdt.id}>
									<TableCell className="px-4 py-2.5 font-medium">
										{cdt.name}
									</TableCell>
									<TableCell className="px-4 py-2.5 font-mono text-muted-foreground text-xs">
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

			<Dialog
				open={createOpen}
				onOpenChange={(open) => {
					setCreateOpen(open);
					if (!open) setCreateError("");
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New CDT</DialogTitle>
					</DialogHeader>
					<div className="space-y-3">
						{createError && (
							<div className="rounded-md bg-destructive/10 p-2 text-destructive text-xs">
								{createError}
							</div>
						)}
						<div className="space-y-1.5">
							<label htmlFor="name-input" className="font-medium text-xs">
								Name <span className="text-destructive">*</span>
							</label>
							<Input
								id="name-input"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								placeholder="Competition Driving Team"
								className="h-8 text-xs"
							/>
							{newName && (
								<p className="text-muted-foreground text-xs">
									Handle: @{newHandle || slugify(newName)}
								</p>
							)}
						</div>
						<div className="space-y-1.5">
							<label htmlFor="handle-input" className="font-medium text-xs">
								Custom Handle{" "}
								<span className="text-muted-foreground">(optional)</span>
							</label>
							<Input
								id="handle-input"
								value={newHandle}
								onChange={(e) => setNewHandle(e.target.value)}
								placeholder={newName ? slugify(newName) : "auto-generated"}
								className="h-8 text-xs"
							/>
						</div>
						<div className="flex flex-col space-y-1.5">
							<label htmlFor="channel-picker" className="font-medium text-xs">
								Slack Channel{" "}
								<span className="text-muted-foreground">(optional)</span>
							</label>
							<ChannelPicker
								value={newChannelId}
								onChange={setNewChannelId}
							/>
						</div>
						<div className="space-y-2">
							<label htmlFor="user-picker" className="font-medium text-xs">
								Members{" "}
								<span className="text-muted-foreground">(optional)</span>
							</label>
							<UserPicker
								selectedIds={newMembers.map((m) => m.user_id)}
								selectedUsers={newMembers}
								onToggle={(u, isSelected) => {
									if (isSelected) {
										setNewMembers([...newMembers, u]);
									} else {
										setNewMembers(
											newMembers.filter((m) => m.user_id !== u.user_id),
										);
									}
								}}
								onClear={() => setNewMembers([])}
								filter={(u) => u.cdt_id === null || u.cdt_id === ""}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setCreateOpen(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={creating || !newName.trim()}
						>
							{creating ? "Creating…" : "Create CDT"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={editOpen}
				onOpenChange={(open) => {
					setEditOpen(open);
					if (!open) {
						setEditDetail(null);
						setEditError("");
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Edit CDT</DialogTitle>
					</DialogHeader>
					{editLoading ? (
						<p className="py-4 text-center text-muted-foreground text-xs">
							Loading…
						</p>
					) : editDetail ? (
						<div className="space-y-4">
							{editError && (
								<div className="rounded-md bg-destructive/10 p-2 text-destructive text-xs">
									{editError}
								</div>
							)}
							<div className="space-y-1.5">
								<label htmlFor="edit-name" className="font-medium text-xs">
									Name
								</label>
								<Input
									id="edit-name"
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									className="h-8 text-xs"
								/>
							</div>
							<div className="flex flex-col space-y-1.5">
								<label htmlFor="edit-channel" className="font-medium text-xs">
									Slack Channel
								</label>
								<ChannelPicker
									value={editChannelId}
									onChange={setEditChannelId}
								/>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<label htmlFor="edit-members" className="font-medium text-xs">
										Members ({editMembers.length})
									</label>
								</div>
								<UserPicker
									selectedIds={editMembers.map((m) => m.user_id)}
									selectedUsers={editMembers}
									onToggle={(u, isSelected) => {
										if (isSelected) {
											setEditMembers([...editMembers, u]);
										} else {
											setEditMembers(
												editMembers.filter((m) => m.user_id !== u.user_id),
											);
										}
									}}
									onClear={() => setEditMembers([])}
									filter={(u) =>
										u.cdt_id === null ||
										u.cdt_id === "" ||
										editDetail.members.some((m) => m.user_id === u.user_id)
									}
								/>
							</div>
						</div>
					) : null}
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setEditOpen(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleSaveEdit}
							disabled={saving || editLoading}
						>
							{saving ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

export function CdtsPage({ session }: { session: Session }) {
	const [users, setUsers] = useState<User[]>([]);
	const [cdts, setCdts] = useState<Cdt[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const cachedUsers = sessionStorage.getItem("users_cache");
		const cachedCdts = sessionStorage.getItem("cdts_cache");

		if (cachedUsers && cachedCdts) {
			setUsers(JSON.parse(cachedUsers));
			setCdts(JSON.parse(cachedCdts));
			setLoading(false);
		}

		Promise.all([api.getUsers(), api.getCdts()]).then(([u, c]) => {
			setUsers(u);
			setCdts(c);
			sessionStorage.setItem("users_cache", JSON.stringify(u));
			sessionStorage.setItem("cdts_cache", JSON.stringify(c));
			setLoading(false);
		});
	}, []);

	if (loading)
		return (
			<Layout session={session}>
				<div className="animate-pulse space-y-4">
					<div className="h-6 w-16 rounded bg-muted"></div>
					<div className="h-4 w-48 rounded bg-muted"></div>
					<div className="mt-4 h-64 w-full rounded bg-muted"></div>
				</div>
			</Layout>
		);

	return (
		<Layout session={session}>
			<div className="space-y-6">
				<div>
					<h1 className="font-semibold text-lg tracking-tight">CDTs</h1>
					<p className="mt-0.5 text-muted-foreground text-sm">
						Team members organized by CDT and role.
					</p>
				</div>

				{session.is_admin ? (
					<Tabs defaultValue="members">
						<TabsList>
							<TabsTrigger value="members">Members</TabsTrigger>
							<TabsTrigger value="manage">Manage</TabsTrigger>
						</TabsList>
						<TabsContent value="members" className="mt-4">
							<CdtsListView users={users} cdts={cdts} />
						</TabsContent>
						<TabsContent value="manage" className="mt-4">
							<AdminCdtsView />
						</TabsContent>
					</Tabs>
				) : (
					<CdtsListView users={users} cdts={cdts} />
				)}
			</div>
		</Layout>
	);
}
