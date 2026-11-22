/** Server-only helpers of the exam module: the AI call, shuffling and scoring. */
import { z } from 'zod'

export type QuestionKind = 'abcde' | 'tf' | 'open'

export type QuestionDraft = {
  kind: QuestionKind
  prompt: string
  options: string[]
  correct: string
  points: number
}

export const VERSIONS = ['A', 'B', 'C'] as const

const aiQuestion = z.object({
  kind: z.enum(['abcde', 'tf', 'open']),
  prompt: z.string().trim().min(3).max(1500),
  options: z.array(z.string().trim().min(1).max(500)).optional().default([]),
  correct: z.union([z.string(), z.number(), z.boolean()]).transform(String),
})

const aiResponse = z.object({
  versions: z.object({
    A: z.array(aiQuestion),
    B: z.array(aiQuestion),
    C: z.array(aiQuestion),
  }),
})

/** Turns a raw AI question into a valid one, or null when it cannot be used. */
function clean(raw: z.infer<typeof aiQuestion>): QuestionDraft | null {
  if (raw.kind === 'abcde') {
    if (raw.options.length !== 5) return null
    const index = Number.parseInt(raw.correct, 10)
    if (!Number.isInteger(index) || index < 0 || index > 4) return null
    return { kind: 'abcde', prompt: raw.prompt, options: raw.options, correct: String(index), points: 1 }
  }
  if (raw.kind === 'tf') {
    const value = raw.correct.toLowerCase()
    if (!['true', 'false', 'prawda', 'fałsz', 'falsz', 'p', 'f'].includes(value)) return null
    const isTrue = ['true', 'prawda', 'p'].includes(value)
    return { kind: 'tf', prompt: raw.prompt, options: [], correct: isTrue ? 'true' : 'false', points: 1 }
  }
  return { kind: 'open', prompt: raw.prompt, options: [], correct: raw.correct.slice(0, 2000), points: 1 }
}

const SYSTEM = `Jesteś pomocnikiem wykładowcy w fikcyjnej szkole medycznej (gra fabularna). Tworzysz egzaminy po polsku na podstawie podanych zagadnień. Odpowiadasz WYŁĄCZNIE poprawnym JSON-em, bez komentarzy i bez bloków kodu.`

export type GenerateInput = {
  topic: string
  pdfBase64?: string
  nAbcde: number
  nTf: number
  nOpen: number
}

/** Newest stable Flash model available to this key that can generate content (or null). */
async function pickFlashModel(key: string): Promise<string | null> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key },
  })
  if (!response.ok) return null
  const body = (await response.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const candidates = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
  const stable = candidates
    .map((name) => ({ name, match: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(name) }))
    .filter((c): c is { name: string; match: RegExpExecArray } => c.match !== null)
    .sort((a, b) => Number(b.match[1]) - Number(a.match[1]))
  if (stable.length) return stable[0].name
  return candidates.find((name) => /flash/.test(name) && !/lite|image|tts|live|audio|embed|preview|exp/.test(name)) ?? null
}

/** Asks Gemini for three versions (A, B, C) of the exam. Throws an Error with a Polish message. */
export async function generateExamWithAi(input: GenerateInput): Promise<Record<'A' | 'B' | 'C', QuestionDraft[]>> {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()
  if (!key) {
    // Names only (never values) of everything the site can see, to find where the secret went.
    const names = Object.keys(process.env).sort()
    throw new Error(
      `Strona nie widzi klucza GEMINI_API_KEY. Zmienne widoczne dla strony: ${names.length ? names.join(', ') : 'brak żadnej'}.`,
    )
  }
  const model = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim()

  const prompt = `Przygotuj egzamin w TRZECH wersjach: A, B i C. Wersje mają dotyczyć tego samego materiału i mieć podobny poziom trudności, ale zawierać RÓŻNE pytania (nie powtarzaj pytań między wersjami).

Każda wersja ma zawierać dokładnie:
- ${input.nAbcde} pytań zamkniętych wielokrotnego wyboru (kind "abcde"): "options" to dokładnie 5 odpowiedzi (bez liter A-E na początku), a "correct" to numer poprawnej odpowiedzi 0-4 (dokładnie jedna poprawna),
- ${input.nTf} pytań prawda/fałsz (kind "tf"): "prompt" to twierdzenie, "options" to pusta lista, "correct" to "true" albo "false",
- ${input.nOpen} pytań otwartych (kind "open"): "options" to pusta lista, a "correct" to krótki wzorcowy zarys poprawnej odpowiedzi dla egzaminatora.

Poprawne odpowiedzi w pytaniach zamkniętych rozłóż równomiernie, nie ustawiaj ich zawsze na tej samej pozycji. Pytania mają być jednoznaczne i oparte na materiale.

Format odpowiedzi:
{"versions":{"A":[{"kind":"abcde","prompt":"...","options":["...","...","...","...","..."],"correct":"2"}],"B":[...],"C":[...]}}

Materiał / zagadnienia od wykładowcy:
${input.topic.trim() || '(patrz załączony plik PDF)'}`

  const parts: unknown[] = [{ text: prompt }]
  if (input.pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: input.pdfBase64 } })

  const call = (modelName: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
      }),
    })

  let response: Response
  let usedModel = model
  try {
    response = await call(model)
    // The default model name may have been retired: pick the newest available Flash model instead.
    if (response.status === 404) {
      const fallback = await pickFlashModel(key)
      if (fallback && fallback !== model) {
        usedModel = fallback
        response = await call(fallback)
      }
    }
  } catch {
    throw new Error('Nie udało się połączyć z usługą AI. Spróbuj ponownie za chwilę.')
  }
  if (!response.ok) {
    throw new Error(
      `Usługa AI zwróciła błąd (${response.status}) dla modelu „${usedModel}”. Sprawdź klucz GEMINI_API_KEY i nazwę modelu GEMINI_MODEL.`,
    )
  }

  let text: string | undefined
  try {
    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  } catch {
    text = undefined
  }
  if (!text) throw new Error('Usługa AI nie zwróciła odpowiedzi. Spróbuj ponownie.')

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: z.infer<typeof aiResponse>
  try {
    parsed = aiResponse.parse(JSON.parse(json))
  } catch {
    throw new Error('Odpowiedź AI miała nieprawidłowy format. Spróbuj ponownie.')
  }
  const result = { A: [], B: [], C: [] } as Record<'A' | 'B' | 'C', QuestionDraft[]>
  for (const v of VERSIONS) {
    result[v] = parsed.versions[v].map(clean).filter((q): q is QuestionDraft => q !== null)
  }
  if (VERSIONS.every((v) => result[v].length === 0)) {
    throw new Error('AI nie wygenerowało poprawnych pytań. Zmień opis lub plik i spróbuj ponownie.')
  }
  return result
}

// ---------------------------------------------------------------------------
// Shuffling: every student gets their own order of questions and answers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export type StoredQuestion = {
  id: number
  kind: string
  prompt: string
  options: string
  correct: string
  points: number
  position: number
}

export type StudentQuestion = {
  id: number
  kind: QuestionKind
  prompt: string
  /** abcde only: answers in this student's own order; `id` is the original index that is stored as the answer. */
  options: { id: number; text: string }[]
}

/** What a student sees: shuffled questions and answers, never the correct answers. */
export function studentView(questions: StoredQuestion[], seed: number): StudentQuestion[] {
  const ordered = shuffled(
    [...questions].sort((a, b) => a.position - b.position),
    seed,
  )
  return ordered.map((q) => {
    const kind = q.kind as QuestionKind
    if (kind !== 'abcde') return { id: q.id, kind, prompt: q.prompt, options: [] }
    const texts = JSON.parse(q.options) as string[]
    const options = shuffled(
      texts.map((text, id) => ({ id, text })),
      seed ^ (q.id * 2654435761),
    )
    return { id: q.id, kind, prompt: q.prompt, options }
  })
}

export function parseJsonRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export type ScoreSummary = {
  autoPoints: number
  autoMax: number
  percent: number
  openTotal: number
  openGraded: number
  openFailed: number
  /** 'pending' while open questions are still to be marked. */
  result: 'pass' | 'fail' | 'pending'
}

/** Closed questions are scored automatically; open ones need the examiner's pass/fail marks. */
export function summarize(
  questions: StoredQuestion[],
  answers: Record<string, string>,
  openGrades: Record<string, string>,
  passPercent: number,
): ScoreSummary {
  let autoPoints = 0
  let autoMax = 0
  let openTotal = 0
  let openGraded = 0
  let openFailed = 0
  for (const q of questions) {
    if (q.kind === 'open') {
      openTotal++
      const grade = openGrades[String(q.id)]
      if (grade === 'pass' || grade === 'fail') openGraded++
      if (grade === 'fail') openFailed++
      continue
    }
    autoMax += q.points
    if (answers[String(q.id)] === q.correct) autoPoints += q.points
  }
  const percent = autoMax === 0 ? 100 : Math.round((autoPoints / autoMax) * 100)
  let result: ScoreSummary['result']
  if (openGraded < openTotal) result = 'pending'
  else result = percent >= passPercent && openFailed === 0 ? 'pass' : 'fail'
  return { autoPoints, autoMax, percent, openTotal, openGraded, openFailed, result }
}

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function randomToken(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
}

/** Logins like BA1, CH7: two letters and a number, unique within the list. */
export function autoLogins(count: number): string[] {
  const letters = 'ABCDEFGHJKLMNPRSTUWZ'
  const result = new Set<string>()
  while (result.size < count) {
    const bytes = crypto.getRandomValues(new Uint8Array(3))
    result.add(`${letters[bytes[0] % letters.length]}${letters[bytes[1] % letters.length]}${(bytes[2] % 30) + 1}`)
  }
  return [...result]
}
