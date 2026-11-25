import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL } from "@/content/legal";

/** A titled section of the terms or privacy policy. */
export function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-coral">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Email() {
  return (
    <a href={`mailto:${LEGAL.email}`} className="text-foreground underline underline-offset-4">
      {LEGAL.email}
    </a>
  );
}

export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}

export function Effective() {
  return <p className="text-xs">Last updated: {LEGAL.effectiveDate}</p>;
}
