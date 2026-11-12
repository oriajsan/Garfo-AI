import { useEffect, type RefObject } from 'react';

/** Closes on Escape, locks body scroll and moves focus into the panel while `open`. */
export function useModal(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose, panelRef]);
}
