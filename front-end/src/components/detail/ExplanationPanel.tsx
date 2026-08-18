import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import type { Explanation } from '@contract/clinical'
import { generateExplanation } from '../../data/feed'

interface ExplanationPanelProps {
  /** Null means generation was never attempted, which is a different fact from failure. */
  explanation: Explanation | null
  patientId: string
}

/**
 * The plain-language rationale.
 *
 * Three outcomes that must not look alike: generated and grounded, generated
 * then withheld because grounding failed, and never requested. Nothing is ever
 * generated to fill an absence.
 */
export function ExplanationPanel({ explanation, patientId }: ExplanationPanelProps) {
  const [generated, setGenerated] = useState<Explanation | null>(null)
  const [generating, setGenerating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const shown = generated ?? explanation

  async function requestExplanation() {
    setGenerating(true)
    setFailure(null)
    try {
      const result = await generateExplanation(patientId)
      setGenerated(result as Explanation)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the generator did not respond')
    } finally {
      setGenerating(false)
    }
  }

  if (shown === null) {
    return (
      <div className="rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-3.5 py-4">
        <p className="text-2xs font-medium uppercase tracking-[0.07em] text-ink-500">
          {generating ? 'Writing the explanation…' : 'No explanation requested'}
        </p>
        <p className="mt-1.5 max-w-[62ch] text-xs leading-relaxed text-ink-500">
          {generating
            ? 'A 7B model is running locally on one graphics card. This takes tens of ' +
              'seconds — the score, band, inputs and ranked factors above are already final ' +
              'and do not wait for it.'
            : 'No narrative was generated for this reading. The score, band, inputs and ' +
              'ranked factors above are complete.'}
        </p>

        {failure && (
          <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-band-critical-edge">
            {failure}
          </p>
        )}

        <button
          type="button"
          onClick={() => void requestExplanation()}
          disabled={generating}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[2px] border border-rule-strong bg-surface px-2.5 py-1.5 text-2xs font-medium text-ink-950 transition-colors hover:border-ink-950 disabled:cursor-progress disabled:text-ink-500"
        >
          <Sparkles size={11} strokeWidth={2.5} />
          {generating ? 'Generating…' : 'Generate explanation'}
        </button>
      </div>
    )
  }

  const explanationToRender = shown

  if (explanationToRender.status === 'unavailable') {
    return (
      <div className="rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-3.5 py-4">
        <p className="font-mono text-2xs text-ink-700">{explanationToRender.explanation_text}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Score, risk level, inputs and ranked factors above remain fully available. Nothing
          is generated in place of an unavailable explanation.
        </p>
      </div>
    )
  }

  return (
    <div>
      {explanationToRender.grounding_status === 'passed' && (
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-verified/25 bg-verified-tint px-2 py-1 text-xs font-semibold uppercase tracking-[0.07em] text-verified">
          <Check size={11} strokeWidth={3} />
          Checked against this assessment
        </span>
      )}

      {/* Set larger and to a narrower measure than the data around it — this is the one
          place on the screen where prose is read as prose. */}
      <p className="mt-3 max-w-[62ch] text-md leading-[1.6] text-ink-800">
        {explanationToRender.explanation_text}
      </p>

      <p className="mt-4 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-400">
        Point-in-time rationale for this reading. No claim is made about change over time.
      </p>
    </div>
  )
}
