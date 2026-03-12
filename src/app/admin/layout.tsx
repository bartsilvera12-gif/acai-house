"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        if (!u) {
          router.push("/login");
          return;
        }
        const rol = (u as { rol?: string }).rol;
        if (rol !== "super_admin") {
          router.push("/");
          return;
        }
        setOk(true);
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-sm text-gray-500">
        Verificando acceso…
      </div>
    );
  }
  if (!ok) return null;
  return <>{children}</>;
}
