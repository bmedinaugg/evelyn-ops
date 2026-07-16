"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/conversations", label: "Conversations" },
  { href: "/evaluation", label: "Bot evaluation" },
  { href: "/feedback", label: "Feedback" },
  { href: "/board", label: "Board" },
  { href: "/tickets", label: "Tickets" },
  { href: "/failures", label: "Dev fails" },
  { href: "/faq-proposals", label: "FAQ proposals" },
];

const SOON: string[] = [];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div className="brand">
        Evelyn Ops
        <small>TrainMore · Member Care</small>
      </div>
      {LINKS.map((l) => {
        const active =
          pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`navlink${active ? " active" : ""}`}
          >
            {l.label}
          </Link>
        );
      })}
      {SOON.map((s) => (
        <span key={s} className="navlink soon" title="Coming in a later phase">
          {s} <span className="muted">· soon</span>
        </span>
      ))}
      <div className="spacer" />
      <div className="who">
        {email}
        <br />
        <Link href="/auth/signout" prefetch={false}>
          Sign out
        </Link>
      </div>
    </nav>
  );
}
