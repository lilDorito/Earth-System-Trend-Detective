// app shell: header, nav and routes

import { lazy, Suspense, useEffect } from "react";
import { Link, NavLink, Route, Routes } from "react-router";
import { Earth, LoaderCircle } from "lucide-react";
import { usingMockData } from "@/api";
import { Status } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/store/useCatalogStore";

const ExplorerPage = lazy(() => import("@/pages/ExplorerPage"));
const TrendMapPage = lazy(() => import("@/pages/TrendMapPage"));
const DemosPage = lazy(() => import("@/pages/DemosPage"));
const LearnPage = lazy(() => import("@/pages/LearnPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const links = [
  { to: "/", label: "Explore" },
  { to: "/map", label: "Trend map" },
  { to: "/demos", label: "Demos" },
  { to: "/learn", label: "Learn" },
];

function Header() {
  return (
    <header className="flex h-11 shrink-0 items-stretch gap-6 border-b px-3 sm:px-5">
      <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Earth className="size-4 text-primary" />
        <span className="hidden sm:inline">Earth Trend Detective</span>
      </Link>
      <nav className="flex items-stretch gap-5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      {usingMockData && (
        <Status tone="warning" className="ml-auto hidden md:inline-flex" title="Synthetic data generated in the browser">
          mock data
        </Status>
      )}
    </header>
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
    <div className="flex h-dvh flex-col">
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
    </div>
  );
}
