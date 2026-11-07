import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CATEGORIES, coverUrl, loadArticle, saveArticle, uploadCover } from '../lib/articles.js'
import { ArticleBody } from './Article.jsx'
import { t } from '../lib/i18n.jsx'

const EMPTY = {
  title: '',
  category: 'news',
  lead: '',
  body: '',
  source_title: '',
  source_url: '',
  cover_path: '',
  members_only: true,
  published: false,
}

// Редактор статьи (только тренер — маршрут под <AdminRoute adminOnly>).
export default function ArticleEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(id ? null : EMPTY)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    loadArticle(Number(id))
      .then((a) => setForm(a ? { ...EMPTY, ...a, source_url: a.source_url ?? '', cover_path: a.cover_path ?? '' } : EMPTY))
      .catch((e) => setError(e.message))
  }, [id])

  if (!form) return <p className="card text-neutral-400">{error || t('Загружаем…')}</p>

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const onCover = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const path = await uploadCover(file)
      setForm((f) => ({ ...f, cover_path: path }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (published) => {
    if (!form.title.trim()) return setError(t('Нужен заголовок'))
    setBusy(true)
    setError('')
    try {
      const { id: savedId } = await saveArticle({ ...form, id: form.id, published })
      navigate(`/articles/${savedId}`, { replace: true })
    } catch (err) {
      setError(err.message.includes('source_url') ? t('Ссылка на источник должна начинаться с https://') : err.message)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={form.id ? `/articles/${form.id}` : '/articles'} className="text-sm text-neutral-400 hover:text-white">← {t('Назад')}</Link>
      <h1 className="text-3xl">{form.id ? t('Редактировать статью') : t('Новая статья')}</h1>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="a-title">{t('Заголовок *')}</label>
          <input id="a-title" className="input" maxLength={200} value={form.title} onChange={set('title')} />
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(CATEGORIES).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm((f) => ({ ...f, category: k }))}
              className={`rounded-full border px-3 py-1 text-sm ${form.category === k ? 'border-accent bg-accent/15' : 'border-line text-neutral-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="a-lead">{t('Коротко (видно в списке)')}</label>
          <textarea id="a-lead" className="input" rows={2} maxLength={500} value={form.lead} onChange={set('lead')} />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="label" htmlFor="a-body">{t('Текст')}</label>
            <button type="button" onClick={() => setPreview((p) => !p)} className="text-xs text-accent hover:underline">
              {preview ? t('Редактировать') : t('Как будет выглядеть')}
            </button>
          </div>
          {preview ? (
            <div className="rounded-md border border-line p-4"><ArticleBody text={form.body} /></div>
          ) : (
            <textarea id="a-body" className="input font-mono text-sm" rows={16} value={form.body} onChange={set('body')} />
          )}
          <p className="mt-1 text-xs text-neutral-500">
            {t('Пустая строка — новый абзац')} · <code>## {t('Заголовок')}</code> · <code>&gt; {t('цитата')}</code> · <code>- {t('пункт')}</code> ·{' '}
            <code>**{t('жирный')}**</code> · {t('ссылки https://… кликабельны')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="a-src">{t('Источник (автор, где)')}</label>
            <input id="a-src" className="input" maxLength={200} placeholder="John Danaher, BJJ Fanatics" value={form.source_title} onChange={set('source_title')} />
          </div>
          <div>
            <label className="label" htmlFor="a-url">{t('Ссылка на оригинал')}</label>
            <input id="a-url" className="input" type="url" placeholder="https://…" value={form.source_url} onChange={set('source_url')} />
          </div>
        </div>

        <div className="space-y-2">
          <span className="label">{t('Обложка')}</span>
          {form.cover_path && <img src={coverUrl(form.cover_path)} alt="" className="max-h-48 rounded-md" />}
          <div className="flex gap-3">
            <label className="btn-outline cursor-pointer">
              {form.cover_path ? t('Заменить') : t('Добавить картинку')}
              <input type="file" accept="image/*" className="sr-only" onChange={onCover} disabled={busy} />
            </label>
            {form.cover_path && (
              <button type="button" onClick={() => setForm((f) => ({ ...f, cover_path: '' }))} className="text-sm text-neutral-500 hover:text-accent">
                {t('Убрать')}
              </button>
            )}
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={form.members_only} onChange={set('members_only')} />
          <span className="text-sm">
            <b>{t('Только ученикам клуба')}</b>
            <span className="block text-xs text-neutral-400">
              {t('Выключите, чтобы статью видели все, включая гостей сайта. Переводы чужих интервью лучше оставлять только ученикам.')}
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-accent">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => save(true)} disabled={busy} className="btn-primary disabled:opacity-60">
            {form.published ? t('Сохранить') : t('Опубликовать')}
          </button>
          <button type="button" onClick={() => save(false)} disabled={busy} className="btn-outline disabled:opacity-60">
            {form.published ? t('Снять с публикации') : t('Сохранить черновик')}
          </button>
        </div>
      </div>
    </div>
  )
}
