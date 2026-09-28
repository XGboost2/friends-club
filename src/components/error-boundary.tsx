import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = { error: Error | null };

/**
 * Catches render-time errors so the app shows a friendly message instead of a
 * white page. Any thrown error is logged to the console for local debugging
 * and — if `window.__errorReporter` is wired (e.g. from Sentry) — reported.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[app] render error", error, info.componentStack);
    const reporter = (window as unknown as { __errorReporter?: (e: unknown, ctx?: unknown) => void }).__errorReporter;
    if (typeof reporter === "function") {
      try { reporter(error, info); } catch { /* never let reporter throw */ }
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 grid size-16 place-items-center rounded-2xl bg-destructive/15 text-destructive">
          <AlertTriangle size={30} />
        </div>
        <h1 className="font-display text-3xl font-bold">Something went sideways</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          The app hit an unexpected error. It's already been logged. Try again — most of the time a reload does it.
        </p>
        <div className="mt-6 flex gap-3">
          <Button variant="glass" size="lg" onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="neon" size="lg" onClick={this.reset}>Dismiss</Button>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-6 max-h-64 w-full overflow-auto rounded-xl border border-border bg-soft p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
        )}
      </div>
    );
  }
}
