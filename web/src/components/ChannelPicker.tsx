import { Hash, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ChannelPicker({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (id: string) => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [channels, setChannels] = useState<
		{ id: string; name: string; is_private: boolean }[]
	>([]);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<{
		id: string;
		name: string;
		is_private: boolean;
	} | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (channels.length === 0) {
			api
				.getSlackChannels()
				.then((chs) => {
					setChannels(chs);
					if (value) {
						const found = chs.find((c) => c.id === value);
						if (found) setSelected(found);
					}
				})
				.catch((e: Error) => setError(e.message));
		} else if (value && !selected) {
			const found = channels.find((c) => c.id === value);
			if (found) setSelected(found);
		}
	}, [channels.length, value, selected, channels.find]);

	useEffect(() => {
		if (open && inputRef.current) inputRef.current.focus();
	}, [open]);

	const filtered = query
		? channels.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
		: channels;

	const select = (ch: { id: string; name: string; is_private: boolean }) => {
		setSelected(ch);
		onChange(ch.id);
		setOpen(false);
		setQuery("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					className={cn(
						"flex h-9 w-full justify-start rounded-md border border-input bg-transparent px-3 py-1 text-left font-normal text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[empty=true]:text-muted-foreground",
						className,
					)}
					data-empty={!selected}
				>
					{selected ? (
						<span className="flex items-center gap-1.5">
							{selected.is_private ? (
								<Lock className="size-3.5 shrink-0" />
							) : (
								<Hash className="size-3.5 shrink-0" />
							)}
							{selected.name}
						</span>
					) : (
						<span>Pick a channel…</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="pointer-events-auto w-64 p-0"
				align="start"
				onWheel={(e) => e.stopPropagation()}
			>
				<div className="p-1">
					<Input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search channels…"
						className="mb-1 h-8 text-xs"
					/>
					<div className="max-h-[200px] overflow-y-auto overscroll-contain">
						{error && (
							<p className="px-2 py-1.5 text-destructive text-xs">
								Couldn't load channels: {error}
							</p>
						)}
						{!error && filtered.length === 0 && (
							<p className="px-2 py-1.5 text-muted-foreground text-xs">
								No channels found.
							</p>
						)}
						{filtered.map((ch) => (
							<button
								key={ch.id}
								type="button"
								className={cn(
									"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
									selected?.id === ch.id &&
										"bg-accent font-medium text-accent-foreground",
								)}
								onClick={() => select(ch)}
							>
								{ch.is_private ? (
									<Lock className="size-3 shrink-0 text-muted-foreground" />
								) : (
									<Hash className="size-3 shrink-0 text-muted-foreground" />
								)}
								{ch.name}
							</button>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
