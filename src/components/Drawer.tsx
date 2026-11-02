import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ title, subtitle, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialog} className="detail-drawer" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="drawer-content">
      <header className="drawer-heading"><div>{subtitle && <p>{subtitle}</p>}<h2 id={titleId}>{title}</h2></div>
        <button type="button" className="icon-button" aria-label="상세 패널 닫기" onClick={onClose} autoFocus><X size={21} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}
