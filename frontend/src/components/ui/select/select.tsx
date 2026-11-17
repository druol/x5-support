import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./select.module.css";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  label?: string;
  ariaLabel?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
};

/** Кастомный выпадающий список в стиле дизайн-системы (вместо нативного select). */
export function Select({ label, ariaLabel, name, value, onChange, options, placeholder = "Выберите", className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // фокус на выбранном пункте
    const active = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    (active ?? listRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index + 1];
      next?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index - 1];
      next?.focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[index]!.value);
    }
  };

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")}>
      {label && (
        <span className={styles.label} id={`${id}-label`}>
          {label}
        </span>
      )}
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen(current => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {open && (
        <div ref={listRef} className={styles.panel} role="listbox" aria-labelledby={label ? `${id}-label` : undefined}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value || `empty-${index}`}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                data-selected={isSelected}
                className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
                onClick={() => choose(option.value)}
                onKeyDown={event => onOptionKeyDown(event, index)}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={15} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
