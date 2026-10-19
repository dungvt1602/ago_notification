// Chuẩn hoá loại kênh của một lệnh gửi. File THUẦN (không "server-only", không DB) để script
// test chạy ngoài Next vẫn import được.
//
// VÌ SAO PHẢI DÙNG CHUNG: lệnh có thể KHÔNG gắn kênh (channelId null ở cả batch lẫn template).
// Khi đó confirmSend vẫn ghi job.channel = "WHATSAPP" và tin đi thật qua WhatsApp. Trước đây
// worker lại mặc định chuỗi rỗng -> tưởng không phải WhatsApp -> bỏ qua hạn mức và gửi không
// giới hạn. Hai nơi lệch mặc định là một lỗi không ai nhìn thấy cho tới khi Meta khoá số, nên
// từ nay CHỈ có một chỗ quyết định.
export const DEFAULT_CHANNEL_TYPE = "WHATSAPP";

export function channelTypeOf(channel?: { type?: string | null } | null): string {
  return (channel?.type || DEFAULT_CHANNEL_TYPE).toUpperCase();
}

export function isWhatsApp(channel?: { type?: string | null } | null): boolean {
  return channelTypeOf(channel) === "WHATSAPP";
}
