import { FastifyInstance } from 'fastify';
import {
  createEmergencyIncidentHandler,
  getActiveIncidentsHandler,
  updateIncidentStatusHandler,
} from './emergency.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';

export async function emergencyRoutes(fastify: FastifyInstance) {
  // Trigger SOS incident (authenticated)
  fastify.post('/sos', { preHandler: [authenticate as any] }, createEmergencyIncidentHandler);

  // Get active incidents for live emergency feeds
  fastify.get('/active', { preHandler: [authenticate as any] }, getActiveIncidentsHandler);

  // Update incident status (e.g., responder marks VERIFIED or RESOLVED)
  fastify.patch('/:id/status', { preHandler: [authenticate as any] }, updateIncidentStatusHandler);
}
