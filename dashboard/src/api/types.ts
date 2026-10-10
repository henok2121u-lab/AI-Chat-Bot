// Shapes returned by the server's /api routes. Money comes back as strings
// (Prisma Decimal), dates as ISO strings.

export type Role = "OWNER" | "STAFF";
export type BusinessType = "RESTAURANT" | "CLINIC" | "SALON" | "OTHER";
export type Channel = "TELEGRAM" | "WHATSAPP" | "CLI";
export type ConversationMode = "BOT" | "HUMAN";
export type MessageRole = "CUSTOMER" | "BOT" | "AGENT";
export type OrderStatus = "NEW" | "CONFIRMED" | "READY" | "DELIVERED" | "CANCELLED";
export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export interface Session {
  user: { id: string; email: string; name: string | null; role: Role };
  business: { id: string; name: string; type: BusinessType };
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WeeklyHours = Partial<Record<Weekday, { open: string; close: string }[]>>;

export interface Business {
  id: string;
  name: string;
  type: BusinessType;
  description: string | null;
  hours: WeeklyHours;
  timezone: string;
  currency: string;
  location: string | null;
  phone: string | null;
  policies: string | null;
  bookingSlotCapacity: number;
  deliveryFee: string;
  freeDeliveryThreshold: string | null;
  minDeliveryOrder: string | null;
  botEnabled: boolean;
  channels: {
    telegram: { connected: boolean; botUsername: string | null };
    whatsapp: { connected: boolean; phoneNumberId: string | null };
  };
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  available: boolean;
  sortOrder: number;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  available: boolean;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  channel: Channel;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string;
}

interface ConversationBase {
  id: string;
  channel: Channel;
  mode: ConversationMode;
  needsAttention: boolean;
  handoffReason: string | null;
  lastMessageAt: string;
  lastCustomerMessageAt: string | null;
  replyWindowEndsAt: string | null;
  canReply: boolean;
  customer: Customer;
}

export interface ConversationSummary extends ConversationBase {
  lastMessage: Pick<Message, "role" | "text" | "createdAt"> | null;
}

export interface OrderItem {
  itemId: string;
  name: string;
  unitPrice: string;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  number: number;
  conversationId: string | null;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: string;
  deliveryFee: string;
  total: string;
  deliveryType: "PICKUP" | "DELIVERY" | "DINE_IN";
  address: string | null;
  phone: string | null;
  createdAt: string;
  /** Present on /orders responses (not on orders embedded in a conversation). */
  customer?: Customer;
}

export interface Booking {
  id: string;
  conversationId: string | null;
  startsAt: string;
  partySize: number;
  contactName: string;
  contactPhone: string;
  status: BookingStatus;
  /** Present on /bookings responses. */
  customer?: Customer;
  service?: { id: string; name: string; durationMin: number } | null;
}

export interface ConversationDetail extends ConversationBase {
  messages: Message[];
  orders: Order[];
  bookings: Booking[];
}
