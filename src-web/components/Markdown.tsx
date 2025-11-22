import type { CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';
import { ErrorBoundary } from './ErrorBoundary';
import { Prose } from './Prose';

interface Props {
  children: string | null;
  className?: string;
}

export function Markdown({ children, className }: Props) {
  if (children == null) return null;

  return (
    <Prose className={className}>
      <ErrorBoundary name="Markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {children}
        </ReactMarkdown>
      </ErrorBoundary>
    </Prose>
  );
}

const prismTheme = {
  'pre[class*="language-"]': {
    // Needs to be here, so the lib doesn't add its own
  },

  // Syntax tokens
  comment: { color: 'var(--textSubtle)' },
  prolog: { color: 'var(--textSubtle)' },
  doctype: { color: 'var(--textSubtle)' },
  cdata: { color: 'var(--textSubtle)' },

  punctuation: { color: 'var(--textSubtle)' },

  property: { color: 'var(--primary)' },
  'attr-name': { color: 'var(--primary)' },

  string: { color: 'var(--notice)' },
  char: { color: 'var(--notice)' },

  number: { color: 'var(--info)' },
  constant: { color: 'var(--info)' },
  symbol: { color: 'var(--info)' },

  boolean: { color: 'var(--warning)' },
  'attr-value': { color: 'var(--warning)' },

  variable: { color: 'var(--success)' },

  tag: { color: 'var(--info)' },
  operator: { color: 'var(--danger)' },
  keyword: { color: 'var(--danger)' },
  function: { color: 'var(--success)' },
  'class-name': { color: 'var(--primary)' },
  builtin: { color: 'var(--danger)' },
  selector: { color: 'var(--danger)' },
  inserted: { color: 'var(--success)' },
  deleted: { color: 'var(--danger)' },
  regex: { color: 'var(--warning)' },

  important: { color: 'var(--danger)', fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: 'bold' },
  entity: { cursor: 'help' },
};

const lineStyle: CSSProperties = {
  paddingRight: '1.5em',
  paddingLeft: '0',
  opacity: 0.5,
};

const markdownComponents: Partial<Components> = {
  // Ensure links open in external browser by adding target="_blank"
  a: ({ href, children, ...rest }) => {
    if (href && !href.match(/https?:\/\//)) {
      href = `http://${href}`;
    }
    return (
      <a target="_blank" rel="noreferrer noopener" href={href} {...rest}>
        {children}
      </a>
    );
  },
  code(props) {
    const { children, className, ref, ...extraProps } = props;
    extraProps.node = undefined;

    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <SyntaxHighlighter
        {...extraProps}
        CodeTag="code"
        showLineNumbers
        PreTag="div"
        lineNumberStyle={lineStyle}
        language={match[1]}
        style={prismTheme}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code {...extraProps} ref={ref} className={className}>
        {children}
      </code>
    );
  },
};
