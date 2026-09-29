import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ExternalLink, HeartHandshake} from 'lucide-react'
import logo from '../images/icon.png'
import qrCode from '../images/qr-code.svg'
import {Swirling} from '../components/loading-ui/swirling'
import {Button} from '../components/ui/button'
import {
  clampDelay,
  collectSuccessCodes,
  countFailCache,
  delaySelectOptions,
  emptyFailCache,
  FAIL_CACHE_KEY,
  HISTORY_KEY,
  JOB_KEY,
  KIND_LABEL,
  jobToHistoryEntry,
  MAX_HISTORY,
  parseCodes,
  REDEEM_MATCH,
  summarize,
  type FailCache,
  type HistoryJob,
  type JobSummary,
  type QrSettings,
  type RedeemJob
} from '../lib/redeem'

function formatTime(ts: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function chipClass(status: string) {
  if (status === 'success') return 'text-primary'
  if (status === 'pending') return 'text-muted-foreground'
  if (status === 'used') return 'text-foreground/80'
  if (status === 'limit') return 'text-violet-300'
  if (status === 'invalid') return 'text-amber-400'
  return 'text-red-400/90'
}

const JOB_STAT_TILES: {
  key: keyof Pick<JobSummary, 'success' | 'used' | 'limit' | 'invalid' | 'failed'>
  label: string
  valueClass: string
}[] = [
  {key: 'success', label: 'Thành công', valueClass: 'text-primary'},
  {key: 'used', label: 'Đã nhận', valueClass: 'text-foreground/80'},
  {key: 'limit', label: 'Giới hạn', valueClass: 'text-violet-300'},
  {key: 'invalid', label: 'Sai mã', valueClass: 'text-amber-400'},
  {key: 'failed', label: 'Lỗi', valueClass: 'text-red-400/90'}
]

function jobStatusLabel(status: RedeemJob['status']) {
  switch (status) {
    case 'running':
      return 'Đang đổi'
    case 'waiting_login':
      return 'Chờ đăng nhập'
    case 'done':
      return 'Hoàn tất'
    case 'stopped':
      return 'Đã dừng'
    case 'paused':
      return 'Tạm dừng'
    default:
      return status
  }
}

function JobStatusBadge({job}: {job: RedeemJob}) {
  const time = formatTime(job.updatedAt)
  const loading =
    job.status === 'running' || job.status === 'waiting_login'

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <Swirling
          className="size-3.5 shrink-0 text-primary"
          style={{['--duration' as string]: '1.2s'}}
          aria-hidden
        />
        <span className="text-[10px] font-medium text-foreground truncate">
          {jobStatusLabel(job.status)}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          · {time}
        </span>
      </span>
    )
  }

  return (
    <span className="text-[10px] text-muted-foreground truncate">
      {jobStatusLabel(job.status)} · {time}
    </span>
  )
}

function JobStatTiles({summary}: {summary: JobSummary}) {
  return (
    <div
      className="grid grid-cols-5 gap-1"
      role="group"
      aria-label="Thống kê job hiện tại"
    >
      {JOB_STAT_TILES.map(({key, label, valueClass}) => (
        <div
          key={key}
          className="flex flex-col items-center justify-center rounded-md border border-border/80 bg-muted/25 px-0.5 py-1.5 min-w-0"
        >
          <span
            className={`text-sm font-semibold tabular-nums leading-none ${valueClass}`}
          >
            {summary[key]}
          </span>
          <span className="mt-1 text-[9px] leading-tight text-muted-foreground text-center w-full truncate px-0.5">
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

async function readStorage() {
  const data = await chrome.storage.local.get([
    JOB_KEY,
    HISTORY_KEY,
    FAIL_CACHE_KEY,
    SETTINGS_KEY
  ])
  return {
    job: (data[JOB_KEY] as RedeemJob | undefined) ?? null,
    history: (Array.isArray(data[HISTORY_KEY])
      ? data[HISTORY_KEY]
      : []) as HistoryJob[],
    failCache: (data[FAIL_CACHE_KEY] as FailCache | undefined) ?? emptyFailCache(),
    settings: (data[SETTINGS_KEY] as QrSettings | undefined) ?? {delayMs: 3000}
  }
}

export default function SidebarApp() {
  const [job, setJob] = useState<RedeemJob | null>(null)
  const [history, setHistory] = useState<HistoryJob[]>([])
  const [failCache, setFailCache] = useState(emptyFailCache())
  const [batchText, setBatchText] = useState('')
  const [delayMs, setDelayMs] = useState(3000)
  const [actionNote, setActionNote] = useState('')
  const [donateOpen, setDonateOpen] = useState(false)
  const donateRef = useRef<HTMLDivElement>(null)
  const delayOptions = useMemo(() => delaySelectOptions(), [])

  const parsedCount = useMemo(
    () => parseCodes(batchText).codes.length,
    [batchText]
  )

  const refresh = useCallback(async () => {
    const next = await readStorage()
    setJob(next.job)
    setHistory(next.history)
    setFailCache(next.failCache)
    setDelayMs(clampDelay(next.settings.delayMs))
  }, [])

  useEffect(() => {
    void refresh()

    const pullLiveJob = async () => {
      try {
        const tabs = await chrome.tabs.query({url: REDEEM_MATCH})
        const tab = tabs.find((t) => t.id !== undefined)
        if (!tab?.id) return
        const res = await chrome.tabs.sendMessage(tab.id, {type: 'qr:getJob'})
        const live = res?.job as RedeemJob | null | undefined
        if (!live?.updatedAt) return
        setJob((prev) =>
          !prev || live.updatedAt > prev.updatedAt ? live : prev
        )
      } catch {
        // tab chưa sẵn sàng
      }
    }
    void pullLiveJob()

    const onRuntimeMessage = (
      msg: {
        type?: string
        job?: RedeemJob | null
        history?: HistoryJob[]
        failCache?: FailCache
      },
      _sender: chrome.runtime.MessageSender
    ) => {
      if (msg?.type === 'qr:jobUpdate') {
        setJob(msg.job ?? null)
      }
      if (msg?.type === 'qr:historyUpdate' && Array.isArray(msg.history)) {
        setHistory(msg.history)
      }
      if (msg?.type === 'qr:failCacheUpdate' && msg.failCache) {
        setFailCache(msg.failCache)
      }
    }
    chrome.runtime.onMessage.addListener(onRuntimeMessage)

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== 'local') return
      if (
        changes[JOB_KEY] ||
        changes[HISTORY_KEY] ||
        changes[FAIL_CACHE_KEY] ||
        changes[SETTINGS_KEY]
      ) {
        void refresh()
      }
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage)
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [refresh])

  useEffect(() => {
    if (!donateOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!donateRef.current?.contains(e.target as Node)) {
        setDonateOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDonateOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [donateOpen])

  const jobBusy = Boolean(
    job &&
      (job.status === 'running' || job.status === 'waiting_login') &&
      job.items.some((i) => i.status === 'pending') &&
      Date.now() - job.updatedAt < 90_000
  )

  const jobSummary = job ? summarize(job) : null

  const copyCode = (code: string) => {
    void navigator.clipboard.writeText(code)
  }

  const startBatch = async () => {
    const text = batchText.trim()
    if (!text) {
      setActionNote('Dán hoặc nhập code trước.')
      return
    }
    if (parsedCount === 0) {
      setActionNote('Không nhận code hợp lệ (≥6 ký tự, có chữ cái A–Z).')
      return
    }
    setActionNote('Đang mở trang / gửi lệnh đổi…')
    const ms = clampDelay(delayMs)
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'qr:batchStart',
        text,
        delayMs: ms
      })
      if (res?.ok) {
        const mode = res.mode as string | undefined
        if (mode === 'direct') {
          setActionNote('Đã gửi batch — đang đổi trên tab Garena.')
        } else if (mode === 'reload') {
          setActionNote('Đã gửi batch, đang tải lại tab Garena…')
        } else {
          setActionNote('Đã gửi batch, đang mở tab Garena…')
        }
      } else {
        setActionNote(res?.error ?? 'Không gửi được lệnh. Thử reload tab Garena.')
      }
    } catch (e) {
      setActionNote(
        e instanceof Error ? e.message : 'Lỗi khi bắt đầu — reload extension.'
      )
    }
  }

  const clearJob = async () => {
    if (!job) return
    try {
      const tabs = await chrome.tabs.query({url: REDEEM_MATCH})
      for (const tab of tabs) {
        if (tab.id === undefined) continue
        try {
          await chrome.tabs.sendMessage(tab.id, {type: 'qr:clearJob'})
        } catch {
          // tab không có content script
        }
      }
    } catch {
      // ignore
    }
    await chrome.storage.local.remove(JOB_KEY)
    setJob(null)
  }

  const stopBatch = async () => {
    const current = job
    if (
      !current ||
      (current.status !== 'running' && current.status !== 'waiting_login')
    ) {
      return
    }
    if (current.tabId) {
      try {
        await chrome.tabs.sendMessage(current.tabId, {type: 'qr:stop'})
        return
      } catch {
        // tab closed
      }
    }
    const stopped: RedeemJob = {
      ...current,
      status: 'stopped',
      current: null,
      pauseReason: 'Đã dừng bởi người dùng.',
      finishedAt: Date.now(),
      updatedAt: Date.now()
    }
    const stored = await chrome.storage.local.get(HISTORY_KEY)
    const list = (Array.isArray(stored[HISTORY_KEY])
      ? stored[HISTORY_KEY]
      : []) as HistoryJob[]
    list.unshift(jobToHistoryEntry(stopped))
    list.length = Math.min(list.length, MAX_HISTORY)
    await chrome.storage.local.set({
      [JOB_KEY]: stopped,
      [HISTORY_KEY]: list
    })
  }

  const exportSuccess = () => {
    const codes = collectSuccessCodes(job, history)
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const blob = new Blob([codes.length ? `${codes.join('\n')}\n` : ''], {
      type: 'text/plain;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quick-reward-success-${stamp}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearHistory = async () => {
    await chrome.storage.local.set({[HISTORY_KEY]: []})
    void refresh()
  }

  const clearFailCache = async () => {
    await chrome.storage.local.set({[FAIL_CACHE_KEY]: emptyFailCache()})
    void refresh()
  }

  const cacheCount = countFailCache(failCache)

  const openRedeemPage = async () => {
    try {
      await chrome.runtime.sendMessage({type: 'qr:openRedeem'})
    } catch {
      setActionNote('Không mở được trang — thử reload extension.')
    }
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground p-2 space-y-2 text-xs">
      <header className="flex items-center gap-2 px-1 py-1">
        <img src={logo} alt="" className="size-7 rounded-md" aria-hidden />
        <Button
          type="button"
          variant="outline"
          className="h-6 text-[10px] gap-1"
          onClick={() => void openRedeemPage()}
        >
          <ExternalLink className="size-3" aria-hidden />
          Mở trang
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          aria-expanded={donateOpen}
          onClick={() => setDonateOpen((v) => !v)}
        >
          <HeartHandshake className="size-3" aria-hidden />
          Ủng hộ tác giả
        </Button>
      </header>

      <section className="border border-border rounded-md p-2 space-y-2">
        <div className="flex gap-1">
          <textarea
            className="w-full min-h-[88px] rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-y"
            placeholder="Dán code (Ctrl+V) — phân cách bằng dòng, phẩy, khoảng trắng…"
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <span className="text-muted-foreground">{parsedCount} code</span>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Chờ</span>
            <select
              className="rounded border border-input bg-background px-1 py-0.5"
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              disabled={jobBusy}
            >
              {delayOptions.map((o) => (
                <option key={o.valueMs} value={o.valueMs}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {actionNote ? (
            <p className="w-full text-[10px] text-muted-foreground">{actionNote}</p>
          ) : null}
          <div className="flex gap-1 ml-auto">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={jobBusy}
              onClick={() => void startBatch()}
            >
              Bắt đầu
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!jobBusy}
              onClick={() => void stopBatch()}
            >
              Dừng
            </Button>
          </div>
        </div>
      </section>

      <section className="border border-border rounded-md p-2 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1 text-muted-foreground">
          <span>Job hiện tại</span>
          <div className="flex items-center gap-1 ml-auto">
            {job ? <JobStatusBadge job={job} /> : <span>—</span>}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={!job}
              onClick={() => void clearJob()}
            >
              Xoá job
            </Button>
          </div>
        </div>
        {jobSummary ? <JobStatTiles summary={jobSummary} /> : null}
        <ul className="max-h-40 overflow-auto space-y-0.5">
          {!job?.items.length ? (
            <li className="text-muted-foreground">Không có code.</li>
          ) : (
            job.items.map((item) => (
              <li
                key={item.code}
                className="flex items-center justify-between gap-2 truncate"
                title={item.message || undefined}
              >
                <button
                  type="button"
                  className="truncate text-left cursor-pointer hover:text-primary"
                  onClick={() => copyCode(item.code)}
                >
                  <code>{item.code}</code>
                </button>
                <span className={chipClass(item.status)}>
                  {KIND_LABEL[item.status] ?? item.status}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="border border-border rounded-md p-2 space-y-1 max-h-[40vh] overflow-auto">
        <div className="flex flex-wrap gap-1 justify-between items-center">
          <span className="text-muted-foreground">Lịch sử ({history.length})</span>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={exportSuccess}
            >
              Export
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={!history.length}
              onClick={() => void clearHistory()}
            >
              Xoá lịch sử
            </Button>
          </div>
        </div>
        {!history.length ? (
          <p className="text-muted-foreground">Chưa có lịch sử.</p>
        ) : (
          history.map((h) => (
            <details key={h.id} className="border-t border-border/60 pt-1">
              <summary className="cursor-pointer list-none flex justify-between gap-2">
                <span>
                  {formatTime(h.finishedAt)} · {h.summary.success}/
                  {h.summary.total} thành công
                </span>
              </summary>
              <ul className="mt-1 space-y-0.5 pl-1">
                {h.items.map((item) => (
                  <li
                    key={`${h.id}-${item.code}`}
                    className="flex justify-between gap-2 truncate"
                    title={item.message || undefined}
                  >
                    <button
                      type="button"
                      className="truncate cursor-pointer hover:text-primary"
                      onClick={() => copyCode(item.code)}
                    >
                      <code>{item.code}</code>
                    </button>
                    <span className={chipClass(item.status)}>
                      {KIND_LABEL[item.status] ?? item.status}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-1 text-muted-foreground">
        <span>Cache lỗi: {cacheCount}</span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={!cacheCount}
          onClick={() => void clearFailCache()}
        >
          Xoá cache
        </Button>
      </footer>

      <div
        ref={donateRef}
        className="relative flex flex-col items-center gap-1.5 px-1 pb-1"
      >
        {donateOpen ? (
          <div
            role="dialog"
            aria-label="QR ủng hộ tác giả"
            className="absolute bottom-full left-1/2 z-10 mb-2 w-52 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
          >
            <img
              src={qrCode}
              alt="QR code ủng hộ tác giả"
              className="size-full rounded-sm bg-white"
            />
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Quét mã để ủng hộ tác giả
            </p>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">Pham Huu Loc</p>
      </div>
    </div>
  )
}
