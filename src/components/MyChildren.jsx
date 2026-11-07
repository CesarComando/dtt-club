import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { createChildAccount, getAvatarUrl, normalizePhone, resetChildPassword, unlinkChild } from '../lib/auth.js'
import { DISCIPLINES, getRank, hasRanks } from '../lib/ranks.js'
import { t } from '../lib/i18n.jsx'

// Кабинет родителя → «Мои дети» (слой 24). Родитель добавляет ребёнка: имя, фото, пароль.
// Ребёнок входит сам по логину «телефон родителя-номер» (вход «MMA дети» или любой другой раздел).
const EMPTY = { firstName: '', lastName: '', discipline: 'mma', password: '', password2: '' }

// '37120000000-1' → '20000000-1' (короче и привычнее для латвийских номеров)
const shortLogin = (login) => String(login).replace(/^371(?=\d{8}-)/, '')

export default function MyChildren({ profile }) {
  const [kids, setKids] = useState(null)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState(null) // { name, login }
  const [pwFor, setPwFor] = useState(null) // id ребёнка, которому меняем пароль
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, discipline, trainings_count, rank_override, avatar_url, approved_at')
      .eq('parent_id', profile.id)
      .order('created_at')
    if (e) throw e
    // Логин ребёнка = его «телефон» в profile_contacts (родителю читать можно — слой 25).
    const { data: logins } = await supabase.from('profile_contacts').select('id, phone').in('id', data.map((k) => k.id))
    const loginOf = Object.fromEntries((logins ?? []).map((c) => [c.id, c.phone]))
    const withPhotos = await Promise.all(
      data.map(async (k) => ({ ...k, login: loginOf[k.id], photo: await getAvatarUrl(k.avatar_url) })),
    )
    setKids(withPhotos)
  }, [profile.id])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  // Ребёнок сам не добавляет детей; и без своего телефона родителем быть нельзя.
  if (profile.parent_id || !/^\d{8,15}$/.test(normalizePhone(profile.phone ?? ''))) return null

  const unlink = async (k) => {
    if (!window.confirm(t('Убрать {name} из «Мои дети»? Аккаунт ребёнка останется, но связь с вами пропадёт.', { name: k.first_name }))) return
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
        <h2 className="text-xl">{t('Мои дети')}</h2>
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setCreated(null) }} className="btn-outline !px-3 !py-1.5 text-sm">
            + {t('Добавить ребёнка')}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        {t('У ребёнка свой аккаунт: посещения, ранг, запись на тренировки. Входит сам — по логину от вашего телефона и паролю, который вы зададите.')}
      </p>
      {error && <p className="text-sm text-accent">{error}</p>}

      {created && (
        <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold">{t('Аккаунт {name} создан ✓', { name: created.name })}</p>
          <p className="mt-1">
            {t('Логин для входа:')} <span className="font-display text-lg tracking-wider">{shortLogin(created.login)}</span>
          </p>
          <p className="text-neutral-300">{t('Пароль — тот, что вы ввели. Запишите логин или сделайте скриншот.')}</p>
          <p className="mt-1 text-xs text-neutral-400">{t('На экране входа выберите «MMA дети» (или раздел ребёнка) и введите логин и пароль.')}</p>
        </div>
      )}

      {kids && kids.length > 0 && (
        <ul className="divide-y divide-line">
          {kids.map((k) => {
            const rank = hasRanks(k.discipline) ? getRank(k.trainings_count, k.rank_override).current : null
            return (
              <li key={k.id} className="py-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink font-display ring-1 ring-line">
                    {k.photo ? <img src={k.photo} alt="" className="h-full w-full object-cover" /> : k.first_name?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{k.first_name} {k.last_name}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {[DISCIPLINES[k.discipline], t('{n} трен.', { n: k.trainings_count }), rank?.title, !k.approved_at && t('ждёт подтверждения тренера')]
                        .filter(Boolean).join(' · ')}
                    </p>
                    {k.login && (
                      <p className="text-xs text-neutral-400">
                        {t('Логин:')} <span className="font-display tracking-wider text-white">{shortLogin(k.login)}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button type="button" onClick={() => setPwFor(pwFor === k.id ? null : k.id)} className="text-xs text-neutral-300 hover:text-accent">
                      {t('Новый пароль')}
                    </button>
                    <button type="button" onClick={() => unlink(k)} className="text-xs text-neutral-500 hover:text-accent">
                      {t('Убрать')}
                    </button>
                  </div>
                </div>
                {pwFor === k.id && <NewPassword child={k} onDone={() => setPwFor(null)} />}
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

// Ребёнок забыл пароль — родитель задаёт новый (слой 25).
function NewPassword({ child, onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pw !== pw2) return setMsg(t('Пароли не совпадают.'))
    setBusy(true)
    setMsg('')
    try {
      await resetChildPassword(child.id, pw)
      setOk(true)
      setMsg(t('Готово: {name} теперь входит с новым паролем.', { name: child.first_name }))
      setTimeout(onDone, 2500)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-line p-3">
      <p className="text-xs text-neutral-400">{t('Новый пароль для {name} (логин остаётся прежним):', { name: child.first_name })}</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="password" required minLength={6} autoComplete="new-password" placeholder={t('Новый пароль')} aria-label={t('Новый пароль')} value={pw} onChange={(e) => setPw(e.target.value)} className="input" />
        <input type="password" required minLength={6} autoComplete="new-password" placeholder={t('Повторите')} aria-label={t('Повторите пароль')} value={pw2} onChange={(e) => setPw2(e.target.value)} className="input" />
      </div>
      {msg && <p className={`text-sm ${ok ? 'text-emerald-400' : 'text-accent'}`}>{msg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || ok} className="btn-primary flex-1 disabled:opacity-60">{busy ? t('Сохраняем…') : t('Сохранить пароль')}</button>
        <button type="button" onClick={onDone} disabled={busy} className="btn-outline">{t('Отмена')}</button>
      </div>
    </form>
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
    if (!photo) return setError(t('Добавьте фото ребёнка — тренеру нужно узнавать его на тренировке.'))
    if (form.password !== form.password2) return setError(t('Пароли не совпадают.'))
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
          {preview ? <img src={preview} alt={t('Фото ребёнка')} className="h-full w-full object-cover" /> : <span className="text-xs text-neutral-500">{t('фото')}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input id="kid-cam" type="file" accept="image/*" capture="user" className="sr-only" onChange={onFile} />
          <input id="kid-gal" type="file" accept="image/*" className="sr-only" onChange={onFile} />
          <label htmlFor="kid-cam" className="btn-outline cursor-pointer !px-3 !py-1.5 text-sm">{t('Камера')}</label>
          <label htmlFor="kid-gal" className="btn-outline cursor-pointer !px-3 !py-1.5 text-sm">{t('Из галереи')}</label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="kid-first">{t('Имя *')}</label>
          <input id="kid-first" required value={form.firstName} onChange={set('firstName')} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="kid-last">{t('Фамилия *')}</label>
          <input id="kid-last" required value={form.lastName} onChange={set('lastName')} className="input" />
        </div>
      </div>
      <fieldset>
        <legend className="label">{t('Направление')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(DISCIPLINES).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setForm((f) => ({ ...f, discipline: v }))}
              className={`rounded-md border px-2 py-2 text-xs font-semibold uppercase tracking-wider ${form.discipline === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400'}`}
            >
              {v === 'mma' ? t('MMA дети') : label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="kid-pass">{t('Пароль ребёнка *')}</label>
          <input id="kid-pass" type="password" required minLength={6} autoComplete="new-password" value={form.password} onChange={set('password')} className="input" placeholder={t('мин. 6 символов')} />
        </div>
        <div>
          <label className="label" htmlFor="kid-pass2">{t('Повторите *')}</label>
          <input id="kid-pass2" type="password" required minLength={6} autoComplete="new-password" value={form.password2} onChange={set('password2')} className="input" />
        </div>
      </div>
      {form.password2 && form.password2 !== form.password && <p className="text-xs text-accent">{t('Пароли не совпадают')}</p>}
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1 disabled:opacity-60">{busy ? t('Создаём…') : t('Создать аккаунт ребёнка')}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn-outline">{t('Отмена')}</button>
      </div>
    </form>
  )
}
