import { getIO } from '../../server';
import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getAdminStatsHandler(req: FastifyRequest, reply: FastifyReply) {
  const totalRequests = await prisma.assistanceRequest.count();
  const completed = await prisma.assistanceRequest.count({ where: { status: 'COMPLETED' } });
  const cancelled = await prisma.assistanceRequest.count({ where: { status: 'CANCELLED' } });
  const inProgress = await prisma.assistanceRequest.count({ where: { status: 'IN_PROGRESS' } });
  const dispatched = await prisma.assistanceRequest.count({ where: { status: 'DISPATCHING' } });
  const queued = await prisma.assistanceRequest.count({ where: { status: 'QUEUED' } });
  const arrived = await prisma.assistanceRequest.count({ where: { status: 'ARRIVED' } });

  const customers = await prisma.user.count({ where: { role: 'CUSTOMER' } });
  const technicians = await prisma.user.count({ where: { role: 'TECHNICIAN' } });

  const onlineTechs = await prisma.technicianProfile.count({ where: { isOnline: true } });
  
  return reply.send({
    requests: { total: totalRequests, completed, cancelled, inProgress, dispatched, queued, arrived },
    users: { customers, technicians, onlineTechs, offlineTechs: technicians - onlineTechs }
  });
}

export async function getAdminUsersHandler(req: any, reply: FastifyReply) {
  const { role } = req.query as any;
  const users = await prisma.user.findMany({
    where: role ? { role } : undefined,
    select: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      nationalId: true,
      role: true,
      isBanned: true,
      isOnline: true,
      lastSeen: true,
      createdAt: true,
      technicianProfile: true,
    },
    orderBy: { createdAt: 'desc' }
  });
  return reply.send(users);
}

export async function toggleBanUserHandler(req: any, reply: FastifyReply) {
  const { id } = req.params;
  if (id === req.user?.id) {
    return reply.status(400).send({ message: 'Cannot ban your own account' });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return reply.status(404).send({ message: 'User not found' });
  
  const updated = await prisma.user.update({
    where: { id },
    data: { isBanned: !user.isBanned },
    select: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      nationalId: true,
      role: true,
      isBanned: true,
      isOnline: true,
      lastSeen: true,
      createdAt: true,
    }
  });
  getIO()?.emit('data_updated');
  return reply.send(updated);
}

export async function getUserRequestsHandler(req: any, reply: FastifyReply) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id }, include: { technicianProfile: true } });
  if (!user) return reply.status(404).send({ message: 'User not found' });

  let requests: any[] = [];
  if (user.role === 'CUSTOMER') {
    requests = await prisma.assistanceRequest.findMany({
      where: { customerId: id },
      include: {
        technician: { include: { user: { select: { fullName: true, phoneNumber: true } } } },
        rating: true
      },
      orderBy: { createdAt: 'desc' }
    });
  } else {
    if (!user.technicianProfile?.id) {
      requests = [];
    } else {
      requests = await prisma.assistanceRequest.findMany({
        where: { technicianId: user.technicianProfile.id },
        include: {
          customer: { select: { fullName: true, phoneNumber: true } },
          rating: true
        },
        orderBy: { createdAt: 'desc' }
      });
    }
  }
  return reply.send(requests);
}
