import { Button } from './core/Button';
import { DetailsBanner } from './core/DetailsBanner';
import { FormattedError } from './core/FormattedError';
import { Heading } from './core/Heading';
import { VStack } from './core/Stacks';

export default function RouteError({ error }: { error: unknown }) {
  console.log('Error', error);
  const stringified = JSON.stringify(error);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = (error as any).message ?? stringified;
  const stack =
    typeof error === 'object' && error != null && 'stack' in error ? String(error.stack) : null;
  return (
    <div className="flex items-center justify-center h-full">
      <VStack space={5} className="w-[50rem] !h-auto">
        <Heading>Route Error 🔥</Heading>
        <FormattedError>
          {message}
          {stack && (
            <DetailsBanner color="secondary" className="mt-3 select-auto text-xs" summary="Stack Trace">
              <div className="mt-2 text-xs">{stack}</div>
            </DetailsBanner>
          )}
        </FormattedError>
        <VStack space={2}>
          <Button
            color="primary"
            onClick={async () => {
              window.location.assign('/');
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
