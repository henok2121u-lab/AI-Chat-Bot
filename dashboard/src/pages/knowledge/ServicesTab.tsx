import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { services, type ServiceInput, useBusiness } from "../../api/hooks";
import type { Service } from "../../api/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Spinner, Textarea, Toggle } from "../../components/ui";
import { formatMoney } from "../../lib/format";

export function ServicesTab() {
  const list = services.useList();
  const remove = services.useRemove();
  const currency = useBusiness().data?.currency ?? "ETB";
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Appointment-based services (clinics, salons). Customers can book these through the bot.</p>
        <Button onClick={() => setEditing("new")} className="shrink-0">
          <Plus className="size-4" aria-hidden /> Add service
        </Button>
      </div>
      <ErrorNote error={remove.error} />

      <Card>
        {list.data.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-8" />} title="No services">
            Restaurants usually don't need these — table bookings work without a service.
          </EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {list.data.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-slate-600">{s.durationMin} min · {formatMoney(s.price, currency)}</span>
                    {!s.available && <Badge color="red">Unavailable</Badge>}
                  </div>
                  {s.description && <p className="mt-0.5 text-sm text-slate-500">{s.description}</p>}
                </div>
                <Button variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => confirm(`Delete "${s.name}"?`) && remove.mutate(s.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <ServiceModal service={editing === "new" ? null : editing} currency={currency} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceModal({ service, currency, onClose }: { service: Service | null; currency: string; onClose: () => void }) {
  const save = services.useSave();
  const [form, setForm] = useState<ServiceInput>({
    name: service?.name ?? "",
    description: service?.description ?? "",
    durationMin: service?.durationMin ?? 30,
    price: service?.price ?? "",
    available: service?.available ?? true,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ ...form, id: service?.id }, { onSuccess: onClose });
  }

  return (
    <Modal title={service ? `Edit ${service.name}` : "Add service"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration (minutes)">
            {(id) => <Input id={id} type="number" min={5} step={5} required value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} />}
          </Field>
          <Field label={`Price (${currency})`}>
            {(id) => <Input id={id} type="number" min={0} step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />}
          </Field>
        </div>
        <Field label="Description">{(id) => <Textarea id={id} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={form.available} onChange={(available) => setForm({ ...form, available })} label="Available" />
          Available for booking
        </label>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{service ? "Save" : "Add service"}</Button>
        </div>
      </form>
    </Modal>
  );
}
