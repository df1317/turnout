declare const __COMMIT_HASH__: string;

export function Footer() {
	return (
		<footer className="mt-auto py-6 border-t border-border/60 bg-white/40 backdrop-blur-sm">
			<div className="max-w-5xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-muted-foreground">
				<div className="flex items-center gap-1.5">
					<span>Made with</span>
					<span className="text-red-500">❤️</span>
					<span>by the Digital Fusion programming team</span>
				</div>
				<div className="flex items-center gap-3">
					<a
						href={`https://github.com/df1317/sirsnap/commit/${__COMMIT_HASH__}`}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-foreground transition-colors font-mono"
					>
						{__COMMIT_HASH__}
					</a>
				</div>
			</div>
		</footer>
	);
}
