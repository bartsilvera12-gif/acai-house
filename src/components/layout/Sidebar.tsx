"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getMisModulos, getTodosModulos } from "@/lib/empresas/actions";
import type { ModuloEmpresa } from "@/lib/empresas/actions";

export default function Sidebar() {
  const [modulos, setModulos] = useState<ModuloEmpresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [esSuperAdmin, setEsSuperAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function cargarMenu() {
      try {
        setCargando(true);
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (cancelled || !user?.email) {
          setModulos([]);
          return;
        }

        const { data: usuario } = await supabase
          .from("usuarios")
          .select("rol")
          .eq("email", user.email)
          .single();

        const rol = usuario?.rol;
        if (!cancelled) setEsSuperAdmin(rol === "super_admin");

        const data =
          rol === "super_admin"
            ? await getTodosModulos()
            : await getMisModulos();
        if (cancelled) return;
        setModulos(data);
      } catch {
        if (!cancelled) setModulos([]);
      } finally {
        if (!cancelled) setCargando(false);
      }
    }

    cargarMenu();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) cargarMenu();
      else setModulos([]);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-8">NEURA ERP</h1>

      <nav className="flex flex-col gap-4">
        <Link href="/">Dashboard</Link>

        {cargando ? (
          <span className="text-sm text-gray-400 animate-pulse">Cargando menú…</span>
        ) : (
          modulos
            .filter((m) => m.slug !== "dashboard")
            .map((m) => (
              <Link key={m.id} href={`/${m.slug}`} className="hover:text-gray-300 transition-colors">
                {m.nombre}
              </Link>
            ))
        )}

        {esSuperAdmin && (
          <Link
            href="/admin/empresas"
            className="mt-4 pt-4 border-t border-gray-700 text-amber-400 hover:text-amber-300"
          >
            Admin Empresas
          </Link>
        )}
      </nav>
    </aside>
  );
}
