import {useCallback, useEffect, useMemo, useState} from 'react'
import logo from '../images/icon.png'
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
  REDEEM_URL,
  SETTINGS_KEY,
  summarize,
  URL_HASH_KEY,
  type FailCache,
  type HistoryJob,
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
  if (status === 'invalid') return 'text-amber-400'
  return 'text-red-400/90'
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
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [refresh])

  const jobBusy =
    job?.status === 'running' || job?.status === 'waiting_login'

  const jobSummary = job ? summarize(job) : null

  const copyCode = (code: string) => {
    void navigator.clipboard.writeText(code)
  }

  const startBatch = async () => {
    const text = batchText.trim()
    if (!text) return
    const ms = clampDelay(delayMs)
    await chrome.storage.local.set({[SETTINGS_KEY]: {delayMs: ms}})

    const tabs = await chrome.tabs.query({url: REDEEM_MATCH})
    const tab = tabs.find((t) => t.id !== undefined)
    if (tab?.id) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'qr:start',
          text,
          delayMs: ms
        })
        if (res && !res.ok) {
          console.warn(res.error)
        }
      } catch (e) {
        console.error(e)
      }
      return
    }

    const enc = encodeURIComponent(text)
    await chrome.tabs.create({url: `${REDEEM_URL}#${URL_HASH_KEY}=${enc}`})
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

  return (
    <div className="dark min-h-screen bg-background text-foreground p-2 space-y-2 text-xs">
      <header className="flex items-center gap-2 px-1 py-1">
        <img src={logo} alt="" className="size-7 rounded-md" aria-hidden />
        <h1 className="text-sm font-semibold text-primary">Quick Reward</h1>
      </header>

      <section className="border border-border rounded-md p-2 space-y-2">
        <textarea
          className="w-full min-h-[88px] rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-y"
          placeholder="Dán code — phân cách bằng dòng, phẩy, khoảng trắng…"
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          disabled={jobBusy}
        />
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
          <div className="flex gap-1 ml-auto">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={jobBusy || parsedCount === 0}
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
        <div className="flex justify-between text-muted-foreground">
          <span>Job hiện tại</span>
          <span>{job ? `${job.status} · ${formatTime(job.updatedAt)}` : '—'}</span>
        </div>
        {jobSummary ? (
          <p className="text-muted-foreground">
            {jobSummary.success} ok · {jobSummary.used} đã nhận ·{' '}
            {jobSummary.invalid} invalid · {jobSummary.failed} lỗi
          </p>
        ) : null}
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
                  className="truncate text-left hover:text-primary"
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
              variant="outline"
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
                  {h.summary.total} ok
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
                      className="truncate hover:text-primary"
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
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={!cacheCount}
          onClick={() => void clearFailCache()}
        >
          Xoá cache
        </Button>
      </footer>
    </div>
  )
}
