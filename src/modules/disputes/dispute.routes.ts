import { FastifyInstance } from 'fastify';
import { createDisputeHandler } from './dispute.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';

export async function disputeRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: [authenticate] }, createDisputeHandler);
}