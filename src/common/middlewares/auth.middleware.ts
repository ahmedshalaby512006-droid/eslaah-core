import { FastifyReply, FastifyRequest } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await request.jwtVerify() as any;
    // Avoid instantiating PrismaClient on every request
    const { PrismaClient } = require('@prisma/client');
    const prisma = (globalThis as any).prisma || new PrismaClient();
    (globalThis as any).prisma = prisma;
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.isBanned) {
      return reply.status(403).send({ message: 'Account is banned' });
    }
    request.user = user;
  } catch (err) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or missing access token',
    });
  }
}