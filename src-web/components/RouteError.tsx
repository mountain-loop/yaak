import { useRouteError } from 'react-router-dom';
import { useAppRoutes } from '../hooks/useAppRoutes';
import { Button } from './core/Button';
import { FormattedError } from './core/FormattedError';
import { Heading } from './core/Heading';
import { HStack, VStack } from './core/Stacks';
import { open } from '@tauri-apps/plugin-shell';
import { Icon } from './core/Icon';

export default function RouteError() {
  const error = useRouteError();
  console.log('Error', error);
  const stringified = JSON.stringify(error);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = (error as any).message ?? stringified;
  const routes = useAppRoutes();
  return (
    <div className="flex items-center justify-center h-full">
      <VStack space={5} className="max-w-[40rem] !h-auto">
        <div className="mb-3">
          <Heading>App Error</Heading>
          <p className="text-lg">Uh oh, Yaak encountered an unexpected error.</p>
        </div>
        <FormattedError>{message}</FormattedError>
        <HStack space={2}>
          <Button size="sm" color="secondary" onClick={() => window.location.reload()}>
            Refresh App
          </Button>
          <Button
            size="sm"
            color="secondary"
            onClick={() => {
              routes.navigate('workspaces');
            }}
          >
            Go Home
          </Button>
          <Button
            size="sm"
            color="primary"
            rightSlot={<Icon icon="external_link" />}
            onClick={() => open('https://feedback.yaak.app')}
          >
            Contact Support
          </Button>
        </HStack>
      </VStack>
    </div>
  );
}
