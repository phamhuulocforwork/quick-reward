export const REDEEM_URL = 'https://redeem.df.garena.sg/vi/cdkgarena.html'
export const REDEEM_MATCH = 'https://redeem.df.garena.sg/*'
export const JOB_KEY = 'qr.job'
export const HISTORY_KEY = 'qr.history'
export const FAIL_CACHE_KEY = 'qr.failCache'
export const SETTINGS_KEY = 'qr.settings'
export const HOOK_EVENT = 'dfr:redeem-result'
export const HOOK_PING_EVENT = 'dfr:hook-ping'

export const DELAY = Object.freeze({
  min: 1500,
  max: 10000,
  step: 500,
  default: 3000
})

export const MAX_ATTEMPTS = 3
export const MAX_NETWORK_STREAK = 5
export const MAX_UNKNOWN_STREAK = 3
export const RESULT_TIMEOUT_MS = 45000
export const SEND_TIMEOUT_MS = 5000
export const PAGE_LOCK_MS = 1500
export const MAX_LOGS = 1000
export const MAX_HISTORY = 30
const MIN_CODE_LENGTH = 6
const MAX_CODE_LENGTH = 40

const LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  І: 'I',
  Ј: 'J',
  Ѕ: 'S',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  в: 'B',
  к: 'K',
  м: 'M',
  н: 'H',
  т: 'T',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  ο: 'o',
  ν: 'v',
  ι: 'i'
}

export const RESULT_BY_CODE: Record<
  number,
  {kind: ItemStatus; text: string}
> = {
  0: {
    kind: 'success',
    text: 'Đổi thành công! Quà được gửi vào hộp thư trong game.'
  },
  400072: {kind: 'used', text: 'Tài khoản này đã đổi code này rồi.'},
  400067: {
    kind: 'used',
    text: 'Tài khoản đã đạt giới hạn đổi của nhóm code này.'
  },
  400053: {
    kind: 'used',
    text: 'Tài khoản không thể đổi thêm code của gói quà này.'
  },
  400068: {kind: 'invalid', text: 'Code đã hết lượt đổi.'},
  400054: {kind: 'invalid', text: 'Code không hợp lệ.'},
  400069: {kind: 'invalid', text: 'Code chưa đến thời gian đổi.'},
  400070: {kind: 'invalid', text: 'Code đã hết hạn.'},
  400073: {
    kind: 'error',
    text: 'Gói quà bị lỗi cấu hình (lỗi phía Garena).'
  },
  503001: {kind: 'error', text: 'Tài khoản chưa đủ điều kiện nhận quà này.'},
  503701: {kind: 'network', text: 'Máy chủ Garena báo lỗi mạng.'},
  300001: {kind: 'session', text: 'Phiên đăng nhập đã hết hạn.'}
}

export type ItemStatus =
  | 'pending'
  | 'success'
  | 'used'
  | 'invalid'
  | 'error'
  | 'network'
  | 'session'
  | 'fatal'

export type JobStatus =
  | 'running'
  | 'paused'
  | 'done'
  | 'waiting_login'
  | 'stopped'

export type RedeemItem = {
  code: string
  status: ItemStatus
  attempts: number
  message: string
  resultCode: number | null
  at: number
}

export type RedeemLog = {
  t: number
  kind: string
  text: string
  code: string
}

export type RedeemJob = {
  id: string
  status: JobStatus
  tabId: number | null
  delayMs: number
  items: RedeemItem[]
  logs: RedeemLog[]
  current: {
    phase: string
    index?: number
    code?: string
    attempt?: number
    since?: number
    until?: number
    nextDelayMs?: number
  } | null
  pauseReason: string
  createdAt: number
  updatedAt: number
  finishedAt: number
}

export type HistoryJob = {
  id: string
  createdAt: number
  finishedAt: number
  delayMs: number
  summary: JobSummary
  items: Pick<
    RedeemItem,
    'code' | 'status' | 'message' | 'attempts' | 'at'
  >[]
}

export type JobSummary = {
  total: number
  done: number
  pending: number
  success: number
  used: number
  invalid: number
  failed: number
}

export const KIND_LABEL: Record<string, string> = {
  pending: 'Chưa đổi',
  success: 'Thành công',
  used: 'Đã nhận trước đó',
  invalid: 'Không dùng được',
  error: 'Lỗi',
  network: 'Lỗi mạng',
  session: 'Hết phiên đăng nhập',
  waiting_login: 'Chờ đăng nhập',
  fatal: 'Lỗi nghiêm trọng',
  stopped: 'Đã dừng'
}

export type QrSettings = {
  delayMs: number
}

export type FailCacheEntry = {
  status: ItemStatus
  resultCode: number
  message: string
  at: number
}

export type FailCache = {
  global: Record<string, FailCacheEntry>
  accounts: Record<string, Record<string, FailCacheEntry>>
}

export function emptyFailCache(): FailCache {
  return {global: {}, accounts: {}}
}

/** Which failures are remembered: global invalid vs per-account used. */
export function cacheScope(resultCode: number | null): 'global' | 'account' | null {
  if (resultCode === null) return null
  if (resultCode === 400068 || resultCode === 400054 || resultCode === 400070) {
    return 'global'
  }
  if (resultCode === 400072 || resultCode === 400067 || resultCode === 400053) {
    return 'account'
  }
  return null
}

export function getCachedEntry(
  cache: FailCache,
  code: string,
  openid: string | null
): FailCacheEntry | null {
  if (cache.global[code]) return cache.global[code]
  if (openid && cache.accounts[openid]?.[code]) {
    return cache.accounts[openid][code]
  }
  return null
}

export function splitCached(
  codes: string[],
  cache: FailCache,
  openid: string | null
): {
  toRedeem: string[]
  skipped: {code: string; entry: FailCacheEntry}[]
} {
  const toRedeem: string[] = []
  const skipped: {code: string; entry: FailCacheEntry}[] = []
  for (const code of codes) {
    const entry = getCachedEntry(cache, code, openid)
    if (entry) skipped.push({code, entry})
    else toRedeem.push(code)
  }
  return {toRedeem, skipped}
}

export function recordFailure(
  cache: FailCache,
  item: Pick<RedeemItem, 'code' | 'status' | 'message' | 'resultCode'>,
  openid: string | null
): FailCache {
  const scope = cacheScope(item.resultCode)
  if (!scope || item.resultCode === null) return cache

  const entry: FailCacheEntry = {
    status: item.status,
    resultCode: item.resultCode,
    message: item.message,
    at: Date.now()
  }

  if (scope === 'global') {
    return {
      ...cache,
      global: {...cache.global, [item.code]: entry}
    }
  }
  if (!openid) return cache
  return {
    ...cache,
    accounts: {
      ...cache.accounts,
      [openid]: {...(cache.accounts[openid] ?? {}), [item.code]: entry}
    }
  }
}

export function parseOpenIdFromCookie(documentCookie: string): string | null {
  for (const part of documentCookie.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    if (name !== 'user_info') continue
    try {
      const raw = decodeURIComponent(trimmed.slice(eq + 1))
      const data = JSON.parse(raw) as {openid?: unknown}
      if (typeof data.openid === 'string' && data.openid) return data.openid
    } catch {
      return null
    }
  }
  return null
}

export function jobToHistoryEntry(job: RedeemJob): HistoryJob {
  return {
    id: job.id,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || Date.now(),
    delayMs: job.delayMs,
    summary: summarize(job),
    items: job.items.map((it) => ({
      code: it.code,
      status: it.status,
      message: it.message,
      attempts: it.attempts,
      at: it.at
    }))
  }
}

export function collectSuccessCodes(
  job: RedeemJob | null,
  history: HistoryJob[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (items: {code: string; status: string}[]) => {
    for (const it of items) {
      if (it.status !== 'success' || seen.has(it.code)) continue
      seen.add(it.code)
      out.push(it.code)
    }
  }
  if (job) add(job.items)
  for (const h of history) add(h.items)
  return out
}

export function countFailCache(cache: FailCache): number {
  let n = Object.keys(cache.global).length
  for (const acc of Object.values(cache.accounts)) {
    n += Object.keys(acc).length
  }
  return n
}

export function delaySelectOptions(): {label: string; valueMs: number}[] {
  const opts: {label: string; valueMs: number}[] = []
  for (let ms = DELAY.min; ms <= DELAY.max; ms += DELAY.step) {
    const sec = ms / 1000
    opts.push({
      label: `${sec.toLocaleString('vi-VN', {minimumFractionDigits: 1, maximumFractionDigits: 1})} s`,
      valueMs: ms
    })
  }
  return opts
}

export type ParseCodesResult = {
  codes: string[]
  duplicates: number
  ignored: string[]
}

function looksLikeCode(token: string) {
  return (
    token.length >= MIN_CODE_LENGTH &&
    token.length <= MAX_CODE_LENGTH &&
    /[A-Za-z]/.test(token)
  )
}

export function fixLookalikes(token: string): string | null {
  const upperOnly = !/[a-z]/.test(token)
  let out = ''
  for (const ch of token) {
    if (/[A-Za-z0-9_-]/.test(ch)) {
      out += ch
    } else if (LOOKALIKES[ch]) {
      out += upperOnly ? LOOKALIKES[ch].toUpperCase() : LOOKALIKES[ch]
    } else {
      return null
    }
  }
  return out
}

/** Tách code từ OCR; ký tự giả mạo được tự sửa và thêm vào danh sách đổi. */
export function parseCodes(text: string): ParseCodesResult {
  const codes: string[] = []
  const ignored: string[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (const raw of String(text ?? '')
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}_\-]+/u)) {
    if (!raw) continue
    let token = raw.replace(/^[-_]+|[-_]+$/g, '')
    if (!token) continue

    const addCode = (code: string) => {
      if (!looksLikeCode(code)) {
        ignored.push(code)
        return
      }
      if (seen.has(code)) {
        duplicates += 1
        return
      }
      seen.add(code)
      codes.push(code)
    }

    if (/^[A-Za-z0-9_-]+$/.test(token)) {
      addCode(token)
      continue
    }

    const suggestion = fixLookalikes(token)
    if (suggestion && /[A-Za-z0-9]/.test(token)) {
      addCode(suggestion)
    } else {
      ignored.push(token)
    }
  }

  return {codes, duplicates, ignored}
}

export function clampDelay(ms: number) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return DELAY.default
  const stepped = Math.round(value / DELAY.step) * DELAY.step
  return Math.min(DELAY.max, Math.max(DELAY.min, stepped))
}

export type RedeemOutcome = {
  kind: ItemStatus | 'fatal'
  text: string
  code?: number
  unknown?: boolean
}

export function describeApiResult(detail: {
  code?: number | null
  httpStatus?: number
  msg?: string
}): RedeemOutcome {
  const code = typeof detail.code === 'number' ? detail.code : null
  const httpStatus = Number(detail.httpStatus) || 0
  if (code === null || httpStatus !== 200) {
    return {
      kind: 'network',
      text:
        httpStatus && httpStatus !== 200
          ? `Lỗi kết nối tới máy chủ (HTTP ${httpStatus}).`
          : 'Lỗi kết nối tới máy chủ Garena.'
    }
  }
  const known = RESULT_BY_CODE[code]
  if (known) return {kind: known.kind, text: known.text, code}
  const msg = typeof detail.msg === 'string' ? detail.msg.trim() : ''
  return {
    kind: 'error',
    text: `Máy chủ trả mã ${code}${msg ? `: ${msg}` : ''}.`,
    code,
    unknown: true
  }
}

export function describePageMessage(message: {
  where: string
  text: string
}): RedeemOutcome {
  if (message.where === 'dialog') {
    return {
      kind: 'success',
      text: message.text || RESULT_BY_CODE[0].text
    }
  }
  const hint = /error_hint_(\d+)/.exec(message.text)
  if (hint && RESULT_BY_CODE[Number(hint[1])]) {
    const known = RESULT_BY_CODE[Number(hint[1])]
    return {kind: known.kind, text: known.text, code: Number(hint[1])}
  }
  return {
    kind: 'error',
    text: `Trang báo: ${message.text || '(không có nội dung)'}`
  }
}

export function pushLog(
  job: RedeemJob,
  kind: string,
  text: string,
  code = ''
) {
  job.logs.push({t: Date.now(), kind, text, code})
  if (job.logs.length > MAX_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_LOGS)
  }
}

export function summarize(job: RedeemJob | null): JobSummary {
  const s: JobSummary = {
    total: 0,
    done: 0,
    pending: 0,
    success: 0,
    used: 0,
    invalid: 0,
    failed: 0
  }
  for (const item of job ? job.items : []) {
    s.total += 1
    if (item.status === 'pending') {
      s.pending += 1
      continue
    }
    s.done += 1
    if (item.status === 'success') s.success += 1
    else if (item.status === 'used') s.used += 1
    else if (item.status === 'invalid') s.invalid += 1
    else s.failed += 1
  }
  return s
}

export function formatSeconds(ms: number) {
  return `${(ms / 1000).toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} giây`
}

/** Hash key for OCR payload — avoids Garena OAuth `?code=` collision. */
export const URL_HASH_KEY = 'qr'

export function extractHashPayload(
  hash: string,
  key = URL_HASH_KEY
): {raw: string | null; rest: string} {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(body)
  const raw = params.get(key)
  if (!raw) return {raw: null, rest: body}
  params.delete(key)
  return {raw, rest: params.toString()}
}

export function consumeUrlCodeParam(): string | null {
  const {raw, rest} = extractHashPayload(location.hash)
  if (!raw) return null
  history.replaceState(
    null,
    '',
    location.pathname + location.search + (rest ? `#${rest}` : '')
  )
  return raw
}
