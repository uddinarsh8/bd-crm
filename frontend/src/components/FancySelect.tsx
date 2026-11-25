import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type OptionProps = { value?: string; children?: ReactNode; disabled?: boolean };
type SelectChange = { target: { value: string } };
type Props = {
  value: string;
  onChange: (event: SelectChange) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  id?: string;
};

export function FancySelect({ value, onChange, children, className = 'input', disabled = false, required = false, placeholder, ...ariaProps }: Props) {
  const selectId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    const label = child.props.children;
    const optionValue = child.props.value ?? (typeof label === 'string' || typeof label === 'number' ? String(label) : '');
    return [{ value: optionValue, label, disabled: Boolean(child.props.disabled) }];
  });
  const selected = options.find(option => option.value === value);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const maxHeight = Math.min(280, window.innerHeight - 24);
    const naturalHeight = Math.min(options.length * 42 + 12, maxHeight);
    const below = window.innerHeight - rect.bottom - 12;
    const top = below >= Math.min(naturalHeight, 150) || rect.top < naturalHeight + 24
      ? Math.min(rect.bottom + 6, window.innerHeight - naturalHeight - 12)
      : Math.max(12, rect.top - naturalHeight - 6);
    setPosition({ top, left, width, maxHeight });
  }

  function openMenu() {
    if (disabled) return;
    setActiveIndex(Math.max(0, options.findIndex(option => option.value === value)));
    updatePosition();
    setOpen(true);
  }

  function choose(option: typeof options[number]) {
    if (option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const reposition = () => updatePosition();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, options.length]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); openMenu(); return;
    }
    if (!open) return;
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let index = activeIndex;
      for (let count = 0; count < options.length; count++) {
        index = (index + direction + options.length) % options.length;
        if (!options[index]?.disabled) break;
      }
      setActiveIndex(index);
    } else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(options.findIndex(option => !option.disabled)); }
    else if (event.key === 'End') { event.preventDefault(); let index = options.length - 1; while (index >= 0 && options[index]?.disabled) index--; setActiveIndex(Math.max(0, index)); }
    else if (event.key === 'Enter') { event.preventDefault(); const option = options[activeIndex]; if (option) choose(option); }
  }

  return <>
    <span className="fancy-select-wrap">
      {required && <select className="fancy-select-validation" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => undefined} onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); openMenu(); }}><option value="" />{options.map((option, index) => <option key={`${option.value}-${index}`} value={option.value}>{typeof option.label === 'string' || typeof option.label === 'number' ? option.label : option.value}</option>)}</select>}
      <button ref={triggerRef} type="button" id={ariaProps.id} className={`fancy-select-trigger ${className} ${open ? 'is-open' : ''}`} disabled={disabled} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${selectId}-list`} aria-activedescendant={open ? `${selectId}-option-${activeIndex}` : undefined} aria-required={required || undefined} aria-label={ariaProps['aria-label']} onClick={() => open ? setOpen(false) : openMenu()} onKeyDown={onKeyDown}>
        <span className={`fancy-select-value ${!selected ? 'is-placeholder' : ''}`}>{selected?.label ?? placeholder ?? 'Choose an option'}</span>
        <ChevronDown className="fancy-select-chevron" size={16} aria-hidden="true" />
      </button>
    </span>
    {open && createPortal(<div ref={menuRef} id={`${selectId}-list`} className="fancy-select-menu" role="listbox" aria-label={ariaProps['aria-label'] || 'Options'} style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
      {options.map((option, index) => <button type="button" id={`${selectId}-option-${index}`} role="option" aria-selected={value === option.value} disabled={option.disabled} key={`${option.value}-${index}`} className={`fancy-select-option ${value === option.value ? 'is-selected' : ''} ${activeIndex === index ? 'is-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}><span>{option.label}</span>{value === option.value && <Check size={15} aria-hidden="true" />}</button>)}
    </div>, document.body)}
  </>;
}
