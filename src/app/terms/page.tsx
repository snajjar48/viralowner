import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "viralowner — terms and conditions",
  robots: { index: false, follow: false },
};

// Placeholder: replace with your real terms before launch.
export default function TermsPage() {
  return (
    <AuthShell title="Terms and conditions">
      <p className="text-center text-muted">
        Our full terms are on the way. Questions? Email{" "}
        <a href="mailto:hello@viralowner.com" className="text-foreground underline underline-offset-4">
          hello@viralowner.com
        </a>
        .
      </p>
    </AuthShell>
  );
}
