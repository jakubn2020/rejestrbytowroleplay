/** Server-only helpers of the exam module: the AI call, shuffling and scoring. */
import { extractText, getDocumentProxy } from 'unpdf'

export type QuestionKind = 'abcde' | 'tf' | 'open'

export type QuestionDraft = {
  kind: QuestionKind
  prompt: string
  options: string[]
  correct: string
  points: number
}

export const VERSIONS = ['A', 'B', 'C', 'D', 'E'] as const
export type ExamVersion = (typeof VERSIONS)[number]

/** Lenient reading of one AI question: models differ in how they name kinds and mark the correct answer. */
function clean(raw: unknown): QuestionDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const prompt = String(r.prompt ?? r.question ?? r.pytanie ?? '').trim().slice(0, 1500)
  if (prompt.length < 3) return null
  const kindText = String(r.kind ?? r.type ?? '').toLowerCase()
  const correctRaw = r.correct ?? r.answer ?? r.correct_answer ?? r.poprawna ?? ''
  const correct = String(correctRaw).trim()
  const optionsRaw = Array.isArray(r.options) ? r.options : Array.isArray(r.answers) ? r.answers : []
  const strip = (text: string) => text.replace(/^\s*[A-Ea-e][).:]\s+/, '').trim().slice(0, 500)
  const options = optionsRaw.map((o) => strip(String(o))).filter((o) => o.length > 0)

  if (/abcde|closed|multiple|mcq|zamkni|wybor|wyboru/.test(kindText) || (!kindText && options.length >= 4)) {
    if (options.length < 5) return null
    const five = options.slice(0, 5)
    let index = -1
    const letter = /^([A-Ea-e])(?:[).:\s]|$)/.exec(correct)
    if (/^[0-4]$/.test(correct)) index = Number(correct)
    else if (letter) index = letter[1].toUpperCase().charCodeAt(0) - 65
    else {
      const byText = five.findIndex((o) => o.toLowerCase() === strip(correct).toLowerCase())
      index = byText
    }
    if (index < 0 || index > 4) return null
    return { kind: 'abcde', prompt, options: five, correct: String(index), points: 1 }
  }
  if (/^tf$|true|false|prawda|fa[lł]sz|p\/f/.test(kindText)) {
    const value = correct.toLowerCase()
    if (!['true', 'false', 'prawda', 'fałsz', 'falsz', 'p', 'f', 'tak', 'nie'].includes(value)) return null
    const isTrue = ['true', 'prawda', 'p', 'tak'].includes(value)
    return { kind: 'tf', prompt, options: [], correct: isTrue ? 'true' : 'false', points: 1 }
  }
  if (/open|otwart/.test(kindText)) {
    return { kind: 'open', prompt, options: [], correct: correct.slice(0, 2000), points: 1 }
  }
  return null
}

const SYSTEM = `Jesteś pomocnikiem wykładowcy w fikcyjnej szkole medycznej (gra fabularna). Tworzysz egzaminy po polsku na podstawie podanych zagadnień. Odpowiadasz WYŁĄCZNIE poprawnym JSON-em, bez komentarzy i bez bloków kodu.`

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
  /** Which AI to use; 'auto' = the site's default order. */
  provider?: 'auto' | 'groq' | 'gemini'
  topic: string
  /** Text read from the attached PDF (the AI gets text only, so every provider can be used). */
  material?: string
  version: ExamVersion
  nAbcde: number
  nTf: number
  nOpen: number
}

/** Plain text of a PDF (base64), cut to what an AI request can take. Empty for a scan with no text layer. */
export async function extractPdfText(pdfBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: true })
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20_000)
}

function buildPrompt(input: GenerateInput): string {
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
${input.topic.trim() || '(patrz tekst z pliku poniżej)'}${
    input.material ? `\n\nTekst z załączonego pliku PDF:\n${input.material}` : ''
  }`
  return prompt
}

/** Gemini: returns the raw text answer. Throws an Error with a Polish message. */
async function askGemini(input: GenerateInput, prompt: string): Promise<string> {
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

  const call = (modelName: string, lowThinking = true) => {
    const parts: unknown[] = [{ text: prompt }]
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
    if (result.status !== 429 && TEMPORARY.includes(result.status) && deadline - Date.now() > 20_000) {
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
    // Google explains the reason (rate limit per minute, daily quota…): show it to the owner.
    let detail = ''
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      detail = body.error?.message ? ` Google: ${body.error.message.slice(0, 220)}` : ''
    } catch {
      detail = ''
    }
    if (response.status === 524 || response.status === 408) {
      throw new Error(`Usługa AI przekroczyła limit czasu (${response.status}).${detail}`)
    }
    if (response.status === 429) {
      throw new Error(`Limit zapytań do AI (429): za dużo zapytań naraz albo wyczerpany dzienny limit klucza.${detail}`)
    }
    throw new Error(
      TEMPORARY.includes(response.status)
        ? `Usługa AI jest chwilowo przeciążona (${response.status}).${detail}`
        : `Usługa AI zwróciła błąd (${response.status}) dla modelu „${usedModel}”. Sprawdź klucz GEMINI_API_KEY i nazwę modelu GEMINI_MODEL.${detail}`,
    )
  }

  try {
    return await readStream(response)
  } catch {
    throw new Error('AI nie odpowiedziało na czas. Spróbuj ponownie.')
  }
}

/** Groq (OpenAI-compatible API). Takes text only, so a PDF cannot be sent to it. */
async function askGroq(prompt: string, key: string): Promise<string> {
  const model = (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim()
  let response: Response
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    })
  } catch {
    throw new Error('Groq nie odpowiedział na czas. Spróbuj ponownie.')
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      detail = body.error?.message ? ` Groq: ${body.error.message.slice(0, 220)}` : ''
    } catch {
      detail = ''
    }
    if (response.status === 429) throw new Error(`Limit zapytań do AI (429) w Groq.${detail}`)
    throw new Error(`Groq zwrócił błąd (${response.status}) dla modelu „${model}”. Sprawdź GROQ_API_KEY i GROQ_MODEL.${detail}`)
  }
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content ?? ''
}

function parseQuestions(text: string): QuestionDraft[] {
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let list: unknown[] = []
  try {
    const parsed = JSON.parse(json) as unknown
    if (Array.isArray(parsed)) list = parsed
    else if (parsed && typeof parsed === 'object') {
      const found = Object.values(parsed as Record<string, unknown>).find(Array.isArray)
      list = (found as unknown[] | undefined) ?? []
    }
  } catch {
    throw new Error(`Odpowiedź AI nie była poprawnym JSON-em. Początek: ${json.slice(0, 120)}`)
  }
  const questions = list.map(clean).filter((q): q is QuestionDraft => q !== null)
  if (questions.length === 0) {
    throw new Error(`AI nie wygenerowało pytań w oczekiwanym formacie (otrzymano ${list.length}). Początek: ${json.slice(0, 160)}`)
  }
  return questions
}

/**
 * Generates one batch of questions of one version. The exam is built from several such small
 * requests (the browser sends them one after another), so every request gets its own time limit.
 * Providers: Gemini (reads PDFs) and Groq (text only). Groq is tried first when GROQ_API_KEY is set, then Gemini
 * if Groq fails; AI_PROVIDER=gemini reverses the order. Throws an Error with a Polish message.
 */
export async function generateQuestionsWithAi(input: GenerateInput): Promise<QuestionDraft[]> {
  const prompt = buildPrompt(input)
  const groqKey = (process.env.GROQ_API_KEY ?? '').trim()
  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()
  // Groq goes first whenever its key is set; AI_PROVIDER=gemini puts Gemini first instead.
  const groqFirst = (process.env.AI_PROVIDER ?? '').trim().toLowerCase() !== 'gemini'

  type Attempt = () => Promise<string>
  const attempts: Attempt[] = []
  const gemini: Attempt = () => askGemini(input, prompt)
  const groq: Attempt = () => {
    if (!groqKey) throw new Error('Brak klucza GROQ_API_KEY (strona go nie widzi).')
    return askGroq(prompt, groqKey)
  }
  const choice = input.provider ?? 'auto'
  if (choice === 'groq') attempts.push(groq)
  else if (choice === 'gemini') attempts.push(gemini)
  else {
    if (groqFirst && groqKey) attempts.push(groq)
    if (geminiKey || !groqKey) attempts.push(gemini)
    if (!groqFirst && groqKey) attempts.push(groq)
  }

  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      return parseQuestions(await attempt())
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Nie udało się wygenerować pytań.')
    }
  }
  throw new Error(errors.join(' | ') || 'Nie udało się wygenerować pytań.')
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
