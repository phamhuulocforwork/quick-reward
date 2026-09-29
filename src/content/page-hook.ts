/*
 * MAIN world: báo kết quả RedeemCDKey cho content script qua CustomEvent.
 */
import {HOOK_EVENT, HOOK_PING_EVENT} from '../lib/redeem'

const TARGET_PATH = '/CdkV2/RedeemCDKey'
const watched = new WeakMap<XMLHttpRequest, string>()

const emit = (detail: Record<string, unknown>) => {
  document.dispatchEvent(
    new CustomEvent(HOOK_EVENT, {detail: JSON.stringify(detail)})
  )
}

document.addEventListener(HOOK_PING_EVENT, () => emit({phase: 'ready'}))

const proto = XMLHttpRequest.prototype
const nativeOpen = proto.open
const nativeSend = proto.send

proto.open = function (
  _method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  watched.delete(this)
  try {
    const parsed = new URL(String(url), location.href)
    if (parsed.pathname.endsWith(TARGET_PATH)) {
      watched.set(this, parsed.searchParams.get('cdkey') || '')
    }
  } catch {
    // URL lạ: bỏ qua.
  }
  return nativeOpen.apply(this, [_method, url, ...rest] as Parameters<
    typeof nativeOpen
  >)
}

proto.send = function (...args: unknown[]) {
  if (watched.has(this)) {
    const cdkey = watched.get(this)!
    this.addEventListener(
      'loadend',
      () => {
        let body: {code?: unknown; msg?: string} | null = null
        try {
          body =
            this.responseType === 'json'
              ? (this.response as {code?: unknown; msg?: string})
              : JSON.parse(this.responseText)
        } catch {
          // Không phải JSON.
        }
        const rawCode = body?.code
        emit({
          phase: 'done',
          cdkey,
          httpStatus: this.status,
          code:
            rawCode !== null &&
            rawCode !== undefined &&
            rawCode !== '' &&
            Number.isFinite(Number(rawCode))
              ? Number(rawCode)
              : null,
          msg:
            body && typeof body.msg === 'string'
              ? body.msg.slice(0, 200)
              : ''
        })
      },
      {once: true}
    )
    emit({phase: 'sent', cdkey})
  }
  return nativeSend.apply(this, args as Parameters<typeof nativeSend>)
}

export default function initial() {
  return () => {}
}
