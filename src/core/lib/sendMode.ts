// CHẾ ĐỘ GỬI: gửi thật hay gửi giả. File THUẦN (không "server-only", không DB) để script test
// chạy ngoài Next vẫn import được — giống phoneType.ts / quotaTier.ts / channelType.ts.
//
// VÌ SAO TÁCH RIÊNG VÀ PHẢI TEST: gửi giả KHÔNG gọi Meta, nhưng job vẫn được đánh "Đã gửi" và
// vẫn trừ hạn mức, chỉ khác message id có tiền tố DRYRUN-. Cấu hình sai ở đây nghĩa là bạn tin
// đã gửi 8.000 tin trong khi không tin nào rời máy, và giao diện không hề báo gì.
//
// Mặc định AN TOÀN là GỬI GIẢ: thiếu biến, giá trị lạ, gõ nhầm -> không gửi cho khách. Chỉ vài
// cách viết rõ ràng mới bật gửi thật. Trước đây so sánh đúng bằng chữ "false" nên `False`,
// `FALSE`, hay `"false "` lỡ dính khoảng trắng đều âm thầm quay về gửi giả.
const REAL_SEND_TOKENS = new Set(["false", "0", "no", "off", "tat", "tắt"]);

export function isDryRun(): boolean {
  return !REAL_SEND_TOKENS.has((process.env.SEND_DRY_RUN || "").trim().toLowerCase());
}

// Message id giả khi gửi thử — tiền tố DRYRUN- để tra log biết ngay tin nào không có thật.
export function dryRunMessageId(): string {
  return "DRYRUN-" + crypto.randomUUID();
}
