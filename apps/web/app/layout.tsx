"use client";
import "./globals.css";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAppStore } from "../lib/store";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/projects", label: "Proyectos", icon: "📁" },
  { href: "/runs", label: "Ejecuciones", icon: "⚡" },
  { href: "/analytics", label: "Analíticas", icon: "📈" },
  { href: "/audit", label: "Auditoría", icon: "🔒" },
  { href: "/billing", label: "Facturación", icon: "💳" },
  { href: "/settings", label: "Ajustes", icon: "⚙️" },
  { href: "/admin", label: "Admin", icon: "🛡️" },
  { href: "/support", label: "Soporte", icon: "💬" },
];

const publicPaths = ["/", "/login", "/register"];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useAppStore((s) => s.auth);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isPublic = publicPaths.includes(pathname) || pathname === "/";

  if (isPublic) {
    return (
      <html lang="es">
        <head>
          <style>{`
            .gradient-text { background: linear-gradient(135deg, #6366f1, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
          `}</style>
        </head>
        <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
      </html>
    );
  }

  return (
    <html lang="es">
      <head>
        <style>{`
          .gradient-text { background: linear-gradient(135deg, #6366f1, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        `}</style>
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className={`
            fixed inset-y-0 left-0 z-50 w-60 bg-slate-950 border-r border-slate-800 flex flex-col
            transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}>
            <div className="px-6 py-5 border-b border-slate-800">
              <div className="text-xl font-bold gradient-text">AI Dev Assistant</div>
              {auth && (
                <div className="text-xs text-slate-500 mt-1 truncate">{auth.email}</div>
              )}
            </div>
            <nav className="flex-1 overflow-y-auto py-4 px-3">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 transition ${
                      active
                        ? "bg-indigo-500/10 text-indigo-400"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </a>
                );
              })}
            </nav>
            <div className="px-4 py-3 border-t border-slate-800">
              <a href="/" className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition px-2 py-1.5">
                <span>🏠</span> Landing Page
              </a>
              <a href="/login" className="flex items-center gap-2 text-xs text-slate-500 hover:text-red-400 transition px-2 py-1.5">
                <span>🚪</span> {auth ? "Cerrar sesión" : "Iniciar sesión"}
              </a>
            </div>
          </aside>

          {/* Overlay for mobile sidebar */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top bar */}
            <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur border-b border-slate-800 px-4 lg:px-6 py-3 flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden text-2xl"
              >
                ☰
              </button>
              <div className="flex-1" />
              {auth ? (
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-medium">{auth.email.split("@")[0]}</div>
                    <div className="text-xs text-slate-500">Conectado</div>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white">
                    {auth.email[0]?.toUpperCase()}
                  </div>
                </div>
              ) : (
                <a href="/login" className="text-sm text-indigo-400 hover:text-indigo-300 transition">
                  Iniciar sesión
                </a>
              )}
            </header>
            <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
