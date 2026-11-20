// Server messages with substitutions: [RegExp, (…groups) => translation].
import S from './server.js'

const tr = (s) => S[s] ?? s
const T = '(\\d{2}\\.\\d{2} \\d{2}:\\d{2})' // DD.MM HH:MI

export default [
  [/^Мест нет: записано (\d+) из (\d+)$/, (a, b) => `No places left: ${a} of ${b} booked`],
  [
    /^Лимит (\d+) вопросов на сегодня\. Завтра можно снова, а срочное — тренеру в WhatsApp\.$/,
    (n) => `Daily limit of ${n} questions reached. You can ask again tomorrow; for anything urgent, message the coach on WhatsApp.`,
  ],
  [/^Не удалось начать оплату: ([\s\S]*)$/, (m) => `Could not start payment: ${m}`],
  [/^Не удалось открыть управление оплатой: ([\s\S]*)$/, (m) => `Could not open payment management: ${m}`],
  [/^Не удалось удалить аккаунт: ([\s\S]*)$/, (m) => `Could not delete account: ${m}`],
  [new RegExp(`^(.+?), ${T} — ([^,]+?)(, [\\s\\S]+)?$`), (slot, when, venue, addr) => `${tr(slot)}, ${when} — ${tr(venue)}${addr ?? ''}`],
  [new RegExp(`^(.+?): ${T} → ${T}$`), (slot, from, to) => `${tr(slot)}: ${from} → ${to}`],
  [new RegExp(`^(.+?), ${T}(\\. [\\s\\S]+)?$`), (slot, when, reason) => `${tr(slot)}, ${when}${reason ?? ''}`],
]
