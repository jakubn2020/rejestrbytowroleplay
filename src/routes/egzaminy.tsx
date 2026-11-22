import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ExamEditor } from '@/components/exams/exam-editor'
import { ExamsHome } from '@/components/exams/exams-home'
import { SessionMonitor } from '@/components/exams/session-monitor'
import { Button } from '@/components/ui/button'
import { currentUser } from '@/lib/auth.functions'

export const Route = createFileRoute('/egzaminy')({
  head: () => ({ meta: [{ title: 'Egzaminy (beta) – Centralny Rejestr' }, { name: 'robots', content: 'noindex' }] }),
  component: ExamConsole,
})

export type ExamView = { name: 'home' } | { name: 'exam'; id: number } | { name: 'session'; id: number }

function ExamConsole() {
  const [access, setAccess] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [view, setView] = useState<ExamView>({ name: 'home' })

  useEffect(() => {
    currentUser()
      .then((user) => setAccess(user?.isSuperAdmin ? 'ok' : 'denied'))
      .catch(() => setAccess('denied'))
  }, [])

  if (access === 'loading') return <div className="mx-auto max-w-5xl px-5 py-12 text-muted-foreground">Wczytywanie…</div>
  if (access === 'denied') {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">Egzaminy (beta)</h1>
        <p className="mt-4 text-muted-foreground">
          Moduł jest w wersji beta i na razie dostępny tylko dla właściciela strony. Zaloguj się do panelu na konto właściciela.
        </p>
        <Button asChild variant="outline" className="mt-4"><Link to="/admin">Przejdź do panelu</Link></Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">
          Egzaminy <span className="text-base font-normal text-muted-foreground">(beta, tylko właściciel)</span>
        </h1>
        <div className="flex gap-2">
          {view.name !== 'home' && <Button variant="outline" onClick={() => setView({ name: 'home' })}>Wróć do listy</Button>}
          <Button asChild variant="ghost"><Link to="/admin">Panel</Link></Button>
        </div>
      </div>
      {view.name === 'home' && <ExamsHome onOpen={setView} />}
      {view.name === 'exam' && <ExamEditor id={view.id} onOpen={setView} />}
      {view.name === 'session' && <SessionMonitor id={view.id} onOpen={setView} />}
    </div>
  )
}
