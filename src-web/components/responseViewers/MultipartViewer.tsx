import { type MultipartPart, parseMultipart } from '@mjackson/multipart-parser';
import { lazy, Suspense, useMemo, useState } from 'react';
import { languageFromContentType } from '../../lib/contentType';
import { Banner } from '../core/Banner';
import { Icon } from '../core/Icon';
import { LoadingIcon } from '../core/LoadingIcon';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { AudioViewer } from './AudioViewer';
import { CsvViewer } from './CsvViewer';
import { ImageViewer } from './ImageViewer';
import { SvgViewer } from './SvgViewer';
import { TextViewer } from './TextViewer';
import { VideoViewer } from './VideoViewer';
import { WebPageViewer } from './WebPageViewer';

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

interface Props {
  data: Uint8Array;
  boundary: string;
  idPrefix?: string;
}

export function MultipartViewer({ data, boundary, idPrefix = 'multipart' }: Props) {
  const [tab, setTab] = useState<string>();

  const parseResult = useMemo(() => {
    try {
      const maxFileSize = 1024 * 1024 * 10; // 10MB
      const parsed = parseMultipart(data, { boundary, maxFileSize });
      const parts = Array.from(parsed);
      return { parts, error: null };
    } catch (err) {
      return { parts: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [data, boundary]);

  const { parts, error } = parseResult;

  if (error) {
    return (
      <Banner color="danger" className="m-3">
        Failed to parse multipart data: {error}
      </Banner>
    );
  }

  if (parts.length === 0) {
    return (
      <Banner color="info" className="m-3">
        No multipart parts found
      </Banner>
    );
  }

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

  const { uint8Array, content, detectedLanguage } = useMemo(() => {
    const uint8Array = new Uint8Array(part.arrayBuffer);
    const content = new TextDecoder().decode(part.arrayBuffer);
    const detectedLanguage = languageFromContentType(contentTypeHeader, content);
    return { uint8Array, content, detectedLanguage };
  }, [part, contentTypeHeader]);

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={content} className="pb-2" />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={part.arrayBuffer} className="pb-2" />;
  }

  if (mimeType?.match(/^audio/i)) {
    return <AudioViewer data={uint8Array} />;
  }

  if (mimeType?.match(/^video/i)) {
    return <VideoViewer data={uint8Array} />;
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
        <PdfViewer data={uint8Array} />
      </Suspense>
    );
  }

  return <TextViewer text={content} language={detectedLanguage} stateKey={null} />;
}
