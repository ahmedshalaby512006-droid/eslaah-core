import { getIO } from '../../server';
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

  const { phoneNumber, password } = parseResult.data;

  const user = await prisma.user.findUnique({ where: { phoneNumber } });
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

  if (user.isBanned) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Account is suspended / تم حظر هذا الحساب من قبل الإدارة',
    });
  }

  const token = request.server.jwt.sign(
    { id: user.id, email: user.email, role: user.role as 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN' },
    { expiresIn: '7d' }
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { isOnline: true }
  }); 
  getIO()?.emit('data_updated');

  if (user.role === 'TECHNICIAN') {
    await prisma.technicianProfile.updateMany({
      where: { userId: user.id },
      data: { isOnline: true }
    }); 
    getIO()?.emit('data_updated');
  }

  return reply.status(200).send({
    accessToken: token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
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

export async function updateProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.id;
  const { fullName, phoneNumber, nationalId, password } = request.body as any;
  let dataToUpdate: any = {
    ...(fullName && { fullName }),
    ...(phoneNumber && { phoneNumber }),
    ...(nationalId && { nationalId }),
  };
  
  if (password) {
    dataToUpdate.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: dataToUpdate,
    select: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      nationalId: true,
      role: true,
    },
  });

  return reply.status(200).send(user);
}

export async function toggleOnlineStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { isOnline } = request.body as any;
  const user = request.user;
  
  if (user.role !== 'TECHNICIAN') return reply.status(403).send({ message: 'Only technicians can toggle online status' });
  
  const tech = await prisma.technicianProfile.findUnique({ where: { userId: user.id } });
  if (!tech) return reply.status(404).send({ message: 'Profile not found' });
  
  const updated = await prisma.technicianProfile.update({
    where: { id: tech.id },
    data: { isOnline }
  });
  
  return reply.send(updated);
}

export async function verifyPasswordHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.id;
  const { password } = request.body as any;
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.status(404).send({ message: 'User not found' });
  
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return reply.status(401).send({ message: 'Invalid password' });
  
  return reply.send({ success: true });
}

export async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = request.user?.id;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: false }
      }); 
      getIO()?.emit('data_updated');
      
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (user?.role === 'TECHNICIAN') {
         await prisma.technicianProfile.updateMany({
           where: { userId },
           data: { isOnline: false }
         }); 
         getIO()?.emit('data_updated');
      }
    }
  } catch (err) {}
  return reply.send({ success: true });
}

export async function pingHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = request.user?.id;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeen: new Date(), isOnline: true }
      });
      if (request.user?.role === 'TECHNICIAN') {
        await prisma.technicianProfile.updateMany({
          where: { userId },
          data: { isOnline: true }
        }); 
        getIO()?.emit('data_updated');
      }
    }
  } catch (err) {}
  return reply.send({ success: true });
}

const VALID_VEHICLES = ['SEDAN', 'SUV', 'MOTORCYCLE', 'HEAVY_TRUCK', 'BUS'];
const VALID_MALFUNCTIONS = ['ELECTRICAL', 'MECHANICAL', 'TIRE_AND_WHEEL', 'BODY_AND_CHASSIS', 'BATTERY_JUMP', 'TOWING'];

export async function updateTechProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const data: any = request.body;
  const userId = request.user.id;
  
  let profile = await prisma.technicianProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.technicianProfile.create({ data: { userId } });
  }

  const vehicleSpecialties = Array.isArray(data.vehicleSpecialties) 
    ? data.vehicleSpecialties.filter((v: string) => VALID_VEHICLES.includes(v))
    : [];
  const malfunctionSpecialties = Array.isArray(data.malfunctionSpecialties)
    ? data.malfunctionSpecialties.filter((m: string) => VALID_MALFUNCTIONS.includes(m))
    : [];

  const updated = await prisma.technicianProfile.update({
    where: { id: profile.id },
    data: {
      vehicleSpecialties,
      malfunctionSpecialties,
      workplace: typeof data.workplace === 'string' ? data.workplace : null,
      hasTools: data.hasTools !== undefined ? Boolean(data.hasTools) : true,
      careerExperience: typeof data.careerExperience === 'string' ? data.careerExperience : null,
    },
    include: {
      user: { select: { fullName: true, phoneNumber: true, email: true } }
    }
  });

  getIO()?.emit('data_updated');
  return reply.send(updated);
}

export async function getTechProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.id;
  let profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    include: {
      user: { select: { fullName: true, phoneNumber: true, email: true } }
    }
  });
  if (!profile) {
    profile = await prisma.technicianProfile.create({
      data: { userId },
      include: {
        user: { select: { fullName: true, phoneNumber: true, email: true } }
      }
    });
  }
  return reply.send(profile);
}
