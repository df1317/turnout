import { Link, useLocation } from "react-router-dom";
import type { Session } from "../lib/api";
import { Footer } from "./Footer";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";

export function Layout({
	session,
	children,
}: {
	session?: Session;
	children: React.ReactNode;
}) {
	const location = useLocation();

	const isActive = (p: string) => {
		if (p === "/") return location.pathname === "/";
		return location.pathname.startsWith(p);
	};

	const navLink = (href: string, label: string) => (
		<Link
			to={href}
			className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
				isActive(href)
					? "font-medium text-foreground"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</Link>
	);

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="sticky top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md">
				<div className="mx-auto flex h-[52px] max-w-5xl items-center justify-between px-5">
					<div className="flex items-center gap-5">
						<Link to="/" className="flex shrink-0 items-center gap-2">
							<img
								src="/favicon-32x32.png"
								alt="Turnout Logo"
								className="h-6 w-6 rounded-md object-contain"
							/>
							<span className="font-semibold text-[13px] tracking-tight">
								Turnout
							</span>
						</Link>
						<nav className="flex items-center">
							{navLink("/meetings", "Meetings")}
							{navLink("/team", "Team")}
							{navLink("/cdts", "CDTs")}
							{session?.is_admin && navLink("/admin", "Admin")}
						</nav>
					</div>

					<div className="flex items-center gap-2">
						<ThemeToggle />
						{session ? (
							<>
								<Avatar className="h-6 w-6">
									<AvatarImage src={session.avatar_url} />
									<AvatarFallback className="text-[10px]">
										{session.name[0]}
									</AvatarFallback>
								</Avatar>
								<span className="hidden text-[13px] text-muted-foreground sm:block">
									{session.name}
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={async () => {
										await fetch("/api/auth/logout", { method: "POST" });
										window.location.href = "/";
									}}
									className="h-7 px-2 text-[13px] text-muted-foreground"
								>
									Sign out
								</Button>
							</>
						) : (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									window.location.href = "/api/auth/slack";
								}}
								className="h-7 px-2 text-[13px] text-muted-foreground"
							>
								Sign in
							</Button>
						)}
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-5xl flex-grow px-5 py-8">
				{children}
			</main>

			<Footer />
		</div>
	);
}
