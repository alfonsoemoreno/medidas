import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Escala y Medición",
  description: "Calibración y medición en imágenes de microscopio con una interfaz clara y práctica.",
  applicationName: "Escala y Medición",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
