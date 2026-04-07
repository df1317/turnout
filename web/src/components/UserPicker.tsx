import { useEffect, useRef, useState } from "react";
import { api, type User } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { cn } from "../lib/utils";

export function UserPicker({
	onSelect,
	excludeIds = [],
	filter,
	className,
}: {
	onSelect: (user: User) => void;
	excludeIds?: string[];
	filter?: (user: User) => boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [users, setUsers] = useState<User[]>([]);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open && users.length === 0) {
			api.getUsers().then(setUsers);
		}
	}, [open, users.length]);

	useEffect(() => {
		if (open && inputRef.current) inputRef.current.focus();
	}, [open]);

	const filtered = users.filter(
		(u) =>
			!excludeIds.includes(u.user_id) &&
			(!filter || filter(u)) &&
			u.name.toLowerCase().includes(query.toLowerCase()),
	);

	const select = (user: User) => {
		onSelect(user);
		setOpen(false);
		setQuery("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					className={cn(
						"flex w-full justify-start text-left font-normal h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[empty=true]:text-muted-foreground",
						className,
					)}
				>
					<span>Add a member…</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-0" align="start">
				<div className="p-1">
					<Input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search members…"
						className="h-8 text-xs mb-1"
					/>
					<div className="max-h-[200px] overflow-y-auto overscroll-contain">
						{filtered.length === 0 && (
							<p className="px-2 py-1.5 text-xs text-muted-foreground">
								No members found.
							</p>
						)}
						{filtered.map((u) => (
							<button
								key={u.user_id}
								type="button"
								className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted transition-colors rounded-sm"
								onClick={() => select(u)}
							>
								<Avatar size="sm" className="shrink-0 size-4">
									<AvatarImage src={u.avatar_url} />
									<AvatarFallback className="text-[8px]">
										{u.name[0]}
									</AvatarFallback>
								</Avatar>
								<span className="truncate">{u.name}</span>
							</button>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
