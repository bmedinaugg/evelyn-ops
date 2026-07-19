"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: string };

const SECTIONS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: "📊" }],
  },
  {
    title: "Review",
    items: [
      { href: "/conversations", label: "Conversations", icon: "💬" },
      { href: "/evaluation", label: "Bot evaluation", icon: "🎯" },
      { href: "/tickets", label: "Tickets", icon: "🎫" },
    ],
  },
  {
    title: "Team",
    items: [
      { href: "/feedback", label: "Feedback", icon: "📥" },
      { href: "/board", label: "Board", icon: "🗂️" },
      { href: "/faq-proposals", label: "FAQ proposals", icon: "💡" },
    ],
  },
  {
    title: "Developer",
    items: [{ href: "/failures", label: "Dev fails", icon: "⚠️" }],
  },
];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div className="brand">
        Evelyn Ops
        <small>TrainMore · Member Care</small>
      </div>
      {SECTIONS.map((section, i) => (
        <div key={i}>
          {section.title && (
            <div className="nav-section">{section.title}</div>
          )}
          {section.items.map((l) => {
            const active =
              pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`navlink${active ? " active" : ""}`}
              >
                <span className="icon">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </div>
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
