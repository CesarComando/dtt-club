import { supabase } from './supabaseClient.js'
import { t } from './i18n.jsx'

/** Вопрос помощнику клуба (Edge Function ask-club). messages: [{ role, content }] → текст ответа. */
export async function askClub(messages) {
  const { data, error } = await supabase.functions.invoke('ask-club', { body: { messages } })
  if (error) {
    let message = t('Помощник сейчас недоступен')
    try {
      message = (await error.context?.json())?.error ?? message
    } catch {
      /* тело ответа не JSON */
    }
    throw new Error(message)
  }
  return data.answer
}

/** Факты, на которые опирается помощник (тренер правит во вкладке «Помощник»). */
export async function loadFacts() {
  const { data, error } = await supabase.from('club_info').select('body, updated_at').eq('key', 'facts').maybeSingle()
  if (error) throw error
  return data
}

export async function saveFacts(body) {
  const { error } = await supabase.from('club_info').upsert({ key: 'facts', body, updated_at: new Date().toISOString() })
  if (error) throw error
}
