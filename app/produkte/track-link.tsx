"use client";

import type { ReactNode } from "react";

// The visitor goes straight to the stored Amazon link; the beacon only counts the click.
export function TrackedLink({ id, href, className, children }: { id: string; href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className} target="_blank" rel="sponsored noopener noreferrer"
      onClick={() => { try { navigator.sendBeacon("/api/landing/click", new Blob([JSON.stringify({ id })], { type: "application/json" })); } catch { /* counting is best effort */ } }}>
      {children}
    </a>
  );
}
