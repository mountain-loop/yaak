import React, { useMemo } from 'react';
import { CountBadge } from '../components/core/CountBadge';
import type { TabItem } from '../components/core/Tabs/Tabs';
import type { HeaderModel } from './useInheritedHeaders';
import { useInheritedHeaders } from './useInheritedHeaders';

export function useHeadersTab<T extends string>(
  tabValue: T,
  model: HeaderModel | null,
  label?: string,
) {
  const inheritedHeaders = useInheritedHeaders(model);

  return useMemo<TabItem[]>(() => {
    if (model == null) return [];

    const allHeaders = [
      ...inheritedHeaders,
      ...(model.model === 'grpc_request' ? model.metadata : model.headers),
    ];
    const numHeaders = allHeaders.filter((h) => h.name).length;

    const tab: TabItem = {
      value: tabValue,
      label: label ?? 'Headers',
      rightSlot: <CountBadge count={numHeaders} />,
    };

    return [tab];
  }, [inheritedHeaders, label, model, tabValue]);
}
