import {
  DELAY,
  FAIL_CACHE_KEY,
  HISTORY_KEY,
  HOOK_EVENT,
  HOOK_PING_EVENT,
  JOB_KEY,
  isPendingBatchFresh,
  MAX_ATTEMPTS,
  PENDING_BATCH_KEY,
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
  statusForResultCode,
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
/** Archived job kept on the overlay until the user dismisses it. */
let finishedJob: RedeemJob | null = null
let loopActive = false
let overlayVisible = false
let overlayDismissed = false
let myTabId: number | null = null
let wakeUp: (() => void) | null = null
let stopRequested = false
let lastSettledAt = 0
let extensionOrphaned = false
let cachedOpenId: string | null | undefined
let lastJobSaveAt = 0
let jobSaveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const fn of listeners) fn(job ?? finishedJob, overlayVisible)
}

export function isExtensionOrphaned() {
  return extensionOrphaned
}

function broadcastJob() {
  if (!contextAlive()) return
  chrome.runtime
    .sendMessage({type: 'qr:jobUpdate', job: job ?? null})
    .catch(() => {})
}

function publish(options?: {persist?: boolean}) {
  notify()
  broadcastJob()
  if (!job || !contextAlive()) return
  const force = options?.persist === true
  const now = Date.now()
  if (force || now - lastJobSaveAt >= 250) {
    lastJobSaveAt = now
    if (jobSaveTimer) {
      clearTimeout(jobSaveTimer)
      jobSaveTimer = null
    }
    void saveJob()
    return
  }
  if (!jobSaveTimer) {
    const wait = Math.max(0, 250 - (now - lastJobSaveAt))
    jobSaveTimer = setTimeout(() => {
      jobSaveTimer = null
      lastJobSaveAt = Date.now()
      void saveJob()
    }, wait)
  }
}

async function publishAndSave() {
  notify()
  broadcastJob()
  await saveJob()
  lastJobSaveAt = Date.now()
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  listener(job ?? finishedJob, overlayVisible)
  return () => listeners.delete(listener)
}

export function getJob() {
  return job ?? finishedJob
}

export function dismissOverlay() {
  overlayDismissed = true
  overlayVisible = false
  finishedJob = null
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
    await chrome.runtime.sendMessage({type: 'qr:failCacheUpdate', failCache: cache})
  } catch {
    // ignore
  }
}

async function readOpenId(): Promise<string | null> {
  try {
    const fromDoc = parseOpenIdFromCookie(document.cookie)
    if (fromDoc) {
      cachedOpenId = fromDoc
      return fromDoc
    }
  } catch {
    // ignore
  }
  if (cachedOpenId !== undefined) return cachedOpenId
  if (!contextAlive()) {
    cachedOpenId = null
    return null
  }
  try {
    const res = await chrome.runtime.sendMessage({type: 'qr:getOpenId'})
    cachedOpenId =
      res && typeof res.openid === 'string' && res.openid ? res.openid : null
  } catch {
    cachedOpenId = null
  }
  return cachedOpenId
}

async function persistFailure(item: RedeemItem) {
  if (!cacheScope(item.resultCode)) return
  const cache = await loadFailCache()
  const openid = await readOpenId()
  await saveFailCache(recordFailure(cache, item, openid))
}

async function saveJob() {
  if (!job || !contextAlive()) return
  job.updatedAt = Date.now()
  try {
    await chrome.storage.local.set({[JOB_KEY]: job})
  } catch (e) {
    console.warn('[quick-reward] saveJob failed', e)
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

/** React/Vue controlled inputs ignore plain `.value =`; use the native setter. */
function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
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
        await publishAndSave()
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

  input.focus()
  setNativeInputValue(input, code)
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
    status: statusForResultCode(entry.resultCode, entry.status),
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
    return list
  } catch (e) {
    console.warn('[quick-reward] appendHistory failed', e)
    return null
  }
}

async function broadcastHistoryUpdate(list?: unknown[]) {
  if (!contextAlive()) return
  try {
    let history = list
    if (!history) {
      const stored = await chrome.storage.local.get(HISTORY_KEY)
      history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : []
    }
    await chrome.runtime.sendMessage({type: 'qr:historyUpdate', history})
  } catch {
    // sidebar closed
  }
}

async function archiveCompletedJob() {
  if (!job) return
  const list = await appendHistory()
  finishedJob = job
  job = null
  notify()
  broadcastJob()
  if (!contextAlive()) return
  try {
    await chrome.storage.local.remove(JOB_KEY)
  } catch (e) {
    console.warn('[quick-reward] archive remove job failed', e)
  }
  if (list) await broadcastHistoryUpdate(list)
}

async function finishJob() {
  if (!job) return
  const s = summarize(job)
  job.status = 'done'
  job.current = null
  job.pauseReason = ''
  job.finishedAt = Date.now()
  log(
    'info',
    `Hoàn tất ${s.total} code: ${s.success} thành công, ${s.used} đã nhận, ${s.limit} đạt giới hạn, ${s.invalid} không dùng được, ${s.failed} lỗi.`
  )
  await archiveCompletedJob()
}

async function stopJobComplete() {
  if (!job) return
  job.status = 'stopped'
  job.current = null
  job.pauseReason = 'Đã dừng bởi người dùng.'
  job.finishedAt = Date.now()
  log('info', job.pauseReason)
  await archiveCompletedJob()
}

export function requestStop() {
  stopRequested = true
  if (wakeUp) wakeUp()
}

export async function clearCurrentJob() {
  job = null
  finishedJob = null
  overlayVisible = false
  overlayDismissed = true
  if (wakeUp) wakeUp()
  if (jobSaveTimer) {
    clearTimeout(jobSaveTimer)
    jobSaveTimer = null
  }
  notify()
  broadcastJob()
  if (!contextAlive()) return
  try {
    await chrome.storage.local.remove(JOB_KEY)
  } catch (e) {
    console.warn('[quick-reward] clearJob storage failed', e)
  }
}

async function runLoop() {
  if (loopActive || !job) return
  loopActive = true
  stopRequested = false
  overlayDismissed = false
  overlayVisible = true
  publish()

  let networkStreak = 0
  let unknownStreak = 0

  try {
    while (contextAlive() && job) {
      if (stopRequested) {
        await stopJobComplete()
        break
      }

      const index = job.items.findIndex((item) => item.status === 'pending')
      if (index === -1) {
        await finishJob()
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
      await publishAndSave()

      const result = await redeemOne(item.code)
      if (!contextAlive() || !job) return
      if (stopRequested) {
        await stopJobComplete()
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

      publish()

      if (!job.items.some((it) => it.status === 'pending')) {
        await finishJob()
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
      await publishAndSave()
      await sleep(waitMs)
      if (stopRequested) {
        await stopJobComplete()
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
    await publishAndSave()
  }
}

export async function enqueueCodesFromText(
  raw: string,
  delayMs?: number
) {
  const {codes, duplicates, ignored} = parseCodes(raw)
  if (!codes.length) {
    if (loopActive) return
    const settings = await loadSettings()
    const reason = ignored.length
      ? `Không tìm thấy code hợp lệ (bỏ qua ${ignored.length} đoạn).`
      : 'Không tìm thấy code hợp lệ.'
    finishedJob = {
      ...createJob([], [], delayMs ?? settings.delayMs),
      status: 'done',
      items: [],
      pauseReason: reason,
      finishedAt: Date.now()
    }
    overlayDismissed = false
    overlayVisible = true
    notify()
    return
  }

  if (loopActive) {
    throw new Error('Đang đổi code rồi.')
  }
  finishedJob = null

  const settings = await loadSettings()
  const resolvedDelay = clampDelay(delayMs ?? settings.delayMs)
  const cache = await loadFailCache()
  const openid = await readOpenId()
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
  await publishAndSave()
  if (!pending) {
    await finishJob()
    if (finishedJob) {
      finishedJob.pauseReason = `Cả ${skipped.length} code đã có trong cache lỗi nên không đổi lại. Xoá cache ở sidebar nếu muốn thử lại.`
      notify()
    }
    return
  }
  void runLoop()
}

export async function startOnLoad() {
  const raw = consumeUrlCodeParam()
  if (raw) {
    await enqueueCodesFromText(raw)
    return
  }

  const pendingStored = await chrome.storage.local.get(PENDING_BATCH_KEY)
  const pending = pendingStored[PENDING_BATCH_KEY]
  if (isPendingBatchFresh(pending)) {
    await chrome.storage.local.remove(PENDING_BATCH_KEY)
    await enqueueCodesFromText(pending.text, pending.delayMs)
    return
  }

  const stored = await loadJob()
  const resumeMaxAgeMs = 10 * 60 * 1000
  const fresh =
    stored && Date.now() - stored.updatedAt < resumeMaxAgeMs
  if (
    fresh &&
    stored.items.some((i) => i.status === 'pending') &&
    (stored.status === 'running' ||
      stored.status === 'paused' ||
      stored.status === 'waiting_login')
  ) {
    job = stored
    overlayVisible = !overlayDismissed
    publish()
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
        try {
          if (delayMs !== undefined) {
            await chrome.storage.local.set({
              [SETTINGS_KEY]: {delayMs}
            })
          }
          await enqueueCodesFromText(text, delayMs)
          sendResponse({ok: true})
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })()
      return true
    }

    if (msg.type === 'qr:stop') {
      requestStop()
      sendResponse({ok: true})
      return false
    }

    if (msg.type === 'qr:getJob') {
      sendResponse({job})
      return false
    }

    if (msg.type === 'qr:clearJob') {
      void clearCurrentJob().then(() => sendResponse({ok: true}))
      return true
    }

    return undefined
  })

  setInterval(() => {
    if (!contextAlive() && !extensionOrphaned) {
      extensionOrphaned = true
      notify()
    }
  }, 2000)

  await startOnLoad()
}

declare global {
  // eslint-disable-next-line no-var
  var __qrRedeemerInit: boolean | undefined
}
