#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") [-c|--clipboard]" >&2
  echo "  (default) Chọn vùng màn hình → OCR → wl-copy → mở trang #qr=" >&2
  echo "  -c, --clipboard  Bỏ qua grim; lấy text từ clipboard (wl-paste) → mở trang #qr=" >&2
}

from_clipboard=false
case "${1:-}" in
  -c | --clipboard | clip)
    from_clipboard=true
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  '')
    ;;
  *)
    echo "Tham số không hợp lệ: $1" >&2
    usage
    exit 1
    ;;
esac

if [[ "$from_clipboard" == true ]]; then
  if ! command -v wl-paste >/dev/null 2>&1; then
    notify-send "Quick Reward" "Thiếu wl-paste (clipboard Wayland)." 2>/dev/null || true
    exit 1
  fi
  text="$(wl-paste 2>/dev/null || true)"
else
  text="$(grim -g "$(slurp)" - | tesseract - - -l eng --psm 6 2>/dev/null || true)"
  text="${text//$'\r'/}"
  if [[ -n "${text//[[:space:]]/}" ]]; then
    printf '%s' "$text" | wl-copy
  fi
fi

text="${text//$'\r'/}"

if [[ -z "${text//[[:space:]]/}" ]]; then
  if [[ "$from_clipboard" == true ]]; then
    notify-send "Quick Reward" "Clipboard trống hoặc không đọc được." 2>/dev/null || true
  else
    notify-send "Quick Reward" "Không đọc được code từ vùng chọn." 2>/dev/null || true
  fi
  exit 1
fi

enc="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))' <<<"$text")"
xdg-open "https://redeem.df.garena.sg/vi/cdkgarena.html#qr=${enc}"
