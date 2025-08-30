// src/lib/role-routes.ts
export type Claims = {
  admin?: boolean;
  kitchen?: boolean;
  waiter?: boolean;
  delivery?: boolean;
  cashier?: boolean;
  role?: string;
  [k: string]: any;
};

export type RoleFlags = {
  isAdmin?: boolean;
  isKitchen?: boolean;
  isWaiter?: boolean;
  isDelivery?: boolean;
  isCashier?: boolean;
  // isCustomer?: boolean; // opcional si lo usas
};

export function pickRouteByRole(
  flags: RoleFlags = {},
  claims?: Claims | null
): string {
  const role = (claims?.role || "").toLowerCase();

  if (flags.isAdmin || role === "admin" || claims?.admin) return "/admin";
  if (flags.isKitchen || role === "kitchen" || claims?.kitchen) return "/ops/kitchen";
  if (flags.isWaiter || role === "waiter" || claims?.waiter) return "/ops/waiter";
  if (flags.isDelivery || role === "delivery" || claims?.delivery) return "/ops/delivery";
  if (flags.isCashier || role === "cashier" || claims?.cashier) return "/ops";

  // Cliente / invitado
  return "/app";
}
