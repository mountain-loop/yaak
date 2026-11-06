import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    // Not in @types/react yet; opts editable elements out of macOS Writing Tools
    writingsuggestions?: "true" | "false";
  }
}
