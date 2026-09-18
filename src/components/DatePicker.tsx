import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface DatePickerProps {
  /** `YYYY-MM-DD`, the selected day — or null if nothing is chosen yet. */
  value: string | null
  onChange: (date: string) => void
  /** `YYYY-MM-DD`, the earliest day that may be picked. */
  min: string
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * A small month grid in the app's own paper palette — the browser's native
 * date picker looks like an operating-system dialog dropped onto a letter,
 * which is the exact complaint this replaces.
 */
export function DatePicker({ value, onChange, min }: DatePickerProps) {
  const initial = value ?? min
  const [year, setYear] = useState(Number(initial.slice(0, 4)))
  const [month, setMonth] = useState(Number(initial.slice(5, 7)) - 1)

  const currentYearMonth = `${year}-${pad(month + 1)}`
  const minYearMonth = min.slice(0, 7)
  const atMinMonth = currentYearMonth <= minYearMonth

  const firstWeekday = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  function goPrevMonth() {
    if (atMinMonth) return
    if (month === 0) {
      setYear(year - 1)
      setMonth(11)
    } else setMonth(month - 1)
  }

  function goNextMonth() {
    if (month === 11) {
      setYear(year + 1)
      setMonth(0)
    } else setMonth(month + 1)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="w-64 rounded-letter border border-paper-edge bg-paper-letter p-3">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={goPrevMonth}
          disabled={atMinMonth}
          aria-label="Previous month"
          className="rounded-full p-1 text-ink-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-ui text-xs font-medium text-ink-ui">{monthLabel}</span>
        <button
          type="button"
          onClick={goNextMonth}
          aria-label="Next month"
          className="rounded-full p-1 text-ink-muted transition-colors hover:text-accent"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="font-ui text-[10px] uppercase tracking-wide text-ink-muted">
            {label}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />
          const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
          const disabled = dateStr < min
          const isSelected = value === dateStr
          return (
            <button
              key={dateStr}
              type="button"
              disabled={disabled}
              onClick={() => onChange(dateStr)}
              aria-pressed={isSelected}
              className={`rounded-full py-1 font-ui text-xs transition-colors ${
                isSelected
                  ? 'bg-accent text-paper-app'
                  : disabled
                    ? 'cursor-not-allowed text-ink-muted/40'
                    : 'text-ink-ui hover:bg-accent-soft'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
