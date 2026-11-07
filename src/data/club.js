// Хардкод данных клуба (APP_PASSPORT §4). Позже переедет в Supabase.
import { t } from '../lib/i18n.jsx'

export const CLUB = {
  name: 'Daugavpils Top Team',
  grapplingName: 'Daugavpils Grappling Team',
  address: 'Dzirnavu iela 20, Daugavpils',
  coach: 'Dainis Miglāns',
  coachPhone: '+371 27167013',
}

export const FIRST_TRAINING_FREE = true

// Каждая команда клуба: свои дисциплины, цены и расписание.
export const TEAMS = [
  {
    id: 'mma',
    name: 'Daugavpils Top Team',
    discipline: 'MMA / K1',
    prices: { monthly: 45, single: 6 },
    classes: [
      { title: t('Детское MMA'), days: [t('Вт'), t('Чт')], time: '16:30–17:45' },
      { title: t('MMA новички'), days: [t('Пн'), t('Ср'), t('Пт')], time: '17:00–18:30' },
      { title: t('MMA опытные'), days: [t('Пн'), t('Ср'), t('Пт')], time: '19:00–20:30' },
    ],
  },
  {
    id: 'grappling',
    name: 'Daugavpils Grappling Team',
    discipline: 'Grappling no-gi',
    prices: { monthly: 40, single: 5 },
    classes: [
      { title: t('Взрослые'), days: [t('Вт'), t('Чт')], time: '18:00–20:00' },
      { title: t('Взрослые'), days: [t('Сб')], time: '15:00–17:00' },
    ],
  },
]

export const WEEK_DAYS = [t('Пн'), t('Вт'), t('Ср'), t('Чт'), t('Пт'), t('Сб'), t('Вс')]
