"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  className?: string;
  children: ReactNode;
};

/**
 * Wrapper que habilita scroll horizontal "agarrando" con el cursor (click+drag).
 * Útil para tablas anchas en desktop, donde mover el scrollbar es fricción.
 * En touch no interfiere (el browser ya maneja el swipe nativo).
 * Activa cursor `grab` / `grabbing`. Si el click no se mueve, deja pasar el
 * evento al hijo (ej: click en un link sigue funcionando).
 */
export default function DragScroll({ className = "", children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let down = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;
    const DRAG_THRESHOLD = 4;

    function onDown(e: MouseEvent) {
      // Solo botón principal y solo si hay overflow real (sin overflow no hay nada que arrastrar).
      if (e.button !== 0 || !el || el.scrollWidth <= el.clientWidth) return;
      down = true;
      moved = false;
      startX = e.pageX;
      startScroll = el.scrollLeft;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
    }
    function onMove(e: MouseEvent) {
      if (!down || !el) return;
      const dx = e.pageX - startX;
      if (!moved && Math.abs(dx) > DRAG_THRESHOLD) moved = true;
      if (moved) {
        e.preventDefault();
        el.scrollLeft = startScroll - dx;
      }
    }
    function onUp(e: MouseEvent) {
      if (!down || !el) return;
      down = false;
      el.style.cursor = "";
      el.style.userSelect = "";
      // Si efectivamente arrastró, suprimir el click sintético que dispara el browser
      // (sino un drag corto se interpreta como click sobre un link/botón hijo).
      if (moved) {
        const block = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.removeEventListener("click", block, true);
        };
        window.addEventListener("click", block, true);
      }
      void e;
    }

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`overflow-x-auto cursor-grab ${className}`}
    >
      {children}
    </div>
  );
}
