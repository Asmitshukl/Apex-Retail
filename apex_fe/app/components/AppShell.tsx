"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/analytics", label: "Analytics" },
  { href: "/add-video", label: "Add Video" },
  { href: "/live", label: "Live" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <div className="border-b border-emerald-100 bg-emerald-50/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-2 text-xs text-slate-600">
          <span className="font-medium text-emerald-700">Apex Store Intelligence</span>
          <span>support@apex-retail.local</span>
        </div>
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-600 font-bold text-white">
              AI
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">Apex Retail</span>
              <span className="block text-xs text-slate-500">CCTV intelligence</span>
            </span>
          </Link>

          <nav className="flex flex-wrap items-center justify-end gap-2">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
