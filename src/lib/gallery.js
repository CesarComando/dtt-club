// Слой 19: галерея. Файлы — приватный бакет gallery (папка <user_id>/),
// записи — gallery_items. Ученик добавляет «на проверку», тренер одобряет.
import { supabase } from './supabaseClient.js'

export const GALLERY_BUCKET = 'gallery'
export const ALBUMS = { training: 'Тренировки', competition: 'Соревнования', other: 'Разное' }
export const MAX_VIDEO_MB = 50

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Лента + временные ссылки на файлы (1 час). */
export async function loadGallery() {
  const items = must(
    await supabase
      .from('gallery_items')
      .select('id, author_id, path, kind, album, caption, status, created_at, author:profiles(first_name, last_name)')
      .order('created_at', { ascending: false })
      .limit(200),
  )
  if (!items.length) return []
  const { data: urls } = await supabase.storage.from(GALLERY_BUCKET).createSignedUrls(items.map((i) => i.path), 3600)
  const byPath = Object.fromEntries((urls ?? []).map((u) => [u.path, u.signedUrl]))
  return items.map((i) => ({ ...i, url: byPath[i.path] ?? null }))
}

// Фото ужимаем на телефоне до 1920 px по длинной стороне (JPEG) — быстрее грузится, меньше места.
async function shrinkImage(file) {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file // формат, который браузер не умеет открыть (напр. HEIC) — грузим как есть
  }
}

export async function uploadToGallery(userId, file, { album, caption }) {
  const isVideo = file.type.startsWith('video/')
  if (!isVideo && !file.type.startsWith('image/')) throw new Error('Можно добавлять только фото и видео')
  if (isVideo && file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`Видео больше ${MAX_VIDEO_MB} МБ — обрежьте его`)

  const body = isVideo ? file : await shrinkImage(file)
  const ext = isVideo ? (file.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg'
  const contentType = isVideo ? file.type : 'image/jpeg'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`

  must(await supabase.storage.from(GALLERY_BUCKET).upload(path, body, { contentType }))
  try {
    return must(
      await supabase
        .from('gallery_items')
        .insert({ path, kind: isVideo ? 'video' : 'photo', album, caption: caption.trim() })
        .select('id, status')
        .single(),
    )
  } catch (e) {
    await supabase.storage.from(GALLERY_BUCKET).remove([path]) // запись не создалась — файл не нужен
    throw e
  }
}

export async function approveItem(id) {
  must(await supabase.from('gallery_items').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id))
}

export async function deleteItem(item) {
  must(await supabase.from('gallery_items').delete().eq('id', item.id))
  await supabase.storage.from(GALLERY_BUCKET).remove([item.path])
}
