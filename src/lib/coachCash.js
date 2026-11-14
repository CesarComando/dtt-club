// Слой 47: касса тренера. Помощник тренера вносит оплаты своих учеников (MMA);
// они продлевают ученику абонемент, но в бюджет клуба не входят.
// Тренер видит только свою кассу, главный тренер — все.
import { supabase } from './supabaseClient.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

export const loadCoachMembers = async () => must(await supabase.rpc('coach_members')) ?? []
export const loadCoachLedger = async () => must(await supabase.rpc('coach_ledger')) ?? []

export const addCoachPayment = async ({ member, cents, date, method, kind, note }) =>
  must(
    await supabase.rpc('coach_add_payment', {
      p_member: member,
      p_amount_cents: cents,
      p_paid_on: date,
      p_method: method,
      p_kind: kind,
      p_note: note || null,
    }),
  )

export const deleteCoachPayment = async (id) => must(await supabase.rpc('coach_delete_payment', { p_id: id }))
