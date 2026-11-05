import { Link } from 'react-router-dom'
import { CLUB, TEAMS, FIRST_TRAINING_FREE } from '../data/club.js'
import TeamCard from '../components/TeamCard.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Home() {
  const { profile } = useAuth()
  // Вошедший ученик видит расписание своего направления (и другого — если включил в кабинете).
  // Гости и тренер видят обе команды.
  const ownOnly =
    profile && profile.role === 'athlete' && ['grappling', 'mma'].includes(profile.discipline) && !profile.cross_training
  const teams = ownOnly ? TEAMS.filter((t) => t.id === profile.discipline) : TEAMS
  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="border-l-4 border-accent pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">MMA · K1 · Grappling</p>
        <h1 className="mt-2 text-4xl leading-none md:text-6xl">
          {CLUB.name}
          <span className="block text-accent">& Grappling Team</span>
        </h1>
        <p className="mt-4 text-neutral-300">
          {CLUB.address} · Тренер: {CLUB.coach} ·{' '}
          <a href={`tel:${CLUB.coachPhone.replace(/\s/g, '')}`} className="whitespace-nowrap text-white hover:text-accent">
            {CLUB.coachPhone}
          </a>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/register" className="btn-primary">
            {FIRST_TRAINING_FREE ? 'Первая тренировка бесплатно' : 'Записаться'}
          </Link>
          <a href="#schedule" className="btn-outline">Расписание</a>
        </div>
      </section>

      {/* Команды: расписание + цены */}
      <section id="schedule" className="scroll-mt-24 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl">Расписание и цены</h2>
          {FIRST_TRAINING_FREE && (
            <p className="text-right text-sm text-neutral-400">
              Первая тренировка — <span className="text-accent">бесплатно</span>
            </p>
          )}
        </div>
        <div className={`grid gap-4 ${teams.length > 1 ? 'md:grid-cols-2' : ''}`}>
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      </section>
    </div>
  )
}
