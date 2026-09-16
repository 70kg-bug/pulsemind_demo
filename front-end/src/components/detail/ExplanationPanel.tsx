import { Check, Sparkles } from 'lucide-react'
import type { Explanation } from '@contract/clinical'

interface ExplanationPanelProps {
  /** What to render. Null means generation was never attempted, which is a
   *  different fact from failure. */
  shown: Explanation | null
  generating: boolean
  failure: string | null
  onGenerate: () => void
}

/**
 * The plain-language rationale.
 *
 * Three outcomes that must not look alike: generated and grounded, generated
 * then withheld because grounding failed, and never requested. Nothing is ever
 * generated to fill an absence.
 *
 * CONTROLLED, not self-driving. The request state lives in `useExplanationRequest`
 * one level up, because the guideline-references panel is this panel's SIBLING
 * and has to fill from the same result on the same click. Owned here, that
 * result was unreachable from there.
 */
export function ExplanationPanel(
  { shown, generating, failure, onGenerate }: ExplanationPanelProps,
) {

  // One control, three captions. Lifting it out of the never-requested branch is
  // what makes a second reading explainable: the panel used to offer generation
  // only while there was nothing to show, so once a bed had any explanation the
  // affordance disappeared and the text stayed pinned to an old reading.
  const button = (
    <button
      type="button"
      onClick={onGenerate}
      disabled={generating}
      className="mt-3 inline-flex items-center gap-1.5 rounded-[2px] border border-rule-strong bg-surface px-2.5 py-1.5 text-2xs font-medium text-ink-950 transition-colors hover:border-ink-950 disabled:cursor-progress disabled:text-ink-500"
    >
      <Sparkles size={12} strokeWidth={2.5} />
      {generating ? 'Generating…' : shown === null ? 'Generate explanation' : 'Explain this reading'}
    </button>
  )

  // GENERATING IS CHECKED FIRST, ABOVE `shown === null`, and that ordering is
  // the whole fix. This state used to live inside the never-requested branch, so
  // it showed on the FIRST generation and never again: asking for another
  // explanation left the previous prose sitting there while the references panel
  // beside it visibly cleared and refilled. Dimming the old text instead was
  // tried and rejected — greyed-out prose still reads as the answer, and the
  // panel is claiming to be writing a new one.
  //
  // The old text is not lost: it is stored on the assessment, and if this
  // generation fails `shown` falls back to it on the next render.
  if (generating || shown === null) {
    return (
      <div className="rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-3.5 py-4">
        <p className="text-2xs font-medium uppercase tracking-[0.07em] text-ink-500">
          {generating
            ? shown === null ? 'Writing the explanation…' : 'Re-running the model…'
            : 'No explanation requested'}
        </p>
        <p className="mt-1.5 max-w-[62ch] text-xs leading-relaxed text-ink-500">
          {generating
            ? 'A 7B model is running locally on one graphics card. This takes tens of ' +
              'seconds — the score, band, inputs and ranked factors above are already final ' +
              'and do not wait for it.'
            : 'No narrative was generated for this reading. The score, band, inputs and ' +
              'ranked factors above are complete.'}
        </p>

        {/* Say it before they wait twenty seconds for it. Decoding is greedy, so
            re-running the model on the same reading returns byte-identical prose
            — verified with two live calls, same sha256. Unannounced, the honest
            outcome is indistinguishable from a button that did nothing. */}
        {generating && shown !== null && (
          <p className="mt-1.5 max-w-[62ch] text-xs leading-relaxed text-ink-500">
            Decoding is greedy, so the same reading returns the same wording. The
            guideline passages beside this are being selected again in the same call.
          </p>
        )}

        {failure && (
          <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-band-critical-edge">
            {failure}
          </p>
        )}

        {button}
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
        {/* No generate button here on purpose: the usual way to reach this branch
            is a bed whose explanation is withheld by policy, where the server
            short-circuits the request and the control would do nothing. But if
            an attempt was made and failed, say so. */}
        {failure && (
          <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-band-critical-edge">
            {failure}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      {explanationToRender.grounding_status === 'passed' && (
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-verified/25 bg-verified-tint px-2 py-1 text-xs font-semibold uppercase tracking-[0.07em] text-verified">
          <Check size={12} strokeWidth={3} />
          Checked against this assessment
        </span>
      )}

      {/* Set larger and to a narrower measure than the data around it — this is the one
          place on the screen where prose is read as prose.

          ⚠️ This said `text-md`, which is not a class. The theme defines
          2xs/xs/sm/base/lg…, Tailwind has no `md` font-size key either, so it
          compiled to nothing and the paragraph inherited body's 14px — the same
          size as the data it was supposed to stand apart from. The comment above
          had been true of the intent and false of the screen since it was
          written. `text-base` is what it meant. */}
      <p className="mt-3 max-w-[62ch] text-base leading-[1.6] text-ink-800">
        {explanationToRender.explanation_text}
      </p>

      {failure && (
        <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-band-critical-edge">
          {failure}
        </p>
      )}

      {button}

      <p className="mt-4 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-400">
        Point-in-time rationale for this reading. No claim is made about change over time.
      </p>
    </div>
  )
}
