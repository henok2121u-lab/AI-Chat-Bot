import { NavLink, Navigate, useParams } from "react-router";
import { BusinessInfoTab } from "./BusinessInfoTab";
import { FaqsTab } from "./FaqsTab";
import { MenuTab } from "./MenuTab";
import { ServicesTab } from "./ServicesTab";

const TABS = [
  { id: "business", label: "Business info", Component: BusinessInfoTab },
  { id: "menu", label: "Menu", Component: MenuTab },
  { id: "services", label: "Services", Component: ServicesTab },
  { id: "faqs", label: "FAQs", Component: FaqsTab },
] as const;

export function KnowledgePage() {
  const { tab = "business" } = useParams();
  const active = TABS.find((t) => t.id === tab);
  if (!active) return <Navigate to="/knowledge" replace />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Knowledge</h1>
      <p className="mt-1 text-sm text-slate-500">
        Everything the bot knows about your business. It answers only from this information and uses changes on the next message.
      </p>

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Knowledge sections">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/knowledge/${t.id}`}
            className={() =>
              `-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${t.id === active.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <active.Component />
      </div>
    </div>
  );
}
