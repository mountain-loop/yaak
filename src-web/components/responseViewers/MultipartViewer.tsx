import { type MultipartPart, parseMultipart } from '@mjackson/multipart-parser';
import { lazy, Suspense, useState } from 'react';
import { languageFromContentType } from '../../lib/contentType';
import { Icon } from '../core/Icon';
import { LoadingIcon } from '../core/LoadingIcon';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { CsvViewer } from './CsvViewer';
import { ImageViewer } from './ImageViewer';
import { SvgViewer } from './SvgViewer';
import { TextViewer } from './TextViewer';
import { WebPageViewer } from './WebPageViewer';

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

interface Props {
  data: Uint8Array;
  boundary: string;
  idPrefix?: string;
}

export function MultipartViewer({ data, boundary, idPrefix = 'multipart' }: Props) {
  const [tab, setTab] = useState<string>();

  const maxFileSize = 1024 * 1024 * 10; // 10MB
  const parsed = parseMultipart(data, { boundary, maxFileSize });
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
            <Icon icon="file" />
          ) : null,
      }))}
    >
      {parts.map((part, i) => (
        <TabContent
          // biome-ignore lint/suspicious/noArrayIndexKey: Nothing else to key on
          key={idPrefix + part.name + i}
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
  const mimeType = part.headers.contentType.mediaType ?? null;
  const contentTypeHeader = part.headers.get('content-type');
  const content = new TextDecoder().decode(part.arrayBuffer);

  // Fallback: detect content type from content if not provided
  const detectedLanguage = languageFromContentType(contentTypeHeader, content);

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={content} className="pb-2" />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={part.arrayBuffer} className="pb-2" />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={content} />;
  }

  if (mimeType?.match(/^text\/html/i) || detectedLanguage === 'html') {
    return <WebPageViewer html={content} />;
  }

  if (mimeType?.match(/pdf/i)) {
    return (
      <Suspense fallback={<LoadingIcon />}>
        <PdfViewer data={part.arrayBuffer} />
      </Suspense>
    );
  }

  return <TextViewer text={content} language={detectedLanguage} stateKey={null} />;
}
