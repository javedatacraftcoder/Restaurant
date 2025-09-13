// src/components/HomeNavbar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

export default function HomeNavbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2" href="/">
          <Image src="/logo-mark.svg" alt="Logo" width={28} height={28} />
          <span className="fw-semibold">OrderCraft</span>
        </Link>

        {/* Importante: sin data-bs-*, controlado por React */}
        <button
          className="navbar-toggler"
          type="button"
          aria-controls="homeNav"
          aria-expanded={open ? "true" : "false"}
          aria-label="Toggle navigation"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="navbar-toggler-icon"></span>
        </button>

        <div className={`collapse navbar-collapse ${open ? "show" : ""}`} id="homeNav">
          <ul className="navbar-nav me-auto mb-2 mb-md-0">
            <li className="nav-item">
              <Link className="nav-link" href="/menu" onClick={() => setOpen(false)}>
                Menu
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" href="/promos" onClick={() => setOpen(false)}>
                Promotions
              </Link>
            </li>
          </ul>
          <div className="d-flex gap-2">
            <Link className="btn btn-outline-primary btn-sm" href="/login" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link className="btn btn-primary btn-sm" href="/account" onClick={() => setOpen(false)}>
              Login
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
