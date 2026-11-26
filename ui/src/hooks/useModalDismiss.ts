import { useEffect, useRef } from 'react';

const focusableControls = 'a[href], button, input, select, textarea, [tabindex]';

export function useModalDismiss(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableControls) ?? [])
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);

    if (dialog) {
      document.body.style.overflow = 'hidden';
      (controls()[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
      if (!dialog || event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!(active instanceof HTMLElement) || !items.includes(active) ||
        (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (dialog) {
        document.body.style.overflow = previousOverflow;
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      }
    };
  }, [isOpen]);

  return dialogRef;
}
