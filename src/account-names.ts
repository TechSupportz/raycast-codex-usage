import { useLocalStorage } from "@raycast/utils";
import { useCallback } from "react";

const STORAGE_KEY = "account-names";

/**
 * Names the user typed into the rename form, keyed by account id. They sit on
 * top of the label an account was configured with, so clearing a name falls
 * back to the preference's `Label=path` or the directory-derived default.
 */
export function useAccountNames() {
  const { value, setValue, isLoading } = useLocalStorage<Record<string, string>>(STORAGE_KEY, {});
  const names = value ?? {};

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      const next = { ...names };

      if (trimmed) {
        next[id] = trimmed;
      } else {
        delete next[id];
      }

      await setValue(next);
    },
    [names, setValue],
  );

  return { names, rename, isLoading };
}
