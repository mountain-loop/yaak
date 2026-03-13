import { Button, FormattedError, Heading, VStack } from '@yaakapp-internal/ui';
import { DetailsBanner } from './core/DetailsBanner';

export default function RouteError({ error }: { error: unknown }) {
  console.log('Error', error);
  const stringified = JSON.stringify(error);
  // biome-ignore lint/suspicious/noExplicitAny: none
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
            <DetailsBanner
              color="secondary"
              className="mt-3 select-auto text-xs max-h-[40vh]"
              summary="Stack Trace"
            >
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
