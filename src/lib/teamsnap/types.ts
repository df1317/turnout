export interface TeamSnapItem {
	href: string;
	data: Array<{
		name: string;
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		value: any;
		type?: string;
	}>;
	links: Array<{
		rel: string;
		href: string;
	}>;
}

export interface TeamSnapCollection {
	collection: {
		version: string;
		href: string;
		items: TeamSnapItem[];
	};
}

// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
export function extractData<T = Record<string, any>>(item: TeamSnapItem): T {
	// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
	const result: Record<string, any> = {};
	for (const field of item.data) {
		result[field.name] = field.value;
	}
	return result as T;
}
