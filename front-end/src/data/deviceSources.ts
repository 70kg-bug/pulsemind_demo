import type { ParameterName } from '../types/clinical'

/**
 * Which parameters each input source supplies.
 *
 * ⚠️ This mapping is NOT in the data dictionary. It is a prototype assumption used to
 * make the "simulate source loss" control behave plausibly, and the UI labels it as
 * such — the same way `ParameterDefinition.rateIsMeasured` marks cohort-default rates
 * that are prototype figures rather than published ones.
 *
 * Keyed by the device's role rather than its ID, because IDs vary per bed.
 */
export const PARAMETERS_BY_SOURCE: Record<string, ParameterName[]> = {
  Ventilator: [
    'peep',
    'pip',
    'flow_rate',
    'respiratory_rate_total',
    'minute_volume',
    'tidal_volume_observed',
    'inspiratory_ratio',
    'expiratory_ratio',
  ],
  'Bedside monitor': ['spo2', 'etco2', 'fio2'],
  'Lab / EMR': [],
}

export function parametersFromSource(label: string): ParameterName[] {
  return PARAMETERS_BY_SOURCE[label] ?? []
}
