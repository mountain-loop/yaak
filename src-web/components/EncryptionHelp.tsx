import {VStack} from "./core/Stacks";

export function EncryptionHelp() {
    return <VStack space={3}>
        <p>
            Encrypt values like secrets and tokens. When enabled, Yaak will also encrypt HTTP responses,
            cookies, and authentication credentials automatically.
        </p>
        <p>
            Encrypted data remains secure when syncing to the filesystem or Git, and when exporting or
            sharing with others.
        </p>
    </VStack>
}
