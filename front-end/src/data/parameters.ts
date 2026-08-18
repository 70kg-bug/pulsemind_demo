/**
 * The eleven respiratory parameters. This set is frozen by the data dictionary.
 *
 * `cohortDefaultRate` is how often the parameter is substituted with a population value
 * across the training cohort. Four of these are measured figures from the data dictionary
 * §6.2 and are marked below; the rest are prototype placeholders, because the dictionary
 * only publishes the four that are majority-defaulted.
 *
 * Four of eleven parameters are majority cohort default. That is the reason provenance
 * travels with every value in this UI rather than sitting behind a tooltip.
 */

import type { ParameterName } from '@contract/clinical'

export type ParameterGroup =
  | 'Oxygenation'
  | 'Airway pressure & flow'
  | 'Ventilation'
  | 'Gas exchange'
  | 'I:E ratio'

export interface ParameterDefinition {
  name: ParameterName
  /** Short label used in tables and navigation. */
  label: string
  /** Full clinical name, used as the subtitle on the parameter screen. */
  description: string
  unit: string
  /** Decimal places for display. */
  decimals: number
  group: ParameterGroup
  /** Y-axis range for the provenance chart. Wider than typical values, not a valid range. */
  displayRange: [number, number]
  cohortDefaultValue: number
  cohortDefaultRate: number
  /** True where the rate above is published in the data dictionary. */
  rateIsMeasured: boolean
}

export const PARAMETERS: ParameterDefinition[] = [
  {
    name: 'spo2',
    label: 'SpO₂',
    description: 'Peripheral oxygen saturation',
    unit: '%',
    decimals: 0,
    group: 'Oxygenation',
    displayRange: [82, 100],
    cohortDefaultValue: 97,
    cohortDefaultRate: 0.041,
    rateIsMeasured: false,
  },
  {
    name: 'fio2',
    label: 'FiO₂',
    description: 'Fraction of inspired oxygen',
    unit: '%',
    decimals: 0,
    group: 'Oxygenation',
    displayRange: [21, 100],
    cohortDefaultValue: 40,
    cohortDefaultRate: 0.088,
    rateIsMeasured: false,
  },
  {
    name: 'flow_rate',
    label: 'Flow',
    description: 'Peak inspiratory flow',
    unit: 'L/min',
    decimals: 1,
    group: 'Airway pressure & flow',
    displayRange: [10, 80],
    cohortDefaultValue: 40.0,
    cohortDefaultRate: 0.611,
    rateIsMeasured: true,
  },
  {
    name: 'peep',
    label: 'PEEP',
    description: 'Positive end-expiratory pressure',
    unit: 'cmH₂O',
    decimals: 0,
    group: 'Airway pressure & flow',
    displayRange: [0, 24],
    cohortDefaultValue: 5,
    cohortDefaultRate: 0.062,
    rateIsMeasured: false,
  },
  {
    name: 'pip',
    label: 'PIP',
    description: 'Peak inspiratory pressure',
    unit: 'cmH₂O',
    decimals: 0,
    group: 'Airway pressure & flow',
    displayRange: [5, 45],
    cohortDefaultValue: 20,
    cohortDefaultRate: 0.104,
    rateIsMeasured: false,
  },
  {
    name: 'respiratory_rate_total',
    label: 'RR total',
    description: 'Total respiratory rate',
    unit: '/min',
    decimals: 0,
    group: 'Ventilation',
    displayRange: [5, 45],
    cohortDefaultValue: 18,
    cohortDefaultRate: 0.037,
    rateIsMeasured: false,
  },
  {
    name: 'minute_volume',
    label: 'MV',
    description: 'Minute ventilation',
    unit: 'L/min',
    decimals: 1,
    group: 'Ventilation',
    displayRange: [2, 20],
    cohortDefaultValue: 8.0,
    cohortDefaultRate: 0.119,
    rateIsMeasured: false,
  },
  {
    name: 'tidal_volume_observed',
    label: 'Vt observed',
    description: 'Observed tidal volume',
    unit: 'mL',
    decimals: 0,
    group: 'Ventilation',
    displayRange: [200, 800],
    cohortDefaultValue: 450,
    cohortDefaultRate: 0.146,
    rateIsMeasured: false,
  },
  {
    name: 'etco2',
    label: 'EtCO₂',
    description: 'End-tidal carbon dioxide',
    unit: 'mmHg',
    decimals: 0,
    group: 'Gas exchange',
    displayRange: [20, 60],
    cohortDefaultValue: 36,
    cohortDefaultRate: 0.826,
    rateIsMeasured: true,
  },
  {
    name: 'inspiratory_ratio',
    label: 'I ratio',
    description: 'Inspiratory component',
    unit: '—',
    decimals: 1,
    group: 'I:E ratio',
    displayRange: [0.5, 2],
    cohortDefaultValue: 1.0,
    cohortDefaultRate: 0.792,
    rateIsMeasured: true,
  },
  {
    name: 'expiratory_ratio',
    label: 'E ratio',
    description: 'Expiratory component',
    unit: '—',
    decimals: 1,
    group: 'I:E ratio',
    displayRange: [1, 4],
    cohortDefaultValue: 2.0,
    cohortDefaultRate: 0.793,
    rateIsMeasured: true,
  },
]

export const PARAMETER_GROUPS: ParameterGroup[] = [
  'Oxygenation',
  'Airway pressure & flow',
  'Ventilation',
  'Gas exchange',
  'I:E ratio',
]

const BY_NAME = new Map(PARAMETERS.map((parameter) => [parameter.name, parameter]))

export function parameterDefinition(name: ParameterName): ParameterDefinition {
  const definition = BY_NAME.get(name)
  if (!definition) {
    throw new Error(`Unknown parameter: ${name}`)
  }
  return definition
}

export function parametersInGroup(group: ParameterGroup): ParameterDefinition[] {
  return PARAMETERS.filter((parameter) => parameter.group === group)
}
