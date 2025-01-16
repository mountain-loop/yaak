import type { GrpcMetadataEntry, GrpcRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { CSSProperties } from 'react';
import React, { useCallback, useMemo, useRef } from 'react';
import { useContainerSize } from '../hooks/useContainerQuery';
import type { ReflectResponseService } from '../hooks/useGrpc';
import { useHttpAuthentication } from '../hooks/useHttpAuthentication';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { Button } from './core/Button';
import { CountBadge } from './core/CountBadge';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { PlainInput } from './core/PlainInput';
import { RadioDropdown } from './core/RadioDropdown';
import { HStack, VStack } from './core/Stacks';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { GrpcEditor } from './GrpcEditor';
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

const tabsAtom = atomWithStorage<Record<string, string>>('grpcRequestPaneActiveTabs', {});

export function GrpcConnectionSetupPane({
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
  const updateRequest = useUpdateAnyGrpcRequest();
  const authentication = useHttpAuthentication();
  const [activeTabs, setActiveTabs] = useAtom(tabsAtom);
  const { updateKey: forceUpdateKey } = useRequestUpdateKey(activeRequest.id ?? null);

  const urlContainerEl = useRef<HTMLDivElement>(null);
  const { width: paneWidth } = useContainerSize(urlContainerEl);

  const handleChangeUrl = useCallback(
    (url: string) => updateRequest.mutateAsync({ id: activeRequest.id, update: { url } }),
    [activeRequest.id, updateRequest],
  );

  const handleChangeMessage = useCallback(
    (message: string) => {
      return updateRequest.mutateAsync({ id: activeRequest.id, update: { message } });
    },
    [activeRequest.id, updateRequest],
  );

  const select = useMemo(() => {
    const options =
      services?.flatMap((s) =>
        s.methods.map((m) => ({
          label: `${s.name.split('.', 2).pop() ?? s.name}/${m.name}`,
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
      await updateRequest.mutateAsync({
        id: activeRequest.id,
        update: {
          service: serviceName,
          method: methodName,
        },
      });
    },
    [activeRequest.id, updateRequest],
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
      {
        value: TAB_AUTH,
        label: 'Auth',
        options: {
          value: activeRequest.authenticationType,
          items: [
            ...authentication.map((a) => ({
              label: a.name,
              value: a.pluginName,
            })),
            { type: 'separator' },
            { label: 'No Authentication', shortLabel: 'Auth', value: null },
          ],
          onChange: (authenticationType) => {
            let authentication: GrpcRequest['authentication'] = activeRequest.authentication;
            if (activeRequest.authenticationType !== authenticationType) {
              authentication = {
                // Reset auth if changing types
              };
            }
            updateRequest.mutate({
              id: activeRequest.id,
              update: { authenticationType, authentication },
            });
          },
        },
      },
      { value: TAB_METADATA, label: 'Metadata' },
      {
        value: TAB_DESCRIPTION,
        label: 'Info',
        rightSlot: activeRequest.description && <CountBadge count={true} />,
      },
    ],
    [
      activeRequest.authentication,
      activeRequest.authenticationType,
      activeRequest.description,
      activeRequest.id,
      authentication,
      updateRequest,
    ],
  );

  const activeTab = activeTabs?.[activeRequest.id];
  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabs((r) => ({ ...r, [activeRequest.id]: tab }));
    },
    [activeRequest.id, setActiveTabs],
  );

  const handleMetadataChange = useCallback(
    (metadata: GrpcMetadataEntry[]) =>
      updateRequest.mutate({ id: activeRequest.id, update: { metadata } }),
    [activeRequest.id, updateRequest],
  );

  const handleDescriptionChange = useCallback(
    (description: string) =>
      updateRequest.mutate({ id: activeRequest.id, update: { description } }),
    [activeRequest.id, updateRequest],
  );

  return (
    <VStack style={style}>
      <div
        ref={urlContainerEl}
        className={classNames(
          'grid grid-cols-[minmax(0,1fr)_auto] gap-1.5',
          paneWidth < 400 && '!grid-cols-1',
        )}
      >
        <UrlBar
          key={forceUpdateKey}
          url={activeRequest.url ?? ''}
          method={null}
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
            extraItems={[
              {
                label: 'Refresh',
                type: 'default',
                key: 'custom',
                leftSlot: <Icon className="text-text-subtlest" size="sm" icon="refresh" />,
              },
            ]}
          >
            <Button
              size="sm"
              variant="border"
              rightSlot={<Icon className="text-text-subtlest" size="sm" icon="chevron_down" />}
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
                hotkeyAction="grpc_request.send"
                onClick={isStreaming ? handleSend : handleConnect}
                icon={isStreaming ? 'send_horizontal' : 'arrow_up_down'}
              />
            </>
          ) : (
            <IconButton
              size="sm"
              variant="border"
              title={methodType === 'unary' ? 'Send' : 'Connect'}
              hotkeyAction="grpc_request.send"
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
        tabListClassName="mt-2 !mb-1.5"
      >
        <TabContent value="message">
          <GrpcEditor
            onChange={handleChangeMessage}
            services={services}
            reflectionError={reflectionError}
            reflectionLoading={reflectionLoading}
            request={activeRequest}
            protoFiles={protoFiles}
          />
        </TabContent>
        <TabContent value={TAB_AUTH}>
          <HttpAuthenticationEditor request={activeRequest} />
        </TabContent>
        <TabContent value={TAB_METADATA}>
          <PairOrBulkEditor
            preferenceName="grpc_metadata"
            valueAutocompleteVariables
            nameAutocompleteVariables
            pairs={activeRequest.metadata}
            onChange={handleMetadataChange}
            forceUpdateKey={forceUpdateKey}
            stateKey={`grpc_metadata.${activeRequest.id}`}
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
              placeholder={fallbackRequestName(activeRequest)}
              onChange={(name) => updateRequest.mutate({ id: activeRequest.id, update: { name } })}
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
