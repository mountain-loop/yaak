import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, {
    // handlers: {
    //   link: (state, node, parent) => {
    //     return node;
    //   },
    // },
  })
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  try {
    const r = await renderer.process(md);
    return r.toString();
  } catch (err) {
    console.log('FAILED TO RENDER MARKDOWN', err);
    return 'error';
  }
}
