// Слой 9: QR-чекин, оплата наличными, должники, удаление аккаунта.
import { supabase } from './supabaseClient.js'
import { cached, isNetworkError } from './offline.js'
import { t } from './i18n.jsx'

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

// Удаление аккаунта (Edge Function delete-account): своего или — тренером — ученика.
async function callDelete(body) {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'УДАЛИТЬ', ...body } })
  if (error) {
    let message = t('Не удалось удалить аккаунт')
    try {
      message = (await error.context?.json())?.error ?? message
    } catch {
      /* тело не JSON */
    }
    throw new Error(message)
  }
  return data
}

export async function deleteMyAccount() {
  const data = await callDelete({})
  await supabase.auth.signOut()
  return data
}

export const deleteAthleteAccount = (athleteId) => callDelete({ athlete_id: athleteId })

/** Режим родителя (слой 35): { parent_only, children: [{ name, valid_until, active }] }. */
export async function loadMyFamily() {
  const none = { parent_only: false, children: [] }
  try {
    return await cached('family', async () => {
      const { data, error } = await supabase.rpc('my_family')
      if (error && isNetworkError(error)) throw error
      return error ? none : (data ?? none) // слой ещё не выполнен — обычный кабинет
    })
  } catch {
    return none
  }
}
