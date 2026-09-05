import { FastifyInstance } from 'fastify';
import { createRatingHandler } from './rating.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { authorizeRoles } from '../../common/middlewares/roles.middleware';

export async function ratingRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: [authenticate, authorizeRoles('CUSTOMER')] }, createRatingHandler);
}