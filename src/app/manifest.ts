import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Escala y Medición",
    short_name: "EscalaMed",
    description: "Calibración y medición visual para imágenes de microscopio.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9fd",
    theme_color: "#111f50",
    icons: [
      {
        src: "/icon-144.png",
        sizes: "144x144",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    screenshots: [
      {
        src: "/pwa-screenshot-wide.png",
        sizes: "1440x1024",
        type: "image/png",
        form_factor: "wide",
        label: "Vista de escritorio con calibracion, mediciones y paneles laterales.",
      },
      {
        src: "/pwa-screenshot-mobile.png",
        sizes: "390x844",
        type: "image/png",
        label: "Vista movil de la aplicacion con visor, controles y panel de trabajo.",
      },
    ],
  };
}
