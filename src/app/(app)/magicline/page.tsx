import Link from "next/link";
import { getMagiclineCapabilities } from "@/lib/queries";
import { MagiclineCapabilities } from "../knows/MagiclineCapabilities";

export const dynamic = "force-dynamic";

// The third knowledge page: the half of what Evelyn knows that is not a
// document. Contract dates, balances, check-ins, bookings and access blocks are
// read live from Magicline per question and stored nowhere, so they can never
// appear in the article list on /knows — which is exactly why they went
// unlisted for so long.
export default async function MagiclinePage() {
  const caps = await getMagiclineCapabilities();

  return (
    <>
      <div className="pagehead">
        <h1>Magicline</h1>
        <p className="muted">
          What Evelyn can look up live about a member or a club, and what Member
          Care wants her answering.
        </p>
      </div>

      <div className="panel">
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch", margin: 0 }}>
          The other two knowledge pages are about documents:{" "}
          <Link href="/knows" prefetch={false}>what she knows</Link> is what is
          inside them, <Link href="/gaps" prefetch={false}>gaps</Link> is what
          members ask that none of them cover. Nothing on this page is a
          document. These answers are fetched at the moment the question is
          asked and kept nowhere afterwards.
        </p>
      </div>

      <MagiclineCapabilities caps={caps} back="/magicline" />
    </>
  );
}
