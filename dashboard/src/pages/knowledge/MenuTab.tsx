import { Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { type FormEvent, useState } from "react";
import { menuItems, type MenuItemInput, useBusiness } from "../../api/hooks";
import type { MenuItem } from "../../api/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Spinner, Textarea, Toggle } from "../../components/ui";
import { formatMoney } from "../../lib/format";

export function MenuTab() {
  const list = menuItems.useList();
  const save = menuItems.useSave();
  const remove = menuItems.useRemove();
  const currency = useBusiness().data?.currency ?? "ETB";
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);

  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;

  const categories = [...new Set(list.data.map((m) => m.category))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {list.data.length} items. The bot only offers items listed here, at these prices. Turn an item off when it's sold out.
        </p>
        <Button onClick={() => setEditing("new")} className="shrink-0">
          <Plus className="size-4" aria-hidden /> Add item
        </Button>
      </div>
      <ErrorNote error={save.error ?? remove.error} />

      {list.data.length === 0 && (
        <Card>
          <EmptyState icon={<UtensilsCrossed className="size-8" />} title="No menu items yet">
            Add your dishes and drinks so the bot can answer questions and take orders.
          </EmptyState>
        </Card>
      )}

      {categories.map((category) => (
        <Card key={category} title={category}>
          <ul className="-my-2 divide-y divide-slate-100">
            {list.data
              .filter((m) => m.category === category)
              .map((item) => (
                <li key={item.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${item.available ? "" : "text-slate-400 line-through"}`}>{item.name}</span>
                      <span className="text-sm text-slate-600">{formatMoney(item.price, currency)}</span>
                      {!item.available && <Badge color="red">Unavailable</Badge>}
                    </div>
                    {item.description && <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>}
                  </div>
                  <Toggle
                    checked={item.available}
                    onChange={(available) => save.mutate({ id: item.id, available })}
                    label={`${item.name} available`}
                  />
                  <Button variant="ghost" onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => confirm(`Delete "${item.name}" from the menu?`) && remove.mutate(item.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
          </ul>
        </Card>
      ))}

      {editing && (
        <MenuItemModal
          item={editing === "new" ? null : editing}
          categories={categories}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MenuItemModal({ item, categories, currency, onClose }: { item: MenuItem | null; categories: string[]; currency: string; onClose: () => void }) {
  const save = menuItems.useSave();
  const [form, setForm] = useState<MenuItemInput>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? "",
    category: item?.category ?? categories[0] ?? "",
    available: item?.available ?? true,
    sortOrder: item?.sortOrder ?? 0,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ ...form, id: item?.id }, { onSuccess: onClose });
  }

  return (
    <Modal title={item ? `Edit ${item.name}` : "Add menu item"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Price (${currency})`}>
            {(id) => <Input id={id} type="number" min={0} step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />}
          </Field>
          <Field label="Category" hint="Pick one or type a new one.">
            {(id) => (
              <>
                <Input id={id} list="menu-categories" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                <datalist id="menu-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        <Field label="Description" hint="Ingredients, portion size, spice level — helps the bot answer questions.">
          {(id) => <Textarea id={id} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={form.available} onChange={(available) => setForm({ ...form, available })} label="Available" />
          Available today
        </label>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{item ? "Save" : "Add item"}</Button>
        </div>
      </form>
    </Modal>
  );
}
