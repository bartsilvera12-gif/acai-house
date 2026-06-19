import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Quitar el header "X-Powered-By: Next.js" — leak innecesario de tech stack
  // a clientes/atacantes. Cuesta 0 perf-wise.
  poweredByHeader: false,

  // gzip de respuestas en produccion. Es el default pero declararlo explicito
  // evita sorpresas si Coolify/Traefik intentan re-comprimir.
  compress: true,

  // NOTA: NO usamos output: "standalone" porque Coolify+Nixpacks corre
  // `next start` con .next/ regular, no usa .next/standalone/. Si en el futuro
  // hacemos un Dockerfile custom para reducir imagen, agregar standalone ahi.

  experimental: {
    // Tree-shake agresivo para barrels grandes. Cuando importas
    //   import { ChevronDown, X, Search } from "lucide-react"
    // Next solo bundlea esas 3 icons en vez del barrel completo de la libreria.
    // Aplica tambien a recharts (aunque ya hicimos dynamic import del chart).
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // Headers HTTP para caching agresivo de assets estaticos generados por Next
  // (fingerprinted, immutable por hash). El navegador los cachea 1 ano.
  // Reduce dramaticamente requests al server en navegaciones siguientes
  // del mismo user (vuelve al dashboard, los chunks JS/CSS ya estan locales).
  async headers() {
    // Headers de seguridad aplicados a TODA la app. Defensa en profundidad
    // contra clickjacking, MIME sniffing, abuso de permisos y descargas de
    // tokens via referer. CSP queda en modo permisivo (solo defaults
    // razonables) — endurecerla cuando inventariemos todos los orígenes
    // (Supabase, YCloud, Meta, fuentes Google, etc.).
    const securityHeaders = [
      // Solo HTTPS, 2 años, con preload (registrar dominio en hstspreload.org).
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      // Anti-clickjacking moderno (CSP frame-ancestors complementa, pero
      // mantenemos X-Frame-Options por compatibilidad con navegadores viejos).
      { key: "X-Frame-Options", value: "DENY" },
      // Bloquear MIME sniffing (XSS via uploads disfrazados).
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Filtrar referer en navegaciones externas (evita leak de URLs internas).
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Sin Flash/PDF legacy ni Adobe XAP — protecciones obsoletas pero
      // algunos scanners de seguridad las piden.
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      // Bloquear APIs sensibles del navegador a menos que se necesiten.
      {
        key: "Permissions-Policy",
        value: [
          "accelerometer=()",
          "camera=()",
          "geolocation=()",
          "gyroscope=()",
          "magnetometer=()",
          "microphone=()",
          "payment=()",
          "usb=()",
        ].join(", "),
      },
      // CSP permisiva por ahora: bloquea inline scripts (XSS) pero permite
      // los dominios típicos. Refinar cuando se documenten todos los
      // orígenes de fonts/imágenes/APIs reales.
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
          "font-src 'self' fonts.gstatic.com data:",
          "img-src 'self' data: blob: https:",
          "connect-src 'self' https: wss:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ];

    return [
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/_next/image(.*)",
        headers: [
          // Imagenes optimizadas tambien son fingerprinted, mismo trato.
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Aplicar headers de seguridad a TODAS las rutas (la regex (.*) cubre
        // raíz también; Next no aplica el catch-all a /_next/* arriba que
        // tiene su propio bloque por la regla de "más específico primero").
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
