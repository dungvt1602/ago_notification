// KHÔNG có "import server-only" ở đây vì file này còn được dùng bởi script backfill (tsx, chạy
// ngoài Next). Bản thân nó là hàm thuần; người gọi (sendService, customerService) đã có
// "server-only". Lưu ý: libphonenumber-js/max khá nặng (~145kB) nên TUYỆT ĐỐI không import file
// này vào component client.
// PHẢI import từ /max: bản mặc định dùng metadata "mobile" và có thể trả undefined cho số
// hợp lệ (xem issue libphonenumber-js). /max có metadata đầy đủ.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { findCountry, splitPhone } from "@shared/countries";

// Loại số suy từ dãy số. Lưu ý quan trọng: ở Mỹ/Canada/một số nước châu Âu hệ thống số
// KHÔNG phân biệt di động vs máy bàn -> lib trả FIXED_LINE_OR_MOBILE, mình ghi nhận là
// AMBIGUOUS (Không rõ) thay vì đoán bừa.
export type PhoneType = "MOBILE" | "FIXED_LINE" | "AMBIGUOUS" | "UNKNOWN";

export const PHONE_TYPE_LABELS: Record<PhoneType, string> = {
  MOBILE: "Di động",
  FIXED_LINE: "Máy bàn",
  AMBIGUOUS: "Không rõ",
  UNKNOWN: "Không xác định",
};

// Suy loại số từ dãy số + thị trường (quốc gia). Thuần, không gọi mạng, có thể dùng ở mọi nơi
// (thêm tay / sửa / import / backfill). Số có mã quốc gia -> parse quốc tế; số không có mã vùng
// -> parse theo quốc gia của market (nếu biết). Không parse được -> UNKNOWN.
export function detectPhoneType(phone: string | null | undefined, market?: string | null): PhoneType {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "UNKNOWN";

  const country = market ? findCountry(market) : undefined;
  const { dial } = splitPhone(phone, market);

  let parsed: ReturnType<typeof parsePhoneNumberFromString>;
  if (dial) {
    // Có mã quốc gia -> parse theo dạng quốc tế.
    parsed = parsePhoneNumberFromString("+" + digits);
  } else if (country) {
    // Số nội địa -> cần biết quốc gia để parse.
    parsed = parsePhoneNumberFromString(digits, country.iso2 as CountryCode);
  } else {
    // Không rõ mã vùng lẫn quốc gia -> thử quốc tế, không thì chịu.
    parsed = parsePhoneNumberFromString("+" + digits);
  }
  if (!parsed) return "UNKNOWN";

  const type = parsed.getType();
  if (type === "MOBILE") return "MOBILE";
  if (type === "FIXED_LINE") return "FIXED_LINE";
  if (type === "FIXED_LINE_OR_MOBILE") return "AMBIGUOUS";
  // VOIP / TOLL_FREE / PREMIUM_RATE / UAN / PAGER / PERSONAL_NUMBER / undefined -> không chắc chắn.
  return "UNKNOWN";
}
