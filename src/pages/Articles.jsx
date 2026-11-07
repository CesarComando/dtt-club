import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { CATEGORIES, articleDate, coverUrl, loadArticles } from '../lib/articles.js'
import { t } from '../lib/i18n.jsx'

// «Статьи»: новости клуба, переводы речей и интервью тренеров. Читают все
// (статьи «только ученикам» — после входа), пишет тренер.
export default function Articles() {
  const { user, profile, loading } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState(null)
  const [cat, setCat] = useState('all')
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    loadArticles()
      .then(setItems)
      .catch((e) => {
        setError(e.message)
        setItems([])
      })
  }, [loading, user])

  const list = (items ?? []).filter((a) => cat === 'all' || a.category === cat)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('Статьи')}</h1>
        {isAdmin && (
          <Link to="/articles/new" className="btn-primary">{t('＋ Новая статья')}</Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {[['all', t('Все')], ...Object.entries(CATEGORIES)].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCat(id)}
            className={`rounded-full border px-3 py-1 text-sm ${cat === id ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      {items == null ? (
        <p className="card text-neutral-400">{t('Загружаем…')}</p>
      ) : list.length === 0 ? (
        <p className="card text-neutral-400">
          {isAdmin ? t('Пока пусто — нажмите «Новая статья».') : t('Скоро здесь появятся новости и переводы.')}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((a) => (
            <li key={a.id}>
              <Link to={`/articles/${a.id}`} className="card block h-full overflow-hidden !p-0 transition-colors hover:border-white/30">
                {a.cover_path && (
                  <img src={coverUrl(a.cover_path)} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                )}
                <div className="space-y-1.5 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                    {CATEGORIES[a.category]} · {articleDate(a)}
                    {!a.published && <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-black">{t('черновик')}</span>}
                    {a.published && a.members_only && isAdmin && <span className="ml-2 text-neutral-400">· {t('только ученикам')}</span>}
                  </p>
                  <h2 className="text-xl leading-tight">{a.title}</h2>
                  {a.lead && <p className="line-clamp-3 text-sm text-neutral-400">{a.lead}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!user && (
        <p className="text-center text-sm text-neutral-500">
          {t('Часть статей — только для учеников клуба.')}{' '}
          <Link to="/login?next=%2Farticles" className="text-accent hover:underline">{t('Войдите')}</Link>{t(', чтобы видеть все.')}
        </p>
      )}
    </div>
  )
}
