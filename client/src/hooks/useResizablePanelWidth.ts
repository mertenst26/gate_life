import { useState, useCallback, useRef, type PointerEvent, type KeyboardEvent } from 'react';

const MIN = 260;
const MAX = 960;

function clamp(w: number): number {
  let max = MAX;
  if (typeof window !== 'undefined') {
    max = Math.min(MAX, Math.max(MIN + 80, window.innerWidth - 80));
  }
  return Math.max(MIN, Math.min(max, w));
}

function readStored(storageKey: string, defaultWidth: number): number {
  try {
    const v = localStorage.getItem(storageKey);
    if (v) {
      const n = parseInt(v, 10);
      if (!isNaN(n)) return clamp(n);
    }
  } catch {
    /* ignore */
  }
  return clamp(defaultWidth);
}

export function useResizablePanelWidth(storageKey: string, defaultWidth: number) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth));
  const widthRef = useRef(width);
  widthRef.current = width;

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(storageKey, String(widthRef.current));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: widthRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startX - e.clientX;
    setWidth(clamp(dragRef.current.startW + delta));
  }, []);

  const endDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const wasDragging = !!dragRef.current;
      if (wasDragging) {
        dragRef.current = null;
        persist();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [persist],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      endDrag(e);
    },
    [endDrag],
  );

  const onPointerCancel = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      endDrag(e);
    },
    [endDrag],
  );

  const nudgeWidth = useCallback(
    (delta: number) => {
      setWidth(w => {
        const next = clamp(w + delta);
        widthRef.current = next;
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey],
  );

  const onResizeKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudgeWidth(16);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeWidth(-16);
      }
    },
    [nudgeWidth],
  );

  const onLostPointerCapture = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      persist();
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [persist]);

  return {
    width,
    resizeHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onKeyDown: onResizeKeyDown,
    },
  };
}
