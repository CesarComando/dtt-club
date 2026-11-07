// Слой 34: уведомления, напоминания о продлении, статистика тренера, пробные тренировки.
import { supabase } from './supabaseClient.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}
const rpc = async (fn, args) => must(await supabase.rpc(fn, args))

// Уведомления (свои; RLS пускает только к своим)
export const loadNotifications = async () =>
  must(
    await supabase
      .from('notifications')
      .select('id, kind, title, body, created_at, read_at')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
  )
export const markNotificationsRead = async (ids) =>
  must(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids))

// Тренер: отменить / вернуть занятие (записанным придёт уведомление)
export const setSessionCancelled = (id, cancelled, reason = null) =>
  rpc('set_session_cancelled', { p_session: id, p_cancelled: cancelled, p_reason: reason })

// Напоминания о продлении
export const loadMembershipReminders = () => rpc('membership_reminders')
export const markReminded = (r) =>
  rpc('mark_membership_reminded', { p_member: r.member_id, p_profile: r.profile_id, p_until: r.valid_until })

// Статистика
export const loadCoachStats = (weeks = 12) => rpc('coach_stats', { p_weeks: weeks })
export const loadInactive = (days = 14) => rpc('inactive_athletes', { p_days: days })

// Пробные тренировки
export const requestTrial = (f) =>
  rpc('request_trial', {
    p_name: f.name,
    p_phone: f.phone,
    p_discipline: f.discipline,
    p_age: f.age ? Number(f.age) : null,
    p_preferred: f.preferred || null,
  })
export const loadTrials = async () =>
  must(await supabase.from('trial_requests').select('*').order('created_at', { ascending: false }).limit(200))
export const setTrialStatus = async (id, status) =>
  must(await supabase.from('trial_requests').update({ status }).eq('id', id))
export const deleteTrial = async (id) => must(await supabase.from('trial_requests').delete().eq('id', id))

export const TRIAL_DISCIPLINES = {
  mma: 'MMA (взрослые)',
  k1: 'K1',
  grappling: 'Грэпплинг / BJJ no-gi',
  kids: 'Детское MMA',
}

// Ссылка «написать в WhatsApp» с готовым текстом (открывает WhatsApp тренера).
export const waLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
export const prettyPhone = (p) => (p?.startsWith('371') && p.length === 11 ? `+371 ${p.slice(3, 7)} ${p.slice(7)}` : p ? `+${p}` : '')
