import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { InputDevice } from '../../types/clinical'
import { getPatientContext } from '../../data/feed'
import { cn } from '../../lib/cn'
import { SectionHeading } from '../ui/SectionHeading'

interface PatientContextDrawerProps {
  patientId: string
  bedCode: string
  devices: InputDevice[]
  open: boolean
  onClose: () => void
}

/**
 * Recorded context, borrowed from the hospital record.
 *
 * Nothing here is a model output and nothing here is editable — PulseMind reads these
 * entities and never writes them. The Charlson index in particular is a recorded score,
 * not a PulseMind prediction, and is labelled as such.
 */
export function PatientContextDrawer({
  patientId,
  bedCode,
  devices,
  open,
  onClose,
}: PatientContextDrawerProps) {
  useEffect(() => {
    if (!open) return

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const context = getPatientContext(patientId)
  if (!context) return null

  const sections: Array<[string, Array<[string, string]>]> = [
    [
      'Structural',
      [
        ['Patient ID', patientId],
        ['Bed', bedCode],
        ['Ventilation episode', context.ventilation_episode_id],
        ['Stay', context.stay_id],
      ],
    ],
    [
      'Demographics',
      [
        ['Age', context.age],
        ['Sex', context.sex],
        ['Weight', context.weight],
        ['Height', context.height],
        ['Race / ethnicity', context.ethnicity],
      ],
    ],
  ]

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-ink-950/25 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden="true"
      />

      <aside
        aria-label="Patient context"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(30rem,94vw)] flex-col border-l border-rule bg-surface transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-950">Patient context</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] p-1 text-ink-500 transition-colors hover:bg-surface-sunken hover:text-ink-950"
            aria-label="Close patient context"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="rounded-[2px] border border-verified/25 bg-verified-tint px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-verified">
            Patient-to-bed association verified
          </p>

          {sections.map(([title, rows]) => (
            <section key={title} className="mt-5">
              <SectionHeading className="mb-1">{title}</SectionHeading>
              <dl>
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-3 border-t border-rule-faint py-2"
                  >
                    <dt className="text-2xs text-ink-500">{label}</dt>
                    <dd className="font-mono text-2xs text-ink-950">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="mt-5">
            <SectionHeading className="mb-1">Medical history</SectionHeading>
            {context.comorbidities.length > 0 ? (
              <ul>
                {context.comorbidities.map((comorbidity) => (
                  <li
                    key={comorbidity.icd_code}
                    className="flex items-baseline justify-between gap-3 border-t border-rule-faint py-2"
                  >
                    <span className="text-2xs text-ink-950">{comorbidity.label}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-400">
                      ICD {comorbidity.icd_code}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-rule-faint py-2 text-2xs text-ink-500">
                No recorded comorbidities.
              </p>
            )}

            <div className="mt-3 flex items-center gap-4 rounded-[2px] border border-rule bg-surface-sunken px-3 py-3">
              <span className="font-num text-2xl leading-none tabular-nums text-ink-950">
                {context.charlson_index}
              </span>
              <span className="text-2xs leading-snug text-ink-500">
                Charlson Comorbidity Index
                <br />
                <span className="text-xs text-ink-400">
                  Recorded context — not a PulseMind prediction.
                </span>
              </span>
            </div>
          </section>

          <section className="mt-5">
            <SectionHeading className="mb-1">Connected sources</SectionHeading>
            <ul>
              {devices.map((device) => (
                <li
                  key={device.device_id}
                  className="flex items-baseline justify-between gap-3 border-t border-rule-faint py-2"
                >
                  <span className="text-2xs text-ink-950">{device.label}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-400">
                    {device.device_make_model} · {device.state.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="shrink-0 border-t border-rule px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-400">
            Read-only association. PulseMind receives data but sends no commands and changes
            no ventilator settings.
          </p>
        </div>
      </aside>
    </>
  )
}
