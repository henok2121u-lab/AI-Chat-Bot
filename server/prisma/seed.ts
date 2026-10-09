// Seeds a demo Addis Ababa restaurant. Safe to re-run: the demo business is
// deleted (cascading to its data) and recreated each time.

import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/db.js";

const db = createPrismaClient();

const DEMO_BUSINESS_ID = "demo-selam-kitchen";
const DEMO_EMAIL = "demo@supportbot.test";
const DEMO_PASSWORD = "demo1234";

const hours = {
  mon: [{ open: "07:00", close: "22:30" }],
  tue: [{ open: "07:00", close: "22:30" }],
  wed: [{ open: "07:00", close: "22:30" }],
  thu: [{ open: "07:00", close: "22:30" }],
  fri: [{ open: "07:00", close: "23:00" }],
  sat: [{ open: "07:00", close: "23:00" }],
  sun: [{ open: "08:00", close: "22:00" }],
};

const policies = `
Delivery: Bole, Gerji, Megenagna, Kazanchis and Olympia only. Delivery fee 100 ETB; free for orders of 2,000 ETB or more. Minimum delivery order 400 ETB. Usual delivery time 45–60 minutes.
Payment: cash, Telebirr, CBE Birr, or transfer to our Commercial Bank of Ethiopia account (details given after the order is confirmed). Delivery orders are paid on arrival.
Cancellations: orders can be cancelled free of charge within 10 minutes of confirmation.
Reservations: tables for up to 12 people can be booked by chat. Larger groups and private events, please ask to speak with staff.
Prices include 15% VAT. A 10% service charge applies to dine-in only.
`.trim();

type SeedMenuItem = { name: string; description: string; price: number; available?: boolean };

const menu: Record<string, SeedMenuItem[]> = {
  Breakfast: [
    { name: "Ful Medames", description: "Mashed fava beans with tomato, onion, green chili, egg and olive oil, served with bread.", price: 220 },
    { name: "Chechebsa (Kita Firfir)", description: "Shredded flatbread tossed in niter kibbeh and berbere, served with honey and yogurt.", price: 280 },
    { name: "Enkulal Firfir", description: "Ethiopian-style scrambled eggs with tomato, onion and jalapeño, served with bread.", price: 250 },
    { name: "Injera Firfir", description: "Torn injera sautéed in spicy berbere sauce.", price: 260 },
    { name: "Genfo", description: "Thick barley porridge with a well of niter kibbeh and berbere.", price: 300 },
  ],
  "Fasting (Vegan)": [
    { name: "Beyaynetu", description: "Fasting combo on injera: shiro, misir wat, kik alicha, gomen, tikil gomen and timatim salad.", price: 380 },
    { name: "Shiro Tegabino", description: "Bubbling chickpea-flour stew served in a clay pot.", price: 320 },
    { name: "Misir Wat", description: "Red lentils simmered in berbere sauce.", price: 280 },
    { name: "Atkilt Wat", description: "Cabbage, potato and carrot stewed with turmeric and garlic.", price: 260 },
  ],
  "Meat Dishes": [
    { name: "Doro Wat", description: "Slow-cooked spicy chicken stew with a boiled egg and ayib, served with injera.", price: 950 },
    { name: "Special Kitfo", description: "Minced beef with mitmita and niter kibbeh, served with ayib and gomen. Raw (tere), rare (leb leb) or cooked (yebesele).", price: 1100 },
    { name: "Derek Tibs", description: "Crispy pan-fried beef cubes with onion, rosemary and green pepper.", price: 850 },
    { name: "Zilzil Tibs", description: "Strips of beef sautéed with onion, tomato and berbere.", price: 900 },
    { name: "Shekla Tibs", description: "Lamb served sizzling on a clay pot over hot coals. Serves 2.", price: 1200 },
    { name: "Gored Gored", description: "Raw cubed beef with awaze and mitmita.", price: 1000, available: false },
  ],
  Sides: [
    { name: "Extra Injera", description: "One roll of fresh teff injera.", price: 40 },
    { name: "Ayib", description: "Fresh Ethiopian cottage cheese.", price: 120 },
    { name: "Gomen", description: "Collard greens sautéed with garlic.", price: 150 },
  ],
  Drinks: [
    { name: "Jebena Buna", description: "Traditional coffee from the clay jebena, per cup.", price: 80 },
    { name: "Macchiato", description: "Ethiopian-style macchiato.", price: 70 },
    { name: "Spris Juice", description: "Layered avocado, mango and papaya juice.", price: 160 },
    { name: "Avocado Juice", description: "Fresh thick avocado juice.", price: 180 },
    { name: "Ambo Mineral Water", description: "Sparkling mineral water, 500 ml.", price: 60 },
    { name: "Bottled Water", description: "Still water, 500 ml.", price: 40 },
    { name: "Soft Drink", description: "Coca-Cola, Fanta or Sprite, 330 ml.", price: 60 },
    { name: "Habesha Beer", description: "Local lager, 330 ml bottle.", price: 120 },
    { name: "Tej", description: "Traditional honey wine, served in a berele.", price: 250 },
  ],
};

const faqs: { question: string; answer: string }[] = [
  {
    question: "What are your opening hours?",
    answer: "Monday–Thursday 7:00–22:30, Friday–Saturday 7:00–23:00, Sunday 8:00–22:00.",
  },
  {
    question: "Where are you located?",
    answer: "Bole Medhanialem, behind Edna Mall, Addis Ababa. Look for the green gate next to the pharmacy.",
  },
  {
    question: "Do you deliver?",
    answer: "Yes — to Bole, Gerji, Megenagna, Kazanchis and Olympia. Delivery is 100 ETB, free for orders of 2,000 ETB or more, minimum order 400 ETB. It usually takes 45–60 minutes.",
  },
  {
    question: "How can I pay?",
    answer: "Cash, Telebirr, CBE Birr, or bank transfer to our Commercial Bank of Ethiopia account. Delivery orders are paid on arrival.",
  },
  {
    question: "Do you have fasting / vegan food?",
    answer: "Yes. Our fasting menu (Beyaynetu, Shiro Tegabino, Misir Wat, Atkilt Wat) is served all day, every day — not only on Wednesdays, Fridays and during Lent.",
  },
  {
    question: "Do you have a coffee ceremony?",
    answer: "Yes, a traditional coffee ceremony every afternoon from 15:00 to 18:00. Jebena buna is 80 ETB per cup.",
  },
  {
    question: "Can I book a table?",
    answer: "Yes, you can book a table for up to 12 people here in the chat. For bigger groups or private events we'll connect you with our staff.",
  },
  {
    question: "Is there parking?",
    answer: "Yes, free parking for about 10 cars in our compound, plus street parking nearby.",
  },
  {
    question: "Do you have Wi-Fi?",
    answer: "Yes, free Wi-Fi for dine-in guests. Ask the waiter for the password.",
  },
  {
    question: "Is the kitfo raw?",
    answer: "You choose: tere (raw), leb leb (lightly warmed, rare) or yebesele (fully cooked).",
  },
];

async function main() {
  await db.business.deleteMany({ where: { id: DEMO_BUSINESS_ID } });

  const business = await db.business.create({
    data: {
      id: DEMO_BUSINESS_ID,
      name: "Selam Habesha Kitchen",
      type: "RESTAURANT",
      description:
        "Family-run Ethiopian restaurant in Bole serving traditional dishes, a full fasting menu and a daily coffee ceremony.",
      hours,
      timezone: "Africa/Addis_Ababa",
      currency: "ETB",
      location: "Bole Medhanialem, behind Edna Mall, Addis Ababa",
      phone: "+251 900 000 000",
      policies,
      bookingSlotCapacity: 6,
      deliveryFee: 100,
      freeDeliveryThreshold: 2000,
      minDeliveryOrder: 400,
      botEnabled: true,
    },
  });

  await db.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      name: "Selam (Owner)",
      role: "OWNER",
      businessId: business.id,
    },
  });

  let sortOrder = 0;
  await db.menuItem.createMany({
    data: Object.entries(menu).flatMap(([category, items]) =>
      items.map((item) => ({
        businessId: business.id,
        category,
        name: item.name,
        description: item.description,
        price: item.price,
        available: item.available ?? true,
        sortOrder: sortOrder++,
      })),
    ),
  });

  await db.faq.createMany({
    data: faqs.map((faq, i) => ({ businessId: business.id, ...faq, sortOrder: i })),
  });

  const menuCount = await db.menuItem.count({ where: { businessId: business.id } });
  console.log(`Seeded "${business.name}" (${business.id}): ${menuCount} menu items, ${faqs.length} FAQs.`);
  console.log(`Dashboard login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
