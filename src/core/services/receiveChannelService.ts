import { prisma } from "@core/db/prisma";
import type {
  CreateReceiveChannelInput,
  UpdateReceiveChannelInput,
} from "@core/validation/receiveChannel.schema";

export function listReceiveChannels() {
  return prisma.receiveChannel.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { inboundMessages: true } } },
  });
}

export function createReceiveChannel(input: CreateReceiveChannelInput) {
  return prisma.receiveChannel.create({
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

export function updateReceiveChannel(id: string, input: UpdateReceiveChannelInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.accountId !== undefined) data.accountId = input.accountId;
  if (input.apiKeyEnv !== undefined) data.apiKeyEnv = input.apiKeyEnv;
  if (input.note !== undefined) data.note = input.note;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return prisma.receiveChannel.update({ where: { id: BigInt(id) }, data });
}

// Xóa kênh nhận: gỡ liên kết ở tin đã nhận (đặt receiveChannelId=null) rồi xóa.
export async function deleteReceiveChannel(id: string) {
  const cid = BigInt(id);
  await prisma.$transaction([
    prisma.inboundMessage.updateMany({ where: { receiveChannelId: cid }, data: { receiveChannelId: null } }),
    prisma.receiveChannel.delete({ where: { id: cid } }),
  ]);
  return { ok: true };
}

// Tra kênh nhận theo (type, accountId) — webhook dùng để gắn tin về đúng kênh.
// Chỉ khớp kênh đang bật. Không thấy -> null (tin vẫn lưu, chỉ không gắn kênh).
export async function findReceiveChannelId(type: string, accountId: string): Promise<bigint | null> {
  if (!accountId) return null;
  const ch = await prisma.receiveChannel.findFirst({
    where: { type: type.toUpperCase(), accountId, isActive: true },
    select: { id: true },
  });
  return ch?.id ?? null;
}
