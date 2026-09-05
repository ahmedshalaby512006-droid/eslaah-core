import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient, ComplaintAuthorRole } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createDisputeSchema = z.object({
  requestId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  category: z.string().max(64),
  description: z.string(),
});

export async function createDisputeHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = createDisputeSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  const authorRole: ComplaintAuthorRole = request.user.role === 'CUSTOMER' ? 'CUSTOMER' : 'TECHNICIAN';

  const dispute = await prisma.dispute.create({
    data: {
      requestId: result.data.requestId,
      authorId: request.user.id,
      targetUserId: result.data.targetUserId,
      authorRole,
      category: result.data.category,
      description: result.data.description,
      status: 'PENDING',
    },
  });

  return reply.status(201).send(dispute);
}