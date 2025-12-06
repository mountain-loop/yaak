import { type MultipartPart, parseMultipart } from '@mjackson/multipart-parser';
import type { HttpResponse } from '@yaakapp-internal/models';
import { useState } from 'react';
import { useResponseBodyBytes } from '../../hooks/useResponseBodyText';
import { getMimeTypeFromContentType, languageFromContentType } from '../../lib/contentType';
import { getContentTypeFromHeaders } from '../../lib/model_util';
import { Editor } from '../core/Editor/LazyEditor';
import { Icon } from '../core/Icon';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { CsvViewerInner } from './CsvViewer';
import { ImageViewer } from './ImageViewer';

interface Props {
  response: HttpResponse;
}

export function MultipartViewer({ response }: Props) {
  const body = useResponseBodyBytes({ response });
  const [tab, setTab] = useState<string>();

  if (body.data == null) return null;

  const contentTypeHeader = getContentTypeFromHeaders(response.headers);
  const boundary = contentTypeHeader?.split('boundary=')[1] ?? 'unknown';

  const parsed = parseMultipart(body.data, { boundary });
  const parts = Array.from(parsed);

  return (
    <Tabs
      value={tab}
      addBorders
      label="Multipart"
      layout="horizontal"
      tabListClassName="border-r border-r-border"
      onChangeValue={setTab}
      tabs={parts.map((part) => ({
        label: part.name ?? '',
        value: part.name ?? '',
        rightSlot:
          part.filename && part.headers.contentType.mediaType?.startsWith('image/') ? (
            <div className="h-5 w-5 overflow-auto flex items-center justify-end">
              <ImageViewer
                data={part.arrayBuffer}
                className="ml-auto w-auto rounded overflow-hidden"
              />
            </div>
          ) : part.filename ? (
            <Icon icon="file_text" />
          ) : null,
      }))}
    >
      {parts.map((part, i) => (
        <TabContent
          // biome-ignore lint/suspicious/noArrayIndexKey: Nothing else to key on
          key={response.id + part.name + i}
          value={part.name ?? ''}
          className="pl-3 !pt-0"
        >
          <Part part={part} />
        </TabContent>
      ))}
    </Tabs>
  );
}

function Part({ part }: { part: MultipartPart }) {
  const contentType = part.headers.get('content-type');
  const mimeType = contentType == null ? null : getMimeTypeFromContentType(contentType).essence;

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={part.arrayBuffer} className="pb-2" />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    const content = new TextDecoder().decode(part.arrayBuffer);
    return <CsvViewerInner text={content} />;
  }

  const content = new TextDecoder().decode(part.arrayBuffer);
  const language = languageFromContentType(contentType, content);
  return <Editor readOnly defaultValue={content} language={language} stateKey={null} />;
}
