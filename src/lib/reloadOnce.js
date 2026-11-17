// После выкладки новой версии старые файлы страниц удаляются. Если приложение было открыто
// до выкладки, переход в «Дневник» и т.п. просит уже несуществующий файл — раньше это
// давало чёрный экран. Теперь страница один раз перезагружается и берёт новую версию.
const KEY = 'dtt-reloaded-at'

export function isChunkError(err) {
  const msg = String(err?.message ?? err ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|ChunkLoadError|Loading chunk/i.test(msg)
}

/** Перезагрузить страницу, но не чаще раза в 20 секунд (чтобы не зациклиться без сети). */
export function reloadOnce() {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY) || 0)
  } catch {
    /* хранилище недоступно */
  }
  if (Date.now() - last < 20000) return false
  try {
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* хранилище недоступно */
  }
  window.location.reload()
  return true
}
