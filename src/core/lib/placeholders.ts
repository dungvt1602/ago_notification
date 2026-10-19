// Điền biến trong nội dung template từ dữ liệu báo giá + khách hàng + sản phẩm.
// Mượn ý tưởng {khách hàng}, {mã}, {giá}, {bảng sản phẩm}... như bot Telegram.

type QuotationLike = {
  code: string;
  title: string | null;
  totalAmount: unknown; // Prisma.Decimal
  currency: string;
  market: string | null;
  issuedDate: Date | null;
  validUntil: Date | null;
};

type ItemLike = {
  no: number;
  product: string;
  packing: string | null;
  unit: string | null;
  quantity: unknown; // Decimal
  price: unknown; // Decimal
  note: string | null;
};

type CustomerLike = { name: string } | null | undefined;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(amount: unknown, currency: string): string {
  const n = num(amount);
  return `${n.toLocaleString("vi-VN")} ${currency}`.trim();
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// Dựng bảng sản phẩm dạng text (giống bot dựng bảng, chỉ khác là text thay vì ảnh).
function fmtItems(items: ItemLike[], currency: string): string {
  if (!items || items.length === 0) return "(chưa có mặt hàng)";
  return items
    .map((it, i) => {
      const qty = num(it.quantity);
      const price = num(it.price);
      const line = qty * price;
      const parts = [`${it.no || i + 1}. ${it.product}`];
      if (it.packing) parts.push(`(${it.packing})`);
      const qtyUnit = [qty ? qty.toLocaleString("vi-VN") : "", it.unit || ""].filter(Boolean).join(" ");
      const tail = [qtyUnit && `SL: ${qtyUnit}`, price && `Đơn giá: ${fmtMoney(price, currency)}`, line && `Thành tiền: ${fmtMoney(line, currency)}`]
        .filter(Boolean)
        .join(" · ");
      return tail ? `${parts.join(" ")}\n   ${tail}` : parts.join(" ");
    })
    .join("\n");
}

export function renderTemplate(
  body: string,
  quotation: QuotationLike,
  customer?: CustomerLike,
  items: ItemLike[] = [],
): string {
  const map: Record<string, string> = {
    "khách hàng": customer?.name ?? "",
    "mã": quotation.code,
    "tiêu đề": quotation.title ?? "",
    "giá": fmtMoney(quotation.totalAmount, quotation.currency),
    "tổng": fmtMoney(quotation.totalAmount, quotation.currency),
    "thị trường": quotation.market ?? "",
    "ngày gửi": fmtDate(quotation.issuedDate),
    "hiệu lực": fmtDate(quotation.validUntil),
    "bảng sản phẩm": fmtItems(items, quotation.currency),
    "số mặt hàng": String(items.length),
  };

  // Thay {key} nếu biết; giữ nguyên nếu không có trong map.
  return (body || "").replace(/\{([^}]+)\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    return key in map ? map[key] : whole;
  });
}

// Tham số phần body khi gửi bằng template Meta đã duyệt.
// name có giá trị -> Meta yêu cầu "parameter_name" (mẫu đặt Loại biến = Tên).
export type BodyParam = { name?: string; value: string };

// Dựng danh sách tham số body từ chuỗi cấu hình của template.
//   "customer_name={khách hàng}"  -> [{ name: "customer_name", value: "Andy" }]
//   "{khách hàng}, {mã}"          -> [{ value: "Andy" }, { value: "BG-2026-0001" }]
//   trống                          -> [{ value: <tên khách> }]  (giữ nguyên hành vi cũ)
export function renderBodyParams(
  spec: string | null | undefined,
  quotation: QuotationLike,
  customer?: CustomerLike,
  items: ItemLike[] = [],
): BodyParam[] {
  const raw = (spec || "").trim();
  if (!raw) {
    const name = customer?.name ?? "";
    return name ? [{ value: name }] : [];
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // "ten_bien = {placeholder}" -> biến có tên; còn lại là biến vị trí.
      const m = part.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
      const [name, expr] = m ? [m[1], m[2]] : [undefined, part];
      return { name, value: renderTemplate(expr, quotation, customer, items) };
    });
}

// Tính tổng tiền báo giá = Σ(quantity * price).
export function computeTotal(items: { quantity: unknown; price: unknown }[]): number {
  return items.reduce((sum, it) => sum + num(it.quantity) * num(it.price), 0);
}
