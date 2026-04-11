import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { PunchCard } from "../components/PunchCard";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import {
	api,
	type Cdt,
	type Meeting,
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

function FeaturedMeeting({
	meeting,
	onUpdate,
}: {
	meeting: Meeting;
	onUpdate: (id: number, status: Meeting["my_status"], note: string) => void;
}) {
	const [pending, setPending] = useState<"yes" | "maybe" | "no" | null>(null);
	const [note, setNote] = useState(meeting.my_note ?? "");
	const [saving, setSaving] = useState(false);

	const selectStatus = (s: "yes" | "maybe" | "no") => {
		setPending(s);
		setNote(meeting.my_note ?? "");
	};

	const confirm = async () => {
		if (!pending || saving) return;
		setSaving(true);
		try {
			await api.rsvp(meeting.id, pending, note);
			onUpdate(meeting.id, pending, note);
			setPending(null);
		} finally {
			setSaving(false);
		}
	};

	const cancel = useCallback(() => {
		setPending(null);
		setNote(meeting.my_note ?? "");
	}, [meeting.my_note]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") cancel();
		};
		if (pending) window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pending, cancel]);

	const active = pending ?? meeting.my_status;
	const d = new Date(meeting.scheduled_at * 1000);
	const month = d.toLocaleDateString("en-US", { month: "long" }).toUpperCase();
	const day = d.getDate();
	const time = d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
	const weekday = d.toLocaleDateString("en-US", { weekday: "long" });

	return (
		<Card>
			<CardContent className="pt-5 pb-5">
				<div className="flex gap-5">
					<div className="flex w-16 shrink-0 flex-col items-center justify-start pt-1">
						<span className="font-semibold text-[10px] text-primary uppercase tracking-widest">
							{month}
						</span>
						<span className="font-bold text-4xl text-foreground leading-tight">
							{day}
						</span>
					</div>

					<div className="min-w-0 flex-1">
						<p className="font-semibold text-lg leading-snug">{meeting.name}</p>
						<p className="mt-1 text-muted-foreground text-sm">
							{weekday} · {time}
						</p>
						<p className="mt-1 text-muted-foreground text-xs">
							<span className="text-emerald-600">
								{meeting.yes_count || 0} going
							</span>
							<span className="mx-1.5">·</span>
							<span className="text-amber-600">
								{meeting.maybe_count || 0} maybe
							</span>
							<span className="mx-1.5">·</span>
							<span className="text-red-600">
								{meeting.no_count || 0} can't go
							</span>
						</p>
						{meeting.description && (
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								{meeting.description}
							</p>
						)}

						<div className="mt-4 space-y-2">
							<div className="flex gap-1.5">
								{(["yes", "maybe", "no"] as const).map((s) => {
									const labels = {
										yes: "Going",
										maybe: "Maybe",
										no: "Can't go",
									};
									return (
										<Button
											key={s}
											size="sm"
											variant={active === s ? "default" : "outline"}
											onClick={() => selectStatus(s)}
										>
											{labels[s]}
										</Button>
									);
								})}
							</div>

							{meeting.my_status && !pending && meeting.my_note && (
								<p className="pl-0.5 text-muted-foreground text-xs italic">
									"{meeting.my_note}"
								</p>
							)}

							{pending && (
								<div className="flex items-start gap-2">
									<Textarea
										className="flex-1 resize-none text-xs"
										rows={2}
										placeholder="Add a note (optional)"
										value={note}
										onChange={(e) => setNote(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault();
												confirm();
											}
										}}
										autoFocus
									/>
									<div className="flex shrink-0 flex-col gap-1">
										<Button size="sm" onClick={confirm} disabled={saving}>
											{saving ? "…" : "Save"}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="text-muted-foreground"
											onClick={cancel}
										>
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
	);
}

function CdtList({ cdts, users }: { cdts: Cdt[]; users: User[] }) {
	const cdtMap = new Map(cdts.map((c) => [c.id, c]));
	const grouped = new Map<string, { cdt: Cdt; members: User[] }>();

	for (const u of users) {
		if (u.cdt_id && cdtMap.has(u.cdt_id)) {
			const cdt = cdtMap.get(u.cdt_id);
			if (!cdt) continue;
			const arr = grouped.get(u.cdt_id)?.members ?? [];
			arr.push(u);
			grouped.set(u.cdt_id, { cdt, members: arr });
		}
	}

	const sorted = [...grouped.values()].sort((a, b) =>
		a.cdt.name.localeCompare(b.cdt.name),
	);

	return (
		<Card className="overflow-hidden py-0">
			{sorted.length === 0 && (
				<p className="px-4 py-4 text-muted-foreground text-sm">No CDTs yet.</p>
			)}
			{sorted.map(({ cdt, members }, ci) => (
				<div key={cdt.id}>
					<div className="flex items-center justify-between bg-muted/30 px-4 py-2">
						<p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
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
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{u.name}</p>
								</div>
								<div className="flex items-center gap-3">
									{u.meetings_attended !== undefined && (
										<span
											className="text-muted-foreground text-xs"
											title="Meetings Attended"
										>
											{u.meetings_attended}
										</span>
									)}
									{u.role ? (
										<Badge
											variant={roleVariant[u.role]}
											className="w-[60px] justify-center text-[10px]"
										>
											{u.role.charAt(0).toUpperCase() + u.role.slice(1)}
										</Badge>
									) : (
										<span className="w-[60px] shrink-0 text-center text-muted-foreground text-xs">
											—
										</span>
									)}
								</div>
							</div>
							{(i < members.length - 1 || ci < sorted.length - 1) && (
								<Separator />
							)}
						</div>
					))}
					{ci < sorted.length - 1 && <Separator />}
				</div>
			))}
		</Card>
	);
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
	const d = new Date(meeting.scheduled_at * 1000);
	const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
	const day = d.getDate();
	const time = d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
	let timeStr = time;
	if (meeting.end_time) {
		const endD = new Date(meeting.end_time * 1000);
		const endTime = endD.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
		timeStr = `${time} - ${endTime}`;
	}

	const weekday = d.toLocaleDateString("en-US", { weekday: "short" });

	return (
		<div className="flex items-center gap-4 px-4 py-4">
			<div className="flex w-10 shrink-0 flex-col items-center justify-start">
				<span className="font-semibold text-[9px] text-primary uppercase tracking-widest">
					{month}
				</span>
				<span className="font-bold text-foreground text-lg leading-tight">
					{day}
				</span>
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{meeting.name}</p>
				<p className="text-muted-foreground text-xs">
					{weekday} · {timeStr}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{meeting.my_status && (
					<Badge
						variant={
							meeting.my_status === "yes"
								? "outline"
								: meeting.my_status === "maybe"
									? "secondary"
									: "destructive"
						}
						className="text-[10px]"
					>
						{meeting.my_status === "yes"
							? "Going"
							: meeting.my_status === "maybe"
								? "Maybe"
								: "Can't go"}
					</Badge>
				)}
				<div className="flex items-center gap-0.5 text-muted-foreground text-xs">
					<span className="text-emerald-600">{meeting.yes_count || 0}</span>
					<span className="mx-0.5">/</span>
					<span className="text-amber-600">{meeting.maybe_count || 0}</span>
					<span className="mx-0.5">/</span>
					<span className="text-red-600">{meeting.no_count || 0}</span>
				</div>
			</div>
		</div>
	);
}

export function Dashboard({ session }: { session: Session }) {
	const [users, setUsers] = useState<User[]>([]);
	const [cdts, setCdts] = useState<Cdt[]>([]);
	const [meetings, setMeetings] = useState<Meeting[]>([]);
	const [pastMeetings, setPastMeetings] = useState<Meeting[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const cachedUsers = sessionStorage.getItem("users_cache");
		const cachedCdts = sessionStorage.getItem("cdts_cache");
		const cachedMeetings = sessionStorage.getItem("meetings_cache");
		const cachedPastMeetings = sessionStorage.getItem("past_meetings_cache");

		if (cachedUsers && cachedCdts && cachedMeetings && cachedPastMeetings) {
			setUsers(JSON.parse(cachedUsers));
			setCdts(JSON.parse(cachedCdts));
			setMeetings(JSON.parse(cachedMeetings));
			setPastMeetings(JSON.parse(cachedPastMeetings));
			setLoading(false);
		}

		Promise.all([
			api.getUsers(),
			api.getCdts(),
			api.getMeetings(),
			api.getPastMeetings(4, 0), // Fetch a small number of recent past meetings
		]).then(([u, c, m, pm]) => {
			setUsers(u);
			setCdts(c);
			setMeetings(m);
			setPastMeetings(pm);
			sessionStorage.setItem("users_cache", JSON.stringify(u));
			sessionStorage.setItem("cdts_cache", JSON.stringify(c));
			sessionStorage.setItem("meetings_cache", JSON.stringify(m));
			sessionStorage.setItem("past_meetings_cache", JSON.stringify(pm));
			setLoading(false);
		});
	}, []);

	if (loading)
		return (
			<Layout session={session}>
				<div className="animate-pulse space-y-6">
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
						<div className="space-y-6">
							<div className="h-4 w-24 rounded bg-muted"></div>
							<Card>
								<CardContent className="pt-5 pb-5">
									<div className="flex gap-5">
										<div className="w-16 shrink-0 space-y-2">
											<div className="mx-auto h-3 w-10 rounded bg-muted"></div>
											<div className="mx-auto h-8 w-12 rounded bg-muted"></div>
										</div>
										<div className="flex-1 space-y-3">
											<div className="h-5 w-3/4 rounded bg-muted"></div>
											<div className="h-4 w-1/2 rounded bg-muted"></div>
											<div className="h-3 w-1/3 rounded bg-muted"></div>
											<div className="mt-4 flex gap-2">
												<div className="h-8 w-16 rounded bg-muted"></div>
												<div className="h-8 w-16 rounded bg-muted"></div>
												<div className="h-8 w-16 rounded bg-muted"></div>
											</div>
										</div>
									</div>
								</CardContent>
							</Card>
						</div>
						<div className="space-y-3">
							<div className="h-4 w-20 rounded bg-muted"></div>
							<Card className="h-48 bg-muted/20"></Card>
						</div>
					</div>
				</div>
			</Layout>
		);

	const now = Math.floor(Date.now() / 1000);
	const thirtyDaysFromNow = now + 30 * 24 * 60 * 60;

	const upcoming = meetings
		.filter((m) => {
			const time = m.end_time || m.scheduled_at;
			return time > now && time < thirtyDaysFromNow;
		})
		.sort((a, b) => a.scheduled_at - b.scheduled_at);

	const featured = upcoming[0];
	const rest = upcoming.slice(1);

	const updateRsvp = (
		id: number,
		status: Meeting["my_status"],
		note: string,
	) => {
		setMeetings((ms) =>
			ms.map((m) => {
				if (m.id === id) {
					const prevStatus = m.my_status;

					// Optimistically update counts
					let yes_count = m.yes_count;
					let maybe_count = m.maybe_count;
					let no_count = m.no_count;

					if (prevStatus === "yes") yes_count = Math.max(0, yes_count - 1);
					if (prevStatus === "maybe")
						maybe_count = Math.max(0, maybe_count - 1);
					if (prevStatus === "no") no_count = Math.max(0, no_count - 1);

					if (status === "yes") yes_count += 1;
					if (status === "maybe") maybe_count += 1;
					if (status === "no") no_count += 1;

					return {
						...m,
						my_status: status,
						my_note: note,
						yes_count,
						maybe_count,
						no_count,
					};
				}
				return m;
			}),
		);
	};

	return (
		<Layout session={session}>
			<div className="space-y-6">
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
					<div className="space-y-6">
						<div className="space-y-3">
							<h2 className="font-semibold text-[13px] text-muted-foreground uppercase tracking-wider">
								Next Meeting
							</h2>
							{featured ? (
								<FeaturedMeeting meeting={featured} onUpdate={updateRsvp} />
							) : (
								<Card>
									<CardContent className="py-8 text-center">
										<p className="text-muted-foreground text-sm">
											No upcoming meetings.
										</p>
										<Link
											to="/meetings"
											className="mt-1 inline-block text-primary text-sm hover:underline"
										>
											View all meetings
										</Link>
									</CardContent>
								</Card>
							)}
						</div>

						<div className="space-y-3">
							<PunchCard />
						</div>
					</div>

					<div className="flex flex-col gap-6 lg:col-start-2">
						<div className="space-y-3">
							<h2 className="font-semibold text-[13px] text-muted-foreground uppercase tracking-wider">
								My CDT
							</h2>
							<CdtList
								cdts={cdts.filter(
									(c) =>
										users.find((u) => u.user_id === session.user_id)?.cdt_id ===
										c.id,
								)}
								users={users.filter(
									(u) =>
										u.cdt_id ===
										users.find((user) => user.user_id === session.user_id)
											?.cdt_id,
								)}
							/>
						</div>

						{pastMeetings.length > 0 && (
							<div className="flex-1 space-y-3">
								<h2 className="font-semibold text-[13px] text-muted-foreground uppercase tracking-wider">
									Recent Meetings
								</h2>
								<Card className="overflow-hidden py-0 gap-0">
									{pastMeetings.map((m, i) => {
										const d = new Date(m.scheduled_at * 1000);
										const month = d
											.toLocaleDateString("en-US", { month: "short" })
											.toUpperCase();
										const day = d.getDate();

										return (
											<div key={m.id}>
												<Link
													to="/meetings"
													className="block transition-colors hover:bg-muted/30"
												>
													<div className="flex items-center gap-3 px-4 py-3.5">
														<div className="flex w-10 shrink-0 flex-col items-center justify-start">
															<span className="font-semibold text-[9px] text-primary uppercase tracking-widest">
																{month}
															</span>
															<span className="font-bold text-foreground text-lg leading-tight">
																{day}
															</span>
														</div>
														<div className="min-w-0 flex-1">
															<p className="truncate font-medium text-sm">
																{m.name}
															</p>
															<p className="text-muted-foreground text-xs">
																{d.toLocaleTimeString("en-US", {
																	hour: "numeric",
																	minute: "2-digit",
																})}
															</p>
														</div>
														{m.my_status && (
															<Badge
																variant={
																	m.my_status === "yes"
																		? "outline"
																		: m.my_status === "maybe"
																			? "secondary"
																			: "destructive"
																}
																className="text-[10px]"
															>
																{m.my_status === "yes"
																	? "Going"
																	: m.my_status === "maybe"
																		? "Maybe"
																		: "Can't go"}
															</Badge>
														)}
													</div>
												</Link>
												{i < pastMeetings.length - 1 && <Separator />}
											</div>
										);
									})}
								</Card>
							</div>
						)}
					</div>
				</div>

				{rest.length > 0 && (
					<div className="space-y-3">
						<h2 className="font-semibold text-[13px] text-muted-foreground uppercase tracking-wider">
							Upcoming · {rest.length}
						</h2>
						<Card className="overflow-hidden py-0 gap-0">
							{rest.map((m, i) => (
								<div key={m.id}>
									<Link
										to="/meetings"
										className="block transition-colors hover:bg-muted/30"
									>
										<MeetingRow meeting={m} />
									</Link>
									{i < rest.length - 1 && <Separator />}
								</div>
							))}
						</Card>
					</div>
				)}
			</div>
		</Layout>
	);
}
