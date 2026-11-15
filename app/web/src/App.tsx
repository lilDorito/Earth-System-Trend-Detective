// app shell: header, nav and routes; phones get a bottom tab bar instead of the header links

import { lazy, Suspense, useEffect } from "react";
import { Link, NavLink, Route, Routes } from "react-router";
import { BookOpen, Compass, Earth, Globe, LoaderCircle, PlayCircle, type LucideIcon } from "lucide-react";
import { usingMockData } from "@/api";
import { Status } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/store/useCatalogStore";

const ExplorerPage = lazy(() => import("@/pages/ExplorerPage"));
const TrendMapPage = lazy(() => import("@/pages/TrendMapPage"));
const DemosPage = lazy(() => import("@/pages/DemosPage"));
const LearnPage = lazy(() => import("@/pages/LearnPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Explore", icon: Compass },
  { to: "/map", label: "Trend map", icon: Globe },
  { to: "/demos", label: "Demos", icon: PlayCircle },
  { to: "/learn", label: "Learn", icon: BookOpen },
];

function Header() {
  return (
    <header className="flex h-11 shrink-0 items-stretch gap-6 border-b px-3 sm:px-5">
      <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Earth className="size-4 text-primary" />
        <span>Earth Trend Detective</span>
      </Link>
      <nav className="hidden sm:flex items-stretch gap-5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end
            className={({ isActive }) =>
              cn(
                "relative flex items-center whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground",
                isActive && "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-primary",
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {usingMockData && (
          <Status tone="warning" title="Synthetic data generated in the browser">
            mock data
          </Status>
        )}
      </div>
    </header>
  );
}

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="grid shrink-0 grid-cols-4 border-t bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              "flex h-14 select-none flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors active:bg-accent",
              isActive && "text-primary",
            )
          }
        >
          <Icon className="size-5" strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function PageFallback() {
  return (
    <div className="grid h-full place-items-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  const loadCatalog = useCatalogStore((s) => s.load);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <Header />
      <main className="min-h-0 flex-1">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<ExplorerPage />} />
            <Route path="/map" element={<TrendMapPage />} />
            <Route path="/demos" element={<DemosPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <TabBar />
    </div>
  );
}
