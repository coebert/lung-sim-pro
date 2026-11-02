import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export const SUPPORT_EMAIL = 'support@anaesthesiacore.app';

/** Shared shell for Support / Privacy pages: safe-area aware, scrollable, back to simulator. */
export function InfoPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app-safe-area h-dvh flex flex-col bg-background">
      <header className="flex items-center gap-2 px-3 py-2 bg-secondary border-b border-border shrink-0">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden /> Back to simulator
        </Link>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-5 max-w-2xl w-full mx-auto text-sm text-muted-foreground leading-relaxed space-y-5">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        {children}
        <nav aria-label="App information" className="pt-4 border-t border-border flex gap-4 text-xs">
          <Link to="/support" className="text-primary underline-offset-2 hover:underline">Support</Link>
          <Link to="/privacy" className="text-primary underline-offset-2 hover:underline">Privacy</Link>
          <Link to="/" className="text-primary underline-offset-2 hover:underline">Simulator</Link>
        </nav>
      </main>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function EmailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary font-medium underline underline-offset-2 whitespace-nowrap">
      {SUPPORT_EMAIL}
    </a>
  );
}
