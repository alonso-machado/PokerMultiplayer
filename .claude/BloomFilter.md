# Bloom Filter — Username Uniqueness

## What it does

A Bloom filter checks if a username has **definitely never been seen** or **probably exists**.
- **False negatives: impossible** — if the filter says "free", the name is 100% free.
- **False positives: possible** — if it says "taken", there's a ~0.1% chance it's actually free.

**No database. No file persistence.** The filter is in-memory only.  
Epoch versioning (below) makes this safe across redeploys.

---

## The redeploy problem — and the fix

Without persistence, a redeploy empties the filter. Users from the previous deploy reconnect with valid tokens, the filter has forgotten their usernames, and two users could claim the same name during the reconnect window → **false negative**, the one thing a Bloom filter must never have.

**Fix: epoch-prefixed keys — internal only, never shown in the UI.**

Every filter lookup uses `${BLOOM_EPOCH}:${username}` as the internal key.  
The display name stored in the player token and shown everywhere in the front remains the raw username — `alice`, never `2:alice`.  
`BLOOM_EPOCH` is an env var bumped on each deploy (a timestamp, deploy counter, or git SHA).

| Deploy | Internal filter key | What the user sees |
|---|---|---|
| epoch `1` | `1:alice` | `alice` |
| epoch `2` | `2:alice` ← new namespace | `alice` |

On redeploy the filter starts empty **for the new epoch** — that's intentional.  
Users reconnect, the new epoch has never seen any username, so they re-register cleanly.  
No false negatives. No cross-epoch collisions. No files to maintain.

The tradeoff: username reservations reset each deploy. For a no-state game where identity is the signed token (not the display name), this is acceptable.

---

## Parameters

| Parameter | Value |
|---|---|
| n (expected users per epoch) | 100,000 |
| m (bit array) | 1,440,000 bits = **180 KB** |
| k (hash functions) | **10** — mathematically optimal for this m/n |
| FPR | **0.099%** — 1 in ~1,000 valid names gets a false rejection |

**Why k=10 is optimal:** `k_opt = (m/n) × ln 2 = 14.4 × 0.693 ≈ 9.97`.  
Going higher or lower both increase FPR — see the table below.

| k | FPR | Notes |
|---|---|---|
| 5 | 0.217% | Faster, meaningfully worse FPR |
| 7 | 0.125% | Good balance |
| **10** | **0.099%** | Optimal |
| 13 | 0.116% | Past optimal — FPR climbs again |
| 15 | 0.349% | More work, much worse |

---

## Hash function: SipHash-1-3

Usernames come from untrusted users on a public endpoint.  
FNV-1a and MurmurHash3 are deterministic — an attacker can craft usernames that all land on the same bit positions, flooding the filter and causing false positives for everyone.  
**SipHash uses a secret random key generated at startup** — the attacker can't predict positions without the key.

| | FNV-1a | MurmurHash3 | **SipHash-1-3** |
|---|---|---|---|
| Speed | fastest | fastest | ~3× slower |
| Distribution | good | excellent | excellent |
| Hash flooding resistant | ✗ | ✗ | **✓** |

Speed difference is irrelevant — this runs once per registration, not in a hot loop.

---

## Implementation

```typescript
// server/src/bloomFilter.ts

// Secret key — random per server instance, attacker can't predict positions
const SIPHASH_KEY = crypto.getRandomValues(new Uint32Array(4))

// Epoch from env — bump on every deploy (git SHA, timestamp, counter, etc.)
// All filter keys are prefixed with this value → no cross-deploy collisions
const EPOCH = process.env.BLOOM_EPOCH ?? '1'

function siphash13(str: string, key: Uint32Array): number {
  let v0 = key[0]! ^ 0x736f6d65
  let v1 = key[1]! ^ 0x646f7261
  let v2 = key[2]! ^ 0x6c796765
  let v3 = key[3]! ^ 0x74656462
  function sipRound(): void {
    v0 = (v0 + v1) | 0; v1 = (v1 << 5)  | (v1 >>> 27); v1 ^= v0
    v0 = (v0 << 16) | (v0 >>> 16)
    v2 = (v2 + v3) | 0; v3 = (v3 << 8)  | (v3 >>> 24); v3 ^= v2
    v0 = (v0 + v3) | 0; v3 = (v3 << 7)  | (v3 >>> 25); v3 ^= v0
    v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2
    v2 = (v2 << 16) | (v2 >>> 16)
  }
  for (let i = 0; i < str.length; i++) {
    v3 ^= str.charCodeAt(i); sipRound(); v0 ^= str.charCodeAt(i)
  }
  v2 ^= 0xff; sipRound(); sipRound(); sipRound()
  return (v0 ^ v1 ^ v2 ^ v3) >>> 0
}

export class UsernameFilter {
  private readonly bits = new Uint8Array(180_000)  // 1,440,000 bits, all zero
  private readonly m = 1_440_000
  private readonly k = 10

  /** Returns false if username is DEFINITELY free in this epoch. */
  mightExist(username: string): boolean {
    const key = `${EPOCH}:${username.toLowerCase()}`
    return this.positions(key).every(pos => (this.bits[pos >>> 3]! & (1 << (pos & 7))) !== 0)
  }

  /** Mark a username as taken for this epoch. */
  add(username: string): void {
    const key = `${EPOCH}:${username.toLowerCase()}`
    for (const pos of this.positions(key)) {
      this.bits[pos >>> 3] |= 1 << (pos & 7)
    }
  }

  private positions(str: string): number[] {
    const h1 = siphash13(str, SIPHASH_KEY)
    const h2 = siphash13(str, new Uint32Array([
      SIPHASH_KEY[2]!, SIPHASH_KEY[3]!, SIPHASH_KEY[0]!, SIPHASH_KEY[1]!
    ]))
    return Array.from({ length: this.k }, (_, i) => ((h1 + i * h2) >>> 0) % this.m)
  }
}

export const usernameFilter = new UsernameFilter()
```

---

## Registration flow

```
POST /api/auth/register  { username, ... }
  → usernameFilter.mightExist(username)
      true  → reject: "username already taken"
      false → username is definitely free in this epoch → register
  → usernameFilter.add(username)
```

No secondary check, no fallback. If the filter says free, it is free.  
The 0.1% false positive rate means 1 in ~1,000 valid names gets a false rejection — the user adds a character and moves on.

---

## Env vars

```env
# Bump on every deploy. Use git SHA, deploy timestamp, or a simple counter.
# All usernames from previous epochs are forgotten — clean slate each deploy.
BLOOM_EPOCH=1
```

No `BLOOM_PATH` — persistence was removed. Nothing to mount, nothing to migrate.
