/**
 * Minimal QR code encoder (byte mode, error correction level M, versions 1–10),
 * written without dependencies. Returns the dark/light modules of the symbol.
 */

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const MAX_VERSION = 10

function rawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function dataCodewords(ver: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]
}

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor)
    })
  }
  return result
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return ((x + y) % 2 + ((x * y) % 3)) % 2 === 0
  }
}

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  // Rule 1: runs of 5+ equal modules in rows and columns.
  for (let a = 0; a < size; a++) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let b = 1; b < size; b++) {
        const cur = horizontal ? m[a][b] : m[b][a]
        const prev = horizontal ? m[a][b - 1] : m[b - 1][a]
        if (cur === prev) {
          run++
          if (run === 5) score += 3
          else if (run > 5) score += 1
        } else {
          run = 1
        }
      }
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  }
  // Rule 3: finder-like patterns.
  const pattern = [true, false, true, true, true, false, true, false, false, false, false]
  const reversed = [...pattern].reverse()
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 11 <= size; b++) {
      for (const horizontal of [true, false]) {
        let p1 = true
        let p2 = true
        for (let k = 0; k < 11; k++) {
          const v = horizontal ? m[a][b + k] : m[b + k][a]
          if (v !== pattern[k]) p1 = false
          if (v !== reversed[k]) p2 = false
        }
        if (p1) score += 40
        if (p2) score += 40
      }
    }
  }
  // Rule 4: balance of dark modules.
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  score += Math.max(k, 0) * 10
  return score
}

export function makeQr(text: string): boolean[][] {
  const bytes = utf8Bytes(text)

  let ver = 1
  while (ver <= MAX_VERSION) {
    const countBits = ver < 10 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
    ver++
  }
  if (ver > MAX_VERSION) throw new Error('Tekst jest zbyt długi dla kodu QR')

  // Data bits.
  const bits: number[] = []
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  const capacityBits = dataCodewords(ver) * 8
  push(0, Math.min(4, capacityBits - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    data.push(v)
  }

  // Error correction and interleaving.
  const numBlocks = NUM_BLOCKS[ver]
  const eccLen = ECC_PER_BLOCK[ver]
  const rawCodewords = Math.floor(rawModules(ver) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - eccLen + (i < numShort ? 0 : 1)
    const dat = data.slice(k, k + datLen)
    k += datLen
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(block[i])
    })
  }

  // Function patterns.
  const size = ver * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  )
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  )
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFunction[y][x] = true
  }

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)

  const alignPos: number[] = []
  if (ver > 1) {
    const numAlign = Math.floor(ver / 7) + 2
    const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
    alignPos.push(6)
    for (let pos = size - 7; alignPos.length < numAlign; pos -= step) alignPos.splice(1, 0, pos)
  }
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      const last = alignPos.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(alignPos[i] + dx, alignPos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  const drawFormat = (grid: boolean[][], mask: number) => {
    const put = (x: number, y: number, dark: boolean) => {
      grid[y][x] = dark
      isFunction[y][x] = true
    }
    const formatData = (0 << 3) | mask // level M = 0b00
    let rem = formatData
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const fb = ((formatData << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) put(8, i, bit(fb, i))
    put(8, 7, bit(fb, 6))
    put(8, 8, bit(fb, 7))
    put(7, 8, bit(fb, 8))
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(fb, i))
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(fb, i))
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(fb, i))
    put(8, size - 8, true)
  }
  drawFormat(modules, 0)

  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const vb = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFn(a, b, bit(vb, i))
      setFn(b, a, bit(vb, i))
    }
  }

  // Place data modules in the zigzag order.
  let idx = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x] && idx < codewords.length * 8) {
          modules[y][x] = bit(codewords[idx >>> 3], 7 - (idx & 7))
          idx++
        }
      }
    }
  }

  // Pick the mask with the lowest penalty.
  let bestScore = Infinity
  let bestModules: boolean[][] = modules
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => row.slice())
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y][x] && maskApplies(mask, x, y)) candidate[y][x] = !candidate[y][x]
      }
    }
    drawFormat(candidate, mask)
    const score = penalty(candidate)
    if (score < bestScore) {
      bestScore = score
      bestModules = candidate
    }
  }
  return bestModules
}

/** SVG path (one square per dark module) for the given symbol, with a quiet-zone border. */
export function qrPath(modules: boolean[][], border = 2): { d: string; size: number } {
  const parts: string[] = []
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + border},${y + border}h1v1h-1z`)
    })
  })
  return { d: parts.join(''), size: modules.length + border * 2 }
}
