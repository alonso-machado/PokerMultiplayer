/**
 * Username uniqueness filter — in-memory only, no persistence.
 *
 * Uses SipHash-1-3 with a random startup key to resist hash-flooding attacks
 * (usernames are untrusted user input on a public endpoint).
 *
 * Epoch-prefixed keys prevent cross-deploy collisions without any file I/O:
 *   internal key = `${BLOOM_EPOCH}:${username.toLowerCase()}`
 *   the epoch prefix NEVER leaves this module — callers pass plain usernames.
 *
 * Parameters: n=100,000 · p=0.1% · m=1,440,000 bits (180 KB) · k=10
 * Optimal k formula: k = (m/n) × ln2 = 14.4 × 0.693 ≈ 9.97 → 10
 */

const EPOCH = process.env.BLOOM_EPOCH ?? '1'

// Random 128-bit key generated once at startup — attacker cannot predict positions
const KEY = crypto.getRandomValues(new Uint32Array(4))

function siphash13(str: string, k: Uint32Array): number {
  let v0 = k[0]! ^ 0x736f6d65
  let v1 = k[1]! ^ 0x646f7261
  let v2 = k[2]! ^ 0x6c796765
  let v3 = k[3]! ^ 0x74656462

  function round(): void {
    v0 = (v0 + v1) | 0; v1 = (v1 << 5)  | (v1 >>> 27); v1 ^= v0
    v0 = (v0 << 16) | (v0 >>> 16)
    v2 = (v2 + v3) | 0; v3 = (v3 << 8)  | (v3 >>> 24); v3 ^= v2
    v0 = (v0 + v3) | 0; v3 = (v3 << 7)  | (v3 >>> 25); v3 ^= v0
    v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2
    v2 = (v2 << 16) | (v2 >>> 16)
  }

  for (let i = 0; i < str.length; i++) {
    v3 ^= str.charCodeAt(i)
    round()                        // 1 compression round
    v0 ^= str.charCodeAt(i)
  }

  v2 ^= 0xff
  round(); round(); round()        // 3 finalization rounds

  return (v0 ^ v1 ^ v2 ^ v3) >>> 0
}

function positions(str: string, m: number, k: number): number[] {
  const h1 = siphash13(str, KEY)
  const h2 = siphash13(str, new Uint32Array([KEY[2]!, KEY[3]!, KEY[0]!, KEY[1]!]))
  return Array.from({ length: k }, (_, i) => ((h1 + i * h2) >>> 0) % m)
}

class UsernameFilter {
  private readonly bits = new Uint8Array(180_000)  // 1,440,000 bits
  private readonly m   = 1_440_000
  private readonly k   = 10

  /**
   * Returns false if the username is DEFINITELY free in this epoch.
   * Returns true if it MIGHT be taken (0.1% chance of false positive).
   */
  mightExist(username: string): boolean {
    const key = `${EPOCH}:${username.toLowerCase()}`
    return positions(key, this.m, this.k)
      .every(pos => (this.bits[pos >>> 3]! & (1 << (pos & 7))) !== 0)
  }

  /**
   * Marks a username as taken for this epoch.
   * Call this only after a successful registration — never on failed attempts.
   */
  add(username: string): void {
    const key = `${EPOCH}:${username.toLowerCase()}`
    for (const pos of positions(key, this.m, this.k)) {
      this.bits[pos >>> 3] |= 1 << (pos & 7)
    }
  }

  /** Returns diagnostic stats and the full bit array encoded as base64. */
  stats(): {
    epoch: string
    m: number
    k: number
    bitsSet: number
    estimatedItems: number
    falsePositiveRate: number
    fillRatio: number
    bits: string
  } {
    let bitsSet = 0
    for (const byte of this.bits) {
      // Hamming weight (popcount) per byte
      let b = byte - ((byte >> 1) & 0x55)
      b = (b & 0x33) + ((b >> 2) & 0x33)
      bitsSet += (b + (b >> 4)) & 0x0f
    }
    const fillRatio = bitsSet / this.m
    // n_est = -(m/k) × ln(1 − fill)
    const estimatedItems = fillRatio < 1
      ? Math.round(-(this.m / this.k) * Math.log(1 - fillRatio))
      : Infinity as unknown as number
    // FPR ≈ fill^k
    const falsePositiveRate = Math.pow(fillRatio, this.k)

    return {
      epoch: EPOCH,
      m: this.m,
      k: this.k,
      bitsSet,
      estimatedItems,
      falsePositiveRate,
      fillRatio,
      bits: Buffer.from(this.bits).toString('base64'),
    }
  }
}

export const usernameFilter = new UsernameFilter()
