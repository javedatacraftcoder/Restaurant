// src/components/AuthButtons.tsx
"use client";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";

export default function AuthButtons() {
  const { user, loading, flags } = useAuth();
  if (loading) return null;

  if (user) {
    const isOp = flags.isAdmin || flags.isKitchen || flags.isWaiter || flags.isDelivery || flags.isCashier;
    const primaryHref = flags.isAdmin ? "/admin" : isOp ? "/ops" : "/app";

    return (
      <div className="d-flex align-items-center gap-2">
        <Link className="btn btn-sm btn-outline-light" href={primaryHref}>
          {flags.isAdmin ? "Admin" : isOp ? "Operaciones" : "Mi área"}
        </Link>
        <button className="btn btn-sm btn-warning" onClick={() => signOut(auth)}>
          Logout
        </button>
      </div>
    );
  }

  return <Link className="btn btn-sm btn-primary" href="/login">Login</Link>;
}
