import classNames from 'classnames';
import { useKeyValue } from '../../hooks/useKeyValue';
import { BulkPairEditor } from './BulkPairEditor';
import { IconButton } from './IconButton';
import type { PairEditorProps } from './PairEditor';
import { PairEditor } from './PairEditor';

interface Props extends PairEditorProps {
  preferenceName: string;
  forcedEnvironmentId?: string;
}

export function PairOrBulkEditor({ preferenceName, ...props }: Props) {
  const { value: useBulk, set: setUseBulk } = useKeyValue<boolean>({
    namespace: 'global',
    key: ['bulk_edit', preferenceName],
    fallback: false,
  });

  return (
    <div className="relative h-full w-full group/wrapper">
      {useBulk ? <BulkPairEditor {...props} /> : <PairEditor {...props} />}
      <div className="absolute right-0 bottom-0">
        <IconButton
          size="sm"
          variant="border"
          title={useBulk ? 'Enable form edit' : 'Enable bulk edit'}
          className={classNames(
            'transition-opacity opacity-0 group-hover:opacity-80 hover:!opacity-100 shadow',
            'bg-surface hover:text group-hover/wrapper:opacity-100',
          )}
          onClick={() => setUseBulk((b) => !b)}
          icon={useBulk ? 'table' : 'file_code'}
        />
      </div>
    </div>
  );
}
