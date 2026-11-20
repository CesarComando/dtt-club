// Язык интерфейса: русский (исходный), латышский и английский.
//
// Как устроено:
//   t('Текст по-русски')                 → перевод на латышский (LV) или английский (EN)
//   t('Ещё {n} дн.', { n: 3 })           → подстановка значений
//   Ключ — сам русский текст. Нет перевода → показываем русский (ничего не ломается).
// Переводы лежат в src/i18n/lv/*.js и src/i18n/en/*.js (по разделам) и собираются автоматически.
// Смена языка перезагружает страницу: так обновляются и тексты в константах модулей.
// Сообщения сервера (ошибки SQL / Edge Functions) переводятся в supabaseClient.js.

const dict = (files) => ({
  words: Object.assign({}, ...Object.entries(files).filter(([p]) => !p.endsWith('_patterns.js')).map(([, d]) => d)),
  patterns: Object.entries(files).find(([p]) => p.endsWith('_patterns.js'))?.[1] ?? [],
})
const DICTS = {
  lv: dict(import.meta.glob('../i18n/lv/*.js', { eager: true, import: 'default' })),
  en: dict(import.meta.glob('../i18n/en/*.js', { eager: true, import: 'default' })),
}

const KEY = 'dtt-lang'
export const LANGS = { ru: 'RU', lv: 'LV', en: 'EN' }

const stored = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// ?lang=lv в адресе (кнопка с сайта клуба) — запоминаем; иначе выбор пользователя; по умолчанию русский.
function initial() {
  const fromUrl = /[?&]lang=(ru|lv|en)\b/.exec(window.location.hash + window.location.search)?.[1]
  if (fromUrl) {
    try {
      localStorage.setItem(KEY, fromUrl)
    } catch {
      /* приватный режим */
    }
    return fromUrl
  }
  const s = stored()
  return s in LANGS ? s : 'ru'
}

export const lang = initial()
const D = DICTS[lang] ?? null
document.documentElement.lang = lang

/** Локаль для дат и чисел: toLocaleDateString(locale(), …) */
export const locale = () => ({ lv: 'lv-LV', en: 'en-GB' })[lang] ?? 'ru-RU'

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m)) : s)

function fromPatterns(ru) {
  for (const [re, out] of D?.patterns ?? []) {
    const m = re.exec(ru)
    if (m) return typeof out === 'function' ? out(...m.slice(1)) : ru.replace(re, out)
  }
  return null
}

/** Перевод строки интерфейса (ключ — русский текст). */
export function t(ru, vars) {
  if (ru == null || ru === '') return ru
  const s = D ? D.words[ru] ?? fromPatterns(ru) ?? ru : ru
  return fill(s, vars)
}

/** Перевод текста из базы / с сервера: только если он есть в словаре (иначе как есть). */
export const tData = (s) => (D && typeof s === 'string' ? D.words[s] ?? fromPatterns(s) ?? s : s)

export function setLang(next) {
  if (next === lang) return
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* приватный режим — язык не запомнится */
  }
  window.location.reload()
}

/** Переключатель RU | LV | EN. */
export function LangSwitch({ className = '' }) {
  return (
    <div className={`inline-flex overflow-hidden rounded-md border border-line text-xs font-semibold ${className}`} role="group" aria-label="Valoda / Язык">
      {Object.entries(LANGS).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setLang(id)}
          aria-pressed={lang === id}
          className={`min-h-10 min-w-10 px-3 py-2 ${lang === id ? 'bg-accent text-white' : 'text-neutral-400 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
