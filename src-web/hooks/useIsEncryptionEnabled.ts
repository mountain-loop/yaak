import {useAtomValue} from "jotai/index";
import {activeWorkspaceMetaAtom} from "./useActiveWorkspace";

export function useIsEncryptionEnabled() {
    const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
    return workspaceMeta?.encryptionKey != null;
}
