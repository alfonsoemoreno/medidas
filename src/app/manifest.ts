import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Escala y Medición",
    short_name: "EscalaMed",
    description: "Calibración y medición visual para imágenes de microscopio.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9fd",
    theme_color: "#111f50",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
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
  };
}
