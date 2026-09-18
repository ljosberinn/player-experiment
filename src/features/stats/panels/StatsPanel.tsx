import type { ReactNode } from "react";

export interface StatsPanelProps {
  readonly title: string;
  /** A control belonging to this panel alone - an export, a toggle. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The box one panel sits in: a heading, whatever control is its own, and the
 * figure under both.
 *
 * A component rather than repeated markup because the heading level is a
 * document-structure decision rather than a per-panel one - the tab strip is
 * the view's heading, so every panel under it is one level down, and a panel
 * that picked its own would break the outline for a screen reader walking it.
 */
export function StatsPanel({ title, action, children }: StatsPanelProps) {
  return (
    <section className="stats-panel">
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}
