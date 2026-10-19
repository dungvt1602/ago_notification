// Gửi tin nhắn văn bản qua Telegram Bot API — dùng để BÁO SẾP (nội bộ), giống bot cũ.
//
// Env:
//   TELEGRAM_BOT_TOKEN_MAIN : token bot Telegram.
//   TELEGRAM_BOSS_CHAT_ID   : chat id người nhận (nhiều người -> ngăn nhau bằng dấu phẩy).
//                             Người nhận PHẢI đã bấm Start bot (bot không tự nhắn trước được).
// Chưa cấu hình -> { skipped:true } (no-op), app vẫn chạy.

export type TgResult = { ok: boolean; skipped?: boolean; error?: string };

function chatIds(): string[] {
  return (process.env.TELEGRAM_BOSS_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN_MAIN && chatIds().length > 0;
}

// Gửi tới 1 chat id cụ thể bằng token truyền vào (dùng cho kênh nhận cấu hình trong DB).
export async function sendTelegramTo(token: string, chatId: string, text: string): Promise<TgResult> {
  if (!token || !chatId) return { ok: false, skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data?.ok) {
      console.error('[telegram] gửi thất bại tới', chatId, ':', JSON.stringify(data));
      return { ok: false, error: data?.description || 'gửi lỗi' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[telegram] lỗi mạng:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Gửi 1 đoạn text tới từng chat id. KHÔNG BAO GIỜ ném lỗi (nuốt + trả kết quả).
export async function sendTelegramText(text: string): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN_MAIN;
  const to = chatIds();
  if (!token || to.length === 0) return { ok: false, skipped: true };

  try {
    let anyFail = false;
    for (const chatId of to) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!res.ok || !data?.ok) {
        anyFail = true;
        console.error('[telegram] gửi thất bại tới', chatId, ':', JSON.stringify(data));
      }
    }
    return anyFail ? { ok: false, error: 'một số chat id gửi lỗi' } : { ok: true };
  } catch (err) {
    console.error('[telegram] lỗi mạng:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
