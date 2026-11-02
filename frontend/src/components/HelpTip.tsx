import { CircleHelp } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  placement?: 'top' | 'bottom';
}

export function HelpTip({ label, children, placement = 'top' }: Props) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!visible) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [visible]);

  return <span className={`help-tip help-tip-${placement}`}
    onPointerEnter={() => { setHovered(true); setDismissed(false); }}
    onPointerLeave={() => setHovered(false)}
    onFocus={() => { setFocused(true); setDismissed(false); }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
    <button className="help-tip-button" type="button" aria-label={label}
      aria-describedby={visible ? tooltipId : undefined}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    {visible && <span className="help-tip-content" id={tooltipId} role="tooltip">{children}</span>}
  </span>;
}
