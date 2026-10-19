import type { Channel } from "@prisma/client";
import { prisma } from "@core/db/prisma";
import type { CreateChannelInput, UpdateChannelInput } from "@core/validation/channel.schema";

export function listChannels() {
  return prisma.channel.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { templates: true, sendBatches: true } } },
  });
}

export function createChannel(input: CreateChannelInput) {
  return prisma.channel.create({
    data: {
      name: input.name,
      type: input.type,
      accountId: input.accountId,
      apiKeyEnv: input.apiKeyEnv,
      note: input.note ?? null,
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
    },
  });
}

export function updateChannel(id: string, input: UpdateChannelInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.accountId !== undefined) data.accountId = input.accountId;
  if (input.apiKeyEnv !== undefined) data.apiKeyEnv = input.apiKeyEnv;
  if (input.note !== undefined) data.note = input.note;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return prisma.channel.update({ where: { id: BigInt(id) }, data });
}

// Xóa kênh: gỡ liên kết ở template + lệnh gửi (đặt channelId=null) rồi xóa.
export async function deleteChannel(id: string) {
  const cid = BigInt(id);
  await prisma.$transaction([
    prisma.template.updateMany({ where: { channelId: cid }, data: { channelId: null } }),
    prisma.sendBatch.updateMany({ where: { channelId: cid }, data: { channelId: null } }),
    prisma.channel.delete({ where: { id: cid } }),
  ]);
  return { ok: true };
}

// Lấy API key THẬT của một kênh từ biến môi trường.
// DB chỉ lưu channel.apiKeyEnv (tên biến), key thật đọc từ process.env ở đây.
export function getChannelApiKey(channel: Pick<Channel, "apiKeyEnv" | "name">): string {
  const key = process.env[channel.apiKeyEnv];
  if (!key) {
    throw new Error(
      `Thiếu API key cho kênh "${channel.name}": chưa đặt biến môi trường ${channel.apiKeyEnv} trong .env`,
    );
  }
  return key;
}
