import fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import fastifyJwt from '@fastify/jwt';
import { authRoutes } from './modules/auth/auth.routes';
dotenv.config();
import { requestRoutes } from './modules/requests/request.routes';
import { ratingRoutes } from './modules/ratings/rating.routes';
import { disputeRoutes } from './modules/disputes/dispute.routes';



const app = fastify({ logger: true });
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || '');

app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
app.register(sensible);
app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'fallback-secret-key-change-it',
});

app.register(authRoutes, { prefix: '/api/v1/auth' });

// التسجيل مع باقي الـ Plugins
app.register(requestRoutes, { prefix: '/api/v1/requests' });
app.register(ratingRoutes, { prefix: '/api/v1/ratings' });
app.register(disputeRoutes, { prefix: '/api/v1/disputes' });

app.get('/health', async () => {
  const redisPing = await redis.ping();
  return {
    status: 'ok',
    services: {
      server: 'healthy',
      redis: redisPing === 'PONG' ? 'connected' : 'disconnected',
      database: 'connected'
    },
    timestamp: new Date().toISOString()
  };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Eslaah Core running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
