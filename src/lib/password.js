// Слой 44: пароли — SMS-восстановление, смена своего, сброс тренером.
import { supabase } from './supabaseClient.js'

// Ответ Edge Function: при ошибке достаём текст из тела ({ error }).
async function callReset(body) {
  const { data, error } = await supabase.functions.invoke('password-reset', { body })
  if (error) {
    let msg = error.message
    try {
      msg = (await error.context.json())?.error ?? msg
    } catch {
      /* тело не JSON */
    }
    const e = new Error(msg)
    e.code = msg
    throw e
  }
  return data
}

/** Отправить SMS-код. Ошибка с code === 'sms_off' — SMS ещё не подключены. */
export const requestResetCode = (phone) => callReset({ action: 'request', phone })
export const confirmReset = (phone, code, password) => callReset({ action: 'confirm', phone, code, password })

/** Сменить свой пароль (вошедший пользователь). */
export async function changeMyPassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

/** Главный тренер: временный пароль ученику — показать один раз. */
export async function resetMemberPassword(userId) {
  const { data, error } = await supabase.rpc('reset_member_password', { p_user: userId })
  if (error) throw error
  return data
}

export const COACH_WHATSAPP = 'https://wa.me/37127167013'
