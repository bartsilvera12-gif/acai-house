"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Context para sincronizar el loader inicial + el estado del Sidebar mobile.
 *
 * - sidebarReady: el Sidebar ya cargo modulos (loader inicial puede cerrarse).
 * - mobileSidebarOpen: el Sidebar esta abierto como drawer en mobile.
 *
 * El loader del AuthGuard espera sidebarReady para desaparecer.
 * El Header expone un boton hamburger que abre/cierra mobileSidebarOpen.
 * El Sidebar lee mobileSidebarOpen para renderizarse fijo o como drawer.
 */
type BootContextValue = {
  sidebarReady: boolean;
  setSidebarReady: (v: boolean) => void;
  /** El dashboard reporta cuando terminó su fetch inicial. Solo se mira en `/`. */
  dashboardReady: boolean;
  setDashboardReady: (v: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (v: boolean) => void;
};

const BootContext = createContext<BootContextValue>({
  sidebarReady: false,
  setSidebarReady: () => {},
  dashboardReady: false,
  setDashboardReady: () => {},
  mobileSidebarOpen: false,
  setMobileSidebarOpen: () => {},
});

export function BootProvider({ children }: { children: ReactNode }) {
  const [sidebarReady, setSidebarReady] = useState(false);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // useMemo evita crear un objeto nuevo en cada render del Provider:
  // sin esto, todos los consumers (Sidebar, Header, AuthGuard) se re-renderizaban
  // por cualquier cambio del shell, aunque sus props no cambiaran.
  const value = useMemo(
    () => ({
      sidebarReady, setSidebarReady,
      dashboardReady, setDashboardReady,
      mobileSidebarOpen, setMobileSidebarOpen,
    }),
    [sidebarReady, dashboardReady, mobileSidebarOpen],
  );
  return (
    <BootContext.Provider value={value}>
      {children}
    </BootContext.Provider>
  );
}

export function useBoot() {
  return useContext(BootContext);
}
