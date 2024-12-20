import { useRouteError } from 'react-router-dom';
import { router } from '../main';
import { Route } from '../routes/workspaces';
import { Button } from './core/Button';
import { FormattedError } from './core/FormattedError';
import { Heading } from './core/Heading';
import { VStack } from './core/Stacks';

export default function RouteError() {
  const error = useRouteError();
  console.log('Error', error);
  const stringified = JSON.stringify(error);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = (error as any).message ?? stringified;
  return (
    <div className="flex items-center justify-center h-full">
      <VStack space={5} className="max-w-[50rem] !h-auto">
        <Heading>Route Error 🔥</Heading>
        <FormattedError>{message}</FormattedError>
        <VStack space={2}>
          <Button
            color="primary"
            onClick={() => {
              router.navigate({ to: Route.fullPath });
            }}
          >
            Go Home
          </Button>
          <Button color="info" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </VStack>
      </VStack>
    </div>
  );
}
