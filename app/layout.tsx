import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import { getIndex } from "@/lib/data";

export const metadata: Metadata = {
  title: "Syndicate",
  description: "Syndicate betting tracker and bet queue",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const index = getIndex();
  const datasets = index.sheets.map((s) => ({ slug: s.slug, name: s.name }));
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <NavBar datasets={datasets} />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
