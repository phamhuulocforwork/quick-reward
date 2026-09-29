import {
  PENDING_BATCH_KEY,
  REDEEM_MATCH,
  REDEEM_URL,
  SETTINGS_KEY,
  clampDelay,
  parseOpenIdFromCookie
} from './lib/redeem'

async function focusTab(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return
  await chrome.tabs.update(tab.id, {active: true})
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, {focused: true})
  }
}

async function getOpenIdFromCookies(): Promise<string | null> {
  const cookies = await chrome.cookies.getAll({url: REDEEM_URL})
  for (const c of cookies) {
    if (c.name === 'user_info') {
      const openid = parseOpenIdFromCookie(`${c.name}=${c.value}`)
      if (openid) return openid
    }
    try {
      const raw = decodeURIComponent(c.value)
      const data = JSON.parse(raw) as {openid?: unknown}
      if (typeof data.openid === 'string' && data.openid) return data.openid
    } catch {
      // not JSON
    }
  }
  return null
}

async function openRedeemPage(): Promise<{ok: true; mode: 'focus' | 'new'}> {
  const tabs = await chrome.tabs.query({url: REDEEM_MATCH})
  const tab = tabs.find((t) => t.id !== undefined)
  if (tab) {
    await focusTab(tab)
    return {ok: true, mode: 'focus'}
  }
  await chrome.tabs.create({url: REDEEM_URL, active: true})
  return {ok: true, mode: 'new'}
}

async function startBatchFromSidebar(text: string, delayMs: number) {
  const ms = clampDelay(delayMs)
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {delayMs: ms},
    [PENDING_BATCH_KEY]: {text, delayMs: ms, createdAt: Date.now()}
  })

  const tabs = await chrome.tabs.query({url: REDEEM_MATCH})
  const tab = tabs.find((t) => t.id !== undefined)
  if (tab?.id !== undefined) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'qr:start',
        text,
        delayMs: ms
      })
      if (res?.ok === false && res.error === 'Đang đổi code rồi.') {
        await chrome.storage.local.remove(PENDING_BATCH_KEY)
        return {ok: false as const, error: res.error as string}
      }
      await chrome.storage.local.remove(PENDING_BATCH_KEY)
      await focusTab(tab)
      return {ok: true as const, mode: 'direct' as const}
    } catch {
      await chrome.tabs.reload(tab.id)
      await focusTab(tab)
      return {ok: true as const, mode: 'reload' as const}
    }
  }

  await chrome.tabs.create({url: REDEEM_URL, active: true})
  return {ok: true as const, mode: 'new' as const}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return undefined

  if (msg.type === 'qr:batchStart') {
    const text = typeof msg.text === 'string' ? msg.text : ''
    const delayMs =
      typeof msg.delayMs === 'number' ? msg.delayMs : clampDelay(3000)
    if (!text.trim()) {
      sendResponse({ok: false, error: 'Chưa có nội dung code.'})
      return false
    }
    startBatchFromSidebar(text, delayMs).then(sendResponse, (err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    })
    return true
  }

  if (msg.type === 'qr:openRedeem') {
    openRedeemPage().then(sendResponse, (err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    })
    return true
  }

  if (msg.type === 'qr:getOpenId') {
    getOpenIdFromCookies().then(
      (openid) => sendResponse({openid}),
      () => sendResponse({openid: null})
    )
    return true
  }

  if (msg.type === 'qr:sleep') {
    const ms = Math.min(Math.max(Number(msg.ms) || 0, 0), 30000)
    setTimeout(() => sendResponse({ok: true}), ms)
    return true
  }

  if (msg.type === 'qr:whoami') {
    sendResponse({tabId: sender.tab?.id ?? null})
    return undefined
  }

  return undefined
})

// Named one by one so the bundler can fold each build down to a single
// branch. waterfox and librewolf are gecko, and used to fall to chromium.
const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'waterfox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'librewolf' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

const isSafariLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'safari' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'webkit-based'

// Safari has no side panel surface, so the sidebar page opens in a tab.
let sidebarTabId: number | undefined

function openSidebarTab() {
  const url = chrome.runtime.getURL('sidebar/index.html')

  const openNewTab = () => {
    chrome.tabs.create({url}, (tab) => {
      sidebarTabId = tab?.id
    })
  }

  // A repeat click focuses the tab already opened instead of a new copy.
  const knownTabId = sidebarTabId

  if (knownTabId === undefined) {
    openNewTab()

    return
  }

  chrome.tabs.update(knownTabId, {active: true}, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      openNewTab()

      return
    }

    // Selecting a tab in another window leaves that window behind the one the
    // user is looking at, so raise it too.
    chrome.windows?.update(tab.windowId, {focused: true})
  })
}

if (isFirefoxLike) {
  // Firefox refuses sidebarAction.open() outside a user input handler, and a
  // message listener is not one, so the toolbar click is the only route.
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open()
  })
}

if (isSafariLike) {
  // Safari never had setPanelBehavior, so the toolbar click needs a listener.
  chrome.action?.onClicked.addListener(() => {
    openSidebarTab()
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'openSidebar') return

    openSidebarTab()
  })
}

if (!isFirefoxLike && !isSafariLike) {
  // setPanelBehavior only affects FUTURE action clicks, registering it
  // inside onClicked would swallow the first toolbar click.
  chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick: true})

  // The side panel API only exists in Chromium. Firefox opens the sidebar in
  // the listener above, so this listener is compiled out of gecko builds.
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'openSidebar') return

    // Every line here runs synchronously on purpose. sidePanel.open() is only
    // allowed inside the user gesture that the content-script click carries, and
    // a tabs.query callback outlives it: the panel then silently refuses to open.
    // sender.tab is the tab the click came from, so no lookup is needed at all.
    chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick: true})

    const tabId = sender.tab?.id
    if (!chrome.sidePanel?.open || tabId === undefined) return

    try {
      chrome.sidePanel?.open({tabId})
    } catch (error) {
      console.error(error)
    }
  })
}
