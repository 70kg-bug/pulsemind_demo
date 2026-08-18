import { AlertTriangle } from 'lucide-react'
import type { RiskContributor } from '@contract/clinical'
import { cn } from '../../lib/cn'
import { formatPercent } from '../../lib/format'

interface ContributorListProps {
  contributors: RiskContributor[]
}

/** Widest share in the list, so the bars use their full width rather than a fixed ceiling. */
function widestShare(contributors: RiskContributor[]): number {
  return Math.max(...contributors.map((contributor) => contributor.share_of_decision))
}

/**
 * What drove this reading, ranked.
 *
 * Two distinctions are marked because collapsing either one would change what the list
 * means. A `documentation` contributor is a charting artefact — how often and how
 * recently something was recorded — and narrating it in a clinical voice would turn a
 * record-keeping pattern into a finding. An imputed contributor rests on a population
 * default rather than a measurement of this patient.
 */
export function ContributorList({ contributors }: ContributorListProps) {
  if (contributors.length === 0) {
    return (
      <p className="text-2xs text-ink-500">
        No ranked factors are published — this reading did not meet the data-sufficiency floor.
      </p>
    )
  }

  const widest = widestShare(contributors)

  return (
    <ul>
      {contributors.map((contributor) => (
        <li
          key={contributor.rank}
          className="flex items-start gap-3 border-t border-rule-faint py-2.5 first:border-t-0"
        >
          <span className="w-5 shrink-0 pt-[3px] font-mono text-xs tabular-nums text-ink-300">
            {String(contributor.rank).padStart(2, '0')}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-2xs text-ink-950">{contributor.feature_name}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'rounded-[2px] border px-1.5 py-[1px] text-2xs font-medium uppercase tracking-[0.06em]',
                  contributor.kind === 'documentation'
                    ? 'border-rule-strong bg-surface-sunken text-ink-700'
                    : 'border-rule bg-surface text-ink-500',
                )}
              >
                {contributor.kind}
              </span>
              {contributor.is_imputed && (
                <span className="inline-flex items-center gap-1 rounded-[2px] border border-prov-default-edge bg-prov-default-tint px-1.5 py-[1px] text-2xs font-medium uppercase tracking-[0.06em] text-prov-default">
                  <AlertTriangle size={9} strokeWidth={2.5} />
                  Population default
                </span>
              )}
            </span>
          </span>

          <span className="w-24 shrink-0 text-right">
            <span className="block font-num text-2xs tabular-nums text-ink-950">
              {formatPercent(contributor.share_of_decision, 1)}
            </span>
            <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-[1px] bg-rule-faint">
              <span
                className={cn(
                  'block h-full rounded-[1px]',
                  contributor.is_imputed ? 'bg-prov-default' : 'bg-ink-800',
                )}
                style={{ width: `${(contributor.share_of_decision / widest) * 100}%` }}
              />
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
