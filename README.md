# Quick Reward

Extension tự đổi gift code **Delta Force** trên trang Garena: OCR vùng màn hình (Hyprland) → mở URL có `#qr=` (hash, tránh va chạm OAuth `?code=` của Garena) → extension lọc code và đổi tuần tự.

Màu thương hiệu: `#0fda85`, đen, trắng.

## Cài extension

```bash
npm install
npm run dev
# hoặc npm run build rồi load dist/chrome (hoặc firefox) trong chrome://extensions
```

## Phím tắt Hyprland (OCR → trình duyệt)

1. Cài script vào `~/.local/bin`: `./install.sh` (cần `~/.local/bin` trong `$PATH`)
2. Bind trong Hyprland:

```lua
bind = SUPER SHIFT, D, exec, quick-redeem.sh
bind = SUPER SHIFT, C, exec, quick-redeem.sh -c
```

Script mặc định: `grim` + `slurp` → `tesseract` (eng) → `wl-copy` → mở  
`https://redeem.df.garena.sg/vi/cdkgarena.html#qr=…`

Chỉ dùng clipboard (bỏ qua chọn vùng OCR):

```bash
./scripts/quick-redeem.sh -c
# hoặc: --clipboard | clip
```

## Dùng trên trang đổi quà

1. Đăng nhập Garena tại trang đổi code.
2. Chạy phím tắt hoặc mở URL thủ công với hash `#qr=` (có thể nhiều code / text OCR).
3. Extension xóa `#qr` khỏi URL, hiện overlay tiến trình, lưu lịch sử trong sidebar.

## Nhập hàng loạt

Mở sidebar Quick Reward: dán danh sách code, chọn thời gian chờ giữa mỗi lần đổi, bấm **Bắt đầu**. Nếu chưa có tab Garena, extension mở tab mới; nếu đã mở, chạy ngay trên tab đó. **Dừng** hủy job (không tự chạy lại sau khi tải lại trang). Code invalid/hết hạn được cache toàn cục; code đã đổi trên tài khoản được cache theo `openid` — lần sau sẽ bỏ qua. **Export** tải file `.txt` các code đổi thành công.

## Commands

```bash
npm run dev
npm run build
npm run build:firefox
node --test src/lib/redeem.test.ts
```

[Extension.js docs](https://extension.js.org)

# Giấy phép

MIT — xem [LICENSE](LICENSE).