import { useEffect, useRef, useState } from "react";
import { api, type User } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Check, X } from "lucide-react";
import { cn } from "../lib/utils";

export function UserPicker({
	selectedIds = [],
	selectedUsers = [],
	onToggle,
	onClear,
	filter,
	className,
}: {
	selectedIds?: string[];
	selectedUsers?: User[];
	onToggle: (user: User, isSelected: boolean) => void;
	onClear?: () => void;
	filter?: (user: User) => boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [users, setUsers] = useState<User[]>([]);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (users.length === 0) {
			api.getUsers().then(setUsers);
		}
	}, [users.length]);

	useEffect(() => {
		if (open && inputRef.current) inputRef.current.focus();
	}, [open]);

	const filtered = users
		.filter(
			(u) =>
				(!filter || filter(u)) &&
				u.name.toLowerCase().includes(query.toLowerCase()),
		)
		.sort((a, b) => {
			const aSelected = selectedIds.includes(a.user_id);
			const bSelected = selectedIds.includes(b.user_id);
			if (aSelected && !bSelected) return -1;
			if (!aSelected && bSelected) return 1;
			return a.name.localeCompare(b.name);
		});
	
	const displayUsers = selectedUsers.length > 0 
		? selectedUsers 
		: users.filter(u => selectedIds.includes(u.user_id));

	const toggleUser = (user: User) => {
		const isSelected = selectedIds.includes(user.user_id);
		onToggle(user, !isSelected);
		if (inputRef.current) inputRef.current.focus();
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					className={cn(
						"flex w-full justify-start text-left font-normal h-auto min-h-9 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[empty=true]:text-muted-foreground whitespace-normal",
						className,
					)}
				>
					{displayUsers.length > 0 ? (
						<div className="flex flex-wrap items-center gap-1.5 w-full pr-8 relative">
							<div className="flex -space-x-1.5 overflow-hidden mr-1">
								{displayUsers.slice(0, 3).map((u) => (
									<Avatar key={u.user_id} className="inline-block size-5 ring-1 ring-background">
										<AvatarImage src={u.avatar_url} />
										<AvatarFallback className="text-[8px]">{u.name[0]}</AvatarFallback>
									</Avatar>
								))}
							</div>
							<span className="text-xs truncate max-w-[120px]">
								{displayUsers.slice(0, 2).map((u) => u.name).join(", ")}
							</span>
							{displayUsers.length > 2 && (
								<span className="text-xs text-muted-foreground whitespace-nowrap">
									+{displayUsers.length - 2} more
								</span>
							)}
							{onClear && (
								<div 
									className="absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
									onClick={(e) => {
										e.stopPropagation();
										onClear();
									}}
								>
									<X className="size-3.5" />
								</div>
							)}
						</div>
					) : (
						<span className="text-muted-foreground">Select members…</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-0 pointer-events-auto" align="start" onWheel={(e) => e.stopPropagation()}>
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
						{filtered.map((u) => {
							const isSelected = selectedIds.includes(u.user_id);
							return (
								<button
									key={u.user_id}
									type="button"
									className={cn(
										"w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-left transition-colors rounded-sm",
										isSelected ? "bg-accent/50" : "hover:bg-muted"
									)}
									onClick={() => toggleUser(u)}
								>
									<div className="flex items-center gap-2 overflow-hidden">
										<Avatar size="sm" className="shrink-0 size-4">
											<AvatarImage src={u.avatar_url} />
											<AvatarFallback className="text-[8px]">
												{u.name[0]}
											</AvatarFallback>
										</Avatar>
										<span className="truncate">{u.name}</span>
									</div>
									{isSelected && <Check className="size-3.5 text-primary shrink-0" />}
								</button>
							);
						})}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
