import { FastifyInstance } from 'fastify';
import { getAdminStatsHandler, getAdminUsersHandler, toggleBanUserHandler, getUserRequestsHandler } from './admin.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { authorizeRoles } from '../../common/middlewares/roles.middleware';

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.get('/stats', { preHandler: [authenticate as any, authorizeRoles('ADMIN') as any] }, getAdminStatsHandler);
  fastify.get('/users', { preHandler: [authenticate as any, authorizeRoles('ADMIN') as any] }, getAdminUsersHandler);
  fastify.patch('/users/:id/ban', { preHandler: [authenticate as any, authorizeRoles('ADMIN') as any] }, toggleBanUserHandler);
  fastify.get('/users/:id/requests', { preHandler: [authenticate as any, authorizeRoles('ADMIN') as any] }, getUserRequestsHandler);
}
