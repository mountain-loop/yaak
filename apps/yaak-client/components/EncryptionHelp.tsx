import { VStack } from './core/Stacks';

export function EncryptionHelp() {
  return (
    <VStack space={3}>
      <p>Encrypt passwords, tokens, and other sensitive info when encryption is enabled.</p>
      <p>
        Encrypted data remains secure when syncing to the filesystem or Git, and when exporting or
        sharing with others.
      </p>
    </VStack>
  );
}
