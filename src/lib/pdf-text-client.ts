/**
 * Reads the text of a PDF in the browser (so the server needs no PDF library and every AI provider gets plain text).
 * pdf.js is loaded from a CDN when first needed; a scan with no text layer gives an empty string.
 */
const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/'
const MAX_CHARS = 20_000

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (source: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }>
    }>
  }
}

let loading: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const lib = (await import(/* @vite-ignore */ `${PDFJS_BASE}pdf.min.mjs`)) as PdfJs
    // A worker from another origin is not allowed directly, so it is wrapped in a blob.
    const code = await (await fetch(`${PDFJS_BASE}pdf.worker.min.mjs`)).text()
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    return lib
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

export async function extractPdfTextInBrowser(file: File): Promise<string> {
  const lib = await loadPdfJs()
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  let text = ''
  for (let n = 1; n <= pdf.numPages && text.length < MAX_CHARS; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    text += content.items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('') + '\n\n'
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS)
}
