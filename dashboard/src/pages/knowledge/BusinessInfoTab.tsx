import { CircleCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useBusiness, useUpdateBusiness } from "../../api/hooks";
import { type Business, WEEKDAYS, type Weekday, type WeeklyHours } from "../../api/types";
import { Button, Card, ErrorNote, Field, Input, Select, Spinner, Textarea, Toggle } from "../../components/ui";

type Form = Omit<Business, "id" | "channels">;

/** Copies only the editable fields — the API rejects unknown keys like createdAt. */
function toForm(b: Business): Form {
  return {
    name: b.name,
    type: b.type,
    description: b.description,
    hours: b.hours,
    timezone: b.timezone,
    currency: b.currency,
    location: b.location,
    phone: b.phone,
    policies: b.policies,
    bookingSlotCapacity: b.bookingSlotCapacity,
    deliveryFee: b.deliveryFee,
    freeDeliveryThreshold: b.freeDeliveryThreshold,
    minDeliveryOrder: b.minDeliveryOrder,
    botEnabled: b.botEnabled,
  };
}

const DAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function BusinessInfoTab() {
  const business = useBusiness();
  const update = useUpdateBusiness();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

  // Start editing from the server copy (and again after each save).
  useEffect(() => {
    if (business.data) setForm(toForm(business.data));
  }, [business.data]);

  if (business.isPending || !form) return <Spinner />;
  if (business.error) return <ErrorNote error={business.error} />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };
  const text = (key: "name" | "description" | "location" | "phone" | "policies" | "timezone" | "currency") => ({
    value: form[key] ?? "",
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    update.mutate(
      {
        ...form,
        // Blank optional amounts mean "no threshold / no minimum".
        freeDeliveryThreshold: form.freeDeliveryThreshold || null,
        minDeliveryOrder: form.minDeliveryOrder || null,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Bot replies to customers</p>
            <p className="text-sm text-slate-500">
              When off, new messages go straight to the inbox for staff and the bot stays silent.
            </p>
          </div>
          <Toggle checked={form.botEnabled} onChange={(v) => set("botEnabled", v)} label="Bot enabled" />
        </div>
      </Card>

      <Card title="Business details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(id) => <Input id={id} required {...text("name")} />}</Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={form.type} onChange={(e) => set("type", e.target.value as Form["type"])}>
                <option value="RESTAURANT">Restaurant / café</option>
                <option value="CLINIC">Clinic</option>
                <option value="SALON">Salon</option>
                <option value="OTHER">Other</option>
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="About" hint="A sentence or two the bot can use to introduce the business.">
              {(id) => <Textarea id={id} {...text("description")} />}
            </Field>
          </div>
          <Field label="Location">{(id) => <Input id={id} placeholder="Street, area, landmark" {...text("location")} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" {...text("phone")} />}</Field>
          <Field label="Timezone" hint="Used for opening hours and bookings.">{(id) => <Input id={id} required {...text("timezone")} />}</Field>
          <Field label="Currency">{(id) => <Input id={id} required maxLength={3} {...text("currency")} />}</Field>
        </div>
      </Card>

      <Card title="Opening hours">
        <HoursEditor hours={form.hours} onChange={(hours) => set("hours", hours)} />
      </Card>

      <Card title="Orders and bookings">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Delivery fee (${form.currency})`}>
            {(id) => <Input id={id} type="number" min={0} step="0.01" required value={form.deliveryFee} onChange={(e) => set("deliveryFee", e.target.value)} />}
          </Field>
          <Field label={`Free delivery from (${form.currency})`} hint="Leave empty if delivery is never free.">
            {(id) => <Input id={id} type="number" min={0} step="0.01" value={form.freeDeliveryThreshold ?? ""} onChange={(e) => set("freeDeliveryThreshold", e.target.value)} />}
          </Field>
          <Field label={`Minimum delivery order (${form.currency})`} hint="Leave empty for no minimum.">
            {(id) => <Input id={id} type="number" min={0} step="0.01" value={form.minDeliveryOrder ?? ""} onChange={(e) => set("minDeliveryOrder", e.target.value)} />}
          </Field>
          <Field label="Bookings per time slot" hint="How many bookings can overlap.">
            {(id) => <Input id={id} type="number" min={1} required value={form.bookingSlotCapacity} onChange={(e) => set("bookingSlotCapacity", Number(e.target.value))} />}
          </Field>
        </div>
      </Card>

      <Card title="Policies">
        <Field label="Policies the bot can quote" hint="Delivery areas, payment methods, cancellations, reservations…">
          {(id) => <Textarea id={id} rows={7} {...text("policies")} />}
        </Field>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white">
        <ErrorNote error={update.error} />
        {saved && !update.error && (
          <span className="flex items-center gap-1 text-sm text-emerald-700">
            <CircleCheck className="size-4" aria-hidden /> Saved
          </span>
        )}
        <Button type="submit" loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function HoursEditor({ hours, onChange }: { hours: WeeklyHours; onChange: (h: WeeklyHours) => void }) {
  const setDay = (day: Weekday, ranges: { open: string; close: string }[]) => onChange({ ...hours, [day]: ranges });

  return (
    <div className="divide-y divide-slate-100">
      {WEEKDAYS.map((day) => {
        const range = hours[day]?.[0];
        const open = !!range;
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-28 text-sm font-medium">{DAY_LABEL[day]}</span>
            <Toggle checked={open} onChange={(v) => setDay(day, v ? [{ open: "09:00", close: "18:00" }] : [])} label={`Open on ${DAY_LABEL[day]}`} />
            {open ? (
              <div className="flex items-center gap-2 text-sm">
                <Input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} opening time`}
                  value={range.open}
                  onChange={(e) => setDay(day, [{ ...range, open: e.target.value }])}
                  className="w-32"
                />
                <span className="text-slate-400">to</span>
                <Input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} closing time`}
                  value={range.close}
                  onChange={(e) => setDay(day, [{ ...range, close: e.target.value }])}
                  className="w-32"
                />
              </div>
            ) : (
              <span className="text-sm text-slate-400">Closed</span>
            )}
          </div>
        );
      })}
      <p className="pt-3 text-xs text-slate-500">A closing time earlier than the opening time means the business is open past midnight.</p>
    </div>
  );
}
