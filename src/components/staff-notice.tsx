import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'

import { getStaffNotice } from '@/lib/owner-controls.functions'

/** The owner's message for staff, shown at the top of the panel. */
export function StaffNotice() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    getStaffNotice()
      .then(setText)
      .catch(() => undefined)
  }, [])
  if (!text) return null
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  )
}
