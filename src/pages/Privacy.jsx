import { Link } from 'react-router-dom'
import { CLUB } from '../data/club.js'
import { lang, t } from '../lib/i18n.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

// Политика конфиденциальности (APP_PASSPORT §5: обязательна до публикации в сторах).
// Текст — по GDPR (Регламент ЕС 2016/679). Реквизиты клуба и контакт — в CONTACT.
// При изменении обработки данных — обновить текст и дату.
const UPDATED = t('7 ноября 2026 г.')
const CONTACT = 'danilasppc@gmail.com'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  )
}

export default function Privacy() {
  const { user } = useAuth()
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header className="border-l-4 border-accent pl-4">
        <p className="label">{t('Документ')}</p>
        <h1 className="text-3xl">{t('Политика конфиденциальности')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('Обновлено:')} {UPDATED}</p>
      </header>

      {lang === 'lv' ? <BodyLv /> : lang === 'en' ? <BodyEn /> : <BodyRu />}

      <p className="text-sm text-neutral-500">
        {user ? (
          <Link to="/dashboard" className="text-accent hover:underline">← {t('В кабинет')}</Link>
        ) : (
          <Link to="/" className="text-accent hover:underline">← {t('На главную')}</Link>
        )}
      </p>
    </article>
  )
}

// Русский текст политики.
function BodyRu() {
  return (
    <>
      <Section title="1. Кто обрабатывает данные">
        <p>
          Приложение спортивного клуба <b>{CLUB.name}</b> и <b>{CLUB.grapplingName}</b>, {CLUB.address}, Латвия.
          Ответственный за обработку данных — тренер клуба {CLUB.coach}. Связь по вопросам данных:{' '}
          <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">{CONTACT}</a>.
        </p>
      </Section>

      <Section title="2. Какие данные мы собираем и зачем">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Имя, фамилия, номер телефона</b> — вход в приложение и связь с вами по поводу тренировок.</li>
          <li><b>Селфи</b> — чтобы тренер узнавал учеников в зале. Фото хранится в закрытом хранилище и видно только вошедшим участникам клуба.</li>
          <li><b>Направление, посещения, ранг, записи на тренировки</b> — учёт тренировок, стаж и клубная система рангов.</li>
          <li><b>Рост, вес, дата рождения</b> (если вы их укажете) — расчёт индекса массы тела и возраста. Видите только вы и тренер.</li>
          <li><b>Дневник тренировок и освоенные приёмы</b> — ваши записи после тренировок. Видите только вы и тренер.</li>
          <li><b>Оценки партнёров</b> (техника, скорость, сила и т.д., 1–10) — анонимно: ученик видит свои средние баллы, когда оценок 3 и больше; кто какую оценку поставил, видит только тренер. В рейтинге клуба (отдельно MMA и грэпплинг) участники клуба видят имя и общий средний балл тех, у кого 3+ оценок; гигиена в рейтинг не входит. Кто скрыл профиль, в рейтинг не попадает.</li>
          <li><b>Фото и видео в галерее</b> — то, что вы сами загрузили. Видно только вошедшим участникам клуба и только после одобрения тренером.</li>
          <li><b>Друзья и личные сообщения</b> — список ваших друзей и переписка с ними. Сообщения видят только двое участников переписки; тренер чужие сообщения не читает. Детские аккаунты в друзья не добавляются.</li>
          <li><b>Приглашения</b> — кто кого позвал на тренировку (тренер видит, что пришёл гость). Приглашённый по ссылке видит только имя пригласившего.</li>
          <li><b>Платежи</b> — статус абонемента, суммы и даты оплат: картой в приложении, переводом на счёт клуба и наличными тренеру. Оплату картой проводит Stripe: номер карты в приложение не попадает, его обрабатывает только Stripe.</li>
          <li><b>Список учеников клуба</b> — тренер ведёт учёт учеников и их оплат (имя, направление, телефон, если вы его давали, оплаты переводом по банковской выписке). Если вы зарегистрируетесь в приложении, тренер связывает эту запись с вашим аккаунтом.</li>
          <li><b>Уведомления</b> — об отмене, переносе или смене зала тренировки, на которую вы (или ваш ребёнок) записаны.</li>
          <li><b>Заявка на пробную тренировку</b> (без регистрации) — имя, телефон, направление, возраст и удобное время, если вы их указали. Нужна только чтобы тренер связался с вами; видит только тренер.</li>
        </ul>
        <p>
          Основания: исполнение договора об оказании спортивных услуг, законный интерес клуба (учёт посещаемости
          и оплат) и ваше согласие (селфи, параметры тела, дневник, оценки, фото в галерее).
        </p>
        <p>
          Доступ: всё перечисленное видит тренер клуба. Помощник тренера видит только посещения и записи на
          тренировки — без телефонов, оплат, дневников и параметров тела.
        </p>
      </Section>

      <Section title="3. Дети">
        <p>
          В клубе есть детские группы. Аккаунт для ребёнка младше 13 лет регистрирует родитель или законный
          представитель, он же даёт согласие на обработку данных ребёнка. Данные детей используются только для
          учёта тренировок и не передаются третьим лицам для рекламы.
        </p>
      </Section>

      <Section title="4. Кому передаются данные">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Supabase</b> — хранение базы данных, фото и видео (серверы в ЕС, Франкфурт).</li>
          <li><b>Stripe</b> — приём оплаты картой и счета.</li>
          <li><b>GitHub Pages</b> — размещение самого приложения (без ваших данных).</li>
          <li>Бухгалтер клуба — сведения о платежах для налогового учёта.</li>
        </ul>
        <p>Мы не продаём данные и не используем их для рекламы.</p>
      </Section>

      <Section title="5. Сколько храним">
        <p>
          Пока у вас есть аккаунт. После удаления аккаунта сразу удаляются профиль, телефон, селфи, посещения,
          записи на тренировки, параметры тела, дневник, приёмы, оценки (поставленные вами и вам), друзья и переписка, фото и видео
          в галерее. Сведения о платежах хранятся в Stripe, в учёте клуба и у бухгалтера столько, сколько требует
          закон Латвии о бухгалтерском учёте. Заявки на пробную тренировку удаляются автоматически через
          180 дней (или раньше — по вашей просьбе).
        </p>
      </Section>

      <Section title="6. Ваши права">
        <p>
          Вы можете запросить копию своих данных, исправить их, ограничить обработку или отозвать согласие.
          <b> Удалить аккаунт можно самостоятельно</b>: Кабинет → внизу «Удалить аккаунт». Жалобу можно подать
          в Государственную инспекцию данных Латвии (Datu valsts inspekcija, dvi.gov.lv).
        </p>
      </Section>
    </>
  )
}

// Latviešu teksts (juridiski līdzvērtīgs krievu tekstam).
function BodyLv() {
  return (
    <>
      <Section title="1. Kas apstrādā datus">
        <p>
          Sporta kluba <b>{CLUB.name}</b> un <b>{CLUB.grapplingName}</b> lietotne, {CLUB.address}, Latvija.
          Personas datu apstrādes pārzinis — kluba treneris {CLUB.coach}. Saziņa datu jautājumos:{' '}
          <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">{CONTACT}</a>.
        </p>
      </Section>

      <Section title="2. Kādus datus mēs vācam un kāpēc">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Vārds, uzvārds, tālruņa numurs</b> — pieslēgšanās lietotnei un saziņa ar jums par treniņiem.</li>
          <li><b>Pašbilde (selfijs)</b> — lai treneris zālē atpazītu audzēkņus. Foto tiek glabāts slēgtā krātuvē, un to redz tikai pieslēgušies kluba dalībnieki.</li>
          <li><b>Virziens, apmeklējumi, rangs, pieteikšanās treniņiem</b> — treniņu uzskaite, stāžs un kluba rangu sistēma.</li>
          <li><b>Augums, svars, dzimšanas datums</b> (ja tos norādāt) — ķermeņa masas indeksa un vecuma aprēķins. Tos redzat tikai jūs un treneris.</li>
          <li><b>Treniņu dienasgrāmata un apgūtās tehnikas</b> — jūsu ieraksti pēc treniņiem. Tos redzat tikai jūs un treneris.</li>
          <li><b>Partneru vērtējumi</b> (tehnika, ātrums, spēks u. c., 1–10) — anonīmi: audzēknis redz savus vidējos vērtējumus, ja vērtējumu ir 3 vai vairāk; kurš kādu vērtējumu ir devis, redz tikai treneris. Kluba reitingā (atsevišķi MMA un grapplings) kluba dalībnieki redz vārdu un kopējo vidējo vērtējumu tiem, kam ir 3+ vērtējumi; higiēna reitingā netiek ieskaitīta. Kas paslēpis profilu, reitingā neparādās.</li>
          <li><b>Foto un video galerijā</b> — tas, ko esat augšupielādējuši paši. Redzams tikai pieslēgušies kluba dalībniekiem un tikai pēc trenera apstiprinājuma.</li>
          <li><b>Draugi un privātās ziņas</b> — jūsu draugu saraksts un sarakste ar viņiem. Ziņas redz tikai abi sarakstes dalībnieki; treneris svešas ziņas nelasa. Bērnu kontus draugos pievienot nevar.</li>
          <li><b>Ielūgumi</b> — kurš kuru uzaicinājis uz treniņu (treneris redz, ka ieradies viesis). Ar saiti uzaicinātais redz tikai uzaicinātāja vārdu.</li>
          <li><b>Maksājumi</b> — abonementa statuss, maksājumu summas un datumi: ar karti lietotnē, ar pārskaitījumu uz kluba kontu un skaidrā naudā trenerim. Maksājumus ar karti apstrādā Stripe: kartes numurs lietotnē nenonāk, to apstrādā tikai Stripe.</li>
          <li><b>Kluba audzēkņu saraksts</b> — treneris uzskaita audzēkņus un viņu maksājumus (vārds, virziens, tālrunis, ja esat to norādījuši, pārskaitījumi pēc bankas izraksta). Ja reģistrējaties lietotnē, treneris sasaista šo ierakstu ar jūsu kontu.</li>
          <li><b>Paziņojumi</b> — par tāda treniņa atcelšanu, pārcelšanu vai zāles maiņu, uz kuru esat pieteicies jūs (vai jūsu bērns).</li>
          <li><b>Pieteikums izmēģinājuma treniņam</b> (bez reģistrācijas) — vārds, tālrunis, virziens, vecums un ērtākais laiks, ja tos norādījāt. Nepieciešams tikai, lai treneris ar jums sazinātos; to redz tikai treneris.</li>
        </ul>
        <p>
          Apstrādes tiesiskais pamats: sporta pakalpojumu līguma izpilde, kluba leģitīmās intereses (apmeklējumu
          un maksājumu uzskaite) un jūsu piekrišana (pašbilde, ķermeņa parametri, dienasgrāmata, vērtējumi, foto galerijā).
        </p>
        <p>
          Piekļuve: visu uzskaitīto redz kluba treneris. Trenera palīgs redz tikai apmeklējumus un pieteikšanos
          treniņiem — bez tālruņiem, maksājumiem, dienasgrāmatām un ķermeņa parametriem.
        </p>
      </Section>

      <Section title="3. Bērni">
        <p>
          Klubā ir bērnu grupas. Kontu bērnam, kas jaunāks par 13 gadiem, reģistrē vecāks vai likumiskais
          pārstāvis, kurš arī dod piekrišanu bērna personas datu apstrādei. Bērnu dati tiek izmantoti tikai treniņu
          uzskaitei un netiek nodoti trešajām personām reklāmas nolūkos.
        </p>
      </Section>

      <Section title="4. Kam dati tiek nodoti">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Supabase</b> — datubāzes, foto un video glabāšana (serveri ES, Frankfurtē).</li>
          <li><b>Stripe</b> — maksājumu ar karti pieņemšana un rēķini.</li>
          <li><b>GitHub Pages</b> — pašas lietotnes izvietošana (bez jūsu datiem).</li>
          <li>Kluba grāmatvedis — informācija par maksājumiem nodokļu uzskaitei.</li>
        </ul>
        <p>Mēs nepārdodam datus un neizmantojam tos reklāmai.</p>
      </Section>

      <Section title="5. Cik ilgi glabājam">
        <p>
          Kamēr jums ir konts. Pēc konta dzēšanas nekavējoties tiek dzēsti profils, tālrunis, pašbilde, apmeklējumi,
          pieteikumi treniņiem, ķermeņa parametri, dienasgrāmata, tehnikas, vērtējumi (jūsu dotie un jums dotie), draugi un sarakste, foto
          un video galerijā. Informācija par maksājumiem tiek glabāta Stripe, kluba uzskaitē un pie grāmatveža tik
          ilgi, cik to prasa Latvijas grāmatvedības likums. Pieteikumi izmēģinājuma treniņam tiek automātiski dzēsti
          pēc 180 dienām (vai agrāk — pēc jūsu lūguma).
        </p>
      </Section>

      <Section title="6. Jūsu tiesības">
        <p>
          Jūs varat pieprasīt savu datu kopiju, labot tos, ierobežot apstrādi vai atsaukt piekrišanu.
          <b> Kontu varat dzēst paši</b>: Profils → apakšā «Dzēst kontu». Sūdzību var iesniegt Datu valsts
          inspekcijā (dvi.gov.lv).
        </p>
      </Section>
    </>
  )
}

// English text (translation of the Russian text).
function BodyEn() {
  return (
    <>
      <Section title="1. Who processes the data">
        <p>
          The app of the sports clubs <b>{CLUB.name}</b> and <b>{CLUB.grapplingName}</b>, {CLUB.address}, Latvia.
          The data controller is the club coach {CLUB.coach}. Contact for data questions:{' '}
          <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">{CONTACT}</a>.
        </p>
      </Section>

      <Section title="2. What data we collect and why">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>First name, last name, phone number</b> — signing in to the app and contacting you about training.</li>
          <li><b>Selfie</b> — so the coach can recognise students at the gym. The photo is kept in private storage and is visible only to signed-in club members.</li>
          <li><b>Discipline, visits, rank, session bookings</b> — training records, experience and the club rank system.</li>
          <li><b>Height, weight, date of birth</b> (if you enter them) — calculating body mass index and age. Only you and the coach can see them.</li>
          <li><b>Training diary and mastered techniques</b> — your notes after training. Only you and the coach can see them.</li>
          <li><b>Partner ratings</b> (technique, speed, strength etc., 1–10) — anonymous: a student sees their own averages once there are 3 or more ratings; only the coach sees who gave which rating. In the club ranking (MMA and grappling separately) club members see the name and overall average of those with 3+ ratings; hygiene is not included in the ranking. People who hid their profile do not appear in the ranking.</li>
          <li><b>Photos and videos in the gallery</b> — what you uploaded yourself. Visible only to signed-in club members and only after coach approval.</li>
          <li><b>Friends and private messages</b> — your friends list and your conversations with them. Messages are seen only by the two people in the conversation; the coach does not read other people's messages. Child accounts cannot be added as friends.</li>
          <li><b>Invitations</b> — who invited whom to training (the coach sees that a guest came). A person invited by link sees only the inviter's name.</li>
          <li><b>Payments</b> — membership status, payment amounts and dates: by card in the app, by bank transfer to the club account and in cash to the coach. Card payments are processed by Stripe: the card number never reaches the app, only Stripe handles it.</li>
          <li><b>Club student list</b> — the coach keeps a record of students and their payments (name, discipline, phone if you gave it, bank transfers from the bank statement). If you register in the app, the coach links this record to your account.</li>
          <li><b>Notifications</b> — about cancellation, rescheduling or a change of gym for a session that you (or your child) booked.</li>
          <li><b>Trial session request</b> (without registration) — name, phone, discipline, age and preferred time, if you entered them. Used only so the coach can contact you; only the coach sees it.</li>
        </ul>
        <p>
          Legal basis: performance of the sports services contract, the club's legitimate interest (recording attendance
          and payments) and your consent (selfie, body stats, diary, ratings, gallery photos).
        </p>
        <p>
          Access: the club coach sees everything listed. An assistant coach sees only attendance and session
          bookings — no phone numbers, payments, diaries or body stats.
        </p>
      </Section>

      <Section title="3. Children">
        <p>
          The club has kids groups. An account for a child under 13 is registered by a parent or legal
          guardian, who also gives consent to processing the child's data. Children's data is used only for
          training records and is not passed to third parties for advertising.
        </p>
      </Section>

      <Section title="4. Who receives the data">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Supabase</b> — storage of the database, photos and videos (servers in the EU, Frankfurt).</li>
          <li><b>Stripe</b> — card payments and invoices.</li>
          <li><b>GitHub Pages</b> — hosting of the app itself (without your data).</li>
          <li>The club's accountant — payment information for tax accounting.</li>
        </ul>
        <p>We do not sell data and do not use it for advertising.</p>
      </Section>

      <Section title="5. How long we keep it">
        <p>
          For as long as you have an account. When the account is deleted, the profile, phone, selfie, visits,
          session bookings, body stats, diary, techniques, ratings (given by you and to you), friends and messages, photos and videos
          in the gallery are deleted immediately. Payment information is kept in Stripe, in the club records and by the accountant for
          as long as the Latvian accounting law requires. Trial session requests are deleted automatically after
          180 days (or earlier at your request).
        </p>
      </Section>

      <Section title="6. Your rights">
        <p>
          You can request a copy of your data, correct it, restrict processing or withdraw consent.
          <b> You can delete your account yourself</b>: My account → «Delete account» at the bottom. You can file a complaint
          with the Latvian Data State Inspectorate (Datu valsts inspekcija, dvi.gov.lv).
        </p>
      </Section>
    </>
  )
}
