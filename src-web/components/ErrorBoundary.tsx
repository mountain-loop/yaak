import type { ErrorInfo, ReactNode } from 'react';
import { Component, useEffect } from 'react';
import { showDialog } from '../lib/dialog';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import RouteError from './RouteError';

interface ErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Banner color="danger" className="flex items-center gap-2 overflow-auto">
          <div>
            Error rendering <InlineCode>{this.props.name}</InlineCode> component
          </div>
          <Button
            className="inline-flex"
            variant="border"
            color="danger"
            size="2xs"
            onClick={() => {
              showDialog({
                id: 'error-boundary',
                render: () => <RouteError error={this.state.error} />,
              });
            }}
          >
            Show
          </Button>
        </Banner>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundaryTestThrow() {
  useEffect(() => {
    throw new Error('test error');
  });

  return <div>Hello</div>;
}
