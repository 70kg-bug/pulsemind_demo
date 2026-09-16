import type { Explanation } from '@contract/clinical'

interface GuidelineReferencesProps {
  /** The SAME object the explanation panel is rendering. Null means no
   *  generation has been attempted for this reading. */
  explanation: Explanation | null
  generating: boolean
}

/** `Qwen/Qwen2.5-7B-Instruct` reads as a path; the model's name is the half
 *  after the org. */
function modelName(generator: string): string {
  return generator.split('/').pop() ?? generator
}

/**
 * The passages the generator was shown.
 *
 * FILLED BY THE SAME CLICK AS THE PROSE, from the same object, so what is on
 * screen is what the model read — not a second lookup that happens to agree.
 *
 * An empty list is not one state, it is three, and saying "no references
 * retrieved" for all of them reports two correct outcomes as a shortfall:
 *
 *   nothing generated yet   there was no retrieval, because there was no call
 *   the template floor      the deterministic writer never consults the library
 *   the model ran, 0 hits   9 of the 57 keys have no admissible passage, and
 *                           those are suppressed rather than invented
 *
 * `generator` is the field that separates them, which is why it is persisted.
 */
export function GuidelineReferences({ explanation, generating }: GuidelineReferencesProps) {
  const note = (text: string) => (
    <p className="mt-3 max-w-[46ch] text-2xs leading-relaxed text-ink-500">{text}</p>
  )

  if (generating) {
    return note(
      'Selecting the approved passages. These arrive with the explanation, from the '
      + 'same call — the model is shown exactly what appears here.',
    )
  }

  if (explanation === null) {
    return note('References appear with the explanation. Nothing has been requested yet.')
  }

  if (explanation.status === 'unavailable') {
    return note(
      'No explanation was generated for this reading, so no guideline passages were '
      + 'consulted.',
    )
  }

  if (explanation.generator === 'template') {
    return note(
      'Written by the deterministic template, which states the record back and does '
      + 'not consult the guideline library. Generate with the model to see the '
      + 'passages it was shown.',
    )
  }

  if (explanation.citations.length === 0) {
    return note(
      'The approved library holds no admissible passage for this reading. Suppressed '
      + 'rather than substituted — nothing is written into a citation slot to fill it.',
    )
  }

  return (
    <>
      <ul className="mt-2">
        {explanation.citations.map((citation) => (
          <li
            key={citation.source}
            className="border-t border-rule-faint py-2.5 first:border-t-0"
          >
            <p className="text-xs leading-relaxed text-ink-800">{citation.claim}</p>
            <p className="mt-1 font-mono text-xs text-ink-400">{citation.source}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-400">
        Shown to {explanation.generator ? modelName(explanation.generator) : 'the generator'}{' '}
        as part of this explanation, and retrieved from a fixed approved library — not
        generated. The passages were selected and reviewed before this reading existed, so
        a citation here cannot be invented.
      </p>
    </>
  )
}
