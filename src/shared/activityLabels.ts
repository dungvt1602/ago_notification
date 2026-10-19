// Bảng tên hành động (mã lưu trong activity_logs.action -> tiếng Việt) + nhóm để lọc/tô màu.
// Dùng chung client (màn Nhật ký) và server (ghi nhật ký). KHÔNG import server-only ở đây.

export type ActionGroup = "auth" | "customer" | "template" | "quotation" | "send" | "user" | "channel" | "zalo" | "system";

export const ACTION_LABELS: Record<string, { label: string; group: ActionGroup }> = {
  DANG_NHAP: { label: "Đăng nhập", group: "auth" },
  DANG_NHAP_LOI: { label: "Đăng nhập thất bại", group: "auth" },

  KHACH_HANG_TAO: { label: "Thêm khách hàng", group: "customer" },
  KHACH_HANG_SUA: { label: "Sửa khách hàng", group: "customer" },
  KHACH_HANG_XOA: { label: "Xóa khách hàng", group: "customer" },
  KHACH_HANG_NHAP_FILE: { label: "Nhập khách hàng từ file", group: "customer" },

  TEMPLATE_TAO: { label: "Tạo template", group: "template" },
  TEMPLATE_SUA: { label: "Sửa template", group: "template" },
  TEMPLATE_XOA: { label: "Xóa template", group: "template" },
  TEMPLATE_DOI_ANH: { label: "Đổi ảnh template", group: "template" },
  TEMPLATE_XOA_ANH: { label: "Xóa ảnh template", group: "template" },
  TEMPLATE_GAN_KHACH: { label: "Gắn khách vào template", group: "template" },
  TEMPLATE_GO_KHACH: { label: "Gỡ khách khỏi template", group: "template" },
  TEMPLATE_DONG_BO_META: { label: "Đồng bộ template từ Meta", group: "template" },

  BAO_GIA_TAO: { label: "Tạo báo giá", group: "quotation" },
  BAO_GIA_SUA: { label: "Sửa báo giá", group: "quotation" },
  BAO_GIA_XOA: { label: "Xóa báo giá", group: "quotation" },
  BAO_GIA_SUA_MAT_HANG: { label: "Cập nhật mặt hàng báo giá", group: "quotation" },

  TAO_LENH_BAO_GIA: { label: "Tạo lệnh gửi báo giá", group: "send" },
  XAC_NHAN_GUI: { label: "Xác nhận gửi báo giá", group: "send" },
  HUY_LENH: { label: "Hủy lệnh gửi", group: "send" },
  GUI_WHATSAPP_QUEUE: { label: "Gửi hàng đợi WhatsApp", group: "send" },
  TU_DONG_TRA_LOI: { label: "Trả lời tự động", group: "send" },

  NGUOI_DUNG_TAO: { label: "Thêm người dùng", group: "user" },
  NGUOI_DUNG_SUA: { label: "Sửa người dùng", group: "user" },
  NGUOI_DUNG_XOA: { label: "Xóa người dùng", group: "user" },

  KENH_GUI_TAO: { label: "Thêm kênh gửi", group: "channel" },
  KENH_GUI_SUA: { label: "Sửa kênh gửi", group: "channel" },
  KENH_GUI_XOA: { label: "Xóa kênh gửi", group: "channel" },
  KENH_NHAN_TAO: { label: "Thêm kênh nhận", group: "channel" },
  KENH_NHAN_SUA: { label: "Sửa kênh nhận", group: "channel" },
  KENH_NHAN_XOA: { label: "Xóa kênh nhận", group: "channel" },

  ZALO_KET_NOI: { label: "Kết nối Zalo OA", group: "zalo" },
  ZALO_NGAT_KET_NOI: { label: "Ngắt kết nối Zalo OA", group: "zalo" },
  ZALO_LAM_MOI_TOKEN: { label: "Gia hạn token Zalo", group: "zalo" },
  ZALO_KIEM_TRA: { label: "Kiểm tra kết nối Zalo", group: "zalo" },
  ZALO_GUI_THU: { label: "Gửi tin thử Zalo", group: "zalo" },
  ZALO_LAY_MA: { label: "Lấy mã kích hoạt Zalo", group: "zalo" },
  ZALO_KICH_HOAT: { label: "Kích hoạt Zalo", group: "zalo" },
  ZALO_HUY_KICH_HOAT: { label: "Hủy kích hoạt Zalo", group: "zalo" },
};

export const GROUP_LABELS: Record<ActionGroup, string> = {
  auth: "Đăng nhập",
  customer: "Khách hàng",
  template: "Template",
  quotation: "Báo giá",
  send: "Gửi báo giá",
  user: "Người dùng",
  channel: "Kênh gửi / nhận",
  zalo: "Zalo",
  system: "Hệ thống",
};

export function actionLabel(code: string): string {
  return ACTION_LABELS[code]?.label || code;
}
export function actionGroup(code: string): ActionGroup {
  return ACTION_LABELS[code]?.group || "system";
}

// Tên trường tiếng Việt cho phần "đã đổi gì" trong ghi chú sửa.
export const FIELD_LABELS: Record<string, string> = {
  name: "tên",
  fullName: "họ tên",
  username: "username",
  email: "email",
  password: "mật khẩu",
  phone: "SĐT",
  whatsappPhone: "SĐT WhatsApp",
  company: "công ty",
  address: "địa chỉ",
  market: "thị trường",
  status: "trạng thái",
  receiveQuotation: "nhận báo giá",
  note: "ghi chú",
  isActive: "đang bật",
  code: "mã",
  title: "tiêu đề",
  subject: "sản phẩm",
  body: "nội dung",
  icon: "icon",
  currency: "tiền tệ",
  totalAmount: "tổng tiền",
  issuedDate: "ngày phát hành",
  validUntil: "hiệu lực đến",
  quotationId: "báo giá",
  channelId: "kênh gửi",
  categoryId: "danh mục",
  waTemplateName: "template Meta",
  waLanguage: "ngôn ngữ template",
  waCategory: "loại template Meta",
  waImage: "ảnh header",
  waFlow: "nút Flow",
  waBodyParams: "tham số body",
  sendAsText: "gửi dạng text",
  autoReply: "mẫu trả lời tự động",
  type: "loại",
  accountId: "tài khoản / số nhận",
  apiKeyEnv: "biến token",
  roles: "vai trò",
};
