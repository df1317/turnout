import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "./ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

interface UnmatchedMember {
	id: number;
	name: string;
}

interface SlackUser {
	user_id: string;
	name: string;
}

export function TeamSnapImport() {
	const [token, setToken] = useState("");
	const [teamId, setTeamId] = useState("");
	const [days, setDays] = useState("30");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	// biome-ignore lint/suspicious/noExplicitAny: API data
	const [result, setResult] = useState<any>(null);
	const [error, setError] = useState<string | null>(null);

	const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
	const [unmatchedMembers, setUnmatchedMembers] = useState<UnmatchedMember[]>(
		[],
	);
	const [showMappingDialog, setShowMappingDialog] = useState(false);
	const [mappings, setMappings] = useState<Record<number, string>>({});

	useEffect(() => {
		Promise.all([
			api.getSetting("teamsnap_token"),
			api.getSetting("teamsnap_team_id"),
		]).then(([savedToken, savedTeamId]) => {
			if (savedToken) setToken(savedToken);
			if (savedTeamId) setTeamId(savedTeamId);
		});
	}, []);

	const handleSave = async () => {
		setSaving(true);
		try {
			await api.setSetting("teamsnap_token", token);
			await api.setSetting("teamsnap_team_id", teamId);
			// biome-ignore lint/suspicious/noExplicitAny: Error
		} catch (e: any) {
			setError(e.message || "Failed to save settings");
		} finally {
			setSaving(false);
		}
	};

	const handleSync = async () => {
		setLoading(true);
		setError(null);
		setResult(null);
		setUnmatchedMembers([]);

		try {
			const manualMappingsParam =
				Object.keys(mappings).length > 0
					? `&mappings=${encodeURIComponent(JSON.stringify(mappings))}`
					: "";

			const res = await api.fetch(
				`/api/teamsnap/sync?days=${days}${manualMappingsParam}`,
			);

			// biome-ignore lint/suspicious/noExplicitAny: API data
			let data: any;
			const contentType = res.headers.get("content-type");
			if (contentType?.includes("application/json")) {
				data = await res.json();
				console.log("TeamSnap API Response:", data);
			} else {
				const text = await res.text();
				console.error("TeamSnap API Non-JSON Response:", text);
				throw new Error(
					`Server returned non-JSON error: ${text.substring(0, 100)}`,
				);
			}

			if (!res.ok) throw new Error(data.error || "Sync failed");

			setResult(data);

			if (data.unmatchedMembers && data.unmatchedMembers.length > 0) {
				setUnmatchedMembers(data.unmatchedMembers);
				if (data.slackUsers) {
					setSlackUsers(data.slackUsers);
				}
			}
			// biome-ignore lint/suspicious/noExplicitAny: Error
		} catch (e: any) {
			setError(e.message || "An error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>TeamSnap Import</CardTitle>
				<CardDescription>
					Import past events and attendance data from TeamSnap into SirSnap.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{error && (
					<Alert variant="destructive">
						<AlertTitle>Error</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{result?.success && (
					<Alert className="border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300">
						<AlertTitle>Import Successful</AlertTitle>
						<AlertDescription>
							<ul className="mt-2 list-disc space-y-1 pl-5">
								<li>Events Found: {result.stats.eventsFound}</li>
								<li>Members Found: {result.stats.membersFound}</li>
								<li>Users Matched: {result.stats.matchedUsers}</li>
								<li>
									Attendance Records Inserted:{" "}
									{result.stats.attendanceRecordsInserted}
								</li>
							</ul>

							{unmatchedMembers.length > 0 && (
								<div className="mt-4 flex items-center justify-between">
									<p className="text-sm text-yellow-700 dark:text-yellow-400">
										Warning: {unmatchedMembers.length} members could not be
										matched automatically.
									</p>
									<Button
										size="sm"
										variant="outline"
										className="border-yellow-500 text-yellow-700 hover:bg-yellow-100"
										onClick={() => setShowMappingDialog(true)}
									>
										Fix Matches
									</Button>
								</div>
							)}
						</AlertDescription>
					</Alert>
				)}

				<div className="space-y-2">
					<Label htmlFor="teamsnap-token">TeamSnap OAuth Token</Label>
					<Input
						id="teamsnap-token"
						type="password"
						placeholder="ey..."
						value={token}
						onChange={(e) => setToken(e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="teamsnap-team-id">Team ID</Label>
					<Input
						id="teamsnap-team-id"
						placeholder="1234567"
						value={teamId}
						onChange={(e) => setTeamId(e.target.value)}
					/>
				</div>

				<div className="flex justify-end">
					<Button variant="secondary" onClick={handleSave} disabled={saving}>
						{saving ? "Saving..." : "Save Credentials"}
					</Button>
				</div>

				<div className="space-y-2 border-t pt-4">
					<Label htmlFor="teamsnap-days">Import Timeframe (Days)</Label>
					<Input
						id="teamsnap-days"
						type="number"
						min="1"
						max="365"
						value={days}
						onChange={(e) => setDays(e.target.value)}
					/>
				</div>
			</CardContent>
			<CardFooter className="flex justify-between">
				<Button onClick={handleSync} disabled={loading || !token || !teamId}>
					{loading ? "Importing..." : "Start Import"}
				</Button>
			</CardFooter>

			<Dialog open={showMappingDialog} onOpenChange={setShowMappingDialog}>
				<DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Map TeamSnap Members</DialogTitle>
						<DialogDescription>
							Select the matching SirSnap user for each TeamSnap member below,
							then run the sync again.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						{unmatchedMembers.map((member) => (
							<div
								key={member.id}
								className="flex items-center justify-between gap-4"
							>
								<span className="flex-1 font-medium">{member.name}</span>
								<div className="flex-1">
									<Select
										value={mappings[member.id] || "ignore"}
										onChange={(e) =>
											setMappings((prev) => ({
												...prev,
												[member.id]: e.target.value,
											}))
										}
									>
										<option value="ignore">-- Ignore --</option>
										{slackUsers.map((u) => (
											<option key={u.user_id} value={u.user_id}>
												{u.name}
											</option>
										))}
									</Select>
								</div>
							</div>
						))}
					</div>
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							onClick={() => setShowMappingDialog(false)}
						>
							Cancel
						</Button>
						<Button
							onClick={() => {
								setShowMappingDialog(false);
								handleSync();
							}}
						>
							Apply & Re-sync
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
