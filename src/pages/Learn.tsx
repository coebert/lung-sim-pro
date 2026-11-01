import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { learnSections } from '@/lib/learning';

const Learn = () => {
  const navigate = useNavigate();
  return (
    <div className="h-dvh flex flex-col bg-background">
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} aria-label="Back to simulator">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-sm font-bold text-foreground">Learn</h1>
      </div>
      <main className="flex-1 overflow-y-auto px-4 py-4 max-w-2xl w-full mx-auto">
        {learnSections.map((sec) => (
          <section key={sec.id} className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">{sec.heading}</h2>
            <Accordion type="multiple">
              {sec.items.map((it) => (
                <AccordionItem key={it.title} value={it.title}>
                  <AccordionTrigger className="text-sm text-foreground text-left">{it.title}</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-muted-foreground">
                    {it.body.map((b, i) => <p key={i}>{b}</p>)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        ))}
        <p className="text-xs text-muted-foreground pb-6">For education only — not a substitute for clinical training or local guidelines.</p>
      </main>
    </div>
  );
};

export default Learn;
