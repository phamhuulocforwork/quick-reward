import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {
  cacheScope,
  collectSuccessCodes,
  emptyFailCache,
  extractHashPayload,
  fixLookalikes,
  parseCodes,
  parseOpenIdFromCookie,
  recordFailure,
  splitCached,
  URL_HASH_KEY
} from './redeem.ts'

describe('parseCodes', () => {
  it('splits multiple codes from OCR noise', () => {
    const r = parseCodes('DFREWARD2026\nDFGIFT666, junk\nDFPRO-2026')
    assert.deepEqual(r.codes, ['DFREWARD2026', 'DFGIFT666', 'DFPRO-2026'])
  })

  it('deduplicates codes', () => {
    const r = parseCodes('ABC12345 ABC12345 XYZ78901')
    assert.equal(r.codes.length, 2)
    assert.equal(r.duplicates, 1)
  })

  it('ignores short tokens', () => {
    const r = parseCodes('G3 AS VAL123456')
    assert.ok(r.codes.includes('VAL123456'))
    assert.ok(r.ignored.includes('G3'))
  })

  it('fixes cyrillic lookalikes into redeem list', () => {
    const fake = 'DFAXIO' + '\u043C' + '33'
    const r = parseCodes(fake)
    assert.ok(r.codes.includes('DFAXIOM33'))
  })
})

describe('fixLookalikes', () => {
  it('returns null for unfixable tokens', () => {
    assert.equal(fixLookalikes('hello🎁'), null)
  })
})

describe('extractHashPayload', () => {
  it('reads qr from hash', () => {
    const r = extractHashPayload('#qr=ABC12345')
    assert.equal(r.raw, 'ABC12345')
    assert.equal(r.rest, '')
  })

  it('decodes newlines in hash value', () => {
    const r = extractHashPayload('#qr=ABC123%0AXYZ78901')
    assert.equal(r.raw, 'ABC123\nXYZ78901')
  })

  it('preserves other hash params', () => {
    const r = extractHashPayload('#foo=1&qr=TESTCODE12&bar=2')
    assert.equal(r.raw, 'TESTCODE12')
    assert.equal(r.rest, 'foo=1&bar=2')
  })

  it('returns null when key missing', () => {
    const r = extractHashPayload('#other=x')
    assert.equal(r.raw, null)
    assert.equal(r.rest, 'other=x')
  })

  it('uses URL_HASH_KEY constant', () => {
    assert.equal(URL_HASH_KEY, 'qr')
  })
})

describe('cacheScope', () => {
  it('caches global invalid codes', () => {
    assert.equal(cacheScope(400054), 'global')
    assert.equal(cacheScope(400068), 'global')
  })

  it('does not cache not-yet-redeemable', () => {
    assert.equal(cacheScope(400069), null)
  })

  it('caches per-account used codes', () => {
    assert.equal(cacheScope(400072), 'account')
  })
})

describe('splitCached', () => {
  it('splits global and account entries', () => {
    const cache = emptyFailCache()
    cache.global.BADCODE1 = {
      status: 'invalid',
      resultCode: 400054,
      message: 'invalid',
      at: 1
    }
    cache.accounts.user1 = {
      USEDCODE1: {
        status: 'used',
        resultCode: 400072,
        message: 'used',
        at: 2
      }
    }
    const r = splitCached(['BADCODE1', 'USEDCODE1', 'NEWCODE12'], cache, 'user1')
    assert.deepEqual(r.toRedeem, ['NEWCODE12'])
    assert.equal(r.skipped.length, 2)
  })
})

describe('recordFailure', () => {
  it('writes global invalid', () => {
    let cache = emptyFailCache()
    cache = recordFailure(
      cache,
      {
        code: 'X',
        status: 'invalid',
        message: 'm',
        resultCode: 400070
      },
      null
    )
    assert.ok(cache.global.X)
  })

  it('skips non-cacheable result codes', () => {
    const cache = emptyFailCache()
    const next = recordFailure(
      cache,
      {
        code: 'X',
        status: 'invalid',
        message: 'm',
        resultCode: 400069
      },
      'u1'
    )
    assert.equal(Object.keys(next.global).length, 0)
  })
})

describe('parseOpenIdFromCookie', () => {
  it('reads openid from user_info', () => {
    const payload = encodeURIComponent(JSON.stringify({openid: 'abc123'}))
    assert.equal(
      parseOpenIdFromCookie(`foo=1; user_info=${payload}; bar=2`),
      'abc123'
    )
  })
})

describe('collectSuccessCodes', () => {
  it('dedupes success codes across job and history', () => {
    const codes = collectSuccessCodes(
      {
        id: '1',
        status: 'done',
        tabId: null,
        delayMs: 3000,
        items: [
          {
            code: 'OK1',
            status: 'success',
            attempts: 1,
            message: '',
            resultCode: 0,
            at: 1
          },
          {
            code: 'OK1',
            status: 'success',
            attempts: 1,
            message: '',
            resultCode: 0,
            at: 2
          },
          {
            code: 'FAIL1',
            status: 'invalid',
            attempts: 1,
            message: '',
            resultCode: 400054,
            at: 3
          }
        ],
        logs: [],
        current: null,
        pauseReason: '',
        createdAt: 1,
        updatedAt: 1,
        finishedAt: 1
      },
      [
        {
          id: 'h1',
          createdAt: 1,
          finishedAt: 2,
          delayMs: 3000,
          summary: {
            total: 1,
            done: 1,
            pending: 0,
            success: 1,
            used: 0,
            invalid: 0,
            failed: 0
          },
          items: [{code: 'OK2', status: 'success', message: '', attempts: 1, at: 1}]
        }
      ]
    )
    assert.deepEqual(codes, ['OK1', 'OK2'])
  })
})
