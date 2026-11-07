import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { DISCIPLINES } from '../lib/ranks.js'
import { useSection } from '../lib/section.js'
import { t } from '../lib/i18n.jsx'

// Кабинет: «тренируюсь и в другом направлении». Показывает расписание другого
// направления и даёт на него записываться. Основное направление, ранг и абонемент
// не меняются (profiles.cross_training, слой 15).
export default function CrossTraining({ profile, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chosen = useSection()
  if (profile.role !== 'athlete' || !['grappling', 'mma'].includes(profile.discipline)) return null

  const other = profile.discipline === 'grappling' ? 'mma' : 'grappling'
  const on = Boolean(profile.cross_training)
  // Вошёл в раздел другого направления, а переключатель выключен — подсказываем.
  const mismatch = !on && chosen === other

  const toggle = async () => {
    setBusy(true)
    setError('')
    const { error: e } = await supabase.from('profiles').update({ cross_training: !on }).eq('id', profile.id)
    if (e) setError(e.message)
    else await onChange?.()
    setBusy(false)
  }

  return (
    <label className={`card flex cursor-pointer items-center justify-between gap-4 ${on || mismatch ? 'border-accent/60' : ''}`}>
      <span className="min-w-0">
        <span className="block font-semibold">{t('Показывать и тренировки {name}', { name: DISCIPLINES[other] })}</span>
        <span className="block text-xs text-neutral-400">
          {t('Можно записываться и туда. Ваше направление, ранг и абонемент не меняются — абонемент {name} оплачивается отдельно.', { name: DISCIPLINES[other] })}
        </span>
        {mismatch && (
          <span className="mt-1 block text-xs font-semibold text-accent">
            {t('Вы вошли в раздел {other}, а ваше направление — {mine}. Включите, чтобы видеть эти тренировки.', { other: DISCIPLINES[other], mine: DISCIPLINES[profile.discipline] })}
          </span>
        )}
        {error && <span className="block text-xs text-accent">{error}</span>}
      </span>
      <input type="checkbox" className="h-6 w-6 shrink-0 accent-accent" checked={on} disabled={busy} onChange={toggle} />
    </label>
  )
}
