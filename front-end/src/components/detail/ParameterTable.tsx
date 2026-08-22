import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { ParameterName, ParameterReading, RiskContributor } from '@contract/clinical'
import { PARAMETER_GROUPS, parameterDefinition } from '../../data/parameters'
import { cn } from '../../lib/cn'
import { ProvenanceTag } from '../ui/ProvenanceTag'
import { ProvenanceValue } from '../ui/ProvenanceValue'

interface ParameterTableProps {
  patientId: string
  parameters: ParameterReading[]
  contributors: RiskContributor[]
}

/**
 * A parameter is a score factor when one of the ranked contributors derives
 * from it. Matched on the machine name: `feature_name` is a display label, and
 * comparing it to a parameter's prose description marked every row "not among
 * the ranked drivers" -- including the rank-1 driver.
 */
function scoreFactorParameters(contributors: RiskContributor[]): Set<ParameterName> {
  return new Set(
    contributors
      .map((contributor) => contributor.parameter)
      .filter((name): name is ParameterName => name !== null),
  )
}

export function ParameterTable({ patientId, parameters, contributors }: ParameterTableProps) {
  const factors = scoreFactorParameters(contributors)
  const defaultedCount = parameters.filter((p) => p.source === 'population_reference').length

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
        <p className="text-2xs text-ink-500">
          Every value carries where it came from. A value without its source states a
          population statistic in a clinical voice.
        </p>
        {/* Counted over the eleven displayed parameters. The "model inputs defaulted"
            figure on the reading-state panel is a share over the model's whole feature
            set, which is a different quantity — the two are never equal. */}
        <p className="font-mono text-2xs tabular-nums text-prov-default">
          {defaultedCount} of these {parameters.length} on population defaults
        </p>
      </div>

      {/* Column heads, desktop only — the mobile layout stacks and labels inline. */}
      <div className="hidden border-b border-rule pb-1.5 md:flex md:items-center md:gap-4">
        <span className="flex-1 text-xs font-semibold uppercase tracking-[0.07em] text-ink-400">
          Parameter
        </span>
        <span className="w-24 text-right text-xs font-semibold uppercase tracking-[0.07em] text-ink-400">
          Latest
        </span>
        <span className="w-48 text-xs font-semibold uppercase tracking-[0.07em] text-ink-400">
          Source
        </span>
        <span className="w-28 text-xs font-semibold uppercase tracking-[0.07em] text-ink-400">
          Model use
        </span>
        <span className="w-4" />
      </div>

      {PARAMETER_GROUPS.map((group) => {
        const rows = parameters.filter(
          (reading) => parameterDefinition(reading.parameter_name).group === group,
        )
        if (rows.length === 0) return null

        return (
          <div key={group}>
            <p className="border-b border-rule-faint pb-1 pt-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
              {group}
            </p>

            {rows.map((reading) => {
              const definition = parameterDefinition(reading.parameter_name)
              const isFactor = factors.has(reading.parameter_name)

              return (
                <Link
                  key={reading.parameter_name}
                  to={`/patient/${patientId}/parameter/${reading.parameter_name}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-rule-faint py-2 transition-colors hover:bg-surface-sunken md:flex-nowrap"
                >
                  <span className="min-w-[9rem] flex-1">
                    <span className="block text-2xs text-ink-950">{definition.label}</span>
                    <span className="block text-xs text-ink-400">
                      {definition.description}
                    </span>
                  </span>

                  <span className="w-24 text-right">
                    <ProvenanceValue
                      value={reading.value}
                      unit={reading.unit}
                      source={reading.source}
                      decimals={definition.decimals}
                    />
                  </span>

                  <span className="w-48">
                    <ProvenanceTag source={reading.source} ageMinutes={reading.age_minutes} />
                  </span>

                  <span className="w-28">
                    <span
                      className={cn(
                        'text-xs font-medium uppercase tracking-[0.06em]',
                        isFactor ? 'text-ink-950' : 'text-ink-400',
                      )}
                    >
                      {isFactor ? 'Score factor' : 'Available'}
                    </span>
                  </span>

                  <ChevronRight size={14} strokeWidth={2} className="w-4 shrink-0 text-ink-300" />
                </Link>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
