// Сообщения сервера с подстановками: [RegExp, (…группы) => перевод].
// Пробуются по порядку, только если точного ключа в словаре нет.
import S from './server.js'

const tr = (s) => S[s] ?? s
const T = '(\\d{2}\\.\\d{2} \\d{2}:\\d{2})' // DD.MM HH:MI

export default [
  // SQL: raise exception 'Мест нет: записано % из %'
  [/^Мест нет: записано (\d+) из (\d+)$/, (a, b) => `Vietu nav: pieteikušies ${a} no ${b}`],

  // Edge Functions: шаблонные ошибки
  [
    /^Лимит (\d+) вопросов на сегодня\. Завтра можно снова, а срочное — тренеру в WhatsApp\.$/,
    (n) => `Šodienas limits — ${n} jautājumi. Rīt varēsiet jautāt atkal, bet steidzamos jautājumus rakstiet trenerim WhatsApp.`,
  ],
  [/^Не удалось начать оплату: ([\s\S]*)$/, (m) => `Neizdevās sākt apmaksu: ${m}`],
  [/^Не удалось открыть управление оплатой: ([\s\S]*)$/, (m) => `Neizdevās atvērt apmaksas pārvaldību: ${m}`],
  [/^Не удалось удалить аккаунт: ([\s\S]*)$/, (m) => `Neizdevās dzēst kontu: ${m}`],

  // Уведомления layer34 (тело). Сначала «другой зал» — у него после времени идёт « — ».
  // <слот>, DD.MM HH:MI — <зал>[, <адрес>]
  [new RegExp(`^(.+?), ${T} — ([^,]+?)(, [\\s\\S]+)?$`), (slot, when, venue, addr) => `${tr(slot)}, ${when} — ${tr(venue)}${addr ?? ''}`],
  // <слот>: DD.MM HH:MI → DD.MM HH:MI
  [new RegExp(`^(.+?): ${T} → ${T}$`), (slot, from, to) => `${tr(slot)}: ${from} → ${to}`],
  // <слот>, DD.MM HH:MI[. <причина>]
  [new RegExp(`^(.+?), ${T}(\\. [\\s\\S]+)?$`), (slot, when, reason) => `${tr(slot)}, ${when}${reason ?? ''}`],
]
