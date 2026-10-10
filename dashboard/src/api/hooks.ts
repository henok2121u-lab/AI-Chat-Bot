import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  Booking,
  BookingStatus,
  Business,
  ConversationDetail,
  ConversationMode,
  ConversationSummary,
  Faq,
  MenuItem,
  Message,
  Order,
  OrderStatus,
  Service,
  Session,
} from "./types";

/** How often the inbox refreshes (live updates by polling; SSE later). */
export const POLL_MS = 5000;

export const keys = {
  me: ["me"] as const,
  business: ["business"] as const,
  menuItems: ["menu-items"] as const,
  services: ["services"] as const,
  faqs: ["faqs"] as const,
  conversations: (filter: string) => ["conversations", filter] as const,
  conversation: (id: string) => ["conversation", id] as const,
  orders: (statuses: string) => ["orders", statuses] as const,
  bookings: (from: string, to: string) => ["bookings", from, to] as const,
};

// --- Session ---------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<Session>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api<Session>("/auth/login", { method: "POST", body }),
    onSuccess: (session) => qc.setQueryData(keys.me, session),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { businessName: string; businessType: string; name: string; email: string; password: string }) =>
      api<Session>("/auth/register", { method: "POST", body }),
    onSuccess: (session) => qc.setQueryData(keys.me, session),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.clear(),
  });
}

// --- Business & knowledge --------------------------------------------------

export function useBusiness() {
  return useQuery({ queryKey: keys.business, queryFn: () => api<Business>("/business") });
}

export function useUpdateBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Omit<Business, "id" | "channels">>) => api<Business>("/business", { method: "PATCH", body }),
    onSuccess: (business) => {
      qc.setQueryData(keys.business, business);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

/** List + create/update/delete hooks for a simple REST collection. */
function collection<T extends { id: string }, Input>(path: string, key: QueryKey) {
  return {
    useList: () => useQuery({ queryKey: key, queryFn: () => api<T[]>(path) }),
    useSave: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, ...body }: Partial<Input> & { id?: string }) =>
          id ? api<T>(`${path}/${id}`, { method: "PATCH", body }) : api<T>(path, { method: "POST", body }),
        onSuccess: () => qc.invalidateQueries({ queryKey: key }),
      });
    },
    useRemove: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (id: string) => api<void>(`${path}/${id}`, { method: "DELETE" }),
        onSuccess: () => qc.invalidateQueries({ queryKey: key }),
      });
    },
  };
}

export type MenuItemInput = Omit<MenuItem, "id" | "price"> & { price: string | number };
export type ServiceInput = Omit<Service, "id" | "price"> & { price: string | number };
export type FaqInput = Omit<Faq, "id">;

export const menuItems = collection<MenuItem, MenuItemInput>("/menu-items", keys.menuItems);
export const services = collection<Service, ServiceInput>("/services", keys.services);
export const faqs = collection<Faq, FaqInput>("/faqs", keys.faqs);

// --- Inbox -----------------------------------------------------------------

export type InboxFilter = "all" | "attention" | "human";

export function useConversations(filter: InboxFilter) {
  return useQuery({
    queryKey: keys.conversations(filter),
    queryFn: () => api<ConversationSummary[]>(`/conversations?filter=${filter}`),
    refetchInterval: POLL_MS,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? ""),
    queryFn: () => api<ConversationDetail>(`/conversations/${id}`),
    enabled: !!id,
    refetchInterval: POLL_MS,
  });
}

function useRefreshInbox() {
  const qc = useQueryClient();
  return (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.conversation(id) }),
      qc.invalidateQueries({ queryKey: ["conversations"] }),
    ]);
}

export function useUpdateConversation() {
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; mode?: ConversationMode; needsAttention?: boolean }) =>
      api(`/conversations/${id}`, { method: "PATCH", body }),
    onSuccess: (_data, { id }) => refresh(id),
  });
}

export function useSendReply() {
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api<Message>(`/conversations/${id}/messages`, { method: "POST", body: { text } }),
    onSuccess: (_data, { id }) => refresh(id),
  });
}

// --- Orders & bookings -------------------------------------------------------

/** `statuses` is a comma-separated list ("" for all). Polls so new bot orders appear. */
export function useOrders(statuses: string) {
  return useQuery({
    queryKey: keys.orders(statuses),
    queryFn: () => api<Order[]>(`/orders?limit=100${statuses ? `&status=${statuses}` : ""}`),
    refetchInterval: POLL_MS,
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api<Order>(`/orders/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["conversation"] })]),
  });
}

export function useBookings(from: string, to: string) {
  return useQuery({
    queryKey: keys.bookings(from, to),
    queryFn: () => api<Booking[]>(`/bookings?limit=500&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    refetchInterval: POLL_MS * 6,
  });
}

export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: BookingStatus }) =>
      api<Booking>(`/bookings/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ["bookings"] }), qc.invalidateQueries({ queryKey: ["conversation"] })]),
  });
}
