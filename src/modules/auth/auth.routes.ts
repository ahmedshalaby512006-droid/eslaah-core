import { FastifyInstance } from 'fastify';
import { registerHandler, loginHandler, getMeHandler } from './auth.controller';
import { authenticate } from '../../common/middlewares/auth.middleware';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', registerHandler);
  fastify.post('/login', loginHandler);
  fastify.get('/me', { preHandler: [authenticate] }, getMeHandler);
}