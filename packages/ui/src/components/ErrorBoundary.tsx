import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { InlineCode } from "./InlineCode";

export interface ErrorBoundaryProps {
  name: string;
  children: ReactNode;
  /** Shows a button that hands the error over, eg. to open it in a dialog. Without it the message shows inline. */
  onShowError?: (error: unknown) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("Error caught by ErrorBoundary:", error, info);
  }

  render() {
    const { hasError, error } = this.state;
    if (!hasError) {
      return this.props.children;
    }

    const { name, onShowError } = this.props;
    return (
      <Banner color="danger" className="flex items-center gap-2 overflow-auto">
        <div>
          Error rendering <InlineCode>{name}</InlineCode> component
          {onShowError == null && `: ${error instanceof Error ? error.message : String(error)}`}
        </div>
        {onShowError && (
          <Button
            className="inline-flex"
            variant="border"
            color="danger"
            size="2xs"
            onClick={() => onShowError(error)}
          >
            Show
          </Button>
        )}
      </Banner>
    );
  }
}
