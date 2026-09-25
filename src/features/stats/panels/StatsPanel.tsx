import type { ReactNode } from "react";

export interface StatsPanelProps {
  readonly title: string;
  /** A control belonging to this panel alone - an export, a toggle. */
  readonly action?: ReactNode;
  /** What the figure covers, where that is less than everything. */
  readonly caption?: string | null;
  readonly children: ReactNode;
  /** Under the caption, so the caption stays beside the figure it qualifies. */
  readonly footer?: ReactNode;
}

/**
 * The box one panel sits in: a heading, whatever control is its own, and the
 * figure under both.
 *
 * A component rather than repeated markup because the heading level is a
 * document-structure decision rather than a per-panel one - the tab strip is
 * the view's heading, so every panel under it is one level down, and a panel
 * that picked its own would break the outline for a screen reader walking it.
 *
 * The caption is the panel's rather than a chart's: When you listen draws two
 * charts over one coverage, and drops one of them once it is empty.
 */
export function StatsPanel({ title, action, caption, children, footer }: StatsPanelProps) {
  return (
    <section className="stats-panel">
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
      {caption !== undefined && caption !== null && (
        <p className="stats-panel-caption">{caption}</p>
      )}
      {footer}
    </section>
  );
}
