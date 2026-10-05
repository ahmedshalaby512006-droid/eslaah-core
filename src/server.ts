import { Server as SocketIOServer } from 'socket.io';
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
import { adminRoutes } from './modules/admin/admin.routes';

const app = fastify({ logger: true });
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || '');

app.register(cors, {
  origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
app.register(sensible);
app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'fallback-secret-key-change-it',
});

app.register(authRoutes, { prefix: '/api/v1/auth' });
app.register(requestRoutes, { prefix: '/api/v1/requests' });
app.register(ratingRoutes, { prefix: '/api/v1/ratings' });
app.register(disputeRoutes, { prefix: '/api/v1/disputes' });
app.register(adminRoutes, { prefix: '/api/v1/admin' });

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

let io: SocketIOServer | undefined;
export const getIO = () => io;

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.ready();
    io = new SocketIOServer(app.server, {
      cors: {
        origin: 'http://localhost:5173',
        credentials: true
      }
    });

    io.on('connection', (socket) => {
      console.log('Socket client connected:', socket.id);
      socket.on('disconnect', () => {
        console.log('Socket client disconnected:', socket.id);
      });
    });

    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Eslaah Core running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
