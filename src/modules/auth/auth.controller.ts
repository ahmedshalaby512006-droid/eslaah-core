import { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { registerSchema, loginSchema } from './auth.schema';

const prisma = new PrismaClient();

export async function registerHandler(request: FastifyRequest, reply: FastifyReply) {
  const parseResult = registerSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: parseResult.error.issues[0].message,
    });
  }

  const { email, password, fullName, phoneNumber, nationalId, role } = parseResult.data;

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { phoneNumber }],
    },
  });

  if (existingUser) {
    return reply.status(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: 'Email or phone number already in use',
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      phoneNumber,
      nationalId,
      role: role ?? 'CUSTOMER',
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      role: true,
      createdAt: true,
    },
  });

  return reply.status(201).send(user);
}

export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const parseResult = loginSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: parseResult.error.issues[0].message,
    });
  }

  const { email, password } = parseResult.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid credentials',
    });
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid credentials',
    });
  }

  const token = request.server.jwt.sign(
    { id: user.id, email: user.email, role: user.role as 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN' },
    { expiresIn: '7d' }
  );

  return reply.status(200).send({
    accessToken: token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
  });
}

export async function getMeHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'User profile not found',
    });
  }

  return reply.status(200).send(user);
}