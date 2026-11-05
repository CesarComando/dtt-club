// Слой 28: статьи — новости клуба, переводы, интервью. Пишет только тренер.
import { supabase } from './supabaseClient.js'

export const CATEGORIES = {
  news: 'Новости клуба',
  translation: 'Переводы',
  interview: 'Интервью',
  article: 'Статьи',
}
export const ARTICLES_BUCKET = 'articles'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

const LIST_COLS = 'id, title, category, lead, cover_path, members_only, published, published_at, created_at'

export const loadArticles = async () =>
  must(
    await supabase
      .from('articles')
      .select(LIST_COLS)
      .order('published_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false })
      .limit(100),
  )

export const loadArticle = async (id) => must(await supabase.from('articles').select('*').eq('id', id).maybeSingle())

export const coverUrl = (path) =>
  path ? supabase.storage.from(ARTICLES_BUCKET).getPublicUrl(path).data.publicUrl : null

export async function saveArticle(article) {
  const { id, ...fields } = article
  const row = {
    title: fields.title.trim(),
    category: fields.category,
    lead: fields.lead.trim(),
    body: fields.body,
    source_title: fields.source_title.trim(),
    source_url: fields.source_url.trim() || null,
    cover_path: fields.cover_path || null,
    members_only: fields.members_only,
    published: fields.published,
  }
  const q = id ? supabase.from('articles').update(row).eq('id', id) : supabase.from('articles').insert(row)
  return must(await q.select('id').single())
}

export async function deleteArticle(article) {
  must(await supabase.from('articles').delete().eq('id', article.id))
  if (article.cover_path) await supabase.storage.from(ARTICLES_BUCKET).remove([article.cover_path])
}

export async function uploadCover(file) {
  if (!file.type.startsWith('image/')) throw new Error('Обложка — только картинка')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${crypto.randomUUID()}.${ext}`
  must(await supabase.storage.from(ARTICLES_BUCKET).upload(path, file, { contentType: file.type }))
  return path
}

export const articleDate = (a) =>
  new Date(a.published_at ?? a.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
