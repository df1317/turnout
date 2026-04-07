import { type Session } from "../lib/api";
import { Button } from "./ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import { Footer } from "./Footer";

const path = () => window.location.pathname;

export function Layout({
	session,
	children,
}: {
	session: Session;
	children: React.ReactNode;
}) {
	const isActive = (p: string) => {
		const current = path();
		if (p === "/") return current === "/";
		return current.startsWith(p);
	};

	const navLink = (href: string, label: string) => (
		<a
			href={href}
			className={`text-[13px] px-3 py-1.5 rounded-md transition-colors ${
				isActive(href)
					? "text-foreground font-medium"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</a>
	);

	return (
		<div className="min-h-screen bg-background flex flex-col">
			<header className="sticky top-0 z-50 w-full border-b border-border/60 bg-white/80 backdrop-blur-md">
				<div className="max-w-5xl mx-auto px-5 h-[52px] flex items-center justify-between">
					<div className="flex items-center gap-5">
						<a href="/" className="flex items-center gap-2 shrink-0">
							<div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
								<span className="text-[11px] font-bold text-white tracking-tight">
									S
								</span>
							</div>
							<span className="font-semibold text-[13px] tracking-tight">
								Sirsnap
							</span>
						</a>
						<nav className="flex items-center">
							{navLink("/", "Home")}
							{navLink("/meetings", "Meetings")}
							{navLink("/team", "Team")}
							{navLink("/cdts", "CDTs")}
							{session.is_admin && navLink("/admin", "Admin")}
						</nav>
					</div>

					<div className="flex items-center gap-2">
						<Avatar className="h-6 w-6">
							<AvatarImage src={session.avatar_url} />
							<AvatarFallback className="text-[10px]">
								{session.name[0]}
							</AvatarFallback>
						</Avatar>
						<span className="text-[13px] text-muted-foreground hidden sm:block">
							{session.name}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={async () => {
								await fetch("/auth/logout", { method: "POST" });
								window.location.href = "/";
							}}
							className="text-[13px] text-muted-foreground h-7 px-2"
						>
							Sign out
						</Button>
					</div>
				</div>
			</header>

			<main className="max-w-5xl mx-auto px-5 py-8 w-full flex-grow">
				{children}
			</main>

			<Footer />
		</div>
	);
}
