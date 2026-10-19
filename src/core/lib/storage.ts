import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase Storage cho ảnh template (bucket public `template-images`).
// - Path CỐ ĐỊNH theo template (template-<id>) + upsert -> thay ảnh mới là GHI ĐÈ file cũ,
//   không để lại rác trong bucket.
// - Cần SUPABASE_SERVICE_ROLE_KEY (secret, chỉ server) để ghi/xóa. Chưa khai -> app
//   fallback lưu bytes vào DB như cũ (không gãy).

const BUCKET = "template-images";

let cached: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

export function isStorageConfigured(): boolean {
  return client() !== null;
}

// Path cố định theo template -> upload lần sau tự GHI ĐÈ ảnh cũ.
export function templateImagePath(templateId: bigint | number | string): string {
  return `template-${templateId}`;
}

// URL public (qua CDN Supabase, có cache) — UI gắn ?t=updatedAt làm cache-buster.
export function publicImageUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

export async function uploadImageToStorage(path: string, bytes: ArrayBuffer, mime: string): Promise<void> {
  const sb = client();
  if (!sb) throw new Error("Storage chưa cấu hình (SUPABASE_SERVICE_ROLE_KEY).");
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error("Upload Storage lỗi: " + error.message);
}

export async function downloadImageFromStorage(path: string): Promise<ArrayBuffer | null> {
  // Ưu tiên service client; server nào THIẾU SUPABASE_SERVICE_ROLE_KEY (hoặc lỗi) thì
  // fallback tải qua PUBLIC URL — bucket này public nên luôn đọc được. Trước đây thiếu
  // key là trả null -> gửi WhatsApp không header -> Meta từ chối #132012.
  const sb = client();
  if (sb) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (!error && data) return data.arrayBuffer();
  }
  try {
    const res = await fetch(publicImageUrl(path));
    if (res.ok) return await res.arrayBuffer();
  } catch {
    // rơi xuống null
  }
  return null;
}

export async function deleteImageFromStorage(path: string): Promise<void> {
  const sb = client();
  if (!sb) return;
  await sb.storage.from(BUCKET).remove([path]); // lỗi xóa không phá luồng chính
}
