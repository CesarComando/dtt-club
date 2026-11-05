import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { ALBUMS, MAX_VIDEO_MB, approveItem, deleteItem, loadGallery, uploadToGallery } from '../lib/gallery.js'

// Галерея клуба: фото и видео с тренировок и соревнований.
// Видят только вошедшие. Ученик добавляет — фото «на проверке», пока тренер не одобрит.
export default function Gallery() {
  const { user, profile, loading } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState(null)
  const [album, setAlbum] = useState('all')
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    loadGallery()
      .then(setItems)
      .catch((e) => {
        setError(e.message)
        setItems([])
      })
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (loading) return null
  if (!user) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <h1 className="text-3xl">Галерея</h1>
        <p className="mt-3 text-neutral-400">Фото и видео клуба видят только ученики — войдите в приложение.</p>
        <Link to="/login?next=%2Fgallery" className="btn-primary mt-6 inline-block">Войти</Link>
      </div>
    )
  }

  const list = items ?? []
  const pending = list.filter((i) => i.status === 'pending')
  const feed = list.filter((i) => i.status === 'approved' && (album === 'all' || i.album === album))
  const minePending = pending.filter((i) => i.author_id === user.id)

  const act = async (fn) => {
    setError('')
    try {
      await fn()
      setOpen(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Галерея</h1>

      <Upload userId={user.id} isAdmin={isAdmin} onDone={load} />

      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      {/* Тренер: что ждёт одобрения */}
      {isAdmin && pending.length > 0 && (
        <section className="card space-y-3 border-amber-400/60">
          <h2 className="text-xl">На проверке · {pending.length}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pending.map((i) => (
              <li key={i.id} className="space-y-1.5">
                <Thumb item={i} onOpen={() => setOpen(i)} />
                <p className="truncate text-xs text-neutral-400">{i.author?.first_name} {i.author?.last_name} · {ALBUMS[i.album]}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => act(() => approveItem(i.id))} className="flex-1 rounded-md bg-emerald-600 py-1.5 text-xs font-semibold">
                    ✓ В галерею
                  </button>
                  <button type="button" onClick={() => act(() => deleteItem(i))} className="rounded-md border border-line px-2 text-xs text-neutral-400 hover:text-accent">
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Ученик: свои, ещё не одобренные */}
      {!isAdmin && minePending.length > 0 && (
        <p className="rounded-md border border-amber-400/60 p-3 text-sm text-neutral-300">
          На проверке у тренера: {minePending.length}. Появятся в галерее после одобрения.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {[['all', 'Все'], ...Object.entries(ALBUMS)].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAlbum(id)}
            className={`rounded-full border px-3 py-1 text-sm ${album === id ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {items == null ? (
        <p className="card text-neutral-400">Загружаем…</p>
      ) : feed.length === 0 ? (
        <p className="card text-neutral-400">Пока пусто — добавьте первые фото с тренировки!</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {feed.map((i) => (
            <li key={i.id}>
              <Thumb item={i} onOpen={() => setOpen(i)} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Viewer
          item={open}
          canDelete={isAdmin || open.author_id === user.id}
          onDelete={() => window.confirm('Удалить из галереи?') && act(() => deleteItem(open))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function Thumb({ item, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="relative block aspect-square w-full overflow-hidden rounded-md bg-ink">
      {item.url &&
        (item.kind === 'video' ? (
          <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <img src={item.url} alt={item.caption} loading="lazy" className="h-full w-full object-cover" />
        ))}
      {item.kind === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center text-3xl text-white/90 drop-shadow">▶</span>
      )}
      {item.status === 'pending' && (
        <span className="absolute top-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">на проверке</span>
      )}
    </button>
  )
}

function Viewer({ item, canDelete, onDelete, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 p-3 text-sm">
        <span className="min-w-0 truncate text-neutral-300">
          {item.author?.first_name} {item.author?.last_name} · {ALBUMS[item.album]} ·{' '}
          {new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </span>
        <div className="flex shrink-0 gap-3">
          {canDelete && <button type="button" onClick={onDelete} className="text-neutral-400 hover:text-accent">Удалить</button>}
          <button type="button" onClick={onClose} className="text-2xl leading-none text-white" aria-label="Закрыть">✕</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2" onClick={onClose}>
        {item.kind === 'video' ? (
          <video src={item.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
        ) : (
          <img src={item.url} alt={item.caption} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      {item.caption && <p className="p-3 text-center text-neutral-200">{item.caption}</p>}
    </div>
  )
}

function Upload({ userId, isAdmin, onDone }) {
  const fileRef = useRef(null)
  const [files, setFiles] = useState([])
  const [album, setAlbum] = useState('training')
  const [caption, setCaption] = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const send = async () => {
    setError('')
    let done = 0
    try {
      for (const f of files) {
        setProgress(`Загружаем ${done + 1} из ${files.length}…`)
        await uploadToGallery(userId, f, { album, caption })
        done++
      }
      setFiles([])
      setCaption('')
      if (fileRef.current) fileRef.current.value = ''
      setProgress(isAdmin ? 'Добавлено в галерею' : 'Отправлено тренеру на проверку')
      onDone()
    } catch (e) {
      setError(`${done ? `Загружено ${done}, дальше ошибка: ` : ''}${e.message}`)
      setProgress('')
      if (done) onDone()
    }
  }

  return (
    <section className="card space-y-3">
      <input
        ref={fileRef}
        id="gallery-file"
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          setFiles([...(e.target.files ?? [])].slice(0, 10))
          setProgress('')
          setError('')
        }}
      />
      {!files.length ? (
        <label htmlFor="gallery-file" className="btn-primary block w-full cursor-pointer text-center">
          ＋ Добавить фото или видео
        </label>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Выбрано: <b>{files.length}</b>{' '}
            <button type="button" onClick={() => setFiles([])} className="text-neutral-500 hover:text-white">— отменить</button>
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ALBUMS).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAlbum(id)}
                className={`rounded-full border px-3 py-1 text-sm ${album === id ? 'border-accent bg-accent/15' : 'border-line text-neutral-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input className="input" maxLength={300} placeholder="Подпись (необязательно)" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <button type="button" onClick={send} disabled={Boolean(progress) && progress.startsWith('Загружаем')} className="btn-primary w-full disabled:opacity-60">
            {isAdmin ? 'Опубликовать' : 'Отправить на проверку'}
          </button>
        </div>
      )}
      {progress && <p className="text-sm text-neutral-300" role="status">{progress}</p>}
      {error && <p className="text-sm text-accent">{error}</p>}
      <p className="text-xs text-neutral-500">
        До 10 файлов за раз, видео — до {MAX_VIDEO_MB} МБ. {isAdmin ? '' : 'В галерее появятся после одобрения тренером. '}
        Детей снимайте только с согласия родителей.
      </p>
    </section>
  )
}
