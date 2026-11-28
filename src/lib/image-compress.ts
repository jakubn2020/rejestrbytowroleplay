/** Browser-side image helpers for the screenshot proofs. */

/** Longest side and size limit of the screenshot that is sent to the server. */
const MAX_SIDE = 1600
const MAX_CHARS = 1_800_000

/** Shrinks a screenshot in the browser so it stays small enough to store (JPEG). */
export async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Nie udało się odczytać obrazu'))
      img.src = url
    })
    let scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    let quality = 0.82
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Brak obsługi canvas')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= MAX_CHARS) return dataUrl
      scale *= 0.75
      quality = Math.max(0.5, quality - 0.1)
    }
    throw new Error('Zrzut ekranu jest zbyt duży')
  } finally {
    URL.revokeObjectURL(url)
  }
}
