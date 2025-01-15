import { openUrl } from '@tauri-apps/plugin-opener';
import type { HttpResponse } from '@yaakapp-internal/models';
import { IconButton } from './core/IconButton';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';

interface Props {
  response: HttpResponse;
}

export function ResponseInfo({ response }: Props) {
  return (
    <div className="overflow-auto h-full pb-4">
      <KeyValueRows>
        <KeyValueRow labelColor="info" label="Version">
          {response.version}
        </KeyValueRow>
        <KeyValueRow labelColor="info" label="Remote Address">
          {response.remoteAddr}
        </KeyValueRow>
        <KeyValueRow
          labelColor="info"
          label={
            <div className="flex items-center">
              URL
              <IconButton
                iconSize="sm"
                className="inline-block w-auto ml-1 !h-auto opacity-50 hover:opacity-100"
                icon="external_link"
                onClick={() => openUrl(response.url)}
                title="Open in browser"
              />
            </div>
          }
        >
          {
            <div className="flex">
              <span className="select-text cursor-text">{response.url}</span>
            </div>
          }
        </KeyValueRow>
      </KeyValueRows>
    </div>
  );
}
