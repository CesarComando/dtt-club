// Слой 9: QR-чекин, оплата наличными, должники, удаление аккаунта.
import { supabase } from './supabaseClient.js'

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

// QR-чекин
export const newCheckinToken = (sessionId) => rpc('checkin_qr', { p_session: sessionId })
export const checkIn = async (token) => (await rpc('check_in', { p_token: token }))?.[0]

// Ссылка, которую кодирует QR: телефон ученика открывает её обычной камерой.
export const checkinUrl = (token) => {
  const base = window.location.href.split('#')[0]
  return `${base}#/checkin/${token}`
}

// Тренер
export const recordCashPayment = (athleteId, productId) =>
  rpc('record_cash_payment', { p_athlete: athleteId, p_product: productId })
export const loadDebtors = () => rpc('payment_debtors')

// Удаление своего аккаунта (Edge Function delete-account)
export async function deleteMyAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'УДАЛИТЬ' } })
  if (error) {
    let message = 'Не удалось удалить аккаунт'
    try {
      message = (await error.context?.json())?.error ?? message
    } catch {
      /* тело не JSON */
    }
    throw new Error(message)
  }
  await supabase.auth.signOut()
  return data
}
