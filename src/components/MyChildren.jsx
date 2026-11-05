import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { createChildAccount, getAvatarUrl, normalizePhone, unlinkChild } from '../lib/auth.js'
import { DISCIPLINES, getRank, hasRanks } from '../lib/ranks.js'

// Кабинет родителя → «Мои дети» (слой 24). Родитель добавляет ребёнка: имя, фото, пароль.
// Ребёнок входит сам по логину «телефон родителя-номер» (вход «MMA дети» или любой другой раздел).
const EMPTY = { firstName: '', lastName: '', discipline: 'mma', password: '', password2: '' }

// '37127167013-1' → '27167013-1' (короче и привычнее для латвийских номеров)
const shortLogin = (login) => String(login).replace(/^371(?=\d{8}-)/, '')

export default function MyChildren({ profile }) {
  const [kids, setKids] = useState(null)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState(null) // { name, login, password }
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, discipline, trainings_count, rank_override, avatar_url, approved_at')
      .eq('parent_id', profile.id)
      .order('created_at')
    if (e) throw e
    const withPhotos = await Promise.all(data.map(async (k) => ({ ...k, photo: await getAvatarUrl(k.avatar_url) })))
    setKids(withPhotos)
  }, [profile.id])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  // Ребёнок сам не добавляет детей; и без своего телефона родителем быть нельзя.
  if (profile.parent_id || !/^\d{8,15}$/.test(normalizePhone(profile.phone ?? ''))) return null

  const unlink = async (k) => {
    if (!window.confirm(`Убрать ${k.first_name} из «Мои дети»? Аккаунт ребёнка останется, но связь с вами пропадёт.`)) return
    try {
      await unlinkChild(k.id)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl">Мои дети</h2>
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setCreated(null) }} className="btn-outline !px-3 !py-1.5 text-sm">
            + Добавить ребёнка
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        У ребёнка свой аккаунт: посещения, ранг, запись на тренировки. Входит сам — по логину от вашего телефона и паролю, который вы зададите.
      </p>
      {error && <p className="text-sm text-accent">{error}</p>}

      {created && (
        <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold">Аккаунт {created.name} создан ✓</p>
          <p className="mt-1">
            Логин для входа: <span className="font-display text-lg tracking-wider">{shortLogin(created.login)}</span>
          </p>
          <p className="text-neutral-300">Пароль — тот, что вы ввели. Запишите логин или сделайте скриншот.</p>
          <p className="mt-1 text-xs text-neutral-400">На экране входа выберите «MMA дети» (или раздел ребёнка) и введите логин и пароль.</p>
        </div>
      )}

      {kids && kids.length > 0 && (
        <ul className="divide-y divide-line">
          {kids.map((k) => {
            const rank = hasRanks(k.discipline) ? getRank(k.trainings_count, k.rank_override).current : null
            return (
              <li key={k.id} className="flex items-center gap-3 py-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink font-display ring-1 ring-line">
                  {k.photo ? <img src={k.photo} alt="" className="h-full w-full object-cover" /> : k.first_name?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{k.first_name} {k.last_name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {[DISCIPLINES[k.discipline], `${k.trainings_count} трен.`, rank?.title, !k.approved_at && 'ждёт подтверждения тренера']
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button type="button" onClick={() => unlink(k)} className="shrink-0 text-xs text-neutral-500 hover:text-accent">
                  Убрать
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <AddChild
          profile={profile}
          onCancel={() => setOpen(false)}
          onDone={async (info) => {
            setOpen(false)
            setCreated(info)
            await load().catch(() => {})
          }}
        />
      )}
    </section>
  )
}

function AddChild({ profile, onCancel, onDone }) {
  const [form, setForm] = useState({ ...EMPTY, lastName: profile.last_name ?? '' })
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f?.type.startsWith('image/')) setPhoto(f)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!photo) return setError('Добавьте фото ребёнка — тренеру нужно узнавать его на тренировке.')
    if (form.password !== form.password2) return setError('Пароли не совпадают.')
    setBusy(true)
    try {
      const login = await createChildAccount({ parentPhone: profile.phone, ...form, photo })
      onDone({ name: form.firstName.trim(), login })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-line p-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink ring-2 ${preview ? 'ring-accent' : 'ring-line'}`}>
          {preview ? <img src={preview} alt="Фото ребёнка" className="h-full w-full object-cover" /> : <span className="text-xs text-neutral-500">фото</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input id="kid-cam" type="file" accept="image/*" capture="user" className="sr-only" onChange={onFile} />
          <input id="kid-gal" type="file" accept="image/*" className="sr-only" onChange={onFile} />
          <label htmlFor="kid-cam" className="btn-outline cursor-pointer !px-3 !py-1.5 text-sm">Камера</label>
          <label htmlFor="kid-gal" className="btn-outline cursor-pointer !px-3 !py-1.5 text-sm">Из галереи</label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="kid-first">Имя *</label>
          <input id="kid-first" required value={form.firstName} onChange={set('firstName')} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="kid-last">Фамилия *</label>
          <input id="kid-last" required value={form.lastName} onChange={set('lastName')} className="input" />
        </div>
      </div>
      <fieldset>
        <legend className="label">Направление</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(DISCIPLINES).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setForm((f) => ({ ...f, discipline: v }))}
              className={`rounded-md border px-2 py-2 text-xs font-semibold uppercase tracking-wider ${form.discipline === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400'}`}
            >
              {v === 'mma' ? 'MMA дети' : label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="kid-pass">Пароль ребёнка *</label>
          <input id="kid-pass" type="password" required minLength={6} autoComplete="new-password" value={form.password} onChange={set('password')} className="input" placeholder="мин. 6 символов" />
        </div>
        <div>
          <label className="label" htmlFor="kid-pass2">Повторите *</label>
          <input id="kid-pass2" type="password" required minLength={6} autoComplete="new-password" value={form.password2} onChange={set('password2')} className="input" />
        </div>
      </div>
      {form.password2 && form.password2 !== form.password && <p className="text-xs text-accent">Пароли не совпадают</p>}
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1 disabled:opacity-60">{busy ? 'Создаём…' : 'Создать аккаунт ребёнка'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn-outline">Отмена</button>
      </div>
    </form>
  )
}
