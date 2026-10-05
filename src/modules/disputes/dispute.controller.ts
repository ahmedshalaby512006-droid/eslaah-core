import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient, ComplaintAuthorRole } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createDisputeSchema = z.object({
  requestId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  category: z.string().max(64),
  description: z.string().min(5).max(2000),
});

export async function createDisputeHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = createDisputeSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  const { requestId, targetUserId, category, description } = result.data;
  const userId = request.user.id;
  const userRole = request.user.role;

  const reqRecord = await prisma.assistanceRequest.findUnique({
    where: { id: requestId },
    include: { technician: true }
  });

  if (!reqRecord) {
    return reply.status(404).send({ message: 'Request not found' });
  }

  // Authorization check: Verify caller belongs to this request and targetUserId is the counterpart
  if (userRole === 'CUSTOMER') {
    if (reqRecord.customerId !== userId) {
      return reply.status(403).send({ message: 'You are not the customer of this request' });
    }
    if (!reqRecord.technician || reqRecord.technician.userId !== targetUserId) {
      return reply.status(400).send({ message: 'Target user is not the technician assigned to this request' });
    }
  } else if (userRole === 'TECHNICIAN') {
    if (!reqRecord.technician || reqRecord.technician.userId !== userId) {
      return reply.status(403).send({ message: 'You are not the technician assigned to this request' });
    }
    if (reqRecord.customerId !== targetUserId) {
      return reply.status(400).send({ message: 'Target user is not the customer of this request' });
    }
  } else if (userRole !== 'ADMIN') {
    return reply.status(403).send({ message: 'Unauthorized' });
  }

  const authorRole: ComplaintAuthorRole = userRole === 'CUSTOMER' ? 'CUSTOMER' : 'TECHNICIAN';

  const dispute = await prisma.dispute.create({
    data: {
      requestId,
      authorId: userId,
      targetUserId,
      authorRole,
      category,
      description,
      status: 'PENDING',
    },
  });

  return reply.status(201).send(dispute);
}