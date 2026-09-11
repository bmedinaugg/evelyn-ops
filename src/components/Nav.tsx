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
      // Performance replaced "Bot helped" (9 conversations a week, keyed on
      // whether the member said thanks). It sits first because "did Evelyn do
      // her job" is the question the other pages get read as answering.
      { href: "/performance", label: "Performance", icon: "✅" },
      { href: "/sentiment", label: "Sentiment", icon: "🌡️" },
      { href: "/evaluation", label: "Bot evaluation", icon: "🎯" },
      { href: "/tickets", label: "Tickets", icon: "🎫" },
      // Two libraries, deliberately separate: /scenarios is what the bot
      // RECOGNISES, /library is what it DOES about it and where the answer
      // comes from.
      { href: "/scenarios", label: "Scenario library", icon: "📖" },
      { href: "/library", label: "Case library", icon: "📚" },
      // And a third, one level further back: /knowledge is what FEEDS the
      // answers — the documents and syncs behind them, including the ones that
      // produced no FAQ and the ones nothing actually reads.
      { href: "/knowledge", label: "Knowledge register", icon: "🗃️" },
      // The short version of all three, for anyone who wants one question
      // traced end to end rather than a library to browse.
      { href: "/questions", label: "How a question gets answered", icon: "❓" },
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
    items: [
      { href: "/failures", label: "Dev fails", icon: "⚠️" },
      { href: "/regression-tests", label: "Regression tests", icon: "🧪" },
    ],
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
