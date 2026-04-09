import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChannelPicker } from "../components/ChannelPicker";
import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api, type Session, type SystemStats } from "../lib/api";

type TeamSnapStats = {
	timeFrameDays: number;
	eventsFound: number;
	membersFound: number;
	matchedUsers: number;
	unmatchedUsers: number;
	attendanceRecordsInserted: number;
	lastSyncTime: number;
};

export function AdminPage({ session }: { session: Session }) {
	const [url, setUrl] = useState("");
	const [channel, setChannel] = useState("");
	const [defaultMeetingLength, setDefaultMeetingLength] = useState("3");
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<string | null>(null);
	const [savingSettings, setSavingSettings] = useState(false);
	const [queueing, setQueueing] = useState(false);
	const [clearingDb, setClearingDb] = useState(false);
	const [clearDbClicks, setClearDbClicks] = useState(0);
	const [stats, setStats] = useState<SystemStats | null>(null);
	const [tsStats, setTsStats] = useState<TeamSnapStats | null>(null);

	const [teamSnapToken, setTeamSnapToken] = useState("");
	const [teamSnapTeamId, setTeamSnapTeamId] = useState("");
	const [savingTeamSnapSettings, setSavingTeamSnapSettings] = useState(false);

	useEffect(() => {
		if (session.is_admin) {
			api.getSetting("default_channel").then((val) => {
				if (val) setChannel(val);
			});
			api.getSetting("default_meeting_length").then((val) => {
				if (val) setDefaultMeetingLength(val);
			});
			api.getSetting("teamsnap_token").then((val) => {
				if (val) setTeamSnapToken(val);
			});
			api.getSetting("teamsnap_team_id").then((val) => {
				if (val) setTeamSnapTeamId(val);
			});
			api.getSetting("teamsnap_last_sync_stats").then((val) => {
				if (val) {
					try {
						setTsStats(JSON.parse(val));
					} catch (e) {
						console.error("Failed to parse teamsnap stats", e);
					}
				}
			});
			api.getStats().then((data) => {
				setStats(data);
			});
		}
	}, [session.is_admin]);

	const handleImport = async () => {
		if (!url.trim()) return;
		setImporting(true);

		const btn = document.getElementById("import-btn");
		const originalText = "Import Meetings";

		try {
			const res = await api.importIcs(url.trim(), channel || undefined);
			// Show temporary success message instead of a blocking alert
			if (btn) {
				btn.innerText = `Imported ${res.count} events!`;
				btn.classList.add("bg-green-600", "hover:bg-green-700");
				setTimeout(() => {
					btn.innerText = originalText;
					btn.classList.remove("bg-green-600", "hover:bg-green-700");
				}, 3000);
			}
			setImportResult(
				res.count === 0
					? "No new events were found."
					: `Successfully imported ${res.count} events.`,
			);
			setUrl("");
		} catch (err) {
			if (btn) {
				btn.innerText = "Import Failed";
				btn.classList.add("bg-red-600", "hover:bg-red-700");
				setTimeout(() => {
					btn.innerText = originalText;
					btn.classList.remove("bg-red-600", "hover:bg-red-700");
				}, 3000);
			}
			alert(
				`Failed to import ICS: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setImporting(false);
		}
	};

	const handleSaveSettings = async () => {
		setSavingSettings(true);
		try {
			await api.setSetting("default_channel", channel);
			await api.setSetting("default_meeting_length", defaultMeetingLength);
			// Show a temporary success message instead of a blocking alert
			const btn = document.getElementById("save-settings-btn");
			if (btn) {
				const originalText = btn.innerText;
				btn.innerText = "Saved!";
				btn.classList.add("bg-green-600", "hover:bg-green-700");
				setTimeout(() => {
					btn.innerText = originalText;
					btn.classList.remove("bg-green-600", "hover:bg-green-700");
				}, 2000);
			}
		} catch (err) {
			alert(
				`Failed to save settings: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setSavingSettings(false);
		}
	};

	const handleSaveTeamSnapSettings = async () => {
		setSavingTeamSnapSettings(true);
		try {
			await api.setSetting("teamsnap_token", teamSnapToken);
			await api.setSetting("teamsnap_team_id", teamSnapTeamId);
			const btn = document.getElementById("save-teamsnap-btn");
			if (btn) {
				const originalText = btn.innerText;
				btn.innerText = "Saved!";
				btn.classList.add("bg-green-600", "hover:bg-green-700");
				setTimeout(() => {
					btn.innerText = originalText;
					btn.classList.remove("bg-green-600", "hover:bg-green-700");
				}, 2000);
			}
		} catch (err) {
			alert(
				`Failed to save TeamSnap settings: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setSavingTeamSnapSettings(false);
		}
	};

	const handleQueue = async () => {
		// remove confirm to fix "A window.confirm() dialog generated by this page was suppressed"
		setQueueing(true);
		try {
			const res = await api.queueAnnouncements();
			alert(`Successfully queued ${res.count} active meetings for refresh.`);
		} catch (err) {
			alert(
				`Failed to queue announcements: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setQueueing(false);
		}
	};

	const handleClearDatabase = async () => {
		if (clearDbClicks < 2) {
			setClearDbClicks((prev) => prev + 1);
			return;
		}

		setClearingDb(true);
		setClearDbClicks(0);
		try {
			await api.clearDatabase();
			alert("Database cleared successfully.");
			// Refresh stats after clearing
			const newStats = await api.getStats();
			setStats(newStats);
		} catch (err) {
			alert(
				`Failed to clear database: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setClearingDb(false);
		}
	};

	if (!session.is_admin) {
		return (
			<Layout session={session}>
				<div className="flex h-[50vh] items-center justify-center">
					<p className="text-muted-foreground">
						You do not have permission to view this page.
					</p>
				</div>
			</Layout>
		);
	}

	return (
		<Layout session={session}>
			<div className="space-y-6">
				<div>
					<h1 className="font-semibold text-lg tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-0.5 text-muted-foreground text-sm">
						Manage workspace settings and imports.
					</p>
				</div>

				<div className="grid gap-6 md:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center justify-between text-base">
								<span>TeamSnap Import</span>
								<Button variant="outline" size="sm" asChild>
									<Link to="/teamsnap">Configure & Sync</Link>
								</Button>
							</CardTitle>
							<CardDescription>
								Import past events and attendance data from TeamSnap into
								Turnout.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1.5">
								<label
									htmlFor="teamsnap-token-input"
									className="font-medium text-xs"
								>
									TeamSnap OAuth Token
								</label>
								<Input
									id="teamsnap-token-input"
									type="password"
									value={teamSnapToken}
									onChange={(e) => setTeamSnapToken(e.target.value)}
									placeholder="ey..."
									className="h-8 text-xs"
								/>
							</div>
							<div className="space-y-1.5">
								<label
									htmlFor="teamsnap-team-id-input"
									className="font-medium text-xs"
								>
									Team ID
								</label>
								<Input
									id="teamsnap-team-id-input"
									value={teamSnapTeamId}
									onChange={(e) => setTeamSnapTeamId(e.target.value)}
									placeholder="1234567"
									className="h-8 text-xs"
								/>
							</div>
							<Button
								id="save-teamsnap-btn"
								size="sm"
								className="mt-2 w-full"
								onClick={handleSaveTeamSnapSettings}
								disabled={savingTeamSnapSettings}
							>
								{savingTeamSnapSettings ? "Saving…" : "Save Credentials"}
							</Button>

							<div className="mt-4 border-t pt-4">
								{tsStats ? (
									<div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
										<p className="font-semibold text-sm">Last Sync</p>
										<p>
											<span className="font-medium">Date:</span>{" "}
											{new Date(tsStats.lastSyncTime).toLocaleString()}
										</p>
										<div className="grid grid-cols-2 gap-2 pt-1">
											<div>
												<span className="font-medium">Events:</span>{" "}
												{tsStats.eventsFound}
											</div>
											<div>
												<span className="font-medium">RSVPs:</span>{" "}
												{tsStats.attendanceRecordsInserted}
											</div>
											<div className="text-emerald-600 dark:text-emerald-500">
												<span className="font-medium">Matched:</span>{" "}
												{tsStats.matchedUsers}
											</div>
											{tsStats.unmatchedUsers > 0 && (
												<div className="text-red-600 dark:text-red-500">
													<span className="font-medium">Unmatched:</span>{" "}
													{tsStats.unmatchedUsers}
												</div>
											)}
										</div>
									</div>
								) : (
									<p className="text-muted-foreground text-sm">
										No TeamSnap imports have been run yet.
									</p>
								)}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center justify-between text-base">
								<span>Import Meetings</span>
							</CardTitle>
							<CardDescription>
								To import from an ICS URL, go to your calendar provider, copy
								the calendar link, and paste it below.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1.5">
								<label htmlFor="url-input" className="font-medium text-xs">
									ICS URL <span className="text-destructive">*</span>
								</label>
								<Input
									id="url-input"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="http://ical-cdn.teamsnap.com/..."
									className="h-8 text-xs"
								/>
							</div>
							{importResult && (
								<p
									className={`font-medium text-sm ${importResult.includes("Successfully") ? "text-green-600 dark:text-green-500" : "text-amber-600 dark:text-amber-500"}`}
								>
									{importResult}
								</p>
							)}
						</CardContent>
						<CardFooter>
							<Button
								id="import-btn"
								size="sm"
								onClick={handleImport}
								disabled={importing || !url.trim()}
							>
								{importing ? "Importing…" : "Import Meetings"}
							</Button>
						</CardFooter>
					</Card>
				</div>

				<div className="grid gap-6 md:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Workspace Settings</CardTitle>
							<CardDescription>
								Configure default workspace settings.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-col space-y-1.5">
								<label htmlFor="channel-picker" className="font-medium text-xs">
									Default Announcements Channel
								</label>
								<ChannelPicker value={channel} onChange={setChannel} />
								<p className="mt-1 text-muted-foreground text-xs">
									Used as the default channel for meeting imports.
								</p>
							</div>
							<div className="flex flex-col space-y-1.5">
								<label
									htmlFor="meeting-length-input"
									className="font-medium text-xs"
								>
									Default Meeting Length (hours)
								</label>
								<Input
									id="meeting-length-input"
									type="number"
									min="1"
									max="24"
									value={defaultMeetingLength}
									onChange={(e) => setDefaultMeetingLength(e.target.value)}
									className="h-8 text-xs"
								/>
								<p className="mt-1 text-muted-foreground text-xs">
									Used as the default length for meetings when an end time is
									not specified.
								</p>
							</div>
						</CardContent>
						<CardFooter>
							<Button
								id="save-settings-btn"
								size="sm"
								onClick={handleSaveSettings}
								disabled={savingSettings}
							>
								{savingSettings ? "Saving…" : "Save Settings"}
							</Button>
						</CardFooter>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">System Statistics</CardTitle>
							<CardDescription>
								Overview of the database metrics.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{stats ? (
								<div className="grid grid-cols-2 gap-4">
									<div>
										<p className="font-medium text-sm">Users</p>
										<p className="font-bold text-2xl">{stats.users}</p>
									</div>
									<div>
										<p className="font-medium text-sm">Active Meetings</p>
										<p className="font-bold text-2xl">{stats.meetings}</p>
									</div>
									<div>
										<p className="font-medium text-sm">Past Meetings</p>
										<p className="font-bold text-2xl">{stats.pastMeetings}</p>
									</div>
									<div>
										<p className="font-medium text-sm">Queued Slack Updates</p>
										<p className="font-bold text-2xl">
											{stats.pendingAnnouncements}
										</p>
									</div>
									<div>
										<p className="font-medium text-sm">CDTs</p>
										<p className="font-bold text-2xl">{stats.cdts}</p>
									</div>
									<div>
										<p className="font-medium text-sm">RSVPs</p>
										<p className="font-bold text-2xl">{stats.attendance}</p>
									</div>
								</div>
							) : (
								<p className="text-muted-foreground text-sm">Loading...</p>
							)}
						</CardContent>
					</Card>
				</div>

				<div className="grid gap-6 md:grid-cols-1">
					<Card className="border-red-200 dark:border-red-900/50">
						<CardHeader>
							<CardTitle className="text-base text-red-600 dark:text-red-500">
								Developer Tools
							</CardTitle>
							<CardDescription>
								Danger zone operations for debugging and recovery.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="space-y-2">
								<h3 className="font-medium text-xs">Queue Announcements</h3>
								<p className="mt-1 text-muted-foreground text-xs">
									Forces all active, non-cancelled meetings that have a Slack
									message to be added to the pending announcements queue. This
									will regenerate and update their Slack messages with the
									latest data from the database.
								</p>
								<Button
									variant="secondary"
									size="sm"
									onClick={handleQueue}
									disabled={queueing}
								>
									{queueing ? "Queueing…" : "Queue Refresh"}
								</Button>
							</div>

							<div className="space-y-2 border-red-200/50 border-t pt-4 dark:border-red-900/30">
								<h3 className="font-medium text-red-600 text-xs dark:text-red-500">
									Clear Database
								</h3>
								<p className="mt-1 text-muted-foreground text-xs">
									Deletes all meetings, users, CDTs, and attendance data.
									Workspace settings and your current session will be preserved.
									This action cannot be undone.
								</p>
								<Button
									variant="destructive"
									size="sm"
									onClick={handleClearDatabase}
									disabled={clearingDb}
								>
									{clearingDb
										? "Clearing Data…"
										: clearDbClicks === 0
											? "Clear Database (Step 1/3)"
											: clearDbClicks === 1
												? "Confirm Clear? (Step 2/3)"
												: "Confirm Delete All (Step 3/3)"}
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</Layout>
	);
}
