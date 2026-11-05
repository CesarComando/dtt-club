// Хардкод данных клуба (APP_PASSPORT §4). Позже переедет в Supabase.

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
      { title: 'Детское MMA', days: ['Вт', 'Чт'], time: '16:30–17:45' },
      { title: 'MMA новички', days: ['Пн', 'Ср', 'Пт'], time: '17:00–18:30' },
      { title: 'MMA опытные', days: ['Пн', 'Ср', 'Пт'], time: '19:00–20:30' },
    ],
  },
  {
    id: 'grappling',
    name: 'Daugavpils Grappling Team',
    discipline: 'Grappling no-gi',
    prices: { monthly: 40, single: 5 },
    classes: [
      { title: 'Взрослые', days: ['Вт', 'Чт'], time: '18:00–20:00' },
      { title: 'Взрослые', days: ['Сб'], time: '15:00–17:00' },
    ],
  },
]

export const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
