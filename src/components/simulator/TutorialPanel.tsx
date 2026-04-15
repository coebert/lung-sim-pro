import { useState, useEffect, useCallback } from 'react';
import { VentSettings, Vitals, MeasuredValues, PatientPhysiology } from '@/lib/simulation/types';
import { getTutorialForPatient, TutorialScenario, TutorialStep } from '@/lib/simulation/tutorials';
import { GraduationCap, ChevronRight, ChevronLeft, X, CheckCircle2, Lightbulb, RotateCcw, Trophy } from 'lucide-react';

interface TutorialPanelProps {
  patient: PatientPhysiology;
  settings: VentSettings;
  vitals: Vitals;
  measured: MeasuredValues;
  onSelectPatient?: (patientId: string) => void;
  onClose: () => void;
}

export function TutorialPanel({ patient, settings, vitals, measured, onSelectPatient, onClose }: TutorialPanelProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showHint, setShowHint] = useState(false);
  const [showComplete, setShowComplete] = useState(false);

  const tutorial = getTutorialForPatient(patient.id);

  // Reset when patient changes
  useEffect(() => {
    setCurrentStep(0);
    setCompletedSteps(new Set());
    setShowHint(false);
    setShowComplete(false);
  }, [patient.id]);

  // Check current step completion
  useEffect(() => {
    if (!tutorial) return;
    const step = tutorial.steps[currentStep];
    if (!step || completedSteps.has(currentStep)) return;

    if (step.check(settings, vitals, measured)) {
      setCompletedSteps(prev => {
        const next = new Set(prev);
        next.add(currentStep);
        return next;
      });
    }
  }, [settings, vitals, measured, currentStep, tutorial, completedSteps]);

  // Check if all steps complete
  useEffect(() => {
    if (!tutorial) return;
    if (completedSteps.size === tutorial.steps.length && !showComplete) {
      setShowComplete(true);
    }
  }, [completedSteps, tutorial, showComplete]);

  if (!tutorial) {
    return (
      <div className="flex flex-col h-full bg-secondary rounded border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <GraduationCap className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-foreground">Tutorial Mode</span>
          </div>
          <button onClick={onClose} className="p-0.5 hover:bg-muted rounded">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">No tutorial available for this patient. Select a different patient to begin a guided scenario.</p>
      </div>
    );
  }

  const step = tutorial.steps[currentStep];
  const isStepComplete = completedSteps.has(currentStep);
  const allComplete = completedSteps.size === tutorial.steps.length;
  const progress = (completedSteps.size / tutorial.steps.length) * 100;

  const handleReset = useCallback(() => {
    setCurrentStep(0);
    setCompletedSteps(new Set());
    setShowHint(false);
    setShowComplete(false);
  }, []);

  if (showComplete && allComplete) {
    return (
      <div className="flex flex-col h-full bg-secondary rounded border border-border overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <span className="text-xs font-bold text-foreground">Scenario Complete!</span>
          </div>
          <button onClick={onClose} className="p-0.5 hover:bg-muted rounded">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <h3 className="text-sm font-bold text-foreground mb-2">{tutorial.title}</h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{tutorial.summary}</p>
          <div className="flex flex-col gap-1.5">
            {tutorial.steps.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                <span className="text-[10px] text-foreground">{s.title}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleReset}
            className="mt-3 flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-secondary rounded border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-primary/10 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <GraduationCap className="w-4 h-4 text-primary shrink-0" />
          <span className="text-[10px] font-bold text-foreground truncate">Tutorial</span>
        </div>
        <button onClick={onClose} className="p-0.5 hover:bg-muted rounded shrink-0">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-2 py-1 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-muted-foreground">
            Step {currentStep + 1} of {tutorial.steps.length}
          </span>
          <span className="text-[9px] text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-0">
        {/* Scenario intro (only on step 0 before completion) */}
        {currentStep === 0 && !completedSteps.has(0) && (
          <div className="mb-2 p-1.5 bg-muted/50 rounded text-[10px] text-muted-foreground leading-relaxed">
            {tutorial.introduction}
          </div>
        )}

        {/* Step dots */}
        <div className="flex items-center gap-1 mb-2">
          {tutorial.steps.map((_, i) => (
            <button
              key={i}
              onClick={() => { setCurrentStep(i); setShowHint(false); }}
              className={`w-2 h-2 rounded-full transition-colors ${
                completedSteps.has(i) ? 'bg-green-500' :
                i === currentStep ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
              title={`Step ${i + 1}`}
            />
          ))}
        </div>

        {/* Current step */}
        <div className={`rounded p-2 border transition-colors ${
          isStepComplete ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-background/50'
        }`}>
          <div className="flex items-start gap-1.5 mb-1">
            {isStepComplete ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border-2 border-primary shrink-0 mt-0.5" />
            )}
            <h4 className="text-[11px] font-bold text-foreground leading-tight">{step.title}</h4>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed ml-5">
            {step.instruction}
          </p>

          {isStepComplete && (
            <div className="mt-1.5 ml-5 p-1.5 bg-green-500/10 rounded text-[10px] text-green-400 leading-relaxed">
              ✓ {step.successMessage}
            </div>
          )}

          {!isStepComplete && (
            <button
              onClick={() => setShowHint(h => !h)}
              className="mt-1.5 ml-5 flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors"
            >
              <Lightbulb className="w-3 h-3" />
              {showHint ? 'Hide hint' : 'Show hint'}
            </button>
          )}

          {showHint && !isStepComplete && (
            <div className="mt-1 ml-5 p-1.5 bg-yellow-500/10 rounded text-[10px] text-yellow-300/80 leading-relaxed">
              💡 {step.hint}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-border shrink-0">
        <button
          onClick={() => { setCurrentStep(s => Math.max(0, s - 1)); setShowHint(false); }}
          disabled={currentStep === 0}
          className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>
        {isStepComplete && currentStep < tutorial.steps.length - 1 ? (
          <button
            onClick={() => { setCurrentStep(s => s + 1); setShowHint(false); }}
            className="flex items-center gap-0.5 text-[10px] text-primary font-bold hover:text-primary/80 transition-colors"
          >
            Next
            <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          <button
            onClick={handleReset}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
