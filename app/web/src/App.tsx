// app shell: header, nav and routes; phones get a bottom tab bar instead of the header links

import { lazy, Suspense, useEffect } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router";
import { Candy, Earth, GraduationCap, Globe, LoaderCircle, Moon, PlayCircle, type LucideIcon } from "lucide-react";
import Tutorial, { tourSeen, useTutorial } from "@/components/Tutorial";
import { usingMockData } from "@/api";
import { Status } from "@/components/ui/status";
import { setTheme, useThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const TrendMapPage = lazy(() => import("@/pages/TrendMapPage"));
const DemosPage = lazy(() => import("@/pages/DemosPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Trend map", icon: Globe },
  { to: "/demos", label: "Demos", icon: PlayCircle },
];

// phones only for now: the marshmallow theme does not apply on wider screens yet
function ThemeSwitch() {
  const theme = useThemeChoice();
  const marshmallow = theme === "marshmallow";
  return (
    <button
      type="button"
      onClick={() => setTheme(marshmallow ? "dark" : "marshmallow")}
      aria-pressed={marshmallow}
      aria-label={marshmallow ? "Switch to the dark theme" : "Switch to the marshmallow theme"}
      title={marshmallow ? "Dark theme" : "Marshmallow theme"}
      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors active:bg-accent sm:hidden"
    >
      {marshmallow ? <Moon className="size-5" strokeWidth={1.75} /> : <Candy className="size-5 text-primary" strokeWidth={1.75} />}
    </button>
  );
}

function Header() {
  const startTour = useTutorial((s) => s.start);
  return (
    <header className="flex h-11 shrink-0 items-stretch gap-6 border-b px-3 sm:px-5">
      <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Earth className="size-4 text-primary" />
        <span>Is Earth okay?</span>
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
        <button
          type="button"
          onClick={startTour}
          data-tour="tutorial"
          title="A short tour of what to do where"
          className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <GraduationCap className="size-4" />
          <span>Tutorial</span>
        </button>
        {usingMockData && (
          <Status tone="warning" title="Synthetic data generated in the browser">
            mock data
          </Status>
        )}
        <ThemeSwitch />
      </div>
    </header>
  );
}

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="grid shrink-0 grid-cols-2 border-t bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
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
  const startTour = useTutorial((s) => s.start);
  // the first visit starts with the tour, once the map has had a moment to appear
  useEffect(() => {
    if (tourSeen()) return;
    const t = setTimeout(startTour, 1200);
    return () => clearTimeout(t);
  }, [startTour]);

  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <Header />
      <main className="min-h-0 flex-1">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<TrendMapPage />} />
            <Route path="/map" element={<Navigate to="/" replace />} />
            <Route path="/demos" element={<DemosPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <TabBar />
      <Tutorial />
    </div>
  );
}
