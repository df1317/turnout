import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import {
	CalendarIcon,
	Check,
	HelpCircle,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChannelPicker } from "../components/ChannelPicker";
import { DataTable } from "../components/data-table";
import { Layout } from "../components/Layout";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Calendar } from "../components/ui/calendar";
import { Card, CardContent } from "../components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import { Separator } from "../components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "../components/ui/sheet";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import {
	type AdminMeeting,
	api,
	type Meeting,
	type MeetingAttendance,
	type Session,
} from "../lib/api";
import { cn } from "../lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatDate = (unix: number) =>
	new Date(unix * 1000).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	}) +
	" · " +
	new Date(unix * 1000).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});

const fromUnix = (unix: number) => new Date(unix * 1000);
const toUnix = (d: Date) => Math.floor(d.getTime() / 1000);

function DatePicker({
	date,
	onSelect,
	placeholder = "Pick a date",
	className,
}: {
	date: Date | undefined;
	onSelect: (date: Date | undefined) => void;
	placeholder?: string;
	className?: string;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					data-empty={!date}
					className={cn(
						"h-8 justify-start text-left font-normal text-xs data-[empty=true]:text-muted-foreground",
						className,
					)}
				>
					<CalendarIcon className="mr-1.5 size-3.5 shrink-0" />
					{date ? format(date, "MMM d, yyyy") : <span>{placeholder}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar mode="single" selected={date} onSelect={onSelect} />
			</PopoverContent>
		</Popover>
	);
}

function CreateMeetingDialog({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (m: AdminMeeting) => void;
}) {
	const [name, setName] = useState("");
	const [desc, setDesc] = useState("");
	const [date, setDate] = useState<Date>();
	const [time, setTime] = useState("");
	const [endTime, setEndTime] = useState("");
	const [channel, setChannel] = useState("");
	const [creating, setCreating] = useState(false);

	const [isRecurring, setIsRecurring] = useState(false);
	const [selectedDays, setSelectedDays] = useState<number[]>([]);
	const [endDate, setEndDate] = useState<Date>();

	const toggleDay = (d: number) => {
		setSelectedDays((prev) =>
			prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
		);
	};

	const handleDateSelect = (newDate: Date | undefined) => {
		setDate(newDate);
		if (newDate && selectedDays.length === 0) {
			setSelectedDays([newDate.getDay()]);
		}
	};

	const handleCreate = async () => {
		if (!name.trim() || !date || !time) return;
		setCreating(true);
		try {
			const [hours, minutes] = time.split(":").map(Number);
			const dt = new Date(date);
			dt.setUTCHours(hours, minutes, 0, 0);
			const scheduledAt = toUnix(dt);

			let durationMinutes: number | undefined;
			let endUnix: number | undefined;
			if (endTime) {
				const [endHours, endMinutes] = endTime.split(":").map(Number);
				const endDt = new Date(date);
				endDt.setUTCHours(endHours, endMinutes, 0, 0);
				// Handle overnight meetings
				if (endDt < dt) {
					endDt.setDate(endDt.getDate() + 1);
				}
				endUnix = toUnix(endDt);
				durationMinutes = (endUnix - scheduledAt) / 60;
			}

			if (isRecurring && selectedDays.length > 0 && endDate) {
				const timeOfDayMinutes = hours * 60 + minutes;
				const endSeriesDt = new Date(endDate);
				endSeriesDt.setUTCHours(23, 59, 59, 0);
				const endSeriesUnix = toUnix(endSeriesDt);
				const created = await api.createMeetingSeries({
					name: name.trim(),
					description: desc.trim() || undefined,
					scheduled_at: scheduledAt,
					duration_minutes: durationMinutes,
					channel_id: channel || undefined,
					days_of_week: selectedDays,
					time_of_day_minutes: timeOfDayMinutes,
					end_date: endSeriesUnix,
				});
				onCreated(created);
			} else {
				const created = await api.createMeeting({
					name: name.trim(),
					description: desc.trim() || undefined,
					scheduled_at: scheduledAt,
					end_time: endUnix,
					channel_id: channel || undefined,
				});
				onCreated(created);
			}

			setName("");
			setDesc("");
			setDate(undefined);
			setTime("");
			setEndTime("");
			setChannel("");
			setIsRecurring(false);
			setSelectedDays([]);
			setEndDate(undefined);
			onClose();
		} finally {
			setCreating(false);
		}
	};

	const isValid =
		name.trim() &&
		date &&
		time &&
		(!endTime || endTime > time) &&
		(!isRecurring || (selectedDays.length > 0 && endDate));

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>New Meeting</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<label htmlFor="name-input" className="font-medium text-xs">
							Name <span className="text-destructive">*</span>
						</label>
						<Input
							id="name-input"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Build Session"
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="desc-input" className="font-medium text-xs">
							Description{" "}
							<span className="text-muted-foreground">(optional)</span>
						</label>
						<Textarea
							id="desc-input"
							value={desc}
							onChange={(e) => setDesc(e.target.value)}
							placeholder="What's happening at this meeting?"
							className="min-h-16 resize-none text-xs"
							rows={3}
						/>
					</div>
					<div className="grid grid-cols-7 gap-3">
						<div className="col-span-3 flex flex-col space-y-1.5">
							<label htmlFor="date-picker" className="font-medium text-xs">
								Date <span className="text-destructive">*</span>
							</label>
							<DatePicker
								date={date}
								onSelect={handleDateSelect}
								placeholder="Pick a date"
							/>
						</div>
						<div className="col-span-4 space-y-1.5">
							<label
								htmlFor="time-input"
								className="flex items-center justify-between font-medium text-xs"
							>
								<span>
									Time <span className="text-destructive">*</span>
								</span>
							</label>
							<div className="flex items-center gap-1.5">
								<Input
									id="time-input"
									type="time"
									value={time}
									onChange={(e) => setTime(e.target.value)}
									className="h-8 flex-1 px-2 text-xs"
								/>
								<span className="text-muted-foreground text-xs">-</span>
								<Input
									type="time"
									value={endTime}
									onChange={(e) => setEndTime(e.target.value)}
									className="h-8 flex-1 px-2 text-xs"
								/>
							</div>
						</div>
					</div>
					<div className="flex flex-col space-y-1.5">
						<label htmlFor="channel-picker" className="font-medium text-xs">
							Slack Channel{" "}
							<span className="text-muted-foreground">(for announcement)</span>
						</label>
						<ChannelPicker
							value={channel}
							onChange={setChannel}
						/>
					</div>

					<Separator />

					<div className="space-y-2">
						<button
							type="button"
							className="flex cursor-pointer items-center gap-2 font-medium text-xs"
							onClick={() => setIsRecurring(!isRecurring)}
						>
							<div
								className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${isRecurring ? "border-primary bg-primary" : "border-input"}`}
							>
								{isRecurring && (
									<span className="text-[10px] text-primary-foreground">✓</span>
								)}
							</div>
							Recurring meeting
						</button>

						{isRecurring && (
							<div className="space-y-4 pt-2 pl-6">
								<div className="flex flex-col space-y-1.5">
									<label htmlFor="day-picker-0" className="font-medium text-xs">
										Repeat on <span className="text-destructive">*</span>
									</label>
									<div className="flex gap-1.5">
										{DAY_LABELS.map((label, i) => (
											<button
												key={label}
												id={`day-picker-${i}`}
												type="button"
												className={`h-8 w-9 rounded-md border font-medium text-[11px] transition-colors ${
													selectedDays.includes(i)
														? "border-primary bg-primary text-primary-foreground"
														: "border-input bg-transparent text-foreground hover:bg-muted/80"
												}`}
												onClick={() => toggleDay(i)}
											>
												{label}
											</button>
										))}
									</div>
								</div>
								<div className="flex flex-col space-y-1.5">
									<label
										htmlFor="end-date-picker"
										className="font-medium text-xs"
									>
										End date <span className="text-destructive">*</span>
									</label>
									<DatePicker
										date={endDate}
										onSelect={setEndDate}
										placeholder="Pick end date"
									/>
								</div>
							</div>
						)}
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={handleCreate}
						disabled={creating || !isValid}
					>
						{creating ? "Creating…" : "Create Meeting"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EditMeetingDialog({
	meeting,
	onClose,
	onSaved,
}: {
	meeting: AdminMeeting;
	onClose: () => void;
	onSaved: (m: AdminMeeting) => void;
}) {
	const initial = fromUnix(meeting.scheduled_at);
	const [name, setName] = useState(meeting.name);
	const [desc, setDesc] = useState(meeting.description ?? "");
	const [date, setDate] = useState<Date>(initial);
	const [time, setTime] = useState(
		`${String(initial.getUTCHours()).padStart(2, "0")}:${String(initial.getUTCMinutes()).padStart(2, "0")}`,
	);
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		setSaving(true);
		try {
			let scheduledAt: number | undefined;
			if (date && time) {
				const [hours, minutes] = time.split(":").map(Number);
				const dt = new Date(date);
				dt.setUTCHours(hours, minutes, 0, 0);
				scheduledAt = toUnix(dt);
			}
			await api.updateMeeting(meeting.id, {
				name: name.trim() || undefined,
				description: desc.trim() || undefined,
				scheduled_at: scheduledAt,
			});
			onSaved({
				...meeting,
				name: name.trim() || meeting.name,
				description: desc.trim(),
				scheduled_at: scheduledAt ?? meeting.scheduled_at,
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={!!meeting}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Meeting</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<label htmlFor="edit-name" className="font-medium text-xs">
							Name
						</label>
						<Input
							id="edit-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="edit-desc" className="font-medium text-xs">
							Description
						</label>
						<Textarea
							id="edit-desc"
							value={desc}
							onChange={(e) => setDesc(e.target.value)}
							className="min-h-16 resize-none text-xs"
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="date-time-picker" className="font-medium text-xs">
							Date & Time
						</label>
						<div className="flex gap-2" id="date-time-picker">
							<DatePicker
								date={date}
								onSelect={(d) => {
									if (d) setDate(d);
								}}
								placeholder="Pick a date"
								className="flex-1"
							/>
							<Input
								type="time"
								value={time}
								onChange={(e) => setTime(e.target.value)}
								className="h-8 w-28 text-xs"
							/>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={saving}>
						{saving ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MeetingAttendanceDialog({
	meeting,
	onClose,
}: {
	meeting: AdminMeeting;
	onClose: () => void;
}) {
	const [attendance, setAttendance] = useState<MeetingAttendance[] | null>(
		null,
	);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		api
			.getMeetingAttendance(meeting.id)
			.then((data) => {
				setAttendance(data);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, [meeting.id]);

	return (
		<Sheet open={true} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="overflow-y-auto">
				<SheetHeader className="pb-0">
					<SheetTitle className="text-base">
						Attendance: {meeting.name}
					</SheetTitle>
				</SheetHeader>
				{loading ? (
					<div className="py-8 text-center text-muted-foreground text-sm">
						Loading attendance...
					</div>
				) : attendance && attendance.length > 0 ? (
					<div className="space-y-4 px-6 pt-6">
						{attendance.map((a) => (
							<div key={a.user_id} className="flex items-start gap-3">
								<Avatar className="mt-0.5 size-8">
									<AvatarImage src={a.avatar_url} />
									<AvatarFallback>{a.name.slice(0, 2)}</AvatarFallback>
								</Avatar>
								<div className="flex-1 space-y-1">
									<div className="flex items-center justify-between">
										<p className="font-medium text-sm leading-none">{a.name}</p>
										<div className="flex items-center text-xs">
											{a.status === "yes" && (
												<span className="flex items-center gap-1 text-emerald-600">
													<Check className="size-3" /> Yes
												</span>
											)}
											{a.status === "maybe" && (
												<span className="flex items-center gap-1 text-amber-600">
													<HelpCircle className="size-3" /> Maybe
												</span>
											)}
											{a.status === "no" && (
												<span className="flex items-center gap-1 text-red-600">
													<X className="size-3" /> No
												</span>
											)}
										</div>
									</div>
									{a.note && (
										<p className="mt-1 rounded-md bg-muted p-2 text-muted-foreground text-sm">
											{a.note}
										</p>
									)}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="py-8 text-center text-muted-foreground text-sm">
						No RSVPs yet.
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}

function AdminMeetingsView() {
	const [meetings, setMeetings] = useState<AdminMeeting[]>([]);
	const [createOpen, setCreateOpen] = useState(false);
	const [editMeeting, setEditMeeting] = useState<AdminMeeting | null>(null);
	const [viewAttendanceMeeting, setViewAttendanceMeeting] =
		useState<AdminMeeting | null>(null);
	const [selectedMeetings, setSelectedMeetings] = useState<AdminMeeting[]>([]);
	const now = Math.floor(Date.now() / 1000);

	useEffect(() => {
		api.getAdminMeetings().then(setMeetings);
	}, []);

	const handleCancel = useCallback(
		async (m: AdminMeeting) => {
			const newVal = !m.cancelled;
			setMeetings((prev) =>
				prev.map((x) => (x.id === m.id ? { ...x, cancelled: newVal } : x)),
			);
			await api.cancelMeeting(m.id, newVal).catch(() => {
				setMeetings((prev) =>
					prev.map((x) =>
						x.id === m.id ? { ...x, cancelled: m.cancelled } : x,
					),
				);
			});
		},
		[setMeetings],
	);

	const handleDelete = useCallback(
		async (id: number) => {
			await api.deleteMeeting(id);
			setMeetings((prev) => prev.filter((x) => x.id !== id));
		},
		[setMeetings],
	);

	// Use useMemo to prevent recreating the columns array on every render
	// which prevents the DataTable and underlying images from re-rendering
	const columns = useMemo<ColumnDef<AdminMeeting, unknown>[]>(
		() => [
			{
				accessorKey: "name",
				header: "Name",
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						<span className="font-medium">{row.original.name}</span>
						{row.original.series_id && (
							<Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
								Series
							</Badge>
						)}
					</div>
				),
			},
			{
				id: "date",
				header: "Date",
				accessorFn: (row) => row.scheduled_at,
				cell: ({ row }) => {
					const m = row.original;
					let timeStr = formatDate(m.scheduled_at);
					if (m.end_time) {
						const endDt = new Date(m.end_time * 1000);
						timeStr += ` - ${endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
					}
					return (
						<span className="whitespace-nowrap text-muted-foreground">
							{timeStr}
						</span>
					);
				},
			},
			{
				id: "status",
				header: "Status",
				accessorFn: (row) => (row.cancelled ? 0 : row.scheduled_at),
				cell: ({ row }) => {
					const m = row.original;
					if (m.cancelled)
						return <Badge variant="destructive">Cancelled</Badge>;
					if (m.scheduled_at < now)
						return <Badge variant="secondary">Past</Badge>;
					return <Badge variant="outline">Upcoming</Badge>;
				},
			},
			{
				id: "rsvp",
				header: "RSVP",
				cell: ({ row }) => {
					const m = row.original;
					return (
						<div className="flex items-center gap-0.5 text-muted-foreground text-xs">
							<span className="text-emerald-600">{m.yes_count}</span>
							<span className="mx-0.5">/</span>
							<span className="text-amber-600">{m.maybe_count}</span>
							<span className="mx-0.5">/</span>
							<span className="text-red-600">{m.no_count}</span>
						</div>
					);
				},
			},
			{
				id: "actions",
				header: "",
				cell: ({ row }) => {
					const m = row.original;
					return (
						<div
							className="flex items-center gap-1"
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
								}
							}}
							role="none"
						>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setEditMeeting(m)}
							>
								<Pencil className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs"
								onClick={() => handleCancel(m)}
							>
								{m.cancelled ? "Restore" : "Cancel"}
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
					);
				},
			},
		],
		[now, handleCancel, handleDelete],
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-xs">
						{meetings.length} meetings
					</span>
					{selectedMeetings.length > 0 && (
						<>
							<Separator orientation="vertical" className="h-4" />
							<span className="text-muted-foreground text-xs">
								{selectedMeetings.length} selected
							</span>
						</>
					)}
				</div>
				<div className="flex items-center gap-2">
					{selectedMeetings.length > 0 && (
						<Button
							size="sm"
							variant="destructive"
							onClick={() => {
								for (const m of selectedMeetings) {
									handleDelete(m.id);
								}
								setSelectedMeetings([]);
							}}
						>
							<Trash2 className="mr-1 size-3.5" />
							Delete Selected
						</Button>
					)}
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="mr-1 size-3.5" />
						New Meeting
					</Button>
				</div>
			</div>
			<DataTable
				columns={columns}
				data={meetings}
				filterPlaceholder="Filter meetings…"
				onRowClick={(m) => setViewAttendanceMeeting(m)}
				enableRowSelection
				onSelectionChange={setSelectedMeetings}
			/>

			<CreateMeetingDialog
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				onCreated={(m) => setMeetings((prev) => [m, ...prev])}
			/>

			{editMeeting && (
				<EditMeetingDialog
					meeting={editMeeting}
					onClose={() => setEditMeeting(null)}
					onSaved={(m) =>
						setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x)))
					}
				/>
			)}

			{viewAttendanceMeeting && (
				<MeetingAttendanceDialog
					meeting={viewAttendanceMeeting}
					onClose={() => setViewAttendanceMeeting(null)}
				/>
			)}
		</div>
	);
}

function UpcomingMeetingsView({
	meetings,
	onUpdate,
}: {
	meetings: Meeting[];
	onUpdate: (id: number, status: Meeting["my_status"], note: string) => void;
}) {
	const [selectedMeetings, setSelectedMeetings] = useState<Meeting[]>([]);
	const [bulkStatus, setBulkStatus] = useState<"yes" | "maybe" | "no" | null>(
		null,
	);
	const [saving, setSaving] = useState(false);

	const handleBulkUpdate = async () => {
		if (!bulkStatus || selectedMeetings.length === 0 || saving) return;
		setSaving(true);
		try {
			await Promise.all(
				selectedMeetings.map((m) => api.rsvp(m.id, bulkStatus, "")),
			);
			for (const m of selectedMeetings) {
				onUpdate(m.id, bulkStatus, "");
			}
			setSelectedMeetings([]);
			setBulkStatus(null);
		} finally {
			setSaving(false);
		}
	};

	const columns = useMemo<ColumnDef<Meeting, unknown>[]>(
		() => [
			{
				accessorKey: "name",
				header: "Name",
				cell: ({ row }) => (
					<div className="flex flex-col">
						<span className="font-medium">{row.original.name}</span>
						{row.original.description && (
							<span className="max-w-[200px] truncate text-muted-foreground text-xs">
								{row.original.description}
							</span>
						)}
					</div>
				),
			},
			{
				id: "date",
				header: "Date",
				accessorFn: (row) => row.scheduled_at,
				cell: ({ row }) => {
					const m = row.original;
					let timeStr = formatDate(m.scheduled_at);
					if (m.end_time) {
						const endDt = new Date(m.end_time * 1000);
						timeStr += ` - ${endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
					}
					return (
						<span className="whitespace-nowrap text-muted-foreground">
							{timeStr}
						</span>
					);
				},
			},
			{
				id: "rsvp",
				header: "RSVP",
				cell: ({ row }) => {
					const m = row.original;
					return (
						<div className="flex items-center gap-0.5 text-muted-foreground text-xs">
							<span className="text-emerald-600">{m.yes_count || 0}</span>
							<span className="mx-0.5">/</span>
							<span className="text-amber-600">{m.maybe_count || 0}</span>
							<span className="mx-0.5">/</span>
							<span className="text-red-600">{m.no_count || 0}</span>
						</div>
					);
				},
			},
			{
				id: "my_status",
				header: "My Status",
				cell: ({ row }) => {
					const m = row.original;
					return (
						<div className="flex items-center gap-2">
							<div className="flex gap-1">
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
											variant={m.my_status === s ? "default" : "outline"}
											className="h-6 px-2 text-[10px]"
											onClick={async (e) => {
												e.stopPropagation();
												await api.rsvp(m.id, s, m.my_note ?? "");
												onUpdate(m.id, s, m.my_note ?? "");
											}}
										>
											{labels[s]}
										</Button>
									);
								})}
							</div>
							{m.my_note && (
								<span
									className="max-w-[100px] truncate text-muted-foreground text-xs italic"
									title={m.my_note}
								>
									"{m.my_note}"
								</span>
							)}
							<Popover>
								<PopoverTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										className="h-6 w-6"
										onClick={(e) => e.stopPropagation()}
									>
										<Pencil className="size-3" />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									className="w-64 p-3"
									onClick={(e) => e.stopPropagation()}
								>
									<div className="space-y-2">
										<h4 className="font-medium text-xs">Note for {m.name}</h4>
										<Textarea
											id={`note-${m.id}`}
											defaultValue={m.my_note ?? ""}
											className="resize-none text-xs"
											rows={2}
											placeholder="Add a note..."
										/>
										<div className="flex justify-end">
											<Button
												size="sm"
												onClick={async () => {
													const val = (
														document.getElementById(
															`note-${m.id}`,
														) as HTMLTextAreaElement
													).value;
													await api.rsvp(m.id, m.my_status || "yes", val);
													onUpdate(m.id, m.my_status || "yes", val);
												}}
											>
												Save
											</Button>
										</div>
									</div>
								</PopoverContent>
							</Popover>
						</div>
					);
				},
			},
		],
		[onUpdate],
	);

	return (
		<div className="space-y-4">
			{selectedMeetings.length > 0 && (
				<Card className="border-primary/20 bg-muted/30">
					<CardContent className="flex items-center justify-between gap-4 p-3">
						<span className="font-medium text-sm">
							{selectedMeetings.length} meetings selected
						</span>
						<div className="flex max-w-md flex-1 items-center gap-2">
							<div className="flex shrink-0 gap-1">
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
											variant={bulkStatus === s ? "default" : "outline"}
											className="h-8 text-xs"
											onClick={() => setBulkStatus(s)}
										>
											{labels[s]}
										</Button>
									);
								})}
							</div>
							<Button
								size="sm"
								onClick={handleBulkUpdate}
								disabled={!bulkStatus || saving}
								className="ml-auto h-8"
							>
								{saving ? "Saving…" : "Apply"}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
			<DataTable
				columns={columns}
				data={meetings}
				filterPlaceholder="Filter upcoming meetings…"
				enableRowSelection
				onSelectionChange={setSelectedMeetings}
			/>
		</div>
	);
}

function PastMeetingsView({ isAdmin }: { isAdmin: boolean }) {
	const [meetings, setMeetings] = useState<Meeting[]>([]);
	const [loading, setLoading] = useState(true);
	const [viewAttendanceMeeting, setViewAttendanceMeeting] =
		useState<AdminMeeting | null>(null);

	useEffect(() => {
		api.getPastMeetings().then((data) => {
			setMeetings(data);
			setLoading(false);
		});
	}, []);

	const columns = useMemo<ColumnDef<Meeting, unknown>[]>(
		() => [
			{
				accessorKey: "name",
				header: "Name",
				cell: ({ row }) => (
					<div className="flex flex-col">
						<span className="font-medium">{row.original.name}</span>
						{row.original.description && (
							<span className="max-w-[200px] truncate text-muted-foreground text-xs">
								{row.original.description}
							</span>
						)}
					</div>
				),
			},
			{
				id: "date",
				header: "Date",
				accessorFn: (row) => row.scheduled_at,
				cell: ({ row }) => {
					const m = row.original;
					let timeStr = formatDate(m.scheduled_at);
					if (m.end_time) {
						const endDt = new Date(m.end_time * 1000);
						timeStr += ` - ${endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
					}
					return (
						<span className="whitespace-nowrap text-muted-foreground">
							{timeStr}
						</span>
					);
				},
			},
			{
				id: "rsvp",
				header: "RSVP",
				cell: ({ row }) => {
					const m = row.original;
					return (
						<div className="flex items-center gap-0.5 text-muted-foreground text-xs">
							<span className="text-emerald-600">{m.yes_count || 0}</span>
							<span className="mx-0.5">/</span>
							<span className="text-amber-600">{m.maybe_count || 0}</span>
							<span className="mx-0.5">/</span>
							<span className="text-red-600">{m.no_count || 0}</span>
						</div>
					);
				},
			},
			{
				id: "my_status",
				header: "My Status & Note",
				cell: ({ row }) => {
					const m = row.original;
					if (!m.my_status)
						return (
							<span className="text-muted-foreground text-xs italic">
								Did not RSVP
							</span>
						);

					const labels = { yes: "Going", maybe: "Maybe", no: "Can't go" };
					const colors = {
						yes: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50",
						maybe:
							"text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50",
						no: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50",
					};

					return (
						<div className="flex items-center gap-2">
							<Badge
								variant="outline"
								className={`px-1.5 py-0 font-medium text-[10px] ${colors[m.my_status]}`}
							>
								{labels[m.my_status]}
							</Badge>
							{m.my_note && (
								<span
									className="max-w-[150px] truncate text-muted-foreground text-xs italic"
									title={m.my_note}
								>
									"{m.my_note}"
								</span>
							)}
						</div>
					);
				},
			},
		],
		[],
	);

	if (loading) {
		return (
			<div className="py-8 text-center text-muted-foreground text-sm">
				Loading past meetings...
			</div>
		);
	}

	if (meetings.length === 0) {
		return (
			<p className="py-4 text-muted-foreground text-sm">No past meetings.</p>
		);
	}

	return (
		<div className="space-y-4">
			<DataTable
				columns={columns}
				data={meetings}
				filterPlaceholder="Filter past meetings…"
				onRowClick={
					isAdmin
						? (m) => setViewAttendanceMeeting(m as unknown as AdminMeeting)
						: undefined
				}
			/>
			{viewAttendanceMeeting && (
				<MeetingAttendanceDialog
					meeting={viewAttendanceMeeting}
					onClose={() => setViewAttendanceMeeting(null)}
				/>
			)}
		</div>
	);
}

export function MeetingsPage({ session }: { session: Session }) {
	const [meetings, setMeetings] = useState<Meeting[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const cached = sessionStorage.getItem("meetings_cache");
		if (cached) {
			setMeetings(JSON.parse(cached));
			setLoading(false);
		}

		api.getMeetings().then((m) => {
			setMeetings(m);
			sessionStorage.setItem("meetings_cache", JSON.stringify(m));
			setLoading(false);
		});
	}, []);

	const updateRsvp = (
		id: number,
		status: Meeting["my_status"],
		note: string,
	) => {
		const updateList = (list: Meeting[]) => {
			return list.map((m) => {
				if (m.id === id) {
					// We use m.my_status as the prevStatus to avoid stale closures
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
			});
		};
		setMeetings((ms) => updateList(ms));
	};

	const now = Math.floor(Date.now() / 1000);
	const upcoming = meetings
		.filter((m) => (m.end_time || m.scheduled_at) > now)
		.sort((a, b) => a.scheduled_at - b.scheduled_at);

	if (loading)
		return (
			<Layout session={session}>
				<div className="animate-pulse space-y-6">
					<div className="space-y-1.5">
						<div className="h-6 w-24 rounded bg-muted"></div>
						<div className="h-4 w-48 rounded bg-muted"></div>
					</div>
					<div className="mt-4 mb-8 h-9 w-64 rounded-md bg-muted"></div>
					<div className="overflow-hidden rounded-md border bg-card">
						<div className="h-10 border-b bg-muted/30"></div>
						<div className="flex h-14 items-center gap-4 border-b p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
						<div className="flex h-14 items-center gap-4 border-b p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
						<div className="flex h-14 items-center gap-4 border-b p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
						<div className="flex h-14 items-center gap-4 border-b p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
						<div className="flex h-14 items-center gap-4 border-b p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
						<div className="flex h-14 items-center gap-4 p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
					</div>
				</div>
			</Layout>
		);

	const renderMeetingsList = () => (
		<div className="space-y-8">
			<div>
				{upcoming.length === 0 ? (
					<p className="text-muted-foreground text-sm">No upcoming meetings.</p>
				) : (
					<UpcomingMeetingsView meetings={upcoming} onUpdate={updateRsvp} />
				)}
			</div>
		</div>
	);

	return (
		<Layout session={session}>
			<div className="space-y-4">
				<div>
					<h1 className="font-semibold text-lg tracking-tight">Meetings</h1>
					<p className="mt-0.5 text-muted-foreground text-sm">
						RSVP to upcoming meetings.
					</p>
				</div>

				<Tabs defaultValue="upcoming">
					<TabsList>
						<TabsTrigger value="upcoming">Upcoming</TabsTrigger>
						<TabsTrigger value="past">Past</TabsTrigger>
						{session.is_admin && (
							<TabsTrigger value="manage">Manage</TabsTrigger>
						)}
					</TabsList>
					<TabsContent value="upcoming" className="mt-4">
						{renderMeetingsList()}
					</TabsContent>
					<TabsContent value="past" className="mt-4">
						<PastMeetingsView isAdmin={session.is_admin} />
					</TabsContent>
					{session.is_admin && (
						<TabsContent value="manage" className="mt-4">
							<AdminMeetingsView />
						</TabsContent>
					)}
				</Tabs>
			</div>
		</Layout>
	);
}
