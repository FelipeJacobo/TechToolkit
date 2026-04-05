# FASE 4: FRONTEND MODERNO — SaaS UI/UX

## 🎨 Filosofía de Diseño

> "La simplicidad es la máxima sofisticación" — Leonardo da Vinci

El frontend debe sentirse como **Linear** (simple y veloz) con la **profesionalidad de Vercel** (clean, moderna) y la **funcionalidad de Datadog** (visualización de datos rica).

### Principios

1. **Menos es más**: Cada elemento en pantalla tiene un propósito
2. **Velocidad percibida**: Skeleton loaders, optimismo UI, instant transitions
3. **Dark primero**: El dark mode es el default, light es alternativo
4. **Datos claros**: Tablas legibles, charts informativos, sin clutter
5. **Accesibilidad**: WCAG AA minimum, keyboard navigation, screen reader support

---

## 🎨 Design System

### Colores

```css
/* globals.css — CSS Variables */
:root {
  /* Light Mode */
  --background: #ffffff;
  --foreground: #0f0f0f;
  --card: #ffffff;
  --card-border: #e5e7eb;
  --muted: #6b7280;
  --muted-background: #f3f4f6;
  --primary: #2563eb;
  --primary-foreground: #ffffff;
  --primary-hover: #1d4ed8;
  --success: #059669;
  --success-background: #ecfdf5;
  --warning: #d97706;
  --warning-background: #fffbeb;
  --danger: #dc2626;
  --danger-background: #fef2f2;
  --accent: #7c3aed;
  --accent-background: #f5f3ff;
  --radius: 8px;
}

.dark {
  /* Dark Mode — Default para TechToolkit */
  --background: #0a0a0a;
  --foreground: #fafafa;
  --card: #111111;
  --card-border: #262626;
  --muted: #737373;
  --muted-background: #171717;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --primary-hover: #2563eb;
  --success: #34d399;
  --success-background: rgba(5, 150, 105, 0.1);
  --warning: #fbbf24;
  --warning-background: rgba(217, 119, 6, 0.1);
  --danger: #f87171;
  --danger-background: rgba(220, 38, 38, 0.1);
  --accent: #a78bfa;
  --accent-background: rgba(124, 58, 237, 0.1);
  --radius: 8px;
}
```

### Tipografía

```css
:root {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Escala tipográfica */
/* 12px → 14px → 16px → 20px → 24px → 30px → 36px */
```

---

## 🧩 Componentes del Design System

### Estructura de componentes

```
src/components/ui/
├── button.tsx          # Button variants: primary, secondary, ghost, destructive
├── card.tsx            # Card con header, content, footer
├── badge.tsx           # Badge: default, success, warning, danger
├── dialog.tsx          # Modal/Dialog
├── dropdown.tsx        # Dropdown menu
├── input.tsx           # Input con labels, error, icon
├── select.tsx          # Select dropdown
├── table.tsx           # Data table con sorting
├── tabs.tsx            # Tabs navigation
├── skeleton.tsx        # Loading skeleton
├── empty.tsx           # Empty state
├── alert.tsx           # Alert banner
├── toast.tsx           # Toast notification (sonner)
├── tooltip.tsx         # Tooltip
├── progress.tsx        # Progress bar / circular
└── avatar.tsx          # User avatar
```

### Ejemplo: ScoreCard (componente principal del Dashboard)

```tsx
// src/components/dashboard/ScoreCard.tsx
import { cn } from "@/lib/utils";

interface ScoreCardProps {
  score: number;
  previousScore?: number;
  label?: string;
  size?: "sm" | "md" | "lg";
  showRing?: boolean;
}

export function ScoreCard({ score, previousScore, label = "Health Score", size = "lg" }: ScoreCardProps) {
  const diff = previousScore ? score - previousScore : 0;
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const ringColor = score >= 80 ? "stroke-emerald-400" : score >= 50 ? "stroke-amber-400" : "stroke-red-400";

  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;

  const sizes = {
    sm: { text: "text-xl", ring: 48, label: "text-xs" },
    md: { text: "text-3xl", ring: 64, label: "text-sm" },
    lg: { text: "text-5xl", ring: 80, label: "text-sm" },
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width={sizes[size].ring * 2} height={sizes[size].ring * 2} className="-rotate-90">
          <circle
            cx={sizes[size].ring}
            cy={sizes[size].ring}
            r="45"
            className="stroke-neutral-800"
            strokeWidth="6"
            fill="none"
          />
          <circle
            cx={sizes[size].ring}
            cy={sizes[size].ring}
            r="45"
            className={cn(ringColor)}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <div className={cn("absolute inset-0 flex items-center justify-center font-bold", sizes[size].text, color)}>
          {score}
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className={cn("text-neutral-400", sizes[size].label)}>{label}</span>
        {diff !== 0 && (
          <span className={cn("text-xs font-medium", diff > 0 ? "text-emerald-400" : "text-red-400")}>
            {diff > 0 ? "↑" : "↓"} {Math.abs(diff)} pts
          </span>
        )}
      </div>
    </div>
  );
}
```

### Ejemplo: MetricRow (para el dashboard)

```tsx
// src/components/dashboard/MetricRow.tsx
import { cn } from "@/lib/utils";

interface MetricRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: { value: number; direction: "up" | "down" };
  status?: "good" | "warning" | "critical";
  onClick?: () => void;
}

export function MetricRow({ icon, label, value, trend, status = "good", onClick }: MetricRowProps) {
  const statusColors = {
    good: "bg-emerald-500/10 text-emerald-400",
    warning: "bg-amber-500/10 text-amber-400",
    critical: "bg-red-500/10 text-red-400",
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 transition-colors",
        onClick && "cursor-pointer hover:bg-neutral-800/50 hover:border-neutral-700"
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-400">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-neutral-500">{label}</span>
        <span className="text-sm font-medium text-neutral-100">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        {trend && (
          <span className={cn("text-xs font-medium", trend.direction === "up" ? "text-emerald-400" : "text-red-400")}>
            {trend.direction === "up" ? "↑" : "↓"} {trend.value}%
          </span>
        )}
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[status])}>
          {status === "good" ? "OK" : status === "warning" ? "WARN" : "CRIT"}
        </span>
      </div>
    </div>
  );
}
```

---

## 📐 Layout del Dashboard Principal

```tsx
// src/app/(dashboard)/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { ScoreCard } from "@/components/dashboard/ScoreCard";
import { MetricRow } from "@/components/dashboard/MetricRow";
import { ModuleGrid } from "@/components/dashboard/ModuleGrid";
import { ActivityLog } from "@/components/dashboard/ActivityLog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Thermometer,
  Shield,
  Wifi,
  Zap,
  AlertTriangle,
} from "lucide-react";

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.dashboard.getOverview(),
    refetchInterval: 5000, // Actualiza cada 5s si hay device activo
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-8">
          <Skeleton className="h-40 w-40 rounded-full" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-40" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="No se encontraron dispositivos"
        description="Conecta tu dispositivo TechToolkit para ver el dashboard"
        action={{ label: "Descargar TechToolkit", href: "/download" }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Dashboard</h1>
          <p className="text-sm text-neutral-500">
            {data.deviceName} · Última sincronización: {data.lastSync}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleOneClickOptimize}
          disabled={isOptimizing}
          icon={Zap}
        >
          {isOptimizing ? "Optimizando..." : "Optimizar Todo"}
        </Button>
      </div>

      {/* Score + Metrics Row */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <ScoreCard score={data.healthScore} previousScore={data.previousScore} />

        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <MetricRow
            icon={<Cpu className="h-4 w-4" />}
            label="CPU"
            value={`${data.cpu.usage}% · ${data.cpu.model}`}
            status={data.cpu.usage > 90 ? "critical" : data.cpu.usage > 70 ? "warning" : "good"}
            trend={{ value: data.cpu.trend, direction: "down" }}
          />
          <MetricRow
            icon={<MemoryStick className="h-4 w-4" />}
            label="RAM"
            value={`${formatBytes(data.ram.used)} / ${formatBytes(data.ram.total)}`}
            status={data.ram.usagePercent > 90 ? "critical" : data.ram.usagePercent > 70 ? "warning" : "good"}
          />
          <MetricRow
            icon={<HardDrive className="h-4 w-4" />}
            label="Disco"
            value={`${data.disk.usagePercent}% · ${formatBytes(data.disk.free)} libre`}
            status={data.disk.usagePercent > 90 ? "critical" : data.disk.usagePercent > 80 ? "warning" : "good"}
          />
          <MetricRow
            icon={<Thermometer className="h-4 w-4" />}
            label="Temperatura"
            value={`${data.temperature.cpu}°C CPU · ${data.temperature.gpu}°C GPU`}
            status={data.temperature.cpu > 85 ? "critical" : data.temperature.cpu > 70 ? "warning" : "good"}
          />
          <MetricRow
            icon={<Shield className="h-4 w-4" />}
            label="Seguridad"
            value={data.security.status}
            status={data.security.status === "Protegido" ? "good" : "critical"}
          />
          <MetricRow
            icon={<Wifi className="h-4 w-4" />}
            label="Red"
            value={data.network.connection}
            status={data.network.status === "Estable" ? "good" : "warning"}
          />
        </div>
      </div>

      {/* Modules Grid */}
      <ModuleGrid modules={data.suggestedModules} />

      {/* Activity Log */}
      <ActivityLog activities={data.recentActivities} />
    </div>
  );
}
```

---

## 📐 Layout de la App (Sidebar + Header)

```tsx
// src/app/(dashboard)/layout.tsx
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

const navigation = [
  { name: "Dashboard", href: "/", icon: "layout-dashboard", active: true },
  { name: "Módulos", href: "/modules", icon: "grid" },
  { name: "Reportes", href: "/reports", icon: "file-text" },
  { name: "Análisis", href: "/analytics", icon: "bar-chart-3" },
  { name: "Dispositivos", href: "/devices", icon: "monitor" },
  { name: "Licencias", href: "/licenses", icon: "key" },
  { separator: true },
  { name: "Logs", href: "/logs", icon: "list" },
  { name: "Configuración", href: "/settings", icon: "settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#0a0a0a] text-neutral-100">
      <Sidebar navigation={navigation} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

---

## 🌙 Dark/Light Mode Toggle

```tsx
// src/components/layout/ThemeToggle.tsx
"use client";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-md p-2 transition-colors hover:bg-neutral-800"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 text-neutral-400" />
      ) : (
        <Moon className="h-4 w-4 text-neutral-400" />
      )}
    </button>
  );
}
```

Config en `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ... rest
};

export default nextConfig;
```

Y en `providers.tsx`:

```tsx
"use client";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      {children}
    </ThemeProvider>
  );
}
```

---

## 📊 Estado: Loading, Error, Empty

### Skeleton

```tsx
// src/components/ui/skeleton.tsx
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-neutral-800", className)}
      {...props}
    />
  );
}
```

### Empty State

```tsx
// src/components/ui/empty.tsx
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50 py-16 px-8 text-center", className)}>
      {icon && <div className="mb-4 rounded-full bg-neutral-800 p-4 text-neutral-500">{icon}</div>}
      <h3 className="text-lg font-medium text-neutral-100">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      {action && (
        <Button variant="primary" onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

---

## 📋 Tabla de Reportes

```tsx
// src/app/(dashboard)/reports/page.tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { FileText, Download, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";

const statusConfig = {
  completed: { label: "Completado", variant: "success" as const },
  processing: { label: "Procesando", variant: "warning" as const },
  failed: { label: "Fallido", variant: "danger" as const },
};

export default function ReportsPage() {
  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.reports.list(),
  });

  if (isLoading) return <Skeleton className="h-96" />;

  if (!reports?.length) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title="Sin reportes"
        description="Ejecuta un diagnóstico o una optimización para generar reportes"
        action={{ label: "Ejecutar Optimización", onClick: () => {} }}
      />
    );
  }

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-neutral-800 bg-neutral-900/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Reporte
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Tipo
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Score
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Estado
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Fecha
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {reports.map((report) => (
            <tr key={report.id} className="hover:bg-neutral-800/50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-medium text-neutral-100">{report.title}</div>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-neutral-400">{report.type}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-16 rounded-full bg-neutral-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        report.scoreAfter >= 80 ? "bg-emerald-400" :
                        report.scoreAfter >= 50 ? "bg-amber-400" : "bg-red-400"
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, report.scoreAfter))}%` }}
                    />
                  </div>
                  <span className="text-sm text-neutral-400">{report.scoreBefore} → {report.scoreAfter}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant={statusConfig[report.status as keyof typeof statusConfig].variant}>
                  {statusConfig[report.status as keyof typeof statusConfig].label}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-neutral-500">
                  {formatDistanceToNow(new Date(report.createdAt), { locale: es, addSuffix: true })}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => downloadReport(report.id)}>
                  <Download className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## 🗂️ Estructura Completa del Frontend

```
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root: Provider + Theme
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx     # Login con email + MFA
│   │   │   ├── register/page.tsx  # Registro
│   │   │   └── layout.tsx         # Layout centrado, sin sidebar
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx         # Sidebar + Header
│   │   │   ├── page.tsx           # Dashboard principal
│   │   │   ├── modules/page.tsx   # Catálogo de 27 módulos
│   │   │   ├── reports/page.tsx   # Historial de reportes
│   │   │   ├── analytics/page.tsx # Gráficos y métricas
│   │   │   ├── devices/page.tsx   # Lista de dispositivos
│   │   │   ├── licenses/page.tsx  # Gestión de licencias
│   │   │   ├── logs/page.tsx      # Activity logs
│   │   │   └── settings/page.tsx  # Configuración
│   │   ├── (marketing)/
│   │   │   ├── page.tsx           # Landing page
│   │   │   ├── pricing/page.tsx   # Pricing
│   │   │   ├── blog/page.tsx      # Blog
│   │   │   └── docs/page.tsx      # Documentación
│   │   └── api/                   # Next.js API routes (proxy)
│   ├── components/
│   │   ├── ui/                    # Design System (20 componentes)
│   │   ├── dashboard/             # ScoreCard, MetricRow, ModuleGrid, ActivityLog
│   │   ├── layout/                # Sidebar, Header, ThemeToggle
│   │   ├── charts/                # CPUChart, RAMChart, DiskChart, ScoreHistory
│   │   └── modules/               # Card de cada módulo
│   ├── lib/
│   │   ├── api.ts                 # API client (fetch + typed responses)
│   │   ├── auth.ts                # Auth helpers (JWT, sessions)
│   │   ├── utils.ts               # cn(), formatBytes(), etc.
│   │   ├── query.ts               # React Query config
│   │   └── constants.ts           # URLs, timeouts, etc.
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useDevices.ts
│   │   └── useModules.ts
│   ├── stores/
│   │   ├── deviceStore.ts         # Zustand: dispositivo activo
│   │   └── uiStore.ts             # Zustand: sidebar, toasts, modals
│   ├── types/
│   │   ├── api.ts                 # Tipos de respuestas API
│   │   └── index.ts               # Reexports
│   └── styles/
│       └── globals.css            # Tailwind + CSS Variables
├── public/
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 📦 Dependencias Recomendadas

```json
{
  "dependencies": {
    "next": "15.2.0",
    "react": "19",
    "@tanstack/react-query": "5.66.0",
    "zustand": "5.0.3",
    "sonner": "2.0.0",
    "lucide-react": "0.479.0",
    "recharts": "2.15.1",
    "date-fns": "4.1.0",
    "next-themes": "0.4.5",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "tailwind-merge": "3.0.0"
  },
  "devDependencies": {
    "typescript": "5.7",
    "tailwindcss": "4",
    "@types/react": "19",
    "eslint": "9"
  }
}
```

---

*Frontend SaaS moderno. Fase 5: Seguridad y Producción.*
