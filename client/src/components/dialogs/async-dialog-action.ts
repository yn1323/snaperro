export interface DialogActionGuard {
  isPending(): boolean;
  requestClose(onClose: () => void, disabled?: boolean): void;
  run(action: () => boolean | Promise<boolean>, onSuccess: () => void, disabled?: boolean): Promise<void>;
}

/** Serializes a controlled dialog action and protects every close path while it is pending. */
export function createDialogActionGuard(): DialogActionGuard {
  let pending = false;
  return {
    isPending: () => pending,
    requestClose: (onClose, disabled = false) => {
      if (!disabled && !pending) onClose();
    },
    run: async (action, onSuccess, disabled = false) => {
      if (disabled || pending) return;
      pending = true;
      try {
        if (await action()) {
          pending = false;
          onSuccess();
        }
      } finally {
        pending = false;
      }
    },
  };
}
