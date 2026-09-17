import { Component, type ReactNode, type ErrorInfo } from "react";
import type { UniverLocaleKey } from "../locales.ts";
import { viewerErrorMessage } from "../viewer/error-message.ts";

/** Keep a document failure inside its preview: DSH retires crashed slot entries. */
export class PreviewErrorBoundary extends Component<{
  children: ReactNode;
  revision: number;
  targetKey?: string;
  t: (key: UniverLocaleKey) => string;
}, { error: string | null }> {
  override state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: viewerErrorMessage(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace preview failed", error, info.componentStack);
  }

  override componentDidUpdate(previous: Readonly<PreviewErrorBoundary["props"]>) {
    if ((previous.revision !== this.props.revision || previous.targetKey !== this.props.targetKey)
      && this.state.error !== null) this.setState({ error: null });
  }

  override render() {
    if (this.state.error !== null) return <div role="alert" style={{ padding: 16 }}>
      <p>{this.props.t("window.loadFailed")}: {this.state.error}</p>
      <button type="button" onClick={() => this.setState({ error: null })}>
        {this.props.t("window.retry")}
      </button>
    </div>;
    return this.props.children;
  }
}
