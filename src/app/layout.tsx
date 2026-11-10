import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { CommandBar } from "@/components/CommandBar";
import { listProjectNames } from "@/lib/queries";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Project Command Centre",
  description: "Local dashboard for your code projects, with Claude Code built in",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  const projects = listProjectNames();
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full min-h-screen flex-col">
        <Nav />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        <CommandBar projects={projects} />
      </body>
    </html>
  );
}
