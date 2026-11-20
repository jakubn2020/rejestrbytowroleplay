import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ExpiryMode = 'keep' | 'lifetime' | 'months3' | 'custom'
export type ExpiryUnit = 'days' | 'months'

export type ExpiryChoice = {
  mode: ExpiryMode
  amount: string
  unit: ExpiryUnit
}

const MAX_DAYS = 36_500
const MAX_MONTHS = 1_200

/**
 * Turns the form choice into what the server expects:
 * `undefined` = leave unchanged, `null` = lifetime, otherwise an ISO date in the future.
 */
export function resolveExpiry(
  choice: ExpiryChoice,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (choice.mode === 'keep') return { ok: true, value: undefined }
  if (choice.mode === 'lifetime') return { ok: true, value: null }
  const date = new Date()
  if (choice.mode === 'months3') {
    date.setMonth(date.getMonth() + 3)
    return { ok: true, value: date.toISOString() }
  }
  const amount = Number(choice.amount)
  const max = choice.unit === 'days' ? MAX_DAYS : MAX_MONTHS
  if (!Number.isInteger(amount) || amount < 1 || amount > max) {
    return {
      ok: false,
      error: `Podaj liczbę całkowitą od 1 do ${max} (${choice.unit === 'days' ? 'dni' : 'miesięcy'}).`,
    }
  }
  if (choice.unit === 'days') date.setDate(date.getDate() + amount)
  else date.setMonth(date.getMonth() + amount)
  return { ok: true, value: date.toISOString() }
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Validity of the PWZ: lifetime by default, or expiring after 3 months / a custom time. */
export function ExpiryField({
  id,
  value,
  onChange,
  allowKeep,
  currentLabel,
}: {
  id: string
  value: ExpiryChoice
  onChange: (next: ExpiryChoice) => void
  /** Editing an existing entry: offer "leave unchanged". */
  allowKeep?: boolean
  /** e.g. "dożywotnio" or "do 12.02.2027" */
  currentLabel?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-mode`}>
        Ważność PWZ{currentLabel ? ` (obecnie: ${currentLabel})` : ''}
      </Label>
      <select
        id={`${id}-mode`}
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as ExpiryMode })}
        className={selectClass}
      >
        {allowKeep && <option value="keep">Bez zmian</option>}
        <option value="lifetime">Dożywotnio</option>
        <option value="months3">Wygasa za 3 miesiące</option>
        <option value="custom">Wygasa za… (własna liczba)</option>
      </select>
      {value.mode === 'custom' && (
        <div className="flex gap-2">
          <Input
            id={`${id}-amount`}
            type="number"
            min={1}
            inputMode="numeric"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })}
            aria-label="Liczba"
            className="w-28"
          />
          <select
            aria-label="Jednostka"
            value={value.unit}
            onChange={(e) => onChange({ ...value, unit: e.target.value as ExpiryUnit })}
            className={selectClass}
          >
            <option value="days">dni</option>
            <option value="months">miesięcy</option>
          </select>
        </div>
      )}
    </div>
  )
}
