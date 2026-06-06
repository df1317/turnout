import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("ErrorBoundary caught:", error, info);
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div className="flex min-h-[200px] items-center justify-center p-8">
						<div className="text-center">
							<h2 className="font-semibold text-lg">Something went wrong</h2>
							<p className="mt-2 text-muted-foreground text-sm">
								Try refreshing the page.
							</p>
						</div>
					</div>
				)
			);
		}

		return this.props.children;
	}
}
