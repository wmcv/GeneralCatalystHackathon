import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Replay",
  description: "Agents should explore once. Then remember how.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
