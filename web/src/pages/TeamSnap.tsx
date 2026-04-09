import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
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
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import type { Session } from "../lib/api";
import { api } from "../lib/api";

interface UnmatchedMember {
	id: number;
	name: string;
	suggestedMatches: SlackUser[];
}

interface MatchedMember {
	id: number;
	name: string;
	matched_user_id: string;
	manual: boolean;
}

interface SlackUser {
	user_id: string;
	name: string;
}

export function TeamSnapPage({ session }: { session: Session }) {
	const [days, setDays] = useState("30");
	const [loading, setLoading] = useState(false);
	// biome-ignore lint/suspicious/noExplicitAny: API data
	const [result, setResult] = useState<any>(null);
	const [error, setError] = useState<string | null>(null);

	const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
	const [unmatchedMembers, setUnmatchedMembers] = useState<UnmatchedMember[]>(
		[],
	);
	const [matchedMembers, setMatchedMembers] = useState<MatchedMember[]>([]);
	const [mappings, setMappings] = useState<Record<number, string>>({});

	useEffect(() => {
		Promise.all([
			api.getSetting("teamsnap_token"),
			api.getSetting("teamsnap_team_id"),
		]).then(([savedToken, savedTeamId]) => {
			if (!savedToken || !savedTeamId) {
				setError(
					"TeamSnap Token and Team ID must be configured in the Admin Dashboard first.",
				);
			}
		});
	}, []);

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

			if (data.unmatchedMembers) {
				setUnmatchedMembers(data.unmatchedMembers);
			}
			if (data.matchedMembers) {
				setMatchedMembers(data.matchedMembers);
			}
			if (data.slackUsers) {
				setSlackUsers(data.slackUsers);
			}
			// biome-ignore lint/suspicious/noExplicitAny: Error
		} catch (e: any) {
			setError(e.message || "An error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<Layout session={session}>
			<div className="space-y-6">
				<div>
					<h1 className="font-semibold text-lg tracking-tight">
						TeamSnap Import
					</h1>
					<p className="mt-0.5 text-muted-foreground text-sm">
						Import past events and attendance data from TeamSnap into Turnout.
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>TeamSnap Sync</CardTitle>
						<CardDescription>
							Run synchronization with your configured TeamSnap integration.
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
								</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
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
						<Button onClick={handleSync} disabled={loading}>
							{loading ? "Importing..." : "Start Import"}
						</Button>
					</CardFooter>
				</Card>

				{(unmatchedMembers.length > 0 || matchedMembers.length > 0) && (
					<Card>
						<CardHeader className="flex flex-row items-center justify-between">
							<div>
								<CardTitle>Member Mapping</CardTitle>
								<CardDescription>
									Map TeamSnap members to Turnout users.
								</CardDescription>
							</div>
							<Button
								onClick={() => {
									handleSync();
								}}
								disabled={loading}
							>
								{loading ? "Syncing..." : "Apply Mappings & Re-sync"}
							</Button>
						</CardHeader>
						<CardContent>
							<div className="rounded-md border">
								<table className="w-full text-left text-sm">
									<thead className="border-b bg-muted/50">
										<tr>
											<th className="h-10 px-4 align-middle font-medium text-muted-foreground">
												TeamSnap Member
											</th>
											<th className="h-10 px-4 align-middle font-medium text-muted-foreground">
												Turnout User
											</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{unmatchedMembers.map((member) => (
											<tr
												key={`unmatched-${member.id}`}
												className="bg-yellow-50/30 dark:bg-yellow-900/10"
											>
												<td className="p-4 align-middle font-medium">
													{member.name}
													{member.suggestedMatches &&
														member.suggestedMatches.length > 0 && (
															<div className="mt-2 space-y-1">
																<p className="font-normal text-muted-foreground text-xs">
																	Suggestions:
																</p>
																<div className="flex flex-wrap gap-2">
																	{member.suggestedMatches.map((s) => (
																		<Button
																			key={`sugg-${member.id}-${s.user_id}`}
																			variant="outline"
																			size="sm"
																			className="h-6 px-2 text-xs"
																			onClick={() =>
																				setMappings((prev) => ({
																					...prev,
																					[member.id]: s.user_id,
																				}))
																			}
																		>
																			{s.name}
																		</Button>
																	))}
																</div>
															</div>
														)}
												</td>
												<td className="p-4 align-middle">
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
															<option
																key={`unmatched-opt-${u.user_id}`}
																value={u.user_id}
															>
																{u.name}
															</option>
														))}
													</Select>
												</td>
											</tr>
										))}
										{matchedMembers.map((member) => (
											<tr key={`matched-${member.id}`}>
												<td className="p-4 align-middle font-medium">
													{member.name}
													{member.manual && (
														<span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-800 text-xs dark:bg-blue-900/30 dark:text-blue-300">
															Manual
														</span>
													)}
												</td>
												<td className="p-4 align-middle">
													<Select
														value={
															mappings[member.id] || member.matched_user_id
														}
														onChange={(e) =>
															setMappings((prev) => ({
																...prev,
																[member.id]: e.target.value,
															}))
														}
													>
														<option value="ignore">-- Ignore --</option>
														{slackUsers.map((u) => (
															<option
																key={`matched-opt-${u.user_id}`}
																value={u.user_id}
															>
																{u.name}
															</option>
														))}
													</Select>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</Layout>
	);
}
