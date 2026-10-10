import { BookOpen, CalendarDays, Inbox, LogOut, MessageCircleMore, ShoppingBag } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useConversations, useLogout, useMe, useOrders } from "../api/hooks";

const nav = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/orders", label: "Orders", icon: ShoppingBag },
  { to: "/bookings", label: "Bookings", icon: CalendarDays },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen },
];

export function Layout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  // Shares the inbox's polled query, so the badge stays live on every page.
  const attention = useConversations("attention");
  const newOrders = useOrders("NEW");
  const badges: Record<string, number> = {
    "/inbox": attention.data?.length ?? 0,
    "/orders": newOrders.data?.length ?? 0,
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 py-2 md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <div className="mr-2 flex items-center gap-2 px-2 md:mr-0 md:mb-6">
          <MessageCircleMore className="size-6 text-brand-600" aria-hidden />
          <span className="font-semibold">SupportBot</span>
        </div>

        <nav className="flex flex-1 gap-1 md:flex-col" aria-label="Main">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              <Icon className="size-4" aria-hidden />
              <span className="sr-only md:not-sr-only">{label}</span>
              {(badges[to] ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                  {badges[to]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0 md:flex-col md:items-stretch md:border-t md:border-slate-200 md:pt-3">
          <div className="hidden px-2.5 text-xs md:block">
            <p className="truncate font-medium text-slate-700">{me.data?.business.name}</p>
            <p className="truncate text-slate-500">{me.data?.user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Log out"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden md:inline" aria-hidden>Log out</span>
          </button>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
