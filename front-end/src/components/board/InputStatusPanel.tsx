import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
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
 * Connection health, which is not the model's data-sufficiency measure: a source
 * can stream perfectly while the parameters it does not carry stay defaulted.
 *
 * The simulation control is fenced off below the device list rather than sitting
 * beside a real make and model. PulseMind writes nothing to these sources.
 */
export function InputStatusPanel({ devices, now, patientId }: InputStatusPanelProps) {
  const { toggleDevice, setDevices } = useWard()
  const offline = devices.filter((device) => device.state === 'offline')
  // Collapsed by default, and it STAYS where you put it. Not a hover reveal and
  // nothing that closes itself: every glance at this screen is a resumption, so
  // content that appears and disappears on its own is content a returning nurse
  // cannot rely on.
  //
  // A dropped source OPENS it; it does not PIN it open. `open = state ||
  // offline.length > 0` made the header button inert in the one state this
  // comment says it cares about — the chevron would not rotate back and
  // `aria-expanded` was stuck true, so the control read as broken to a mouse
  // and lied to a screen reader.
  const [open, setOpen] = useState(false)
  const hasOffline = offline.length > 0
  useEffect(() => {
    if (hasOffline) setOpen(true)
  }, [hasOffline])

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
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="field-label inline-flex items-center gap-1 text-ink-500 transition-colors hover:text-ink-950"
          >
            <ChevronRight
              size={12}
              strokeWidth={2.5}
              className={cn('transition-transform', open && 'rotate-90')}
            />
            Simulate source loss
          </button>
          {offline.length > 0 && (
            <button
              type="button"
              // ONE write. Firing a request per device raced the server's
              // read-modify-write on `offline_devices`: three reads of the same
              // list, three last-write-wins saves, one device actually restored
              // — and no error anywhere, because each response was correct.
              onClick={() => void setDevices(patientId, offline.map((d) => d.device_id), false)}
              className="text-2xs text-accent underline underline-offset-2"
            >
              Restore all
            </button>
          )}
        </div>

        {open && (
        <>
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
        </>
        )}
      </div>
    </Panel>
  )
}
