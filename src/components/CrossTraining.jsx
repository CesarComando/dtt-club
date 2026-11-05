import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { DISCIPLINES } from '../lib/ranks.js'

// Кабинет: «тренируюсь и в другом направлении». Показывает расписание другого
// направления и даёт на него записываться. Основное направление, ранг и абонемент
// не меняются (profiles.cross_training, слой 15).
export default function CrossTraining({ profile, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (profile.role === 'admin' || !['grappling', 'mma'].includes(profile.discipline)) return null

  const other = profile.discipline === 'grappling' ? 'mma' : 'grappling'
  const on = Boolean(profile.cross_training)

  const toggle = async () => {
    setBusy(true)
    setError('')
    const { error: e } = await supabase.from('profiles').update({ cross_training: !on }).eq('id', profile.id)
    if (e) setError(e.message)
    else await onChange?.()
    setBusy(false)
  }

  return (
    <label className={`card flex cursor-pointer items-center justify-between gap-4 ${on ? 'border-accent/60' : ''}`}>
      <span className="min-w-0">
        <span className="block font-semibold">Показывать и тренировки {DISCIPLINES[other]}</span>
        <span className="block text-xs text-neutral-400">
          Можно записываться и туда. Ваше направление, ранг и абонемент не меняются — абонемент {DISCIPLINES[other]} оплачивается отдельно.
        </span>
        {error && <span className="block text-xs text-accent">{error}</span>}
      </span>
      <input type="checkbox" className="h-6 w-6 shrink-0 accent-accent" checked={on} disabled={busy} onChange={toggle} />
    </label>
  )
}
