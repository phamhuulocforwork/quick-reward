import {useEffect, useState} from 'react'
import logo from '../images/icon.png'
import {KIND_LABEL, summarize} from '../lib/redeem'
import {
  dismissOverlay,
  getJob,
  isExtensionOrphaned,
  subscribe
} from './redeemer'

const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'waterfox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'librewolf' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

function statusClass(status: string) {
  return `qr-chip qr-chip--${status}`
}

export default function ContentApp() {
  const [visible, setVisible] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    return subscribe((nextJob, show) => {
      setVisible(show && Boolean(nextJob))
      tick((n) => n + 1)
    })
  }, [])

  const job = getJob()
  const orphaned = isExtensionOrphaned()
  if (!visible || !job) return null

  const summary = summarize(job)
  const currentCode = job.current?.code

  const openSidebar = () => {
    if (isFirefoxLike) return
    chrome.runtime.sendMessage({type: 'openSidebar'})
  }

  return (
    <div className="qr-overlay" role="status" aria-live="polite">
      <header className="qr-overlay__head">
        <img className="qr-overlay__logo" src={logo} alt="" aria-hidden="true" />
        <div>
          <p className="qr-overlay__title">Quick Reward</p>
          <p className="qr-overlay__sub">
            {job.status === 'running' && job.current?.phase === 'redeeming'
              ? `Đang đổi ${currentCode ?? '…'}`
              : job.status === 'waiting_login'
                ? 'Chờ đăng nhập Garena…'
                : job.status === 'done'
                  ? 'Hoàn tất'
                  : job.status === 'paused'
                    ? 'Tạm dừng'
                    : job.status === 'stopped'
                      ? 'Đã dừng'
                      : 'Đang xử lý…'}
          </p>
        </div>
        <button
          type="button"
          className="qr-overlay__close"
          aria-label="Đóng"
          onClick={() => dismissOverlay()}
        >
          ×
        </button>
      </header>

      <ul className="qr-overlay__list">
        {job.items.map((item) => {
          const active =
            item.code === currentCode && item.status === 'pending'
          return (
            <li
              key={item.code}
              className={active ? 'qr-row qr-row--active' : 'qr-row'}
            >
              <code className="qr-code">{item.code}</code>
              <span className={statusClass(item.status)}>
                {KIND_LABEL[item.status] ?? item.status}
              </span>
            </li>
          )
        })}
      </ul>

      {orphaned ? (
        <p className="qr-overlay__note">
          Extension vừa được tải lại, hãy tải lại trang (F5).
        </p>
      ) : null}

      {job.pauseReason ? (
        <p className="qr-overlay__note">{job.pauseReason}</p>
      ) : null}

      <footer className="qr-overlay__foot">
        <span className="qr-overlay__stats">
          {summary.success} ok · {summary.used} đã nhận · {summary.limit}{' '}
          giới hạn · {summary.invalid} invalid · {summary.failed} lỗi
        </span>
        {orphaned ? null : isFirefoxLike ? (
          <span className="qr-overlay__hint">Mở sidebar bằng icon toolbar</span>
        ) : (
          <button type="button" className="qr-btn" onClick={openSidebar}>
            Lịch sử
          </button>
        )}
      </footer>
    </div>
  )
}
