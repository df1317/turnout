import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { ArrowLeft, Check, HelpCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DataTable } from "../components/data-table";
import { Layout } from "../components/Layout";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
	type AdminMeeting,
	api,
	type MeetingAttendance,
	type Session,
} from "../lib/api";

export function MeetingPage({ session }: { session: Session }) {
	const { id } = useParams();
	const navigate = useNavigate();
	const [meeting, setMeeting] = useState<AdminMeeting | null>(null);
	const [attendance, setAttendance] = useState<MeetingAttendance[] | null>(
		null,
	);
	const [loading, setLoading] = useState(true);

	const columns = useMemo<ColumnDef<MeetingAttendance, unknown>[]>(() => {
		const cols: ColumnDef<MeetingAttendance, unknown>[] = [
			{
				accessorKey: "name",
				header: "Name",
				cell: ({ row }) => {
					const person = row.original;
					return (
						<div className="flex items-center gap-3">
							<Avatar className="size-8">
								<AvatarImage src={person.avatar_url} />
								<AvatarFallback>{person.name.slice(0, 2)}</AvatarFallback>
							</Avatar>
							<div className="font-medium text-sm leading-none">
								{person.name}
							</div>
						</div>
					);
				},
			},
			{
				accessorKey: "status",
				header: "Status",
				cell: ({ row }) => {
					const s = row.original.status;
					if (s === "yes") {
						return (
							<Badge
								variant="secondary"
								className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
							>
								Going
							</Badge>
						);
					}
					if (s === "maybe") {
						return (
							<Badge
								variant="secondary"
								className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
							>
								Maybe
							</Badge>
						);
					}
					if (s === "no") {
						return (
							<Badge
								variant="secondary"
								className="bg-red-500/10 text-red-600 hover:bg-red-500/20"
							>
								Not Going
							</Badge>
						);
					}
					return (
						<Badge variant="secondary" className="text-muted-foreground">
							No RSVP
						</Badge>
					);
				},
			},
		];

		if (session.is_admin) {
			cols.push({
				accessorKey: "note",
				header: "Note",
				cell: ({ row }) => {
					const note = row.original.note;
					if (!note)
						return <span className="text-muted-foreground opacity-50">-</span>;
					return <span className="text-muted-foreground">{note}</span>;
				},
			});
		}

		return cols;
	}, [session.is_admin]);

	useEffect(() => {
		if (!id) return;

		Promise.all([
			api.getMeetings().then((meetings) => {
				const m = meetings.find((m) => m.id === Number(id));
				if (m) return m as unknown as AdminMeeting;
				// Fallback for admins looking at past meetings not in upcoming/recent list
				return api
					.getAdminMeetings()
					.then((ams) => ams.find((am) => am.id === Number(id)));
			}),
			session.is_admin
				? api.getMeetingAttendance(Number(id)).catch(() => null)
				: Promise.resolve(null),
		])
			.then(([m, a]) => {
				if (m) setMeeting(m);
				if (a) setAttendance(a);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, [id, session.is_admin]);

	if (loading) {
		return (
			<Layout session={session}>
				<div className="py-8 text-center text-muted-foreground text-sm">
					Loading meeting...
				</div>
			</Layout>
		);
	}

	if (!meeting) {
		return (
			<Layout session={session}>
				<div className="py-8 text-center text-muted-foreground text-sm">
					Meeting not found.
				</div>
			</Layout>
		);
	}

	const going = attendance?.filter((a) => a.status === "yes") || [];
	const maybe = attendance?.filter((a) => a.status === "maybe") || [];
	const notGoing = attendance?.filter((a) => a.status === "no") || [];
	const noRsvp = attendance?.filter((a) => !a.status) || [];

	return (
		<Layout session={session}>
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => navigate("/meetings")}
					>
						<ArrowLeft className="size-4" />
					</Button>
					<div>
						<h1 className="font-semibold text-lg tracking-tight">
							{meeting.name}
						</h1>
						<p className="mt-0.5 text-muted-foreground text-sm">
							{format(
								new Date(meeting.scheduled_at * 1000),
								"MMM d, yyyy '·' h:mm a",
							)}
						</p>
					</div>
				</div>

				<div className="space-y-8">
					{attendance && attendance.length > 0 ? (
						<div className="space-y-8">
							{going.length > 0 && (
								<div className="space-y-3">
									<h2 className="flex items-center gap-2 font-medium">
										<Check className="size-4 text-emerald-600" />
										Going ({going.length})
									</h2>
									<DataTable data={going} columns={columns} noun="attendees" />
								</div>
							)}

							{maybe.length > 0 && (
								<div className="space-y-3">
									<h2 className="flex items-center gap-2 font-medium">
										<HelpCircle className="size-4 text-amber-600" />
										Maybe ({maybe.length})
									</h2>
									<DataTable data={maybe} columns={columns} noun="attendees" />
								</div>
							)}

							{notGoing.length > 0 && (
								<div className="space-y-3">
									<h2 className="flex items-center gap-2 font-medium">
										<X className="size-4 text-red-600" />
										Not Going ({notGoing.length})
									</h2>
									<DataTable
										data={notGoing}
										columns={columns}
										noun="attendees"
									/>
								</div>
							)}

							{noRsvp.length > 0 && (
								<div className="space-y-3">
									<h2 className="font-medium">No RSVP ({noRsvp.length})</h2>
									<DataTable data={noRsvp} columns={columns} noun="attendees" />
								</div>
							)}
						</div>
					) : (
						<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
							No attendance data.
						</div>
					)}
				</div>
			</div>
		</Layout>
	);
}
