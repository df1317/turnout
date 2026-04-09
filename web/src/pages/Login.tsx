import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { Footer } from "../components/Footer";
import { Button } from "../components/ui/button";

export function LoginPage() {
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	useEffect(() => {
		const err = new URLSearchParams(window.location.search).get("error");
		if (err) {
			if (err === "invalid_state")
				setErrorMsg("Session expired. Please try again.");
			else if (err === "server_error")
				setErrorMsg("An error occurred. Please try again.");
			else setErrorMsg(err);
		}
	}, []);

	const handleLogin = async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/auth/login");
			const data = await res.json();
			if (data.url) {
				window.location.href = data.url;
			}
		} catch (e) {
			console.error("Failed to start login", e);
			setLoading(false);
		}
	};

	return (
		<div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-50 p-4">
			{/* Decorative Background */}
			<div className="absolute inset-0 z-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"></div>
			<div className="pointer-events-none absolute top-1/2 left-1/2 z-0 h-[500px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[100px]"></div>

			<div className="relative z-10 w-full max-w-sm space-y-8 rounded-2xl border border-zinc-200/50 bg-white/80 p-8 text-center shadow-xl backdrop-blur-xl">
				<div className="mx-auto h-24 w-24 overflow-hidden rounded-2xl border border-zinc-200/50 shadow-primary/10 shadow-xl">
					<img
						src="/sir.jpeg"
						alt="Turnout Logo"
						className="h-full w-full object-cover"
					/>
				</div>

				<div className="space-y-3">
					<h1 className="bg-gradient-to-br from-zinc-900 to-zinc-600 bg-clip-text font-bold text-3xl text-transparent tracking-tight">
						Welcome to Turnout
					</h1>
					<p className="text-sm text-zinc-500">
						Please sign in with your Slack account to continue.
					</p>
				</div>

				{errorMsg && (
					<div className="rounded-lg border border-red-100 bg-red-50 p-3 text-left font-medium text-red-600 text-sm">
						{errorMsg}
					</div>
				)}

				<Button
					size="lg"
					className="w-full font-medium"
					onClick={handleLogin}
					disabled={loading}
				>
					{loading ? (
						"Redirecting to Slack..."
					) : (
						<>
							<LogIn className="mr-2 h-4 w-4" />
							Sign in with Slack
						</>
					)}
				</Button>
			</div>

			<div className="absolute bottom-0 left-0 z-10 w-full">
				<Footer />
			</div>
		</div>
	);
}
