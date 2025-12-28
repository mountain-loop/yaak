import classNames from 'classnames';
import { JsonAttributeTree } from '../core/JsonAttributeTree';

interface Props {
  text: string;
  className?: string;
}

export function JsonViewer({ text, className }: Props) {
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // Nothing yet
  }

  return (
    <div className={classNames(className, 'overflow-x-auto h-full')}>
      <JsonAttributeTree attrValue={parsed} />
    </div>
  );
}
