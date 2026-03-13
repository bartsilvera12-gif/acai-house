"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUsuarios, toggleEstadoUsuario } from "@/lib/usuarios/storage";
import type { AreaUsuario, NivelUsuario, Usuario } from "@/lib/usuarios/types";

// ── Configuraciones de display ────────────────────────────────────────────────

const NIVEL_CFG: Record<NivelUsuario, { label: string; cls: string }> = {
  usuario:        { label: "Usuario",        cls: "bg-gray-100    text-gray-600"    },
  supervisor:     { label: "Supervisor",     cls: "bg-blue-100    text-blue-700"    },
  administrador:  { label: "Administrador",  cls: "bg-violet-100  text-violet-700"  },
};

const AREA_CFG: Record<AreaUsuario, { label: string; cls: string }> = {
  ventas:         { label: "Ventas",         cls: "bg-sky-50      text-sky-700      border-sky-100"    },
  soporte:        { label: "Soporte",        cls: "bg-gray-50     text-gray-600     border-gray-200"   },
  finanzas:       { label: "Finanzas",       cls: "bg-amber-50    text-amber-700    border-amber-100"  },
  operaciones:    { label: "Operaciones",    cls: "bg-emerald-50  text-emerald-700  border-emerald-100"},
  administracion: { label: "Administración", cls: "bg-violet-50   text-violet-700   border-violet-100" },
};

const AVATAR_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500",
  "bg-amber-500",  "bg-rose-500", "bg-sky-500",
];

function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }
function getInitials(nombre: string) {
  return nombre.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeNivel({ nivel }: { nivel: NivelUsuario }) {
  const { label, cls } = NIVEL_CFG[nivel];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function BadgeArea({ area }: { area: AreaUsuario }) {
  const { label, cls } = AREA_CFG[area];
  return <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>{label}</span>;
}

function BadgeEstado({ estado }: { estado: Usuario["estado"] }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
      estado === "activo" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {estado}
    </span>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function UsuariosPage() {
  const [usuarios,  setUsuarios]  = useState<Usuario[]>([]);
  const [busqueda,  setBusqueda]  = useState("");
  const [filtroNivel, setFiltroNivel] = useState<"" | NivelUsuario>("");
  const [filtroArea,  setFiltroArea]  = useState<"" | AreaUsuario>("");
  const [filtroEst,   setFiltroEst]   = useState<"" | "activo" | "inactivo">("");

  useEffect(() => { setUsuarios(getUsuarios()); }, []);

  const filtrados = usuarios.filter((u) => {
    const q = busqueda.toLowerCase();
    if (q) {
      const campos = [
        u.codigo_usuario, u.nombre, u.email, u.telefono ?? "",
        NIVEL_CFG[u.nivel].label, AREA_CFG[u.area].label,
      ].join(" ").toLowerCase();
      if (!campos.includes(q)) return false;
    }
    if (filtroNivel && u.nivel  !== filtroNivel) return false;
    if (filtroArea  && u.area   !== filtroArea)  return false;
    if (filtroEst   && u.estado !== filtroEst)   return false;
    return true;
  });

  function handleToggleEstado(u: Usuario) {
    toggleEstadoUsuario(u.id, u.estado === "activo" ? "inactivo" : "activo");
    setUsuarios(getUsuarios());
  }

  const hayFiltros = !!(busqueda || filtroNivel || filtroArea || filtroEst);

  return (
    <div className="space-y-6">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestión de personal y control de accesos</p>
        </div>
        <Link
          href="/usuarios/nuevo"
          className="inline-flex items-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Nuevo usuario
        </Link>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre, email, área…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          />
        </div>

        <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as typeof filtroNivel)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white">
          <option value="">Todos los niveles</option>
          <option value="usuario">Usuario</option>
          <option value="supervisor">Supervisor</option>
          <option value="administrador">Administrador</option>
        </select>

        <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value as typeof filtroArea)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white">
          <option value="">Todas las áreas</option>
          <option value="ventas">Ventas</option>
          <option value="soporte">Soporte</option>
          <option value="finanzas">Finanzas</option>
          <option value="operaciones">Operaciones</option>
          <option value="administracion">Administración</option>
        </select>

        <select value={filtroEst} onChange={(e) => setFiltroEst(e.target.value as typeof filtroEst)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white">
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>

        {hayFiltros && (
          <button onClick={() => { setBusqueda(""); setFiltroNivel(""); setFiltroArea(""); setFiltroEst(""); }}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors px-2 py-1">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Contador */}
      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-700">{filtrados.length}</span> de{" "}
        <span className="font-semibold text-gray-700">{usuarios.length}</span> usuarios
      </p>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No se encontraron usuarios con los filtros aplicados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Código", "Usuario", "Email", "Nivel", "Área", "IPS", "Estado", "Acciones"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtrados.map((usr) => (
                <tr key={usr.id} className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${usr.estado === "inactivo" ? "opacity-60" : ""}`}>

                  {/* Código */}
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-500 whitespace-nowrap">
                    {usr.codigo_usuario}
                  </td>

                  {/* Avatar + Nombre */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(usr.id)}`}>
                        {getInitials(usr.nombre)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{usr.nombre}</p>
                        {usr.telefono && <p className="text-xs text-gray-400">{usr.telefono}</p>}
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[180px]">{usr.email}</td>

                  {/* Nivel */}
                  <td className="px-4 py-3"><BadgeNivel nivel={usr.nivel} /></td>

                  {/* Área */}
                  <td className="px-4 py-3"><BadgeArea area={usr.area} /></td>

                  {/* IPS */}
                  <td className="px-4 py-3">
                    {usr.ips ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                        </svg>
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3"><BadgeEstado estado={usr.estado} /></td>

                  {/* Acciones */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/usuarios/${usr.id}`} title="Ver usuario"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                          <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                        </svg>
                      </Link>
                      <Link href={`/usuarios/${usr.id}?edit=1`} title="Editar usuario"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                        </svg>
                      </Link>
                      <button type="button"
                        title={usr.estado === "activo" ? "Desactivar usuario" : "Activar usuario"}
                        onClick={() => handleToggleEstado(usr)}
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                          usr.estado === "activo"
                            ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
                            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                        }`}>
                        {usr.estado === "activo" ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
