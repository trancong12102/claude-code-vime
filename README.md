# Claude Code Vietnamese Typing Fix

Tool nhỏ giúp sửa lỗi gõ tiếng Việt (Telex/VNI) trên Claude Code CLI.
Mặc định khi gõ tiếng Việt trên terminal, các ký tự backspace (do bộ gõ sinh ra để sửa dấu) bị Claude Code nhận diện sai dẫn đến lỗi ký tự. Script này sẽ patch trực tiếp vào file `cli.js` của Claude Code để xử lý đúng các ký tự này.

## Yêu cầu

- [Bun](https://bun.com)
- [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) đã được cài đặt (`npm install -g @anthropic-ai/claude-code`)

## Cách sử dụng

1. Clone repo này về:
   ```bash
   git clone https://github.com/congtran/claude-vn-typing.git
   cd claude-vn-typing
   ```

2. Cài đặt dependencies:
   ```bash
   bun install
   ```

3. Chạy script patch:
   ```bash
   bun run patch
   ```

Script sẽ tự động tìm đường dẫn cài đặt của `claude`, tạo file backup và apply patch.
Sau khi chạy xong, bạn cần khởi động lại Claude Code để thay đổi có hiệu lực.

## Cơ chế hoạt động

Script sẽ thực hiện 2 việc chính trên file source của Claude Code:
1. Vô hiệu hóa bộ chặn ký tự DEL (Backspace) mặc định gây xung đột.
2. Inject đoạn mã xử lý mới để đếm số lượng ký tự DEL (0x7f) và thực hiện backspace tương ứng trước khi chèn văn bản thực tế.

## Khôi phục (Restore)

Script luôn tạo một file backup tại cùng thư mục với file gốc trước khi sửa đổi (có đuôi `.backup-YYYYMMDDHHmmss`).
Nếu gặp vấn đề, bạn có thể tìm đường dẫn file gốc trong log của script và khôi phục lại từ file backup.

Ví dụ log:
```
✓ Target file path: /path/to/lib/node_modules/@anthropic-ai/claude-code/cli.js
📁 Creating backup at: /path/to/lib/node_modules/@anthropic-ai/claude-code/cli.js.backup-20231202...
```
