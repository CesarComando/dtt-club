import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { CATEGORIES, articleDate, coverUrl, deleteArticle, loadArticle } from '../lib/articles.js'

// Статья. Текст — простая разметка, чтобы тренеру было легко вставлять переводы:
//   пустая строка — новый абзац;  «## Заголовок»;  «> цитата»;  «- пункт списка»;
//   **жирный**;  ссылки https://… становятся кликабельными.
export default function Article() {
  const { id } = useParams()
  const { profile, loading } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const [a, setA] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    loadArticle(Number(id))
      .then(setA)
      .catch((e) => {
        setError(e.message)
        setA(null)
      })
  }, [id, loading, profile?.id])

  const back = <Link to="/articles" className="text-sm text-neutral-400 hover:text-white">← Статьи</Link>

  if (a === undefined) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }
  if (!a) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-12 text-center">
        <h1 className="text-2xl">Статья недоступна</h1>
        <p className="text-neutral-400">{error || 'Она удалена или открыта только ученикам клуба — войдите в приложение.'}</p>
        <div className="flex justify-center gap-3">
          <Link to={`/login?next=${encodeURIComponent(`/articles/${id}`)}`} className="btn-primary">Войти</Link>
          <Link to="/articles" className="btn-outline">Все статьи</Link>
        </div>
      </div>
    )
  }

  const remove = async () => {
    if (!window.confirm(`Удалить статью «${a.title}»?`)) return
    try {
      await deleteArticle(a)
      navigate('/articles', { replace: true })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        {back}
        {isAdmin && (
          <div className="flex gap-3 text-sm">
            <Link to={`/articles/${a.id}/edit`} className="text-neutral-300 hover:text-white">Редактировать</Link>
            <button type="button" onClick={remove} className="text-neutral-500 hover:text-accent">Удалить</button>
          </div>
        )}
      </div>
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          {CATEGORIES[a.category]} · {articleDate(a)}
          {!a.published && <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-black">черновик</span>}
        </p>
        <h1 className="text-3xl leading-tight md:text-4xl">{a.title}</h1>
        {a.lead && <p className="text-lg text-neutral-300">{a.lead}</p>}
      </header>

      {a.cover_path && <img src={coverUrl(a.cover_path)} alt="" className="w-full rounded-lg" />}

      <ArticleBody text={a.body} />

      {(a.source_title || a.source_url) && (
        <p className="border-t border-line pt-4 text-sm text-neutral-400">
          Источник:{' '}
          {a.source_url ? (
            <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {a.source_title || a.source_url}
            </a>
          ) : (
            a.source_title
          )}
        </p>
      )}
    </article>
  )
}

// **жирный** и ссылки внутри строки. Только текст и <a>/<b> — никакого HTML из базы.
function Inline({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <b key={i} className="text-white">{p.slice(2, -2)}</b>
    if (/^https?:\/\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
          {p}
        </a>
      )
    }
    return <Fragment key={i}>{p}</Fragment>
  })
}

export function ArticleBody({ text }) {
  const blocks = (text ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  return (
    <div className="space-y-4 text-[17px] leading-relaxed text-neutral-200">
      {blocks.map((b, i) => {
        if (b.startsWith('## ')) return <h2 key={i} className="pt-2 text-2xl text-white"><Inline text={b.slice(3)} /></h2>
        const lines = b.split('\n')
        if (lines.every((l) => l.startsWith('>'))) {
          return (
            <blockquote key={i} className="border-l-4 border-accent pl-4 italic text-neutral-300">
              <Inline text={lines.map((l) => l.replace(/^>\s?/, '')).join(' ')} />
            </blockquote>
          )
        }
        if (lines.every((l) => /^[-•]\s/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-6">
              {lines.map((l, j) => <li key={j}><Inline text={l.replace(/^[-•]\s/, '')} /></li>)}
            </ul>
          )
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} />
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
