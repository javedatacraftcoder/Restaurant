// src/app/api/cart/quote/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { PricingQuoteSchema } from "@/lib/validators/cart";
import { priceCartItems } from "@/lib/server/pricing";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }
    const raw = await req.json();
    const parsed = PricingQuoteSchema.safeParse({
      items: raw?.items,
      tipAmount: raw?.tipAmount,
      couponCode: raw?.couponCode,
    });
    if (!parsed.success) {
      return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    }
    const quote = await priceCartItems(parsed.data);
    return json(quote, 200);
  } catch (e: any) {
    const known = new Set([
      "MENU_ITEM_NOT_FOUND",
      "MENU_ITEM_UNAVAILABLE",
      "CURRENCY_MISMATCH",
      "INVALID_GROUP_FOR_ITEM",
      "GROUP_MIN_VIOLATION",
      "GROUP_MAX_VIOLATION",
      "OPTION_NOT_FOUND",
      "OPTION_INACTIVE",
      "OPTION_WRONG_GROUP",
    ]);
    if (known.has(e?.message)) {
      return json({ error: "Selección inválida", code: e.message }, 422);
    }
    console.error("[POST /api/cart/quote]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
