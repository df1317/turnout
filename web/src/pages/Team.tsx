import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { DataTable } from "../components/data-table";
import { Layout } from "../components/Layout";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "../components/ui/sheet";
import {
	api,
	type Cdt,
	type Session,
	type User,
	type UserMeeting,
} from "../lib/api";

const ROLES = ["student", "mentor", "parent", "alumni"] as const;
const roleVariant: Record<string, "student" | "mentor" | "parent" | "alumni"> =
	{
		student: "student",
		mentor: "mentor",
		parent: "parent",
		alumni: "alumni",
	};

const statusColor: Record<string, string> = {
	yes: "bg-emerald-50 text-emerald-700 border-emerald-200",
	maybe: "bg-amber-50 text-amber-700 border-amber-200",
	no: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(unix: number) {
	return new Date(unix * 1000).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

const columns: ColumnDef<User, unknown>[] = [
	{
		accessorKey: "name",
		header: "Member",
		cell: ({ row }) => {
			const u = row.original;
			return (
				<div className="flex items-center gap-2.5">
					<Avatar size="sm" className="shrink-0">
						<AvatarImage src={u.avatar_url} />
						<AvatarFallback>{u.name[0]}</AvatarFallback>
					</Avatar>
					<span className="font-medium">{u.name}</span>
					{u.is_admin && (
						<Badge variant="outline" className="h-4 px-1.5 text-[0.6rem]">
							Admin
						</Badge>
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "role",
		header: "Role",
		cell: ({ row }) => {
			const role = row.original.role;
			if (!role) return <span className="text-muted-foreground">—</span>;
			return (
				<Badge variant={roleVariant[role]}>
					{role.charAt(0).toUpperCase() + role.slice(1)}
				</Badge>
			);
		},
	},
	{
		accessorKey: "cdt_name",
		header: "CDT",
		cell: ({ row }) => {
			const name = row.original.cdt_name;
			return name ? (
				<span>{name}</span>
			) : (
				<span className="text-muted-foreground">—</span>
			);
		},
	},
	{
		accessorKey: "meetings_attended",
		header: "Meetings",
		cell: ({ row }) => {
			const count = row.original.meetings_attended ?? 0;
			return <span>{count}</span>;
		},
	},
];

function TeamListView({
	users,
	cdts,
	isAdmin,
	setUsers,
}: {
	users: User[];
	cdts: Cdt[];
	isAdmin: boolean;
	setUsers?: (u: User[]) => void;
}) {
	const [selectedUser, setSelectedUser] = useState<User | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [userMeetings, setUserMeetings] = useState<UserMeeting[]>([]);
	const [meetingsLoading, setMeetingsLoading] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [syncDone, setSyncDone] = useState(false);

	const [selectedRows, setSelectedRows] = useState<User[]>([]);
	const [bulkRole, setBulkRole] = useState("");
	const [bulkCdt, setBulkCdt] = useState("");
	const [applying, setApplying] = useState<string | null>(null);

	useEffect(() => {
		if (!selectedUser) return;
		setMeetingsLoading(true);
		api
			.getUserMeetings(selectedUser.user_id)
			.then(setUserMeetings)
			.finally(() => setMeetingsLoading(false));
	}, [selectedUser?.user_id, selectedUser]);

	const handleRoleChange = async (userId: string, role: string) => {
		if (!setUsers) return;
		const newRole = role || null;
		await api.setRole(userId, newRole);
		setUsers(
			users.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u)),
		);
		if (selectedUser?.user_id === userId) {
			setSelectedUser((prev) => (prev ? { ...prev, role: newRole } : prev));
		}
	};

	const handleCdtChange = async (userId: string, cdtId: string) => {
		if (!setUsers) return;
		const newCdtId = cdtId || null;
		await api.setUserCdt(userId, newCdtId);
		const cdt = cdts.find((c) => c.id === newCdtId);
		setUsers(
			users.map((u) =>
				u.user_id === userId
					? { ...u, cdt_id: newCdtId, cdt_name: cdt?.name ?? null }
					: u,
			),
		);
		if (selectedUser?.user_id === userId) {
			setSelectedUser((prev) =>
				prev
					? { ...prev, cdt_id: newCdtId, cdt_name: cdt?.name ?? null }
					: prev,
			);
		}
	};

	const handleSync = async () => {
		if (!setUsers) return;
		setSyncing(true);
		try {
			await api.syncUsers();
			const fresh = await api.getUsers();
			setUsers(fresh);
			setSyncDone(true);
			setTimeout(() => setSyncDone(false), 3000);
		} finally {
			setSyncing(false);
		}
	};

	const applyBulkRole = async () => {
		if (!selectedRows.length || !setUsers) return;
		setApplying("role");
		try {
			await api.bulkSetRole(
				selectedRows.map((u) => u.user_id),
				bulkRole || null,
			);
			const role = bulkRole || null;
			setUsers(
				users.map((u) =>
					selectedRows.some((s) => s.user_id === u.user_id)
						? { ...u, role }
						: u,
				),
			);
			setSelectedRows([]);
			setBulkRole("");
		} finally {
			setApplying(null);
		}
	};

	const applyBulkCdt = async () => {
		if (!selectedRows.length || !setUsers) return;
		setApplying("cdt");
		try {
			await api.bulkSetCdt(
				selectedRows.map((u) => u.user_id),
				bulkCdt || null,
			);
			const cdtId = bulkCdt || null;
			const cdt = cdts.find((c) => c.id === cdtId);
			setUsers(
				users.map((u) =>
					selectedRows.some((s) => s.user_id === u.user_id)
						? { ...u, cdt_id: cdtId, cdt_name: cdt?.name ?? null }
						: u,
				),
			);
			setSelectedRows([]);
			setBulkCdt("");
		} finally {
			setApplying(null);
		}
	};

	const openUser = (user: User) => {
		setSelectedUser(user);
		setUserMeetings([]);
		setSheetOpen(true);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<span className="text-muted-foreground text-xs">
					{users.length} members
				</span>
				{isAdmin && (
					<div className="flex items-center gap-2">
						{syncDone && (
							<Badge
								variant="outline"
								className="border-emerald-200 bg-emerald-50 text-emerald-600"
							>
								Synced successfully
							</Badge>
						)}
						<Button onClick={handleSync} disabled={syncing} size="sm">
							{syncing ? "Syncing…" : "Sync from Slack"}
						</Button>
					</div>
				)}
			</div>

			{isAdmin && selectedRows.length > 0 && (
				<div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
					<span className="font-medium text-xs">
						{selectedRows.length} selected
					</span>
					<Separator orientation="vertical" className="h-5" />
					<div className="flex items-center gap-2">
						<Select
							value={bulkRole}
							onChange={(e) => setBulkRole(e.target.value)}
							className="h-7 w-28 text-xs"
						>
							<option value="">Set role…</option>
							{ROLES.map((r) => (
								<option key={r} value={r}>
									{r.charAt(0).toUpperCase() + r.slice(1)}
								</option>
							))}
							<option value="">Clear role</option>
						</Select>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							disabled={!bulkRole || applying === "role"}
							onClick={applyBulkRole}
						>
							{applying === "role" ? "…" : "Apply"}
						</Button>
					</div>
					<div className="flex items-center gap-2">
						<Select
							value={bulkCdt}
							onChange={(e) => setBulkCdt(e.target.value)}
							className="h-7 w-36 text-xs"
						>
							<option value="">Set CDT…</option>
							{cdts.map((cdt) => (
								<option key={cdt.id} value={cdt.id}>
									{cdt.name}
								</option>
							))}
						</Select>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							disabled={(!bulkCdt && bulkCdt !== "") || applying === "cdt"}
							onClick={applyBulkCdt}
						>
							{applying === "cdt" ? "…" : "Apply"}
						</Button>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className="ml-auto h-7 text-xs"
						onClick={() => setSelectedRows([])}
					>
						Clear
					</Button>
				</div>
			)}

			<DataTable
				noun="members"
				columns={columns}
				data={users}
				filterPlaceholder="Filter members…"
				onRowClick={openUser}
				enableRowSelection={isAdmin}
				onSelectionChange={isAdmin ? setSelectedRows : undefined}
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
										<SheetTitle className="text-base">
											{selectedUser.name}
										</SheetTitle>
										{selectedUser.is_admin && (
											<Badge
												variant="outline"
												className="mt-1 h-4 px-1.5 text-[0.6rem]"
											>
												Admin
											</Badge>
										)}
									</div>
								</div>
							</SheetHeader>

							<div className="space-y-4 px-6">
								<Separator />

								{isAdmin ? (
									<>
										<div className="space-y-1.5">
											<label
												htmlFor="user-role-select"
												className="font-medium text-muted-foreground text-xs"
											>
												Role
											</label>
											<Select
												id="user-role-select"
												value={selectedUser.role ?? ""}
												onChange={(e) =>
													handleRoleChange(selectedUser.user_id, e.target.value)
												}
												className="h-8 text-xs"
											>
												<option value="">No role</option>
												{ROLES.map((r) => (
													<option key={r} value={r}>
														{r.charAt(0).toUpperCase() + r.slice(1)}
													</option>
												))}
											</Select>
										</div>

										<div className="space-y-1.5">
											<label
												htmlFor="user-cdt-select"
												className="font-medium text-muted-foreground text-xs"
											>
												CDT
											</label>
											<Select
												id="user-cdt-select"
												value={selectedUser.cdt_id ?? ""}
												onChange={(e) =>
													handleCdtChange(selectedUser.user_id, e.target.value)
												}
												className="h-8 text-xs"
											>
												<option value="">No CDT</option>
												{cdts.map((cdt) => (
													<option key={cdt.id} value={cdt.id}>
														{cdt.name}
													</option>
												))}
											</Select>
										</div>
									</>
								) : (
									<div className="flex gap-4">
										<div className="space-y-1">
											<span className="block font-medium text-muted-foreground text-xs">
												Role
											</span>
											<div>
												{selectedUser.role ? (
													<Badge variant={roleVariant[selectedUser.role]}>
														{selectedUser.role.charAt(0).toUpperCase() +
															selectedUser.role.slice(1)}
													</Badge>
												) : (
													<span className="text-muted-foreground text-sm">
														—
													</span>
												)}
											</div>
										</div>
										<div className="space-y-1">
											<span className="block font-medium text-muted-foreground text-xs">
												CDT
											</span>
											<div>
												{selectedUser.cdt_name ? (
													<span className="font-medium text-sm">
														{selectedUser.cdt_name}
													</span>
												) : (
													<span className="text-muted-foreground text-sm">
														—
													</span>
												)}
											</div>
										</div>
									</div>
								)}

								<Separator />

								<div className="space-y-2">
									<p className="font-medium text-xs">Meeting Attendance</p>
									{meetingsLoading ? (
										<p className="text-muted-foreground text-xs">Loading…</p>
									) : userMeetings.length === 0 ? (
										<p className="text-muted-foreground text-xs">
											No attendance records.
										</p>
									) : (
										<ul className="space-y-2">
											{userMeetings.map((m) => {
												let timeStr = formatDate(m.scheduled_at);
												if (m.end_time) {
													const endDt = new Date(m.end_time * 1000);
													timeStr += ` - ${endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
												}

												return (
													<li
														key={m.id}
														className="flex items-start justify-between gap-2"
													>
														<div>
															<p className="font-medium text-xs leading-snug">
																{m.name}
															</p>
															<p className="text-[0.65rem] text-muted-foreground">
																{timeStr}
															</p>
														</div>
														<span
															className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium text-[0.6rem] ${statusColor[m.status] ?? ""}`}
														>
															{m.status}
														</span>
													</li>
												);
											})}
										</ul>
									)}
								</div>
							</div>
						</>
					)}
				</SheetContent>
			</Sheet>
		</div>
	);
}

export function TeamPage({ session }: { session: Session }) {
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
					<h1 className="font-semibold text-lg tracking-tight">Team</h1>
					<p className="mt-0.5 text-muted-foreground text-sm">
						All team members.
					</p>
				</div>

				<TeamListView
					users={users}
					setUsers={setUsers}
					cdts={cdts}
					isAdmin={session.is_admin}
				/>
			</div>
		</Layout>
	);
}
