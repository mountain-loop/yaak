import remarkGfm from 'remark-gfm';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Prose } from './Prose';

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Prose className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </Prose>
  );
}

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
};
