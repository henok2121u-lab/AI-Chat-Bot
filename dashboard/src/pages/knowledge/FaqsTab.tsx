import { CircleHelp, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { faqs, type FaqInput } from "../../api/hooks";
import type { Faq } from "../../api/types";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Spinner, Textarea } from "../../components/ui";

export function FaqsTab() {
  const list = faqs.useList();
  const remove = faqs.useRemove();
  const [editing, setEditing] = useState<Faq | "new" | null>(null);

  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Common questions and the answers the bot should give.</p>
        <Button onClick={() => setEditing("new")} className="shrink-0">
          <Plus className="size-4" aria-hidden /> Add FAQ
        </Button>
      </div>
      <ErrorNote error={remove.error} />

      <Card>
        {list.data.length === 0 ? (
          <EmptyState icon={<CircleHelp className="size-8" />} title="No FAQs yet">
            Parking, Wi-Fi, payment methods, dietary options… anything customers often ask.
          </EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {list.data.map((f) => (
              <li key={f.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{f.question}</p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-600">{f.answer}</p>
                </div>
                <Button variant="ghost" onClick={() => setEditing(f)} aria-label={`Edit "${f.question}"`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" aria-label={`Delete "${f.question}"`} onClick={() => confirm("Delete this FAQ?") && remove.mutate(f.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <FaqModal faq={editing === "new" ? null : editing} nextSortOrder={list.data.length} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FaqModal({ faq, nextSortOrder, onClose }: { faq: Faq | null; nextSortOrder: number; onClose: () => void }) {
  const save = faqs.useSave();
  const [form, setForm] = useState<FaqInput>({
    question: faq?.question ?? "",
    answer: faq?.answer ?? "",
    sortOrder: faq?.sortOrder ?? nextSortOrder,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ ...form, id: faq?.id }, { onSuccess: onClose });
  }

  return (
    <Modal title={faq ? "Edit FAQ" : "Add FAQ"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Question">{(id) => <Input id={id} required autoFocus value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />}</Field>
        <Field label="Answer">{(id) => <Textarea id={id} rows={5} required value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />}</Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{faq ? "Save" : "Add FAQ"}</Button>
        </div>
      </form>
    </Modal>
  );
}
