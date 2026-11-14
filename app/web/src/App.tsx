import { NavLink, Route, Routes } from "react-router";
import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ExplorerPage from "@/pages/ExplorerPage";
import TrendMapPage from "@/pages/TrendMapPage";
import DemosPage from "@/pages/DemosPage";
import LearnPage from "@/pages/LearnPage";
import NotFoundPage from "@/pages/NotFoundPage";

const links = [
  { to: "/", label: "Explore" },
  { to: "/map", label: "Trend map" },
  { to: "/demos", label: "Demos" },
  { to: "/learn", label: "Learn" },
];

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-6 border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <Globe2 className="size-5" /> Earth Trend Detective
        </div>
        <nav className="flex gap-4 text-sm">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end
              className={({ isActive }) => cn("text-neutral-400 hover:text-white", isActive && "text-white")}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<ExplorerPage />} />
          <Route path="/map" element={<TrendMapPage />} />
          <Route path="/demos" element={<DemosPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
