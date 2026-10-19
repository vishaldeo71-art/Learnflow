import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Learnflow | AI Learning Assistant",
  description: "Watch, pause, ask, understand and practice with course grounded AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

