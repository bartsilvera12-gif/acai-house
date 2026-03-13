"use client";

import { useEffect, useState } from "react";
import { getConfig, saveConfig, resetConfig } from "@/lib/config/storage";
import type { ConfigGlobal, FormatoFecha, IdiomaDefault, MonedaBase, Timezone } from "@/lib/config/types";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Tab = "facturacion" | "politicas" | "preferencias" | "metricas";

// ── Helpers UI ────────────────────────────────────────────────────────────────

const fLabel  = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";
const fSelect = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 pb-2 border-b border-gray-100">
      {children}
    </h4>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{children}</p>;
}

function MetricCard({
  label, value, sub,
}: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-800 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const [tab,       setTab]       = useState<Tab>("facturacion");
  const [config,    setConfig]    = useState<ConfigGlobal | null>(null);
  const [success,   setSuccess]   = useState(false);
  const [showReset, setShowReset] = useState(false);

  type FormState = Omit<ConfigGlobal, "updated_at" | "updated_by">;

  const [form, setForm] = useState<FormState>({
    prefijo_factura:              "FAC-",
    numeracion_inicial:           1,
    dias_vencimiento_default:     30,
    interes_moratorio:            1.5,
    porcentaje_descuento_maximo:  20,
    dias_retencion_cliente:       180,
    max_clientes_por_empresa:     0,
    max_usuarios_por_empresa:     0,
    moneda_base:     "GS",
    timezone:        "America/Asuncion",
    idioma_default:  "es",
    formato_fecha:   "DD/MM/YYYY",
    meta_ventas_mensuales:    50_000_000,
    meta_clientes_nuevos:     10,
    meta_facturacion_mensual: 80_000_000,
    meta_conversion_leads:    25,
  });

  useEffect(() => {
    const cfg = getConfig();
    setConfig(cfg);
    setForm({
      prefijo_factura:             cfg.prefijo_factura,
      numeracion_inicial:          cfg.numeracion_inicial,
      dias_vencimiento_default:    cfg.dias_vencimiento_default,
      interes_moratorio:           cfg.interes_moratorio,
      porcentaje_descuento_maximo: cfg.porcentaje_descuento_maximo,
      dias_retencion_cliente:      cfg.dias_retencion_cliente,
      max_clientes_por_empresa:    cfg.max_clientes_por_empresa,
      max_usuarios_por_empresa:    cfg.max_usuarios_por_empresa,
      moneda_base:    cfg.moneda_base,
      timezone:       cfg.timezone,
      idioma_default: cfg.idioma_default,
      formato_fecha:  cfg.formato_fecha,
      meta_ventas_mensuales:    cfg.meta_ventas_mensuales,
      meta_clientes_nuevos:     cfg.meta_clientes_nuevos,
      meta_facturacion_mensual: cfg.meta_facturacion_mensual,
      meta_conversion_leads:    cfg.meta_conversion_leads,
    });
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "number" ? parseFloat(value) || 0 : value,
    }));
  }

  function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    const saved = saveConfig(form);
    setConfig(saved);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  function handleReset() {
    const cfg = resetConfig();
    setConfig(cfg);
    setForm({
      prefijo_factura:             cfg.prefijo_factura,
      numeracion_inicial:          cfg.numeracion_inicial,
      dias_vencimiento_default:    cfg.dias_vencimiento_default,
      interes_moratorio:           cfg.interes_moratorio,
      porcentaje_descuento_maximo: cfg.porcentaje_descuento_maximo,
      dias_retencion_cliente:      cfg.dias_retencion_cliente,
      max_clientes_por_empresa:    cfg.max_clientes_por_empresa,
      max_usuarios_por_empresa:    cfg.max_usuarios_por_empresa,
      moneda_base:    cfg.moneda_base,
      timezone:       cfg.timezone,
      idioma_default: cfg.idioma_default,
      formato_fecha:  cfg.formato_fecha,
      meta_ventas_mensuales:    cfg.meta_ventas_mensuales,
      meta_clientes_nuevos:     cfg.meta_clientes_nuevos,
      meta_facturacion_mensual: cfg.meta_facturacion_mensual,
      meta_conversion_leads:    cfg.meta_conversion_leads,
    });
    setShowReset(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  if (!config) {
    return <div className="flex items-center justify-center py-24 text-sm text-gray-400">Cargando configuración…</div>;
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "facturacion",  label: "Facturación",           icon: "🧾" },
    { id: "politicas",    label: "Políticas del sistema",  icon: "📋" },
    { id: "preferencias", label: "Preferencias",           icon: "⚙️" },
    { id: "metricas",     label: "Métricas",               icon: "🎯" },
  ];

  const facturaPreview = `${form.prefijo_factura}${String(form.numeracion_inicial).padStart(6, "0")}`;

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración Global</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Parámetros globales que aplican a todo el sistema NEURA ERP
          </p>
        </div>
        {config.updated_at && (
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400">Última actualización</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">
              {new Date(config.updated_at).toLocaleString("es-PY")}
            </p>
            {config.updated_by && (
              <p className="text-xs text-gray-400 mt-0.5">por {config.updated_by}</p>
            )}
          </div>
        )}
      </div>

      {/* Banner éxito */}
      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
          </svg>
          Configuración guardada correctamente.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
              tab === t.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}>
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Formulario ──────────────────────────────────────────────── */}
      <form onSubmit={handleGuardar} className="space-y-5">

        {/* ══ TAB: FACTURACIÓN ══════════════════════════════════════ */}
        {tab === "facturacion" && (
          <>
            <Card>
              <SectionTitle>Numeración de documentos</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Prefijo de factura</label>
                  <input type="text" name="prefijo_factura" value={form.prefijo_factura}
                    onChange={handleChange} placeholder="FAC-" className={fInput} />
                  <HelpText>Prefijo que antecede al número correlativo (ej: FAC-, FT-, VTA-).</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Numeración inicial</label>
                  <input type="number" name="numeracion_inicial" value={form.numeracion_inicial}
                    onChange={handleChange} min={1} step={1} className={fInput} />
                  <HelpText>Número desde el cual comienza la secuencia de facturas.</HelpText>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-xs text-gray-500">Vista previa:</span>
                <span className="font-mono text-sm font-bold text-gray-800 bg-white px-3 py-1 rounded border border-gray-200">
                  {facturaPreview}
                </span>
                <span className="text-xs text-gray-400">→</span>
                <span className="font-mono text-xs text-gray-500">
                  {form.prefijo_factura}{String(form.numeracion_inicial + 1).padStart(6, "0")}
                </span>
              </div>
            </Card>

            <Card>
              <SectionTitle>Condiciones de pago</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Días de vencimiento por defecto</label>
                  <div className="relative">
                    <input type="number" name="dias_vencimiento_default"
                      value={form.dias_vencimiento_default}
                      onChange={handleChange} min={0} max={365} step={1} className={fInput} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">días</span>
                  </div>
                  <HelpText>Plazo aplicado automáticamente a facturas a crédito sin plazo definido.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Interés moratorio</label>
                  <div className="relative">
                    <input type="number" name="interes_moratorio" value={form.interes_moratorio}
                      onChange={handleChange} min={0} max={100} step={0.1} className={fInput} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">% mens.</span>
                  </div>
                  <HelpText>Porcentaje mensual aplicado sobre el saldo vencido impago.</HelpText>
                </div>
              </div>
            </Card>

            {/* Resumen facturación */}
            <Card>
              <SectionTitle>Resumen actual</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label="Prefijo"      value={config.prefijo_factura} />
                <MetricCard label="Nro. inicial" value={config.numeracion_inicial} />
                <MetricCard label="Vencimiento"  value={`${config.dias_vencimiento_default} días`} />
                <MetricCard label="Interés mora" value={`${config.interes_moratorio}% mens.`} />
              </div>
            </Card>
          </>
        )}

        {/* ══ TAB: POLÍTICAS DEL SISTEMA ════════════════════════════ */}
        {tab === "politicas" && (
          <>
            <Card>
              <SectionTitle>Control comercial</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Descuento máximo permitido</label>
                  <div className="relative">
                    <input type="number" name="porcentaje_descuento_maximo"
                      value={form.porcentaje_descuento_maximo}
                      onChange={handleChange} min={0} max={100} step={0.5} className={fInput} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                  </div>
                  <HelpText>Porcentaje máximo que cualquier usuario puede aplicar como descuento en ventas. 0 = sin descuento.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Días de retención de cliente</label>
                  <div className="relative">
                    <input type="number" name="dias_retencion_cliente"
                      value={form.dias_retencion_cliente}
                      onChange={handleChange} min={0} step={1} className={fInput} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">días</span>
                  </div>
                  <HelpText>Días de inactividad antes de que un cliente sea marcado como inactivo automáticamente. 0 = desactivado.</HelpText>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle>Límites por empresa</SectionTitle>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                Define el máximo de registros permitidos por empresa dentro de la plataforma.
                Ingresa <strong>0</strong> para indicar que el límite es <strong>ilimitado</strong>.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Máximo de clientes por empresa</label>
                  <input type="number" name="max_clientes_por_empresa"
                    value={form.max_clientes_por_empresa}
                    onChange={handleChange} min={0} step={1} placeholder="0 = ilimitado" className={fInput} />
                  <HelpText>Límite de clientes que puede registrar cada empresa en el sistema.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Máximo de usuarios por empresa</label>
                  <input type="number" name="max_usuarios_por_empresa"
                    value={form.max_usuarios_por_empresa}
                    onChange={handleChange} min={0} step={1} placeholder="0 = ilimitado" className={fInput} />
                  <HelpText>Límite de usuarios activos que puede gestionar cada empresa.</HelpText>
                </div>
              </div>
            </Card>

            {/* Resumen políticas */}
            <Card>
              <SectionTitle>Resumen actual</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label="Descuento máx."
                  value={`${config.porcentaje_descuento_maximo}%`}
                  sub={config.porcentaje_descuento_maximo === 0 ? "Sin descuento" : undefined}
                />
                <MetricCard
                  label="Retención cliente"
                  value={config.dias_retencion_cliente === 0 ? "Desactivado" : `${config.dias_retencion_cliente} días`}
                />
                <MetricCard
                  label="Máx. clientes"
                  value={config.max_clientes_por_empresa === 0 ? "Ilimitado" : config.max_clientes_por_empresa}
                />
                <MetricCard
                  label="Máx. usuarios"
                  value={config.max_usuarios_por_empresa === 0 ? "Ilimitado" : config.max_usuarios_por_empresa}
                />
              </div>
            </Card>
          </>
        )}

        {/* ══ TAB: PREFERENCIAS DEL SISTEMA ═════════════════════════ */}
        {tab === "preferencias" && (
          <>
            <Card>
              <SectionTitle>Moneda y región</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Moneda base del sistema</label>
                  <select name="moneda_base" value={form.moneda_base}
                    onChange={handleChange} className={fSelect}>
                    <option value="GS">Guaraníes (GS)</option>
                    <option value="USD">Dólares (USD)</option>
                    <option value="BRL">Reales (BRL)</option>
                    <option value="ARS">Pesos argentinos (ARS)</option>
                  </select>
                  <HelpText>Moneda utilizada por defecto en todos los módulos financieros.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Formato de fecha</label>
                  <select name="formato_fecha" value={form.formato_fecha}
                    onChange={handleChange} className={fSelect}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY (ej: 09/03/2026)</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY (ej: 03/09/2026)</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD (ej: 2026-03-09)</option>
                  </select>
                  <HelpText>Formato de presentación de fechas en toda la interfaz.</HelpText>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle>Localización</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Zona horaria</label>
                  <select name="timezone" value={form.timezone}
                    onChange={handleChange} className={fSelect}>
                    <option value="America/Asuncion">América/Asunción (Paraguay, UTC-4)</option>
                    <option value="America/Sao_Paulo">América/São Paulo (Brasil, UTC-3)</option>
                    <option value="America/Buenos_Aires">América/Buenos Aires (Argentina, UTC-3)</option>
                    <option value="America/Lima">América/Lima (Perú, UTC-5)</option>
                    <option value="America/Bogota">América/Bogotá (Colombia, UTC-5)</option>
                  </select>
                  <HelpText>Zona horaria usada para registrar fechas y horas en el sistema.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Idioma por defecto</label>
                  <select name="idioma_default" value={form.idioma_default}
                    onChange={handleChange} className={fSelect}>
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="pt">Português</option>
                  </select>
                  <HelpText>Idioma predeterminado para nuevos usuarios del sistema.</HelpText>
                </div>
              </div>
            </Card>

            {/* Resumen preferencias */}
            <Card>
              <SectionTitle>Configuración activa</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label="Moneda base"   value={config.moneda_base} />
                <MetricCard label="Formato fecha" value={config.formato_fecha} />
                <MetricCard label="Zona horaria"  value={config.timezone.split("/")[1] ?? config.timezone} />
                <MetricCard label="Idioma"        value={{ es: "Español", en: "English", pt: "Português" }[config.idioma_default]} />
              </div>
            </Card>

            {/* Zona peligrosa */}
            <Card>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-red-50">
                <span className="text-base">⚠️</span>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Zona peligrosa</h4>
              </div>
              {!showReset ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Restaurar valores por defecto</p>
                    <p className="text-xs text-gray-400 mt-0.5">Restablece toda la configuración global a los valores originales del sistema.</p>
                  </div>
                  <button type="button" onClick={() => setShowReset(true)}
                    className="shrink-0 ml-4 text-sm text-red-600 hover:text-red-800 font-medium border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors">
                    Restaurar
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-red-700 font-medium">
                    ¿Confirmar restauración de toda la configuración global a valores por defecto? Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-3">
                    <button type="button" onClick={handleReset}
                      className="text-sm font-semibold bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors">
                      Sí, restaurar
                    </button>
                    <button type="button" onClick={() => setShowReset(false)}
                      className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </Card>

          </>
        )}

        {/* ══ TAB: MÉTRICAS ════════════════════════════════════════ */}
        {tab === "metricas" && (
          <>
            <Card>
              <SectionTitle>Metas comerciales</SectionTitle>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                Define los objetivos mensuales del equipo. Estos valores se usarán como referencia
                en el Dashboard para mostrar el progreso hacia cada meta.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Meta de ventas mensuales (Gs.)</label>
                  <input type="number" name="meta_ventas_mensuales"
                    value={form.meta_ventas_mensuales}
                    onChange={handleChange} min={0} step={1000} className={fInput} />
                  <HelpText>Ingreso total en ventas esperado cada mes.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Meta de clientes nuevos / mes</label>
                  <input type="number" name="meta_clientes_nuevos"
                    value={form.meta_clientes_nuevos}
                    onChange={handleChange} min={0} step={1} className={fInput} />
                  <HelpText>Cantidad de nuevos clientes a incorporar mensualmente.</HelpText>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle>Metas financieras</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fLabel}>Meta de facturación mensual (Gs.)</label>
                  <input type="number" name="meta_facturacion_mensual"
                    value={form.meta_facturacion_mensual}
                    onChange={handleChange} min={0} step={1000} className={fInput} />
                  <HelpText>Monto total de facturas emitidas esperado al mes.</HelpText>
                </div>
                <div>
                  <label className={fLabel}>Meta de conversión de leads (%)</label>
                  <div className="relative">
                    <input type="number" name="meta_conversion_leads"
                      value={form.meta_conversion_leads}
                      onChange={handleChange} min={0} max={100} step={0.5} className={fInput} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                  </div>
                  <HelpText>Porcentaje objetivo de leads que deben convertirse en clientes.</HelpText>
                </div>
              </div>
            </Card>

            {/* Resumen metas */}
            <Card>
              <SectionTitle>Metas configuradas actualmente</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label="Ventas / mes"      value={`Gs. ${config.meta_ventas_mensuales.toLocaleString("es-PY")}`} />
                <MetricCard label="Clientes nuevos"   value={config.meta_clientes_nuevos} sub="por mes" />
                <MetricCard label="Facturación / mes" value={`Gs. ${config.meta_facturacion_mensual.toLocaleString("es-PY")}`} />
                <MetricCard label="Conversión leads"  value={`${config.meta_conversion_leads}%`} sub="objetivo" />
              </div>
            </Card>
          </>
        )}

        {/* ── Botón guardar (siempre visible) ─────────────────────── */}
        <div className="flex items-center gap-4 pt-2">
          <button type="submit"
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm active:scale-95">
            Guardar configuración
          </button>
          <p className="text-xs text-gray-400">
            Los cambios se aplican de inmediato en todo el sistema.
          </p>
        </div>

      </form>
    </div>
  );
}
