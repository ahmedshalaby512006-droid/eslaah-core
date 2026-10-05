import { FastifyInstance } from 'fastify';
import {
  createRequestHandler,
  getQueuedRequestsHandler,
  acceptRequestHandler,
  updateStatusHandler,
  getActiveCustomerRequestHandler,
  getActiveTechnicianRequestHandler,
  cancelCustomerRequestHandler,
  technicianCancelJobHandler,
  getMessagesHandler,
  sendMessageHandler,
  getAllRequestsHandler,
  acceptTechnicianOfferHandler,
  rejectTechnicianOfferHandler,
  getTechnicianProfileHandler,
} from './request.controller';
import { getMyHistoryHandler } from './request.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { authorizeRoles } from '../../common/middlewares/roles.middleware';

export async function requestRoutes(fastify: FastifyInstance) {
  fastify.get('/my-history', { preHandler: [authenticate as any] }, getMyHistoryHandler);
  fastify.get('/all', { preHandler: [authenticate as any, authorizeRoles('ADMIN') as any] }, getAllRequestsHandler);
  fastify.post('/', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, createRequestHandler);
  fastify.get('/active', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, getActiveCustomerRequestHandler);
  fastify.get('/tech-active', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, getActiveTechnicianRequestHandler);
  fastify.get('/queued', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, getQueuedRequestsHandler);
  fastify.patch('/:id/accept', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, acceptRequestHandler);
  fastify.patch('/:id/customer-accept', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, acceptTechnicianOfferHandler);
  fastify.patch('/:id/customer-reject', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, rejectTechnicianOfferHandler);
  fastify.get('/technician/:techId', { preHandler: [authenticate as any] }, getTechnicianProfileHandler);
  fastify.patch('/:id/status', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, updateStatusHandler);
  fastify.patch('/:id/cancel', { preHandler: [authenticate as any, authorizeRoles('CUSTOMER') as any] }, cancelCustomerRequestHandler);
  fastify.patch('/:id/tech-cancel', { preHandler: [authenticate as any, authorizeRoles('TECHNICIAN', 'ENGINEER') as any] }, technicianCancelJobHandler);
  fastify.get('/:requestId/messages', { preHandler: [authenticate as any] }, getMessagesHandler);
  fastify.post('/:requestId/messages', { preHandler: [authenticate as any] }, sendMessageHandler);
}