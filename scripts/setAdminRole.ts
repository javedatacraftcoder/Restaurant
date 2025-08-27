// scripts/setAdminRole.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import "dotenv/config";

import { adminAuth } from "../src/lib/firebase/admin";

// --- Helpers argv ---
function getArg(name: string): string | undefined {
  const kv = process.argv.find((a) => a.startsWith(name + "="));
  return kv ? kv.split("=").slice(1).join("=") : undefined;
}

function parseBool(v: any): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
}

const VALID_ROLES = ["admin", "kitchen", "waiter", "delivery", "cashier"] as const;
type RoleKey = typeof VALID_ROLES[number];

function ensureValidRole(r: string): r is RoleKey {
  return (VALID_ROLES as readonly string[]).includes(r);
}

async function resolveUid(input?: string): Promise<string> {
  if (!input) throw new Error("Debes pasar email=<...> o uid=<...>");
  if (input.includes("@")) {
    const user = await adminAuth.getUserByEmail(input);
    if (!user?.uid) throw new Error("No se encontró el usuario por email.");
    return user.uid;
  }
  // asume que es uid
  const u = await adminAuth.getUser(input);
  if (!u?.uid) throw new Error("No se encontró el usuario por uid.");
  return u.uid;
}

function parseSetArg(setArg?: string): Partial<Record<RoleKey, boolean>> {
  const out: Partial<Record<RoleKey, boolean>> = {};
  if (!setArg) return out;
  const pairs = setArg.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of pairs) {
    const [k, v] = p.split(":");
    const key = (k || "").trim();
    const bool = parseBool(v);
    if (!ensureValidRole(key)) {
      console.warn(`(ignorado) Rol inválido en set=: ${key}`);
      continue;
    }
    if (bool === undefined) {
      console.warn(`(ignorado) Valor inválido para ${key} en set= (usa true/false).`);
      continue;
    }
    out[key] = bool;
  }
  return out;
}

function parseListArg(listArg?: string): RoleKey[] {
  if (!listArg) return [];
  const parts = listArg.split(",").map((s) => s.trim()).filter(Boolean);
  const roles: RoleKey[] = [];
  for (const p of parts) {
    if (ensureValidRole(p)) roles.push(p);
    else console.warn(`(ignorado) Rol inválido: ${p}`);
  }
  return roles;
}

async function main() {
  const email = getArg("email");
  const uidArg = getArg("uid");
  const userKey = email || uidArg;
  if (!userKey) {
    console.log(`Uso:
  npx tsx scripts/setAdminRole.ts email=usuario@dominio.com add=admin
  npx tsx scripts/setAdminRole.ts uid=ABCDEFG remove=kitchen
  npx tsx scripts/setAdminRole.ts email=usuario@dominio.com set=admin:true,cashier:true,delivery:false
  npx tsx scripts/setAdminRole.ts email=usuario@dominio.com show=true

Roles válidos: ${VALID_ROLES.join(", ")}
`);
    process.exit(1);
  }

  const uid = await resolveUid(userKey);

  const add = parseListArg(getArg("add"));
  const remove = parseListArg(getArg("remove"));
  const setMap = parseSetArg(getArg("set"));
  const showOnly = parseBool(getArg("show")) === true;

  const user = await adminAuth.getUser(uid);
  const current = (user.customClaims || {}) as Record<string, any>;

  console.log(`Usuario: ${user.email || user.uid}`);
  console.log("Claims actuales:", current);

  if (showOnly) {
    console.log("(show=true) No se hicieron cambios.");
    return;
  }

  // Construye claims resultantes sin perder otras propiedades
  const next: Record<string, any> = { ...current };

  // set= tiene prioridad sobre add/remove en la misma ejecución
  const hasSet = Object.keys(setMap).length > 0;
  if (hasSet) {
    for (const role of VALID_ROLES) {
      if (typeof setMap[role] === "boolean") {
        next[role] = !!setMap[role];
      }
    }
  } else {
    // add
    for (const role of add) next[role] = true;
    // remove
    for (const role of remove) next[role] = false;
  }

  // Asegura booleanos
  for (const role of VALID_ROLES) {
    if (typeof next[role] !== "boolean") continue;
    next[role] = !!next[role];
  }

  await adminAuth.setCustomUserClaims(uid, next);

  console.log("✅ Claims actualizados:", next);
  console.log("Importante: el usuario debe CERRAR SESIÓN o refrescar su ID token para ver los cambios (getIdToken(true)).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
