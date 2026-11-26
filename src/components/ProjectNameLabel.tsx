import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getProjectDisplayName, hasDistinctShortName } from '../utils/projectMeta';

export interface ProjectNameLike {
  name?: string | null;
  shortName?: string | null;
}

export interface UseProjectNameTooltipOptions {
  placement?: 'top' | 'bottom';
  prefix?: string;
}

export function useProjectNameTooltip(
  project: ProjectNameLike | null | undefined,
  options?: UseProjectNameTooltipOptions
) {
  const displayName = getProjectDisplayName(project);
  const fullName = typeof project?.name === 'string' ? project.name.trim() : '';
  const hasTooltip = hasDistinctShortName(project);
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const lastPointerTypeRef = useRef<string>('mouse');

  const open = useCallback(() => {
    if (hasTooltip) setIsOpen(true);
  }, [hasTooltip]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!hasTooltip) {
      setIsOpen(false);
    }
  }, [hasTooltip]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const placement = options?.placement ?? 'bottom';
  const prefix = options?.prefix ?? 'Pełna nazwa: ';

  const triggerHandlers = hasTooltip
    ? {
        'aria-describedby': isOpen ? tooltipId : undefined,
        onMouseEnter: open,
        onMouseLeave: close,
        onFocus: open,
        onBlur: close,
        onPointerDown: (e: React.PointerEvent) => {
          lastPointerTypeRef.current = e.pointerType || 'mouse';
        },
        onClick: () => {
          if (lastPointerTypeRef.current === 'touch') {
            setIsOpen((prev) => !prev);
          }
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Escape' && isOpen) {
            e.stopPropagation();
            close();
          }
        },
      }
    : {};

  const tooltipNode =
    hasTooltip && isOpen ? (
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute left-0 z-[90] w-max max-w-xs sm:max-w-sm rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white shadow-xl dark:border-slate-300 dark:bg-slate-100 dark:text-slate-900 whitespace-normal break-words ${
          placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
        }`}
      >
        <span className="sr-only">{prefix}</span>
        {fullName}
      </span>
    ) : null;

  return {
    displayName,
    fullName,
    hasTooltip,
    isOpen,
    tooltipId,
    containerRef,
    triggerHandlers,
    tooltipNode,
    open,
    close,
  };
}

export interface ProjectNameLabelProps {
  project: ProjectNameLike | null | undefined;
  className?: string;
  wrapperClassName?: string;
  placement?: 'top' | 'bottom';
  /** If true (default), renders focusable trigger when shortName differs from name. Set false when nested inside a button. */
  focusable?: boolean;
  /** Optional prefix shown visibly before full name inside tooltip (default: none, screen reader gets 'Pełna nazwa: '). */
  stopClickPropagationOnTouch?: boolean;
}

export const ProjectNameLabel: React.FC<ProjectNameLabelProps> = ({
  project,
  className = '',
  wrapperClassName = '',
  placement = 'bottom',
  focusable = true,
  stopClickPropagationOnTouch = false,
}) => {
  const {
    displayName,
    hasTooltip,
    isOpen,
    tooltipId,
    containerRef,
    triggerHandlers,
    tooltipNode,
    open,
    close,
  } = useProjectNameTooltip(project, { placement });

  if (!hasTooltip) {
    return <span className={className}>{displayName}</span>;
  }

  return (
    <span
      ref={containerRef}
      className={`relative inline-flex max-w-full items-center ${wrapperClassName}`}
    >
      <span
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={isOpen ? tooltipId : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={focusable ? open : undefined}
        onBlur={focusable ? close : undefined}
        onPointerDown={triggerHandlers.onPointerDown}
        onClick={(e) => {
          triggerHandlers.onClick?.();
          if (stopClickPropagationOnTouch) {
            e.stopPropagation();
          }
        }}
        onKeyDown={focusable ? triggerHandlers.onKeyDown : undefined}
        className={`underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 dark:focus-visible:ring-sky-400 rounded-xs cursor-help ${className}`}
      >
        {displayName}
      </span>
      {tooltipNode}
    </span>
  );
};
