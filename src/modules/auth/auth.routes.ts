import { FastifyInstance } from 'fastify';
import { registerHandler, loginHandler, getMeHandler, updateProfileHandler, toggleOnlineStatusHandler, verifyPasswordHandler, logoutHandler, pingHandler , updateTechProfileHandler, getTechProfileHandler } from './auth.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/tech-profile', { preHandler: [authenticate as any] }, getTechProfileHandler);
  fastify.patch('/tech-profile', { preHandler: [authenticate as any] }, updateTechProfileHandler);
  fastify.patch('/online', { preHandler: [authenticate as any] }, toggleOnlineStatusHandler);
  fastify.post('/register', registerHandler);
  fastify.post('/login', loginHandler);
  fastify.post('/logout', { preHandler: [authenticate] }, logoutHandler);
  fastify.post('/ping', { preHandler: [authenticate] }, pingHandler);
  fastify.get('/me', { preHandler: [authenticate] }, getMeHandler);
  fastify.put('/profile', { preHandler: [authenticate] }, updateProfileHandler);
  fastify.post('/verify-password', { preHandler: [authenticate] }, verifyPasswordHandler);
}