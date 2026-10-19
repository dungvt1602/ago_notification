// Hình tối thiểu của request mà service cần (chỉ đọc header) — thay cho Request của Web/Next.
export type ReqLike = { headers: { get(name: string): string | null } };
