import { useEffect, useState } from 'react'
import { ageFrom, bmi, bmiCategory, loadBody, saveBody } from '../lib/diary.js'
import { t } from '../lib/i18n.jsx'

const EMPTY = { height: '', weight: '', birth_date: '' }
const toForm = (b) => ({ height: b?.height ?? '', weight: b?.weight ?? '', birth_date: b?.birth_date ?? '' })
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))

// Кабинет: рост, вес, дата рождения + калькулятор ИМТ.
// Данные лежат в закрытой таблице profile_body — их видят только ученик и тренер.
export default function BodyStats({ userId }) {
  const [form, setForm] = useState(EMPTY)
  const [saved, setSaved] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    loadBody(userId)
      .then((b) => {
        setForm(toForm(b))
        setSaved(toForm(b))
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  // ИМТ считаем «на лету» по тому, что введено сейчас — это и есть калькулятор.
  const value = bmi(num(form.height), num(form.weight))
  const age = ageFrom(form.birth_date)
  const cat = bmiCategory(value, age)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const b = await saveBody(userId, {
        height: num(form.height),
        weight: num(form.weight),
        birth_date: form.birth_date || null,
      })
      setForm(toForm(b))
      setSaved(toForm(b))
      setMsg(t('Сохранено'))
    } catch (err) {
      setMsg(err.message.includes('check') ? t('Проверьте значения: рост 80–230 см, вес 15–250 кг.') : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <p className="label">{t('Мои параметры')}</p>
        <h2 className="text-xl">{t('Рост, вес и ИМТ')}</h2>
        <p className="text-xs text-neutral-500">{t('Видите только вы и тренер.')}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="height">{t('Рост, см')}</label>
            <input id="height" name="height" type="number" inputMode="numeric" min="80" max="230" className="input"
              value={form.height} onChange={onChange} disabled={loading} placeholder="178" />
          </div>
          <div>
            <label className="label" htmlFor="weight">{t('Вес, кг')}</label>
            <input id="weight" name="weight" type="number" inputMode="decimal" step="0.1" min="15" max="250" className="input"
              value={form.weight} onChange={onChange} disabled={loading} placeholder="77.5" />
          </div>
          <div>
            <label className="label" htmlFor="birth_date">{t('Рождение')}</label>
            <input id="birth_date" name="birth_date" type="date" className="input !px-2"
              value={form.birth_date} onChange={onChange} disabled={loading} />
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-md border border-line p-4">
          <div className="text-center">
            <p className="font-display text-4xl tabular-nums">{value ?? '—'}</p>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('ИМТ')}</p>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {cat ? (
              <p className={cat.tone === 'ok' ? 'font-semibold text-white' : cat.tone === 'warn' ? 'font-semibold text-accent' : 'text-neutral-300'}>
                {cat.label}
              </p>
            ) : (
              <p className="text-neutral-400">{t('Введите рост и вес — индекс посчитается сам.')}</p>
            )}
            {age != null && <p className="text-neutral-400">{t('Возраст: {n}', { n: age })}</p>}
            <p className="mt-1 text-xs text-neutral-500">
              {t('У спортсменов с большой мышечной массой ИМТ завышен — это ориентир, а не диагноз.')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || loading || !dirty} className="btn-primary disabled:opacity-50">
            {busy ? t('Сохраняем…') : t('Сохранить')}
          </button>
          {msg && <p className="text-sm text-neutral-400" role="status">{msg}</p>}
        </div>
      </form>
    </section>
  )
}
