import { Check } from 'lucide-react'
import type { Explanation } from '../../types/clinical'

interface ExplanationPanelProps {
  /** Null means generation was never attempted, which is a different fact from failure. */
  explanation: Explanation | null
}

/**
 * The plain-language rationale.
 *
 * Three outcomes, and they must not look alike:
 *
 *   generated    — the narrative, plus the record that it was checked against the
 *                  assessment it describes.
 *   unavailable  — generation was attempted and failed. The fixed string is shown
 *                  verbatim, and the score, band, inputs and ranked factors above all
 *                  remain. Only the narrative is withheld.
 *   absent       — generation was never attempted.
 *
 * Nothing is ever generated to fill an absence. A slot that signals "we do not have
 * this" must not contain prose.
 */
export function ExplanationPanel({ explanation }: ExplanationPanelProps) {
  if (explanation === null) {
    return (
      <div className="rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-3.5 py-4">
        <p className="text-2xs font-medium uppercase tracking-[0.07em] text-ink-500">
          No explanation requested
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
          No narrative was generated for this reading. The score, band, inputs and ranked
          factors above are complete.
        </p>
      </div>
    )
  }

  if (explanation.status === 'unavailable') {
    return (
      <div className="rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-3.5 py-4">
        <p className="font-mono text-2xs text-ink-700">{explanation.explanation_text}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Score, risk level, inputs and ranked factors above remain fully available. Nothing
          is generated in place of an unavailable explanation.
        </p>
      </div>
    )
  }

  return (
    <div>
      {explanation.grounding_status === 'passed' && (
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-verified/25 bg-verified-tint px-2 py-1 text-xs font-semibold uppercase tracking-[0.07em] text-verified">
          <Check size={11} strokeWidth={3} />
          Checked against this assessment
        </span>
      )}

      {/* Set larger and to a narrower measure than the data around it — this is the one
          place on the screen where prose is read as prose. */}
      <p className="mt-3 max-w-[62ch] text-md leading-[1.6] text-ink-800">
        {explanation.explanation_text}
      </p>

      <p className="mt-4 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-400">
        Point-in-time rationale for this reading. No claim is made about change over time.
      </p>
    </div>
  )
}
