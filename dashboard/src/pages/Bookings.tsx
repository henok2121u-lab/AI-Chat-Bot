import { CalendarDays, ChevronLeft, ChevronRight, MessageSquare, Phone, Users } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useBookings, useBusiness, useUpdateBooking } from "../api/hooks";
import type { Booking, BookingStatus } from "../api/types";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../components/ui";
import { addDays, channelLabel, dateKeyInZone, formatDateKey, formatInZone, mondayOf } from "../lib/format";
import { BOOKING_STATUS } from "../lib/status";

/** Covers every UTC offset, so a day in the business's timezone is never cut off. */
const ZONE_MARGIN_MS = 14 * 60 * 60 * 1000;

export function BookingsPage() {
  const business = useBusiness();
  if (business.isPending) return <Spinner />;
  if (business.error) return <div className="p-6"><ErrorNote error={business.error} /></div>;
  return <WeekView timeZone={business.data.timezone} />;
}

function WeekView({ timeZone }: { timeZone: string }) {
  const [params, setParams] = useSearchParams();
  const today = dateKeyInZone(new Date(), timeZone);
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(params.get("week") ?? "") ? mondayOf(params.get("week")!) : mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const range = useMemo(
    () => ({
      from: new Date(Date.parse(`${monday}T00:00:00Z`) - ZONE_MARGIN_MS).toISOString(),
      to: new Date(Date.parse(`${addDays(monday, 7)}T00:00:00Z`) + ZONE_MARGIN_MS).toISOString(),
    }),
    [monday],
  );
  const bookings = useBookings(range.from, range.to);

  const byDay = new Map<string, Booking[]>();
  for (const b of bookings.data ?? []) {
    const key = dateKeyInZone(b.startsAt, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }
  const inWeek = days.flatMap((d) => byDay.get(d) ?? []);
  const active = inWeek.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED");
  const guests = active.reduce((sum, b) => sum + b.partySize, 0);

  const goTo = (week: string) => setParams(week === mondayOf(today) ? {} : { week });
  const rangeLabel = `${formatDateKey(days[0]!, { day: "numeric", month: "short" })} – ${formatDateKey(days[6]!, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="mt-1 text-sm text-slate-500">
            {active.length} upcoming or open {active.length === 1 ? "booking" : "bookings"} · {guests} guests · times in {timeZone.replace("_", " ")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Previous week" onClick={() => goTo(addDays(monday, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="secondary" onClick={() => goTo(mondayOf(today))} disabled={monday === mondayOf(today)}>
            This week
          </Button>
          <Button variant="secondary" aria-label="Next week" onClick={() => goTo(addDays(monday, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <h2 className="mt-5 text-sm font-medium text-slate-700">{rangeLabel}</h2>
      <ErrorNote error={bookings.error} />
      {bookings.isPending ? (
        <Spinner />
      ) : (
        <ol className="mt-3 space-y-3">
          {days.map((day) => {
            const list = (byDay.get(day) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
            const isToday = day === today;
            return (
              <li key={day} className={`rounded-xl bg-white ring-1 ${isToday ? "ring-2 ring-brand-500" : "ring-slate-200"}`}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                  <h3 className={`text-sm font-semibold ${day < today ? "text-slate-400" : ""}`}>
                    {formatDateKey(day, { weekday: "long", day: "numeric", month: "short" })}
                    {isToday && <span className="ml-2 text-brand-700">Today</span>}
                  </h3>
                  {list.length > 0 && <span className="text-xs text-slate-500">{list.length} {list.length === 1 ? "booking" : "bookings"}</span>}
                </div>
                {list.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-slate-400">No bookings</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {list.map((b) => (
                      <BookingRow key={b.id} booking={b} timeZone={timeZone} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!bookings.isPending && inWeek.length === 0 && (
        <EmptyState icon={<CalendarDays className="size-8" />} title="No bookings this week">
          Customers can book a table or appointment by chatting with the bot.
        </EmptyState>
      )}
    </div>
  );
}

function BookingRow({ booking: b, timeZone }: { booking: Booking; timeZone: string }) {
  const update = useUpdateBooking();
  const status = BOOKING_STATUS[b.status];
  const started = new Date(b.startsAt).getTime() <= Date.now();
  const open = b.status === "PENDING" || b.status === "CONFIRMED";
  const setStatus = (next: BookingStatus) => update.mutate({ id: b.id, status: next });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <time dateTime={b.startsAt} className="w-14 shrink-0 text-base font-semibold tabular-nums">
        {formatInZone(b.startsAt, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
      </time>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{b.contactName}</span>
          <span className="inline-flex items-center gap-1 text-slate-500"><Users className="size-3.5" aria-hidden /> {b.partySize}</span>
          {b.service && <span className="text-slate-500">· {b.service.name}</span>}
          <Badge color={status.color}>{status.label}</Badge>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-slate-500">
          <a href={`tel:${b.contactPhone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            <Phone className="size-3.5" aria-hidden /> {b.contactPhone}
          </a>
          {b.customer && <span>{channelLabel[b.customer.channel]}</span>}
          {b.conversationId && (
            <Link to={`/inbox/${b.conversationId}`} className="inline-flex items-center gap-1 hover:text-brand-700">
              <MessageSquare className="size-3.5" aria-hidden /> Chat
            </Link>
          )}
        </p>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2">
          {b.status === "PENDING" && <Button loading={update.isPending} onClick={() => setStatus("CONFIRMED")}>Confirm</Button>}
          {b.status === "CONFIRMED" && started && (
            <>
              <Button variant="secondary" loading={update.isPending} onClick={() => setStatus("COMPLETED")}>Arrived</Button>
              <Button variant="secondary" disabled={update.isPending} onClick={() => setStatus("NO_SHOW")}>No-show</Button>
            </>
          )}
          <Button variant="danger" disabled={update.isPending} onClick={() => confirm(`Cancel ${b.contactName}'s booking?`) && setStatus("CANCELLED")}>
            Cancel
          </Button>
        </div>
      )}
      {update.error && <div className="w-full"><ErrorNote error={update.error} /></div>}
    </li>
  );
}
