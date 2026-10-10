import { MessageSquare, Phone, ShoppingBag, Truck, UtensilsCrossed } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useBusiness, useOrders, useUpdateOrder } from "../api/hooks";
import type { Order, OrderStatus } from "../api/types";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../components/ui";
import { channelLabel, formatInZone, formatMoney, timeAgo } from "../lib/format";
import { ORDER_STATUS } from "../lib/status";

const TABS = [
  { id: "active", label: "Active", statuses: "NEW,CONFIRMED,READY" },
  { id: "new", label: "New", statuses: "NEW" },
  { id: "confirmed", label: "Confirmed", statuses: "CONFIRMED" },
  { id: "ready", label: "Ready", statuses: "READY" },
  { id: "done", label: "Completed", statuses: "DELIVERED" },
  { id: "cancelled", label: "Cancelled", statuses: "CANCELLED" },
  { id: "all", label: "All", statuses: "" },
] as const;

const DELIVERY = {
  DELIVERY: { label: "Delivery", icon: Truck, done: "Mark delivered" },
  PICKUP: { label: "Pickup", icon: ShoppingBag, done: "Mark picked up" },
  DINE_IN: { label: "Dine-in", icon: UtensilsCrossed, done: "Mark served" },
} as const;

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab")) ?? TABS[0];
  const orders = useOrders(tab.statuses);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Orders</h1>
      <p className="mt-1 text-sm text-slate-500">Orders placed through the bot. New orders appear automatically.</p>

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Order status">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === tab.id ? "page" : undefined}
            onClick={() => setParams(t.id === "active" ? {} : { tab: t.id })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${t.id === tab.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {orders.isPending && <Spinner />}
        <ErrorNote error={orders.error} />
        {orders.data?.length === 0 && (
          <EmptyState icon={<ShoppingBag className="size-10" />} title={tab.id === "active" ? "No open orders" : "No orders here"}>
            {tab.id === "active" ? "When customers order through the bot, they show up here." : undefined}
          </EmptyState>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.data?.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order: o }: { order: Order }) {
  const update = useUpdateOrder();
  const business = useBusiness().data;
  const currency = business?.currency ?? "ETB";
  const status = ORDER_STATUS[o.status];
  const delivery = DELIVERY[o.deliveryType];
  const DeliveryIcon = delivery.icon;
  const open = o.status !== "DELIVERED" && o.status !== "CANCELLED";

  const setStatus = (next: OrderStatus) => update.mutate({ id: o.id, status: next });
  const cancel = () => confirm(`Cancel order #${o.number}?`) && setStatus("CANCELLED");

  return (
    <article className={`flex flex-col rounded-xl bg-white ring-1 ${o.status === "NEW" ? "ring-2 ring-amber-300" : "ring-slate-200"}`} aria-label={`Order ${o.number}`}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold">#{o.number}</h2>
          <span
            className="text-xs text-slate-400"
            title={business ? formatInZone(o.createdAt, business.timezone, { dateStyle: "medium", timeStyle: "short" }) : undefined}
          >
            {timeAgo(o.createdAt)}
          </span>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
      </header>

      <div className="flex-1 space-y-3 px-4 py-3 text-sm">
        {o.customer && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{o.customer.name ?? "Unknown customer"}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">{channelLabel[o.customer.channel]}</span>
            {(o.phone ?? o.customer.phone) && (
              <a href={`tel:${o.phone ?? o.customer.phone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <Phone className="size-3.5" aria-hidden /> {o.phone ?? o.customer.phone}
              </a>
            )}
          </p>
        )}

        <ul className="space-y-1">
          {o.items.map((item) => (
            <li key={item.itemId} className="flex justify-between gap-3">
              <span>
                <span className="font-medium">{item.quantity} ×</span> {item.name}
                {item.notes && <span className="block text-xs text-slate-500 italic">“{item.notes}”</span>}
              </span>
              <span className="shrink-0 text-slate-600">{formatMoney(Number(item.unitPrice) * item.quantity, currency)}</span>
            </li>
          ))}
        </ul>

        <dl className="space-y-0.5 border-t border-slate-100 pt-2 text-slate-600">
          {Number(o.deliveryFee) > 0 && (
            <div className="flex justify-between"><dt>Delivery fee</dt><dd>{formatMoney(o.deliveryFee, currency)}</dd></div>
          )}
          <div className="flex justify-between font-semibold text-slate-900"><dt>Total</dt><dd>{formatMoney(o.total, currency)}</dd></div>
        </dl>

        <p className="flex items-start gap-2 text-slate-600">
          <DeliveryIcon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <span>
            {delivery.label}
            {o.address && <> · {o.address}</>}
          </span>
        </p>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        {o.status === "NEW" && <Button loading={update.isPending} onClick={() => setStatus("CONFIRMED")}>Confirm</Button>}
        {o.status === "CONFIRMED" && <Button loading={update.isPending} onClick={() => setStatus("READY")}>Mark ready</Button>}
        {o.status === "READY" && <Button loading={update.isPending} onClick={() => setStatus("DELIVERED")}>{delivery.done}</Button>}
        {open && <Button variant="danger" disabled={update.isPending} onClick={cancel}>Cancel</Button>}
        {o.conversationId && (
          <Link to={`/inbox/${o.conversationId}`} className="ml-auto inline-flex items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
            <MessageSquare className="size-4" aria-hidden /> Open chat
          </Link>
        )}
        {update.error && <div className="w-full"><ErrorNote error={update.error} /></div>}
      </footer>
    </article>
  );
}
