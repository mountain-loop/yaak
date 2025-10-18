import { type GrpcRequest, type HttpRequestHeader, patchModel } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React, { useCallback, useMemo, useRef } from 'react';
import { useAuthTab } from '../hooks/useAuthTab';
import { useContainerSize } from '../hooks/useContainerQuery';
import type { ReflectResponseService } from '../hooks/useGrpc';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { useKeyValue } from '../hooks/useKeyValue';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { resolvedModelName } from '../lib/resolvedModelName';
import { Button } from './core/Button';
import { CountBadge } from './core/CountBadge';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { PlainInput } from './core/PlainInput';
import { RadioDropdown } from './core/RadioDropdown';
import { HStack, VStack } from './core/Stacks';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { GrpcEditor } from './GrpcEditor';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { UrlBar } from './UrlBar';

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequest: GrpcRequest;
  protoFiles: string[];
  reflectionError?: string;
  reflectionLoading?: boolean;
  methodType:
    | 'unary'
    | 'client_streaming'
    | 'server_streaming'
    | 'streaming'
    | 'no-schema'
    | 'no-method';
  isStreaming: boolean;
  onCommit: () => void;
  onCancel: () => void;
  onSend: (v: { message: string }) => void;
  onGo: () => void;
  services: ReflectResponseService[] | null;
}

const TAB_MESSAGE = 'message';
const TAB_METADATA = 'metadata';
const TAB_AUTH = 'auth';
const TAB_DESCRIPTION = 'description';

export function GrpcRequestPane({
  style,
  services,
  methodType,
  activeRequest,
  protoFiles,
  reflectionError,
  reflectionLoading,
  isStreaming,
  onGo,
  onCommit,
  onCancel,
  onSend,
}: Props) {
  const authTab = useAuthTab(TAB_AUTH, activeRequest);
  const metadataTab = useHeadersTab(TAB_METADATA, activeRequest, 'Metadata');
  const inheritedHeaders = useInheritedHeaders(activeRequest);
  const { value: activeTabs, set: setActiveTabs } = useKeyValue<Record<string, string>>({
    namespace: 'no_sync',
    key: 'grpcRequestActiveTabs',
    fallback: {},
  });
  const forceUpdateKey = useRequestUpdateKey(activeRequest.id ?? null);

  const urlContainerEl = useRef<HTMLDivElement>(null);
  const { width: paneWidth } = useContainerSize(urlContainerEl);

  const handleChangeUrl = useCallback(
    (url: string) => patchModel(activeRequest, { url }),
    [activeRequest],
  );

  const handleChangeMessage = useCallback(
    (message: string) => patchModel(activeRequest, { message }),
    [activeRequest],
  );

  const select = useMemo(() => {
    const options =
      services?.flatMap((s) =>
        s.methods.map((m) => ({
          label: `${s.name.split('.').pop() ?? s.name}/${m.name}`,
          value: `${s.name}/${m.name}`,
        })),
      ) ?? [];
    const value = `${activeRequest?.service ?? ''}/${activeRequest?.method ?? ''}`;
    return { value, options };
  }, [activeRequest?.method, activeRequest?.service, services]);

  const handleChangeService = useCallback(
    async (v: string) => {
      const [serviceName, methodName] = v.split('/', 2);
      if (serviceName == null || methodName == null) throw new Error('Should never happen');
      await patchModel(activeRequest, {
        service: serviceName,
        method: methodName,
      });
    },
    [activeRequest],
  );

  const handleConnect = useCallback(async () => {
    if (activeRequest == null) return;

    if (activeRequest.service == null || activeRequest.method == null) {
      alert({
        id: 'grpc-invalid-service-method',
        title: 'Error',
        body: 'Service or method not selected',
      });
    }
    onGo();
  }, [activeRequest, onGo]);

  const handleSend = useCallback(async () => {
    if (activeRequest == null) return;
    onSend({ message: activeRequest.message });
  }, [activeRequest, onSend]);

  const tabs: TabItem[] = useMemo(
    () => [
      { value: TAB_MESSAGE, label: 'Message' },
      ...metadataTab,
      ...authTab,
      {
        value: TAB_DESCRIPTION,
        label: 'Info',
        rightSlot: activeRequest.description && <CountBadge count={true} />,
      },
    ],
    [activeRequest.description, authTab, metadataTab],
  );

  const activeTab = activeTabs?.[activeRequest.id];
  const setActiveTab = useCallback(
    async (tab: string) => {
      await setActiveTabs((r) => ({ ...r, [activeRequest.id]: tab }));
    },
    [activeRequest.id, setActiveTabs],
  );

  const handleMetadataChange = useCallback(
    (metadata: HttpRequestHeader[]) => patchModel(activeRequest, { metadata }),
    [activeRequest],
  );

  const handleDescriptionChange = useCallback(
    (description: string) => patchModel(activeRequest, { description }),
    [activeRequest],
  );

  return (
    <VStack style={style}>
      <div
        ref={urlContainerEl}
        className={classNames(
          'grid grid-cols-[minmax(0,1fr)_auto] gap-1.5',
          paneWidth === 0 && 'opacity-0',
          paneWidth > 0 && paneWidth < 400 && '!grid-cols-1',
        )}
      >
        <UrlBar
          key={forceUpdateKey}
          url={activeRequest.url ?? ''}
          submitIcon={null}
          forceUpdateKey={forceUpdateKey}
          placeholder="localhost:50051"
          onSend={handleConnect}
          onUrlChange={handleChangeUrl}
          onCancel={onCancel}
          isLoading={isStreaming}
          stateKey={'grpc_url.' + activeRequest.id}
        />
        <HStack space={1.5}>
          <RadioDropdown
            value={select.value}
            onChange={handleChangeService}
            items={select.options.map((o) => ({
              label: o.label,
              value: o.value,
              type: 'default',
              shortLabel: o.label,
            }))}
            itemsAfter={[
              {
                label: 'Refresh',
                type: 'default',
                leftSlot: <Icon size="sm" icon="refresh" />,
              },
            ]}
          >
            <Button
              size="sm"
              variant="border"
              rightSlot={<Icon size="sm" icon="chevron_down" />}
              disabled={isStreaming || services == null}
              className={classNames(
                'font-mono text-editor min-w-[5rem] !ring-0',
                paneWidth < 400 && 'flex-1',
              )}
            >
              {select.options.find((o) => o.value === select.value)?.label ?? 'No Schema'}
            </Button>
          </RadioDropdown>
          {methodType === 'client_streaming' || methodType === 'streaming' ? (
            <>
              {isStreaming && (
                <>
                  <IconButton
                    variant="border"
                    size="sm"
                    title="Cancel"
                    onClick={onCancel}
                    icon="x"
                  />
                  <IconButton
                    variant="border"
                    size="sm"
                    title="Commit"
                    onClick={onCommit}
                    icon="check"
                  />
                </>
              )}
              <IconButton
                size="sm"
                variant="border"
                title={isStreaming ? 'Connect' : 'Send'}
                hotkeyAction="request.send"
                onClick={isStreaming ? handleSend : handleConnect}
                icon={isStreaming ? 'send_horizontal' : 'arrow_up_down'}
              />
            </>
          ) : (
            <IconButton
              size="sm"
              variant="border"
              title={methodType === 'unary' ? 'Send' : 'Connect'}
              hotkeyAction="request.send"
              onClick={isStreaming ? onCancel : handleConnect}
              disabled={methodType === 'no-schema' || methodType === 'no-method'}
              icon={
                isStreaming
                  ? 'x'
                  : methodType.includes('streaming')
                    ? 'arrow_up_down'
                    : 'send_horizontal'
              }
            />
          )}
        </HStack>
      </div>
      <Tabs
        value={activeTab}
        label="Request"
        onChangeValue={setActiveTab}
        tabs={tabs}
        tabListClassName="mt-1 !mb-1.5"
      >
        <TabContent value="message">
          <GrpcEditor
            onChange={handleChangeMessage}
            forceUpdateKey={forceUpdateKey}
            services={services}
            reflectionError={reflectionError}
            reflectionLoading={reflectionLoading}
            request={activeRequest}
            protoFiles={protoFiles}
          />
        </TabContent>
        <TabContent value={TAB_AUTH}>
          <HttpAuthenticationEditor model={activeRequest} />
        </TabContent>
        <TabContent value={TAB_METADATA}>
          <HeadersEditor
            inheritedHeaders={inheritedHeaders}
            forceUpdateKey={forceUpdateKey}
            headers={activeRequest.metadata}
            stateKey={`headers.${activeRequest.id}`}
            onChange={handleMetadataChange}
          />
        </TabContent>
        <TabContent value={TAB_DESCRIPTION}>
          <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
            <PlainInput
              label="Request Name"
              hideLabel
              forceUpdateKey={forceUpdateKey}
              defaultValue={activeRequest.name}
              className="font-sans !text-xl !px-0"
              containerClassName="border-0"
              placeholder={resolvedModelName(activeRequest)}
              onChange={(name) => patchModel(activeRequest, { name })}
            />
            <MarkdownEditor
              name="request-description"
              placeholder="Request description"
              defaultValue={activeRequest.description}
              stateKey={`description.${activeRequest.id}`}
              onChange={handleDescriptionChange}
            />
          </div>
        </TabContent>
      </Tabs>
    </VStack>
  );
}
