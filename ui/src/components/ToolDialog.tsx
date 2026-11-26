import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '../locale-context';

interface ToolDialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
  busy?: boolean;
}

/** The top-layer dialog provides browser-managed inertness and keyboard containment. */
export function ToolDialog({ title, description, onClose, children, footer, wide, busy }: ToolDialogProps) {
  const { tr, direction } = useLocale();
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'wa-tool-dialog wa-tool-wide' : 'wa-tool-dialog'} dir={direction}
      aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="wa-tool-shell">
        <div className="wa-tool-header">
          <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          <button type="button" className="wa-tool-close" aria-label={tr('إغلاق', 'Close')} disabled={busy} onClick={onClose}><X size={20} /></button>
        </div>
        <div className="wa-tool-body">{children}</div>
        <div className="wa-tool-footer">{footer}</div>
      </div>
    </dialog>
  );
}

interface ConfirmActionProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmAction({ title, description, confirmLabel, onConfirm, onClose }: ConfirmActionProps) {
  const { tr } = useLocale();
  return <ToolDialog title={title} description={description} onClose={onClose} footer={<>
    <button type="button" className="wa-tool-button" onClick={onClose}>{tr('إلغاء', 'Cancel')}</button>
    <button type="button" className="wa-tool-button wa-tool-danger" onClick={onConfirm}>{confirmLabel}</button>
  </>}><p className="wa-tool-note">{tr('لن يتم تنفيذ الإجراء قبل تأكيدك.', 'Nothing will change until you confirm.')}</p></ToolDialog>;
}
