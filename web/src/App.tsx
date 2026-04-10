import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, type Session } from "./lib/api";
import { AdminPage } from "./pages/Admin";
import { CdtsPage } from "./pages/Cdts";
import { Dashboard } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { MeetingPage } from "./pages/Meeting";
import { MeetingsPage } from "./pages/Meetings";
import { RsvpPage } from "./pages/Rsvp";
import { TeamPage } from "./pages/Team";
import { TeamSnapPage } from "./pages/TeamSnap";

export default function App() {
	const [session, setSession] = useState<Session | null | "loading">("loading");

	useEffect(() => {
		const cachedSession = sessionStorage.getItem("session_cache");
		if (cachedSession) {
			setSession(JSON.parse(cachedSession));
		}

		api
			.getMe()
			.then((s) => {
				setSession(s);
				sessionStorage.setItem("session_cache", JSON.stringify(s));
			})
			.catch(() => setSession(null));
	}, []);

	if (session === "loading") {
		const path = window.location.pathname;

		let mainContent = (
			<div className="animate-pulse space-y-6">
				<div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_340px]">
					<div className="space-y-3">
						<div className="h-4 w-24 rounded bg-muted"></div>
						<div className="rounded-xl border bg-card px-5 pt-5 pb-5">
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
						</div>
					</div>
					<div className="space-y-3">
						<div className="h-4 w-20 rounded bg-muted"></div>
						<div className="h-[280px] rounded-xl border bg-muted/30"></div>
					</div>
				</div>
			</div>
		);

		if (path.startsWith("/meetings")) {
			mainContent = (
				<div className="animate-pulse space-y-6">
					<div className="space-y-1.5">
						<div className="h-6 w-24 rounded bg-muted"></div>
						<div className="h-4 w-48 rounded bg-muted"></div>
					</div>
					<div className="mt-4 mb-8 h-9 w-64 rounded-md bg-muted"></div>
					<div className="mt-2 overflow-hidden rounded-md border bg-card">
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
			);
		} else if (path.startsWith("/cdts") || path.startsWith("/team")) {
			mainContent = (
				<div className="animate-pulse space-y-6">
					<div className="flex items-start justify-between">
						<div className="space-y-1.5">
							<div className="h-6 w-16 rounded bg-muted"></div>
							<div className="h-4 w-48 rounded bg-muted"></div>
						</div>
						<div className="h-8 w-24 rounded-md bg-muted"></div>
					</div>
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
						<div className="flex h-14 items-center gap-4 p-4">
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/4 rounded bg-muted"></div>
							<div className="h-4 w-1/3 rounded bg-muted"></div>
						</div>
					</div>
				</div>
			);
		}

		return (
			<div className="flex min-h-screen flex-col bg-background">
				<header className="sticky top-0 z-50 w-full border-border/60 border-b bg-white/80 backdrop-blur-md">
					<div className="mx-auto flex h-[52px] max-w-5xl items-center justify-between px-5">
						<div className="flex items-center gap-5">
							<div className="flex shrink-0 items-center gap-2">
								<div className="h-6 w-6 animate-pulse rounded-md bg-muted"></div>
								<div className="h-4 w-16 animate-pulse rounded bg-muted"></div>
							</div>
						</div>
					</div>
				</header>
				<main className="mx-auto w-full max-w-5xl flex-grow px-5 py-8">
					{mainContent}
				</main>
			</div>
		);
	}

	if (!session) {
		return (
			<BrowserRouter>
				<Routes>
					<Route
						path="/rsvp/:id/:token"
						element={<RsvpPage session={null} />}
					/>
					<Route path="*" element={<LoginPage />} />
				</Routes>
			</BrowserRouter>
		);
	}

	return (
		<BrowserRouter>
			<Routes>
				<Route path="/team/*" element={<TeamPage session={session} />} />
				<Route path="/cdts/*" element={<CdtsPage session={session} />} />
				<Route
					path="/meetings/:id"
					element={<MeetingPage session={session} />}
				/>
				<Route
					path="/meetings/*"
					element={<MeetingsPage session={session} />}
				/>
				<Route
					path="/rsvp/:id/:token"
					element={<RsvpPage session={session} />}
				/>
				<Route path="/admin/*" element={<AdminPage session={session} />} />
				<Route path="/teamsnap" element={<TeamSnapPage session={session} />} />

				<Route path="/" element={<Dashboard session={session} />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}
