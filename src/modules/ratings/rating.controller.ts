import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createRatingSchema = z.object({
  requestId: z.string().uuid(),
  qualityScore: z.number().int().min(1).max(5),
  priceFairnessScore: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export async function createRatingHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = createRatingSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  const requestRecord = await prisma.assistanceRequest.findUnique({
    where: { id: result.data.requestId },
  });

  if (!requestRecord || requestRecord.customerId !== request.user.id) {
    return reply.status(403).send({ message: 'Unauthorized to rate this request' });
  }

  const rating = await prisma.rating.create({
    data: {
      requestId: result.data.requestId,
      qualityScore: result.data.qualityScore,
      priceFairnessScore: result.data.priceFairnessScore,
      comment: result.data.comment,
    },
  });

  return reply.status(201).send(rating);
}