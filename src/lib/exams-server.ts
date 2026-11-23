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

const aiResponse = z.object({ questions: z.array(aiQuestion) })

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

/** Reads a streamed (server-sent events) Gemini answer and returns the whole text. */
async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const take = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const chunk = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      text += chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    } catch {
      // an incomplete or non-text chunk: ignore it
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) take(line.trim())
  }
  take(buffer.trim())
  return text
}

/** Time allowed for ONE AI request (the platform cuts requests off after about 100 s). */
const AI_TIMEOUT_MS = 80_000
const TEMPORARY = [429, 500, 502, 503, 504]

export type GenerateInput = {
  topic: string
  pdfBase64?: string
  version: 'A' | 'B' | 'C'
  nAbcde: number
  nTf: number
  nOpen: number
}

/**
 * Asks Gemini for one batch of questions of one version. The exam is built from several such small
 * requests (the browser sends them one after another), so every request gets its own time limit.
 * Throws an Error with a Polish message.
 */
export async function generateQuestionsWithAi(input: GenerateInput): Promise<QuestionDraft[]> {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()
  if (!key) {
    // Names only (never values) of everything the site can see, to find where the secret went.
    const names = Object.keys(process.env).sort()
    throw new Error(
      `Strona nie widzi klucza GEMINI_API_KEY. Zmienne widoczne dla strony: ${names.length ? names.join(', ') : 'brak żadnej'}.`,
    )
  }
  const model = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim()
  const deadline = Date.now() + AI_TIMEOUT_MS

  const wanted = [
    input.nAbcde > 0 &&
      `- ${input.nAbcde} pytań zamkniętych wielokrotnego wyboru (kind "abcde"): "options" to dokładnie 5 odpowiedzi (bez liter A-E na początku), a "correct" to numer poprawnej odpowiedzi 0-4 (dokładnie jedna poprawna),`,
    input.nTf > 0 &&
      `- ${input.nTf} pytań prawda/fałsz (kind "tf"): "prompt" to twierdzenie, "options" to pusta lista, "correct" to "true" albo "false",`,
    input.nOpen > 0 &&
      `- ${input.nOpen} pytań otwartych (kind "open"): "options" to pusta lista, a "correct" to krótki wzorcowy zarys poprawnej odpowiedzi dla egzaminatora (1-3 zdania).`,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `Przygotuj część WERSJI ${input.version} egzaminu. Inne wersje i części powstają osobno na tym samym materiale, więc wybierz własny, możliwie niestandardowy zestaw zagadnień, tak aby nie były to najbardziej oczywiste pytania.

Zwróć dokładnie:
${wanted}

Poprawne odpowiedzi w pytaniach zamkniętych rozłóż równomiernie, nie ustawiaj ich zawsze na tej samej pozycji. Pytania mają być jednoznaczne i oparte na materiale.

Format odpowiedzi:
{"questions":[{"kind":"abcde","prompt":"...","options":["...","...","...","...","..."],"correct":"2"},{"kind":"tf","prompt":"...","options":[],"correct":"true"},{"kind":"open","prompt":"...","options":[],"correct":"..."}]}

Materiał / zagadnienia od wykładowcy:
${input.topic.trim() || '(patrz załączony plik PDF)'}`

  const call = (modelName: string, lowThinking = true) => {
    const parts: unknown[] = [{ text: prompt }]
    if (input.pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: input.pdfBase64 } })
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.9,
          ...(lowThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
    })
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const callWithRetry = async (modelName: string) => {
    let result = await call(modelName)
    // A model that does not know the thinking setting answers 400: ask again without it.
    if (result.status === 400) result = await call(modelName, false)
    if (TEMPORARY.includes(result.status) && deadline - Date.now() > 20_000) {
      await sleep(3000)
      result = await call(modelName)
    }
    return result
  }

  let response: Response
  let usedModel = model
  try {
    response = await callWithRetry(model)
    // The default model name may have been retired: pick the newest available Flash model instead.
    if (response.status === 404) {
      const fallback = await pickFlashModel(key)
      if (fallback && fallback !== model) {
        usedModel = fallback
        response = await callWithRetry(fallback)
      }
    }
  } catch {
    throw new Error('AI nie odpowiedziało na czas. Spróbuj ponownie.')
  }
  if (!response.ok) {
    if (response.status === 524 || response.status === 408) {
      throw new Error(`Usługa AI przekroczyła limit czasu (${response.status}).`)
    }
    throw new Error(
      TEMPORARY.includes(response.status)
        ? `Usługa AI jest chwilowo przeciążona (${response.status}).`
        : `Usługa AI zwróciła błąd (${response.status}) dla modelu „${usedModel}”. Sprawdź klucz GEMINI_API_KEY i nazwę modelu GEMINI_MODEL.`,
    )
  }

  let text: string
  try {
    text = await readStream(response)
  } catch {
    throw new Error('AI nie odpowiedziało na czas. Spróbuj ponownie.')
  }
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let questions: QuestionDraft[]
  try {
    questions = aiResponse
      .parse(JSON.parse(json))
      .questions.map(clean)
      .filter((q): q is QuestionDraft => q !== null)
  } catch {
    throw new Error('Odpowiedź AI miała nieprawidłowy format.')
  }
  if (questions.length === 0) throw new Error('AI nie wygenerowało poprawnych pytań.')
  return questions
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
