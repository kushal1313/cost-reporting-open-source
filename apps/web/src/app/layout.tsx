import type { Metadata } from "next";
import { Suspense } from "react";
import { SidebarNav } from "../components/SidebarNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Platform Dashboard",
  description: "Unified platform dashboard — cost reporting, budget alerting, and more",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <h1>Platform Dashboard</h1>
            <Suspense fallback={null}>
              <SidebarNav />
            </Suspense>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
