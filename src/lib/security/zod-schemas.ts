// src/lib/security/zod-schemas.ts
import { z } from 'zod';

export const AddonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  extraPriceCents: z.number().int().min(0),
});

export const OrderItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1).max(100),
  unitPriceCents: z.number().int().min(0),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(300).optional(),
  addons: z.array(AddonSchema).max(20).default([]),
});

export const OrderCreateSchema = z.object({
  type: z.enum(['dine_in', 'delivery']),
  tableNumber: z.number().int().min(1).max(500).optional(),
  customerName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  addressLine1: z.string().max(120).optional(),
  addressLine2: z.string().max(120).optional(),
  notes: z.string().max(300).optional(),
  items: z.array(OrderItemSchema).min(1).max(100),
  tipCents: z.number().int().min(0).default(0),
});
