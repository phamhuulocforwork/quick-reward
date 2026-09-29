import {
  DELAY,
  FAIL_CACHE_KEY,
  HISTORY_KEY,
  HOOK_EVENT,
  HOOK_PING_EVENT,
  JOB_KEY,
  MAX_ATTEMPTS,
  MAX_HISTORY,
  MAX_NETWORK_STREAK,
  MAX_UNKNOWN_STREAK,
  PAGE_LOCK_MS,
  RESULT_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
  SETTINGS_KEY,
  clampDelay,
  consumeUrlCodeParam,
  describeApiResult,
  describePageMessage,
  emptyFailCache,
  formatSeconds,
  parseCodes,
  parseOpenIdFromCookie,
  pushLog,
  cacheScope,
  recordFailure,
  splitCached,
  summarize,
  type FailCache,
  type FailCacheEntry,
  type QrSettings,
  type RedeemItem,
  type RedeemJob,
  type RedeemOutcome
} from '../lib/redeem'

const SEL = {
  stateAfter: '.main-box .state-after',
  stateBefore: '.main-box .state-before',
  input: '.main-box .exc-input',
  button: '.main-box .btn-exchange',
  tips: '#superTips',
  dialog: '#diaTips',
  dialogText: '#diaTips p',
  dialogClose: '#diaTips .btn-close'
}

const LOGIN_WAIT_MS = 15000

const $ = (selector: string) => document.querySelector(selector)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Listener = (job: RedeemJob | null, overlayVisible: boolean) => void

let job: RedeemJob | null = null
let loopActive = false
let overlayVisible = false
let overlayDismissed = false
let myTabId: number | null = null
let wakeUp: (() => void) | null = null
let stopRequested = false
let lastSettledAt = 0
const listeners = new Set<Listener>()

function notify() {
  for (const fn of listeners) fn(job, overlayVisible)
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  listener(job, overlayVisible)
  return () => listeners.delete(listener)
}

export function getJob() {
  return job
}

export function dismissOverlay() {
  overlayDismissed = true
  overlayVisible = false
  notify()
}

function contextAlive() {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

async function loadJob() {
  const stored = await chrome.storage.local.get(JOB_KEY)
  return (stored[JOB_KEY] as RedeemJob | undefined) ?? null
}

async function loadSettings(): Promise<QrSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  const raw = stored[SETTINGS_KEY] as QrSettings | undefined
  return {delayMs: clampDelay(raw?.delayMs ?? DELAY.default)}
}

async function loadFailCache(): Promise<FailCache> {
  const stored = await chrome.storage.local.get(FAIL_CACHE_KEY)
  const raw = stored[FAIL_CACHE_KEY] as FailCache | undefined
  if (!raw || typeof raw !== 'object') return emptyFailCache()
  return {
    global: raw.global ?? {},
    accounts: raw.accounts ?? {}
  }
}

async function saveFailCache(cache: FailCache) {
  if (!contextAlive()) return
  try {
    await chrome.storage.local.set({[FAIL_CACHE_KEY]: cache})
  } catch {
    // ignore
  }
}

function readOpenId(): string | null {
  try {
    return parseOpenIdFromCookie(document.cookie)
  } catch {
    return null
  }
}

async function persistFailure(item: RedeemItem) {
  if (!cacheScope(item.resultCode)) return
  const cache = await loadFailCache()
  const openid = readOpenId()
  await saveFailCache(recordFailure(cache, item, openid))
}

async function saveJob() {
  if (!job || !contextAlive()) return
  job.updatedAt = Date.now()
  try {
    await chrome.storage.local.set({[JOB_KEY]: job})
  } catch {
    // extension reloaded
  }
}

const log = (kind: string, text: string, code = '') => {
  if (job) pushLog(job, kind, text, code)
}

function clickElement(el: Element) {
  el.addEventListener(
    'click',
    (event) => event.preventDefault(),
    {once: true}
  )
  ;(el as HTMLElement).click()
}

type LoginState = 'in' | 'out' | 'loading' | 'unsupported'

function loginState(): LoginState {
  const after = $(SEL.stateAfter)
  const before = $(SEL.stateBefore)
  if (!after || !before || !$(SEL.input) || !$(SEL.button)) return 'unsupported'
  if (after.classList.contains('show')) return 'in'
  if (before.classList.contains('show')) return 'out'
  return 'loading'
}

function loginProblem(state: LoginState) {
  if (state === 'out') return 'Bạn chưa đăng nhập trên trang đổi quà.'
  if (state === 'loading') return 'Trang đổi quà chưa tải xong.'
  return 'Không tìm thấy ô nhập code — Garena có thể đã đổi giao diện.'
}

function isDialogOpen() {
  const dialog = $(SEL.dialog)
  return Boolean(dialog) && getComputedStyle(dialog!).display !== 'none'
}

function isTipShowing() {
  const tips = $(SEL.tips)
  return (
    Boolean(tips) &&
    tips!.classList.contains('show') &&
    !tips!.classList.contains('hide')
  )
}

function readPageMessage() {
  if (isDialogOpen()) {
    return {
      where: 'dialog',
      text: ($(SEL.dialogText)?.textContent || '').trim()
    }
  }
  if (isTipShowing()) {
    return {where: 'tips', text: ($(SEL.tips)?.textContent || '').trim()}
  }
  return null
}

function waitFor(predicate: () => boolean, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    if (predicate()) {
      resolve(true)
      return
    }
    const observer = new MutationObserver(() => {
      if (predicate()) finish(true)
    })
    const timer = setTimeout(() => finish(false), timeoutMs)
    function finish(value: boolean) {
      observer.disconnect()
      clearTimeout(timer)
      resolve(value)
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
  })
}

async function waitForLogin() {
  const deadline = Date.now() + LOGIN_WAIT_MS
  while (Date.now() < deadline) {
    const state = loginState()
    if (state === 'in') return true
    if (state === 'unsupported') return false
    if (state === 'out') {
      if (job) {
        job.status = 'waiting_login'
        job.pauseReason = loginProblem('out')
        await saveJob()
        notify()
      }
      await wait(800)
      continue
    }
    await wait(400)
  }
  return loginState() === 'in'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const started = Date.now()
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      wakeUp = null
      resolve()
    }
    const fallback = () =>
      setTimeout(done, Math.max(0, ms - (Date.now() - started)))
    wakeUp = done
    try {
      chrome.runtime.sendMessage({type: 'qr:sleep', ms}).then(done, fallback)
    } catch {
      fallback()
    }
  })
}

function hookReady() {
  let ready = false
  const onReply = (event: Event) => {
    try {
      const detail = JSON.parse((event as CustomEvent).detail)
      ready = ready || detail.phase === 'ready'
    } catch {
      // ignore
    }
  }
  document.addEventListener(HOOK_EVENT, onReply)
  document.dispatchEvent(new CustomEvent(HOOK_PING_EVENT))
  document.removeEventListener(HOOK_EVENT, onReply)
  return ready
}

async function closeDialog() {
  if (!isDialogOpen()) return
  const close = $(SEL.dialogClose)
  if (close) clickElement(close)
  await waitFor(() => !isDialogOpen(), 2000)
}

async function dismissSuccessDialog() {
  if (!(await waitFor(isDialogOpen, 2000))) return
  await wait(800)
  await closeDialog()
}

async function redeemOne(code: string): Promise<RedeemOutcome> {
  const input = $(SEL.input) as HTMLInputElement | null
  const button = $(SEL.button)
  if (!input || !button) {
    return {kind: 'fatal', text: loginProblem('unsupported')}
  }

  await closeDialog()
  await waitFor(() => !isTipShowing(), 4000)
  const lockLeft = lastSettledAt + PAGE_LOCK_MS - Date.now()
  if (lockLeft > 0) await wait(lockLeft)

  input.value = code
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
  if (input.value !== code) {
    return {kind: 'fatal', text: 'Không điền được code vào ô nhập của trang.'}
  }

  const expectSent = hookReady()
  const outcome = waitForOutcome(code, expectSent)
  clickElement(button)
  const result = await outcome
  lastSettledAt = Date.now()
  return result
}

function waitForOutcome(code: string, expectSent: boolean) {
  return new Promise<RedeemOutcome>((resolve) => {
    let settled = false
    let sent = false
    let pageTimer = 0
    let sendTimer = 0
    let timeoutTimer = 0

    const finish = (result: RedeemOutcome) => {
      if (settled) return
      settled = true
      document.removeEventListener(HOOK_EVENT, onApiResult)
      observer.disconnect()
      clearTimeout(pageTimer)
      clearTimeout(sendTimer)
      clearTimeout(timeoutTimer)
      resolve(result)
    }

    const onApiResult = (event: Event) => {
      let detail: {
        cdkey?: string
        phase?: string
        code?: number | null
        httpStatus?: number
        msg?: string
      }
      try {
        detail = JSON.parse((event as CustomEvent).detail)
      } catch {
        return
      }
      if (!detail || (detail.cdkey && detail.cdkey !== code)) return
      if (detail.phase === 'sent') sent = true
      if (detail.phase === 'done') finish(describeApiResult(detail))
    }

    const onPageChange = () => {
      if (pageTimer) return
      const message = readPageMessage()
      if (message) {
        pageTimer = window.setTimeout(
          () => finish(describePageMessage(message)),
          2500
        )
      }
    }

    const observer = new MutationObserver(onPageChange)
    for (const selector of [SEL.tips, SEL.dialog]) {
      const el = $(selector)
      if (el) {
        observer.observe(el, {
          attributes: true,
          attributeFilter: ['class', 'style']
        })
      }
    }

    document.addEventListener(HOOK_EVENT, onApiResult)
    if (expectSent) {
      sendTimer = window.setTimeout(() => {
        if (!sent && !pageTimer) {
          finish({
            kind: 'network',
            text: 'Trang chưa gửi yêu cầu đổi code sau khi bấm "Đổi".'
          })
        }
      }, SEND_TIMEOUT_MS)
    }
    timeoutTimer = window.setTimeout(
      () =>
        finish({
          kind: 'network',
          text: 'Không nhận được phản hồi từ máy chủ Garena.'
        }),
      RESULT_TIMEOUT_MS
    )
  })
}

function skippedItem(code: string, entry: FailCacheEntry): RedeemItem {
  return {
    code,
    status: entry.status,
    attempts: 0,
    message: `Bỏ qua (đã lỗi trước đó): ${entry.message}`,
    resultCode: entry.resultCode,
    at: entry.at
  }
}

function createJob(
  toRedeem: string[],
  skipped: {code: string; entry: FailCacheEntry}[],
  delayMs: number
) {
  const now = Date.now()
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    status: 'running' as const,
    tabId: myTabId,
    delayMs: clampDelay(delayMs),
    items: [
      ...skipped.map(({code, entry}) => skippedItem(code, entry)),
      ...toRedeem.map((code) => ({
        code,
        status: 'pending' as const,
        attempts: 0,
        message: '',
        resultCode: null,
        at: 0
      }))
    ],
    logs: [],
    current: null,
    pauseReason: '',
    createdAt: now,
    updatedAt: now,
    finishedAt: 0
  }
}

function pauseJob(reason: string, kind = 'warn') {
  if (!job) return
  job.status = 'paused'
  job.current = null
  job.pauseReason = reason
  log(kind, reason)
}

async function appendHistory() {
  if (!job || !contextAlive()) return
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY)
    const list = Array.isArray(stored[HISTORY_KEY])
      ? stored[HISTORY_KEY]
      : []
    const compact = {
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
    list.unshift(compact)
    list.length = Math.min(list.length, MAX_HISTORY)
    await chrome.storage.local.set({[HISTORY_KEY]: list})
  } catch {
    // ignore
  }
}

function finishJob() {
  if (!job) return
  const s = summarize(job)
  job.status = 'done'
  job.current = null
  job.pauseReason = ''
  job.finishedAt = Date.now()
  log(
    'info',
    `Hoàn tất ${s.total} code: ${s.success} thành công, ${s.used} đã nhận, ${s.invalid} không dùng được, ${s.failed} lỗi.`
  )
  void appendHistory()
}

function stopJobComplete() {
  if (!job) return
  job.status = 'stopped'
  job.current = null
  job.pauseReason = 'Đã dừng bởi người dùng.'
  job.finishedAt = Date.now()
  log('info', job.pauseReason)
  void appendHistory()
}

export function requestStop() {
  stopRequested = true
  if (wakeUp) wakeUp()
}

async function runLoop() {
  if (loopActive || !job) return
  loopActive = true
  stopRequested = false
  overlayDismissed = false
  overlayVisible = true
  notify()

  let networkStreak = 0
  let unknownStreak = 0

  try {
    while (contextAlive() && job) {
      if (stopRequested) {
        stopJobComplete()
        break
      }

      const index = job.items.findIndex((item) => item.status === 'pending')
      if (index === -1) {
        finishJob()
        break
      }

      if (!(await waitForLogin())) {
        if (loginState() === 'out') {
          pauseJob(
            `${loginProblem('out')} Đăng nhập xong extension sẽ tiếp tục.`,
            'error'
          )
        } else {
          pauseJob(loginProblem(loginState()), 'error')
        }
        break
      }
      if (job.status === 'waiting_login') {
        job.status = 'running'
        job.pauseReason = ''
      }

      const item = job.items[index]
      const label = `[${index + 1}/${job.items.length}]`
      job.current = {
        phase: 'redeeming',
        index,
        code: item.code,
        attempt: item.attempts + 1,
        since: Date.now()
      }
      await saveJob()
      notify()

      const result = await redeemOne(item.code)
      if (!contextAlive() || !job) return
      if (stopRequested) {
        stopJobComplete()
        break
      }

      if (result.kind === 'fatal') {
        pauseJob(result.text, 'error')
        break
      }
      if (result.kind === 'session') {
        pauseJob(
          `${label} ${item.code}: ${result.text} Đăng nhập lại rồi tải lại trang.`,
          'error'
        )
        break
      }

      item.attempts += 1
      networkStreak = result.kind === 'network' ? networkStreak + 1 : 0
      unknownStreak = result.unknown ? unknownStreak + 1 : 0
      const willRetry =
        result.kind === 'network' && item.attempts < MAX_ATTEMPTS

      if (willRetry) {
        log(
          'warn',
          `${label} ${result.text} Thử lại (${item.attempts + 1}/${MAX_ATTEMPTS}).`,
          item.code
        )
      } else {
        item.status = result.kind
        item.message = result.text
        item.resultCode = result.code ?? null
        item.at = Date.now()
        log(result.kind, `${label} ${result.text}`, item.code)
        void persistFailure(item)
      }

      if (result.kind === 'success') await dismissSuccessDialog()

      notify()

      if (!job.items.some((it) => it.status === 'pending')) {
        finishJob()
        break
      }
      if (networkStreak >= MAX_NETWORK_STREAK) {
        pauseJob(
          'Lỗi mạng liên tiếp — tạm dừng. Chờ vài phút rồi tải lại trang.',
          'error'
        )
        break
      }
      if (unknownStreak >= MAX_UNKNOWN_STREAK) {
        pauseJob('Máy chủ trả mã lạ liên tiếp — tạm dừng.', 'error')
        break
      }

      const waitMs = willRetry ? job.delayMs * 2 : job.delayMs
      job.current = {
        phase: 'waiting',
        until: Date.now() + waitMs,
        nextDelayMs: waitMs
      }
      await saveJob()
      notify()
      await sleep(waitMs)
      if (stopRequested) {
        stopJobComplete()
        break
      }
    }
  } catch (error) {
    if (contextAlive() && job) {
      pauseJob(
        `Lỗi không mong muốn: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      )
    }
  } finally {
    loopActive = false
    wakeUp = null
    await saveJob()
    notify()
  }
}

export async function enqueueCodesFromText(
  raw: string,
  delayMs?: number
) {
  const {codes, duplicates, ignored} = parseCodes(raw)
  if (!codes.length) {
    const settings = await loadSettings()
    job = {
      ...createJob([], [], delayMs ?? settings.delayMs),
      status: 'done',
      items: [],
      finishedAt: Date.now()
    }
    log(
      'error',
      ignored.length
        ? `Không tìm thấy code hợp lệ (bỏ qua ${ignored.length} đoạn).`
        : 'Không tìm thấy code hợp lệ trong tham số URL.'
    )
    overlayVisible = true
    await saveJob()
    notify()
    return
  }

  if (loopActive) {
    log('warn', 'Đang đổi — bỏ qua batch code mới.')
    return
  }

  const settings = await loadSettings()
  const resolvedDelay = clampDelay(delayMs ?? settings.delayMs)
  const cache = await loadFailCache()
  const openid = readOpenId()
  const {toRedeem, skipped} = splitCached(codes, cache, openid)

  job = createJob(toRedeem, skipped, resolvedDelay)
  if (duplicates) {
    log('info', `Bỏ ${duplicates} code trùng.`)
  }
  if (ignored.length) {
    log('info', `Bỏ qua ${ignored.length} đoạn không phải code.`)
  }
  if (skipped.length) {
    log('info', `Bỏ qua ${skipped.length} code đã lỗi trước đó.`)
  }
  const pending = toRedeem.length
  log(
    'info',
    pending
      ? `Bắt đầu đổi ${pending} code, chờ ${formatSeconds(job.delayMs)} giữa mỗi code.`
      : `Không còn code cần đổi (${skipped.length} đã bỏ qua từ cache).`
  )
  overlayVisible = true
  await saveJob()
  notify()
  if (!pending) {
    finishJob()
    return
  }
  void runLoop()
}

export async function startFromUrl() {
  const raw = consumeUrlCodeParam()
  if (raw) {
    await enqueueCodesFromText(raw)
    return
  }

  const stored = await loadJob()
  if (
    stored &&
    stored.items.some((i) => i.status === 'pending') &&
    (stored.status === 'running' ||
      stored.status === 'paused' ||
      stored.status === 'waiting_login')
  ) {
    job = stored
    overlayVisible = !overlayDismissed
    notify()
    if (!loopActive) {
      log('info', 'Tiếp tục job còn dở sau khi tải lại trang.')
      void runLoop()
    }
  }
}

export async function initRedeemer() {
  if (globalThis.__qrRedeemerInit) return
  globalThis.__qrRedeemerInit = true

  try {
    const reply = await chrome.runtime.sendMessage({type: 'qr:whoami'})
    myTabId =
      reply && typeof reply.tabId === 'number' ? reply.tabId : null
  } catch {
    myTabId = null
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return undefined

    if (msg.type === 'qr:start') {
      const text = typeof msg.text === 'string' ? msg.text : ''
      const delayMs =
        typeof msg.delayMs === 'number' ? clampDelay(msg.delayMs) : undefined
      if (loopActive) {
        sendResponse({ok: false, error: 'Đang đổi code rồi.'})
        return false
      }
      void (async () => {
        if (delayMs !== undefined) {
          await chrome.storage.local.set({
            [SETTINGS_KEY]: {delayMs}
          })
        }
        await enqueueCodesFromText(text, delayMs)
        sendResponse({ok: true})
      })()
      return true
    }

    if (msg.type === 'qr:stop') {
      requestStop()
      sendResponse({ok: true})
      return false
    }

    return undefined
  })

  await startFromUrl()
}

declare global {
  // eslint-disable-next-line no-var
  var __qrRedeemerInit: boolean | undefined
}
