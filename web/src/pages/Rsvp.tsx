import { format } from "date-fns";
import { Check, ChevronLeft, HelpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { api, type Meeting, type Session } from "../lib/api";

export function RsvpPage({ session }: { session: Session | null }) {
	const { id, token } = useParams<{ id: string; token?: string }>();
	const navigate = useNavigate();
	const [meeting, setMeeting] = useState<Meeting | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [note, setNote] = useState("");
	const [status, setStatus] = useState<"yes" | "maybe" | "no" | null>(null);

	useEffect(() => {
		if (!id) return;
		api
			.getMeeting(Number(id), token)
			.then((m) => {
				setMeeting(m);
				setStatus(m.my_status);
				setNote(m.my_note || "");
				setLoading(false);
			})
			.catch(() => {
				navigate("/meetings");
			});
	}, [id, token, navigate]);

	const handleSave = async () => {
		if (!meeting || !status) return;
		setSaving(true);
		try {
			await api.rsvp(meeting.id, status, note, token);
			if (session) {
				navigate("/meetings");
			} else {
				setSaving(false);
				alert("RSVP Saved! You can close this page.");
			}
		} catch (err) {
			console.error(err);
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<Layout session={session || undefined}>
				<div className="mx-auto max-w-md animate-pulse space-y-6 pt-10">
					<div className="h-6 w-24 rounded bg-muted"></div>
					<div className="h-[400px] rounded-xl border bg-card"></div>
				</div>
			</Layout>
		);
	}

	if (!meeting) return null;

	const dt = new Date(meeting.scheduled_at * 1000);
	const dateStr = format(dt, "EEEE, MMMM do, yyyy");
	const timeStr = format(dt, "h:mm a");

	return (
		<Layout session={session || undefined}>
			<div className="mx-auto max-w-md space-y-6 pt-4 md:pt-10">
				{session && (
					<Button
						variant="ghost"
						size="sm"
						className="-ml-2 text-muted-foreground"
						asChild
					>
						<Link to="/meetings">
							<ChevronLeft className="mr-1 size-4" />
							Back to Meetings
						</Link>
					</Button>
				)}

				<Card>
					<CardHeader className="pb-4">
						<CardTitle className="text-xl">{meeting.name}</CardTitle>
						<div className="text-muted-foreground text-sm">
							<p>{dateStr}</p>
							<p>{timeStr}</p>
						</div>
						{meeting.description && (
							<p className="mt-4 whitespace-pre-wrap text-sm">
								{meeting.description}
							</p>
						)}
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="space-y-3">
							<p className="font-medium text-sm">Will you be there?</p>
							<div className="grid grid-cols-3 gap-2">
								<Button
									variant={status === "yes" ? "default" : "outline"}
									className={
										status === "yes"
											? "bg-emerald-600 hover:bg-emerald-700"
											: ""
									}
									onClick={() => setStatus("yes")}
								>
									<Check className="mr-1.5 size-4" />
									Going
								</Button>
								<Button
									variant={status === "maybe" ? "default" : "outline"}
									className={
										status === "maybe" ? "bg-amber-600 hover:bg-amber-700" : ""
									}
									onClick={() => setStatus("maybe")}
								>
									<HelpCircle className="mr-1.5 size-4" />
									Maybe
								</Button>
								<Button
									variant={status === "no" ? "default" : "outline"}
									className={
										status === "no" ? "bg-red-600 hover:bg-red-700" : ""
									}
									onClick={() => setStatus("no")}
								>
									<X className="mr-1.5 size-4" />
									Can't Go
								</Button>
							</div>
						</div>

						<div className="space-y-3">
							<label htmlFor="note" className="font-medium text-sm">
								Add a note{" "}
								<span className="text-muted-foreground">(optional)</span>
							</label>
							<Textarea
								id="note"
								placeholder="Running late, leaving early, etc."
								value={note}
								onChange={(e) => setNote(e.target.value)}
								className="resize-none"
								rows={3}
							/>
						</div>

						<Button
							className="w-full"
							size="lg"
							disabled={!status || saving}
							onClick={handleSave}
						>
							{saving ? "Saving..." : "Save RSVP"}
						</Button>
					</CardContent>
				</Card>
			</div>
		</Layout>
	);
}
