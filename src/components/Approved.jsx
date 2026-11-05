import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Зелёная галочка «подтверждён тренером» (profiles.approved_at, слой 16).
export function ApprovedMark({ approved, className = '' }) {
  if (!approved) return null
  return (
    <span
      title="Подтверждён тренером"
      aria-label="Подтверждён тренером"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 align-middle text-xs font-bold text-white ${className}`}
    >
      ✓
    </span>
  )
}

/** Кнопка тренера: подтвердить ученика или снять подтверждение. */
export function ApproveButton({ athlete, onChange, compact = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approved = Boolean(athlete.approved_at)

  const toggle = async () => {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase.rpc('approve_athlete', { p_athlete: athlete.id, p_approved: !approved })
    if (e) setError(e.message)
    else onChange?.(data)
    setBusy(false)
  }

  if (approved && compact) return null
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={
          approved
            ? 'text-xs text-neutral-500 hover:text-accent disabled:opacity-50'
            : 'rounded-md border border-emerald-500 px-2 py-0.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50'
        }
      >
        {busy ? '…' : approved ? 'Снять подтверждение' : '✓ Подтвердить'}
      </button>
      {error && <span className="text-xs text-accent">{error}</span>}
    </span>
  )
}
