import { MessageCircleMore } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <MessageCircleMore className="size-10 text-brand-600" aria-hidden />
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">AI customer support for Telegram and WhatsApp</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">{children}</div>
      </div>
    </div>
  );
}
