import { Component } from 'react'
import { t } from '../lib/i18n.jsx'
import { isChunkError, reloadOnce } from '../lib/reloadOnce.js'

// Если в части приложения случилась ошибка, вместо чёрного экрана показываем
// понятное сообщение с кнопкой «Обновить». Остальное приложение продолжает работать.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[DTT] ошибка на экране:', error)
    // Устаревшая версия после выкладки — тихо перезагружаемся на новую.
    if (isChunkError(error)) reloadOnce()
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.silent) return null
    return (
      <div className="card mx-auto max-w-md space-y-3 py-8 text-center">
        <p className="font-display text-lg uppercase tracking-wider">{t('Что-то пошло не так')}</p>
        <p className="text-sm text-neutral-400">{t('Нажмите «Обновить» — обычно это помогает.')}</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          {t('Обновить')}
        </button>
      </div>
    )
  }
}
