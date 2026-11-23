import { useEffect, useState } from 'react'
import { KeyRound, LogOut } from 'lucide-react'

import { ChangePasswordDialog } from '@/components/admin/password-dialogs'
import { ExaminerView } from '@/components/examiners/examiner-view'
import { ExamStaffTutorial, examTutorialSeen, type TutorialKind } from '@/components/examiners/exam-staff-tutorial'
import { ModeratorView } from '@/components/examiners/moderator-view'
import { StaffNotice } from '@/components/staff-notice'
import { Button } from '@/components/ui/button'
import { ROLE_EXAMINER, ROLE_EXAM_MOD } from '@/lib/registry'

/** The smaller panel for examiners and moderators of examiners (they have no access to the register itself). */
export function ExamStaffPanel({
  user,
  onLogout,
}: {
  user: { email: string; roles?: string[] }
  onLogout: () => void
}) {
  const roles = user.roles ?? []
  const isMod = roles.includes(ROLE_EXAM_MOD)
  const isExaminer = roles.includes(ROLE_EXAMINER)
  const kind: TutorialKind = isMod ? 'moderator' : 'examiner'
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    if (!examTutorialSeen(kind, user.email)) setTutorialOpen(true)
  }, [kind, user.email])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Zalogowano jako <strong className="text-foreground">{user.email}</strong>{' '}
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{isMod ? 'moderator egzaminatorów' : 'egzaminator'}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTutorialOpen(true)}>Samouczek</Button>
          <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
            <KeyRound className="size-4" /> Zmień hasło
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="size-4" /> Wyloguj
          </Button>
        </div>
      </div>
      <StaffNotice />
      <ExamStaffTutorial kind={kind} email={user.email} open={tutorialOpen} onOpenChange={setTutorialOpen} />
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      {isMod && <ModeratorView />}
      {isMod && (
        <h2 className="pt-2 font-[family-name:var(--font-heading)] text-xl font-bold text-[var(--registry-navy)]">
          Wnioski o wpis do rejestru (na zasadach egzaminatora)
        </h2>
      )}
      {(isMod || isExaminer) && <ExaminerView email={user.email} />}
      {!isMod && !isExaminer && <p className="text-muted-foreground">To konto nie ma przypisanej roli w panelu.</p>}
    </div>
  )
}
