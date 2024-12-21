
// This is an atom so we can use it in the child items to avoid re-rendering the entire list
import {atom} from "jotai/index";

export const sidebarSelectedIdAtom = atom<string | null>(null);
