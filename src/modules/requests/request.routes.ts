import { FastifyInstance } from 'fastify';
import {
  createRequestHandler,
  getQueuedRequestsHandler,
  acceptRequestHandler,
  updateStatusHandler,
  getActiveCustomerRequestHandler,
  cancelCustomerRequestHandler,
  getMessagesHandler,
sendMessageHandler,
} from './request.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { authorizeRoles } from '../../common/middlewares/roles.middleware';

export async function requestRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, createRequestHandler);
  fastify.get('/active', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, getActiveCustomerRequestHandler);
  fastify.get('/queued', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, getQueuedRequestsHandler);
  fastify.patch('/:id/accept', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, acceptRequestHandler);
  fastify.patch('/:id/status', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, updateStatusHandler);
  fastify.patch('/:id/cancel', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, cancelCustomerRequestHandler);
  fastify.get('/:requestId/messages', { preHandler: [authenticate as any] }, getMessagesHandler);
  fastify.post('/:requestId/messages', { preHandler: [authenticate as any] }, sendMessageHandler);

}