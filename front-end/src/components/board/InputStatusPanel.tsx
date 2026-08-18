import type { DeviceState, InputDevice } from '@contract/clinical'
import { useWard } from '../../data/WardProvider'
import { cn } from '../../lib/cn'
import { formatAgo, minutesSince } from '../../lib/format'
import { SectionHeading } from '../ui/SectionHeading'
import { Panel } from '../ui/Panel'

interface InputStatusPanelProps {
  devices: InputDevice[]
  now: Date
  /** Sources belong to a bed, so switching one off is a per-patient request. */
  patientId: string
}

const STATE_LABEL: Record<DeviceState, string> = {
  streaming: 'Streaming',
  available: 'Available',
  intermittent: 'Intermittent',
  offline: 'Offline',
}

/**
 * Where the data is coming from.
 *
 * This is connection health, which is a different thing from the model's
 * data-sufficiency measure — a source can be streaming perfectly while most of the
 * parameters it does not carry are still population defaults.
 *
 * The signal counters are live: they read a real timestamp against the shared clock and
 * genuinely climb.
 *
 * The simulation control is deliberately fenced off below the device list rather than
 * sitting inline beside "Hamilton C6 · VNT-04". PulseMind sends nothing to these
 * sources, and a switch rendered next to a real make and model would contradict that in
 * a screenshot.
 */
export function InputStatusPanel({ devices, now, patientId }: InputStatusPanelProps) {
  const { toggleDevice } = useWard()
  const offline = devices.filter((device) => device.state === 'offline')

  return (
    <Panel className="p-4">
      <SectionHeading trailing={`${devices.length} sources`}>Input status</SectionHeading>

      <ul className="mt-2">
        {devices.map((device) => {
          const offline = device.state === 'offline'
          return (
            <li
              key={device.device_id}
              className="flex items-start justify-between gap-3 border-t border-rule-faint py-2.5 first:border-t-0"
            >
              <div className="min-w-0">
                <p className={cn('text-2xs', offline ? 'text-ink-500' : 'text-ink-950')}>
                  {device.label}
                </p>
                <p className="font-mono text-2xs text-ink-500">
                  {device.device_make_model} · {device.device_id}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    'text-2xs',
                    offline ? 'font-medium text-band-critical-ink' : 'text-ink-700',
                  )}
                >
                  {STATE_LABEL[device.state]}
                </p>
                <p className="font-mono text-2xs tabular-nums text-ink-500">
                  {formatAgo(minutesSince(device.last_signal_at, now))}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-3 border-t border-rule pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="field-label">Simulate source loss</p>
          {offline.length > 0 && (
            <button
              type="button"
              onClick={() => offline.forEach((device) => void toggleDevice(patientId, device.device_id))}
              className="text-2xs text-accent underline underline-offset-2"
            >
              Restore all
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {devices.map((device) => (
            <button
              key={device.device_id}
              type="button"
              onClick={() => void toggleDevice(patientId, device.device_id)}
              aria-pressed={device.state === 'offline'}
              className={cn(
                'rounded-[2px] border px-2 py-1 text-2xs transition-colors',
                device.state === 'offline'
                  ? 'border-band-critical-edge bg-band-critical-tint text-ink-950'
                  : 'border-rule-strong text-ink-700 hover:border-ink-950 hover:text-ink-950',
              )}
            >
              {device.state === 'offline' ? 'Restore' : 'Drop'} {device.label.split(' ')[0]}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Prototype control. Dropping a source stops its parameters refreshing, so they
          carry forward and the share resting on population defaults climbs. Past the
          sufficiency floor no score is published and the patient leaves the ranked board.
          The source-to-parameter mapping is a prototype assumption, not a published one.
        </p>
      </div>
    </Panel>
  )
}
