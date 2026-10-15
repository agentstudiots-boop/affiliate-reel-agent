import type { Metadata } from "next";
import { CommandCenter } from "@/app/architecture/command-center";

export const metadata: Metadata = {
  title: "Command Center – Affiliate Content Studio",
  robots: { index: false, follow: false },
};

// Own page of the Command Center. Only reachable with the operator session: proxy.ts redirects to /login, and the data
// route /api/architecture checks the session again on the server. Read only.
export default function ArchitecturePage() {
  return <main className="ccPageMain"><CommandCenter standalone /></main>;
}
