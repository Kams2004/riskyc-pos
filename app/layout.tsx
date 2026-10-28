import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riskyc POS",
  description: "Riskyc Fashion point of sale",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
