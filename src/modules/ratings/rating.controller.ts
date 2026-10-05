import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getIO } from '../../server';

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

  if (requestRecord.technicianId) {
    const agg = await prisma.rating.aggregate({
      where: { request: { technicianId: requestRecord.technicianId } },
      _avg: { qualityScore: true, priceFairnessScore: true }
    });
    
    await prisma.technicianProfile.update({
      where: { id: requestRecord.technicianId },
      data: {
        averageQualityRating: agg._avg.qualityScore || 5,
        averagePriceRating: agg._avg.priceFairnessScore || 5,
      }
    });
  }

  getIO()?.emit('data_updated');
  return reply.status(201).send(rating);
}
