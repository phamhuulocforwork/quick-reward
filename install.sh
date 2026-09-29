#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${root}/scripts/quick-redeem.sh"
dest_dir="${HOME}/.local/bin"
dest="${dest_dir}/quick-redeem.sh"

if [[ ! -f "$src" ]]; then
  echo "Không tìm thấy: $src" >&2
  exit 1
fi

mkdir -p "$dest_dir"
install -m 755 "$src" "$dest"
echo "Đã cài: $dest"
