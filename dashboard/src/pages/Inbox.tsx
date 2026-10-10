import { ArrowLeft, Bot, CircleAlert, Hand, Inbox as InboxIcon, MessagesSquare, Send, UserRound } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { type InboxFilter, useConversation, useConversations, useSendReply, useUpdateConversation } from "../api/hooks";
import type { ConversationDetail, ConversationSummary, Message } from "../api/types";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../components/ui";
import { channelLabel, formatMoney, formatTime, timeAgo } from "../lib/format";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "human", label: "Taken over" },
];

export function InboxPage() {
  const { conversationId } = useParams();
  const [filter, setFilter] = useState<InboxFilter>("all");

  return (
    <div className="flex h-full">
      {/* On small screens show either the list or the open chat. */}
      <div className={`w-full shrink-0 border-r border-slate-200 bg-white md:flex md:w-80 md:flex-col ${conversationId ? "hidden" : "flex flex-col"}`}>
        <ConversationList filter={filter} onFilter={setFilter} activeId={conversationId} />
      </div>
      <div className={`min-w-0 flex-1 ${conversationId ? "flex" : "hidden md:flex"}`}>
        {conversationId ? (
          <ChatView key={conversationId} id={conversationId} />
        ) : (
          <EmptyState icon={<MessagesSquare className="size-10" />} title="Select a conversation">
            Chats from Telegram and WhatsApp appear here. Ones the bot handed over to staff are listed first.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function ConversationList({ filter, onFilter, activeId }: { filter: InboxFilter; onFilter: (f: InboxFilter) => void; activeId?: string }) {
  const conversations = useConversations(filter);

  return (
    <>
      <div className="border-b border-slate-200 p-3">
        <h1 className="mb-3 px-1 text-lg font-semibold">Inbox</h1>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => onFilter(f.value)}
              className={`flex-1 rounded-md px-1.5 py-1 text-xs font-medium whitespace-nowrap ${filter === f.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.isPending && <Spinner />}
        {conversations.error && <div className="p-3"><ErrorNote error={conversations.error} /></div>}
        {conversations.data?.length === 0 && (
          <EmptyState icon={<InboxIcon className="size-8" />} title={filter === "all" ? "No conversations yet" : "Nothing here"}>
            {filter === "all" ? "When customers message your bot, their chats show up here." : "You're all caught up."}
          </EmptyState>
        )}
        <ul>
          {conversations.data?.map((c) => (
            <li key={c.id}>
              <ConversationRow conversation={c} active={c.id === activeId} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ConversationRow({ conversation: c, active }: { conversation: ConversationSummary; active: boolean }) {
  const preview = c.lastMessage ? `${c.lastMessage.role === "CUSTOMER" ? "" : c.lastMessage.role === "BOT" ? "Bot: " : "You: "}${c.lastMessage.text}` : "No messages";
  return (
    <Link
      to={`/inbox/${c.id}`}
      className={`block border-b border-slate-100 px-4 py-3 hover:bg-slate-50 ${active ? "bg-brand-50 hover:bg-brand-50" : ""} ${c.needsAttention ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-transparent"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-sm ${c.needsAttention ? "font-semibold" : "font-medium"}`}>{c.customer.name ?? "Unknown customer"}</span>
        <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.lastMessageAt)}</span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{preview}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge>{channelLabel[c.channel]}</Badge>
        {c.needsAttention && <Badge color="amber">Needs attention</Badge>}
        {c.mode === "HUMAN" && <Badge color="blue">Taken over</Badge>}
      </div>
    </Link>
  );
}

function ChatView({ id }: { id: string }) {
  const conversation = useConversation(id);
  const navigate = useNavigate();

  if (conversation.isPending) return <div className="flex-1"><Spinner /></div>;
  if (conversation.error) return <div className="flex-1 p-6"><ErrorNote error={conversation.error} /></div>;
  const c = conversation.data;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <ChatHeader conversation={c} onBack={() => navigate("/inbox")} />
        <StatusBanner conversation={c} />
        <MessageList messages={c.messages} />
        <ReplyBox conversation={c} />
      </div>
      <CustomerPanel conversation={c} />
    </div>
  );
}

function ChatHeader({ conversation: c, onBack }: { conversation: ConversationDetail; onBack: () => void }) {
  const update = useUpdateConversation();
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <Button variant="ghost" onClick={onBack} aria-label="Back to conversations" className="-ml-2 md:hidden">
        <ArrowLeft className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold">{c.customer.name ?? "Unknown customer"}</h2>
        <p className="text-xs text-slate-500">
          {channelLabel[c.channel]}
          {c.customer.phone && ` · ${c.customer.phone}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {c.needsAttention && c.mode === "BOT" && (
          <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id: c.id, needsAttention: false })}>
            Mark as handled
          </Button>
        )}
        {c.mode === "BOT" ? (
          <Button loading={update.isPending} onClick={() => update.mutate({ id: c.id, mode: "HUMAN" })}>
            <Hand className="size-4" aria-hidden /> Take over
          </Button>
        ) : (
          <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id: c.id, mode: "BOT" })}>
            <Bot className="size-4" aria-hidden /> Give back to bot
          </Button>
        )}
      </div>
      {update.error && <div className="w-full"><ErrorNote error={update.error} /></div>}
    </header>
  );
}

function StatusBanner({ conversation: c }: { conversation: ConversationDetail }) {
  if (c.mode === "HUMAN") {
    return (
      <div className="flex items-start gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
        <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <strong>You're handling this chat</strong> — the bot is paused until you give it back.
          {c.handoffReason && <span className="block text-sky-800">Bot handed over: {c.handoffReason}</span>}
        </p>
      </div>
    );
  }
  if (c.needsAttention) {
    return (
      <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>The bot had trouble with this chat (an error or a question it couldn't answer). Check the last messages.</p>
      </div>
    );
  }
  return null;
}

function MessageList({ messages }: { messages: Message[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  // Jump to the newest message when the chat opens or a new message arrives.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (!messages.length) return <div className="flex-1"><EmptyState icon={<MessagesSquare className="size-8" />} title="No messages yet" /></div>;

  return (
    <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageBubble({ message: m }: { message: Message }) {
  const fromCustomer = m.role === "CUSTOMER";
  const style = fromCustomer
    ? "bg-white text-slate-900 ring-1 ring-slate-200"
    : m.role === "BOT"
      ? "bg-brand-100 text-slate-900"
      : "bg-brand-600 text-white";
  const label = fromCustomer ? null : m.role === "BOT" ? "Bot" : "Staff";

  return (
    <div className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[80%] sm:max-w-[70%]">
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${style} ${fromCustomer ? "rounded-bl-sm" : "rounded-br-sm"}`}>
          {m.text}
        </div>
        <p className={`mt-1 text-xs text-slate-400 ${fromCustomer ? "" : "text-right"}`}>
          {label && <span className="font-medium">{label} · </span>}
          {formatTime(m.createdAt)}
        </p>
      </div>
    </div>
  );
}

function ReplyBox({ conversation: c }: { conversation: ConversationDetail }) {
  const send = useSendReply();
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || send.isPending) return;
    send.mutate({ id: c.id, text: value }, { onSuccess: () => setText("") });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  if (!c.canReply) {
    return (
      <div className="border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        WhatsApp's 24-hour reply window has closed. The customer needs to message again, or you need an approved template to reply.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3">
      <ErrorNote error={send.error} />
      <div className="flex items-end gap-2">
        <label htmlFor="reply" className="sr-only">Reply to customer</label>
        <textarea
          id="reply"
          ref={input}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Reply on ${channelLabel[c.channel]}…`}
          className="block max-h-40 min-h-11 flex-1 resize-y rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" loading={send.isPending} disabled={!text.trim()} aria-label="Send reply">
          <Send className="size-4" aria-hidden />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {c.mode === "BOT" ? "Sending a reply takes over the chat — the bot pauses until you give it back. " : ""}
        {c.channel === "CLI" ? "Test chat: replies are saved but not delivered anywhere." : "Enter to send · Shift+Enter for a new line"}
      </p>
    </form>
  );
}

function CustomerPanel({ conversation: c }: { conversation: ConversationDetail }) {
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 xl:block" aria-label="Customer details">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Customer</h3>
      <dl className="mt-2 space-y-1 text-sm">
        <div><dt className="inline text-slate-500">Name: </dt><dd className="inline">{c.customer.name ?? "—"}</dd></div>
        <div><dt className="inline text-slate-500">Phone: </dt><dd className="inline">{c.customer.phone ?? "—"}</dd></div>
        <div><dt className="inline text-slate-500">Channel: </dt><dd className="inline">{channelLabel[c.channel]}</dd></div>
      </dl>

      <h3 className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">Orders in this chat</h3>
      {c.orders.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {c.orders.map((o) => (
            <li key={o.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
              <div className="flex justify-between font-medium">
                <span>#{o.number}</span>
                <Badge color={o.status === "CANCELLED" ? "red" : o.status === "DELIVERED" ? "green" : "amber"}>{o.status.toLowerCase()}</Badge>
              </div>
              <ul className="mt-1 text-slate-600">
                {o.items.map((i) => (
                  <li key={i.itemId}>{i.quantity} × {i.name}</li>
                ))}
              </ul>
              <p className="mt-1 font-medium">{formatMoney(o.total)}</p>
              {o.address && <p className="text-xs text-slate-500">{o.deliveryType.toLowerCase()} · {o.address}</p>}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">Bookings in this chat</h3>
      {c.bookings.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {c.bookings.map((b) => (
            <li key={b.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
              <p className="font-medium">{new Date(b.startsAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              <p className="text-slate-600">{b.partySize} people · {b.contactName}</p>
              <Badge color={b.status === "CANCELLED" ? "red" : "green"}>{b.status.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
