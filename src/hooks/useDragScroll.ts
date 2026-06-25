"use client";

import { useEffect, useRef } from "react";

/**
 * Drag-to-scroll horizontal con el mouse. Click + arrastre sobre el fondo del
 * contenedor desplaza el contenido. Ignora elementos marcados con
 * `data-no-drag-scroll` (típicamente tarjetas con su propio drag, ej. dnd-kit).
 *
 * Devuelve un ref para asignar al contenedor scrollable.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let startY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;
    let moved = false;

    const onMouseDown = (e: MouseEvent) => {
      // Solo botón principal del mouse.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      // Si el click viene de una tarjeta arrastrable u otro control, no robamos el evento.
      if (target?.closest("[data-no-drag-scroll]")) return;
      // Ignorar inputs/botones/links para no romper interacción normal.
      if (target?.closest("button, a, input, textarea, select, [role='button']")) return;

      isDown = true;
      moved = false;
      startX = e.pageX;
      startY = e.pageY;
      scrollStartX = el.scrollLeft;
      scrollStartY = el.scrollTop;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return;
      const dx = e.pageX - startX;
      const dy = e.pageY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      el.scrollLeft = scrollStartX - dx;
      el.scrollTop = scrollStartY - dy;
    };

    const end = () => {
      if (!isDown) return;
      isDown = false;
      el.style.cursor = "";
      el.style.userSelect = "";
    };

    const onClickCapture = (e: MouseEvent) => {
      // Evita que el "click" sintético posterior al arrastre dispare acciones
      // del fondo (ej. abrir modales) cuando hubo desplazamiento real.
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    };

    // Wheel vertical → scroll horizontal. En kanbans anchos (más columnas que
    // pantalla) la rueda del mouse "natural" no ayuda a moverse de izquierda
    // a derecha; este handler convierte deltaY → scrollLeft cuando hay overflow
    // horizontal y la rueda viene mayormente en eje vertical (mouse normal o
    // touchpad gestureando arriba/abajo). Si el usuario ya viene scrolleando
    // en eje X (touchpad horizontal), respeta el delta nativo.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absY > absX) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", end);
    window.addEventListener("mouseleave", end);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("mouseleave", end);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return ref;
}
