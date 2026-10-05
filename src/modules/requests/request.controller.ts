import { getIO } from '../../server';
import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createAssistanceRequestSchema, updateRequestStatusSchema } from './request.schema';

async function extractCoordinates(input: string): Promise<{ lat: number; lng: number } | null> {
  const directMatch = input.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (directMatch) {
    return { lat: parseFloat(directMatch[1]), lng: parseFloat(directMatch[2]) };
  }

  if (input.includes('http')) {
    try {
      const res = await fetch(input, { method: 'HEAD', redirect: 'follow' });
      const finalUrl = res.url;
      const urlMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || finalUrl.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (urlMatch) {
        return { lat: parseFloat(urlMatch[1]), lng: parseFloat(urlMatch[2]) };
      }
    } catch (e) {
      console.error('Error resolving map url:', e);
    }
  }
  return null;
}

const prisma = new PrismaClient();

export async function createRequestHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = createAssistanceRequestSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  // Prevent multiple active requests for the same customer
  const existingActive = await prisma.assistanceRequest.findFirst({
    where: {
      customerId: request.user.id,
      OR: [
        { status: { in: ['QUEUED', 'DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
        { status: 'COMPLETED', rating: null }
      ],
    },
  });

  if (existingActive) {
    return reply.status(400).send({ message: 'You already have an active request in progress.' });
  }

  const { latitude, longitude, vehicleType, malfunctionCategory, addressDescription } = result.data as any;

  const coords = await extractCoordinates(addressDescription || '');
  const lat = latitude ?? coords?.lat ?? 31.04;
  const lng = longitude ?? coords?.lng ?? 30.47;

  const [newRequest]: any = await prisma.$queryRaw`
    INSERT INTO "assistance_requests" (
      "id",
      "customer_id",
      "vehicle_type",
      "malfunction_category",
      "address_description",
      "status",
      "pickup_location",
      "created_at"
    ) VALUES (
      gen_random_uuid(),
      ${request.user.id}::uuid,
      ${vehicleType}::"VehicleType",
      ${malfunctionCategory}::"MalfunctionCategory",
      ${addressDescription},
      'QUEUED'::"RequestStatus",
      ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326),
      NOW()
    )
    RETURNING 
      "id", 
      "customer_id" AS "customerId", 
      "vehicle_type" AS "vehicleType", 
      "malfunction_category" AS "malfunctionCategory", 
      "address_description" AS "addressDescription", 
      "status", 
      "created_at" AS "createdAt";
  `;

  getIO()?.emit('data_updated');
  return reply.status(201).send({ ...newRequest, offers: [] });
}

export async function getQueuedRequestsHandler(request: FastifyRequest, reply: FastifyReply) {
  const techProfile = await prisma.technicianProfile.findUnique({
    where: { userId: request.user.id }
  });

  const hasVehicleFilter = techProfile?.vehicleSpecialties && techProfile.vehicleSpecialties.length > 0;
  const hasMalfunctionFilter = techProfile?.malfunctionSpecialties && techProfile.malfunctionSpecialties.length > 0;

  const list = await prisma.assistanceRequest.findMany({
    where: { 
      status: 'QUEUED',
      ...(hasVehicleFilter ? { vehicleType: { in: techProfile.vehicleSpecialties } } : {}),
      ...(hasMalfunctionFilter ? { malfunctionCategory: { in: techProfile.malfunctionSpecialties } } : {})
    },
    orderBy: { createdAt: 'desc' },
    include: {
      offers: {
        include: {
          technician: {
            include: {
              user: { select: { fullName: true, phoneNumber: true, email: true } }
            }
          }
        }
      }
    }
  });
  return reply.status(200).send(list);
}

export async function getActiveTechnicianRequestHandler(request: FastifyRequest, reply: FastifyReply) {
  const techProfile = await prisma.technicianProfile.findUnique({
    where: { userId: request.user.id }
  });
  
  if (!techProfile) return reply.send(null);

  const activeReq = await prisma.assistanceRequest.findFirst({
    where: {
      technicianId: techProfile.id,
      status: { in: ['DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { fullName: true, phoneNumber: true } },
    },
  });

  return reply.send(activeReq || null);
}

export async function getActiveCustomerRequestHandler(request: FastifyRequest, reply: FastifyReply) {
  const activeReq = await prisma.assistanceRequest.findFirst({
    where: {
      customerId: request.user.id,
      OR: [
        { status: { in: ['QUEUED', 'DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
        { status: 'COMPLETED', rating: null }
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      technician: {
        include: {
          user: { select: { fullName: true, phoneNumber: true, email: true } }
        }
      },
      offers: {
        include: {
          technician: {
            include: {
              user: { select: { fullName: true, phoneNumber: true, email: true } }
            }
          }
        }
      }
    },
  });

  return reply.send(activeReq || null);
}

export async function acceptRequestHandler(request: any, reply: any) {
  const { id } = request.params;
  const userId = request.user.id;

  let techProfile = await prisma.technicianProfile.findUnique({
    where: { userId },
  });

  if (!techProfile) {
    techProfile = await prisma.technicianProfile.create({
      data: { userId, isOnline: true },
    });
  }

  const req = await prisma.assistanceRequest.findUnique({ where: { id } });
  if (!req || req.status !== 'QUEUED') {
    return reply.status(409).send({ message: 'Request is no longer available or already accepted.' });
  }

  try {
    const existingOffer = await prisma.requestOffer.findUnique({
      where: { requestId_technicianId: { requestId: id, technicianId: techProfile.id } }
    });

    if (existingOffer) {
      return reply.status(400).send({ message: 'You already sent an offer for this request.' });
    }

    await prisma.requestOffer.create({
      data: {
        requestId: id,
        technicianId: techProfile.id
      }
    });

    getIO()?.emit('data_updated');
    getIO()?.emit('offer_received', { customerId: req.customerId, technicianId: techProfile.id });
    return reply.status(200).send({ success: true, message: 'Offer sent' });
  } catch (e: any) {
    return reply.status(400).send({ message: e.message || 'Error sending offer' });
  }
}

export async function acceptTechnicianOfferHandler(request: any, reply: any) {
  const { id } = request.params;
  const { technicianId } = request.body;
  const customerId = request.user.id;
  
  const updated = await prisma.assistanceRequest.updateMany({
    where: { id, customerId, status: 'QUEUED' },
    data: { status: 'ACCEPTED', technicianId, acceptedAt: new Date() }
  });

  if (updated.count === 0) {
    return reply.status(400).send({ message: 'Request not found or already accepted.' });
  }

  // Delete all offers for this request since one was accepted
  await prisma.requestOffer.deleteMany({ where: { requestId: id } });

  getIO()?.emit('data_updated');
  getIO()?.emit('request_accepted', { customerId, technicianId });
  return reply.send({ success: true });
}

export async function rejectTechnicianOfferHandler(request: any, reply: any) {
  const { id } = request.params;
  const { technicianId } = request.body;
  
  await prisma.requestOffer.deleteMany({
    where: { requestId: id, technicianId }
  });

  getIO()?.emit('data_updated');
  return reply.send({ success: true });
}

export async function updateStatusHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  const result = updateRequestStatusSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  const dataToUpdate: any = { status: result.data.status };
  if (result.data.status === 'COMPLETED') {
    dataToUpdate.completedAt = new Date();
  }

  const updated = await prisma.assistanceRequest.update({
    where: { id },
    data: dataToUpdate,
  });

  if (result.data.status === 'COMPLETED' && updated.technicianId) {
    await prisma.technicianProfile.update({
      where: { id: updated.technicianId },
      data: { totalCompletedJobs: { increment: 1 } }
    });
  }

  getIO()?.emit('data_updated');
  getIO()?.emit('status_changed', { requestId: id, status: result.data.status });
  return reply.status(200).send(updated);
}

export async function cancelCustomerRequestHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  const customerId = request.user.id;

  const updated = await prisma.assistanceRequest.updateMany({
    where: {
      id,
      customerId,
      status: 'QUEUED',
    },
    data: {
      status: 'CANCELLED',
    },
  });

  if (updated.count === 0) {
    return reply.status(409).send({ message: 'Cannot cancel request: already accepted by technician or completed.' });
  }

  // Delete offers
  await prisma.requestOffer.deleteMany({ where: { requestId: id } });

  getIO()?.emit('data_updated');
  return reply.status(200).send({ message: 'Request cancelled successfully.' });
}

export async function getMessagesHandler(req: any, reply: any) {
  const messages = await prisma.message.findMany({
    where: { requestId: req.params.requestId },
    orderBy: { createdAt: 'asc' },
  });
  return reply.send(messages);
}

export async function sendMessageHandler(req: any, reply: any) {
  const msg = await prisma.message.create({
    data: {
      requestId: req.params.requestId,
      senderId: req.user.id,
      senderRole: req.user.role,
      text: req.body.text,
    },
  });
  getIO()?.emit('data_updated');
  return reply.status(201).send(msg);
}

export async function getAllRequestsHandler(request: FastifyRequest, reply: FastifyReply) {
  const requests = await prisma.assistanceRequest.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { fullName: true, phoneNumber: true } },
      technician: { include: { user: { select: { fullName: true, phoneNumber: true } } } },
      offers: { include: { technician: { include: { user: true } } } }
    }
  });
  return reply.send(requests);
}

export async function getTechnicianProfileHandler(request: any, reply: any) {
  const { techId } = request.params;
  const tech = await prisma.technicianProfile.findUnique({
    where: { id: techId },
    include: {
      user: { select: { fullName: true, phoneNumber: true, email: true } }
    }
  });
  if (!tech) return reply.status(404).send({ message: 'Not found' });

  const reviews = await prisma.rating.findMany({
    where: {
      request: {
        technicianId: techId,
      },
    },
    include: {
      request: {
        select: {
          customer: { select: { fullName: true } },
          vehicleType: true,
          malfunctionCategory: true,
          completedAt: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
  });

  return reply.send({
    ...tech,
    reviews,
    totalReviews: reviews.length,
  });
}

export async function getMyHistoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.id;
  const role = request.user.role;
  let requests;

  if (role === 'CUSTOMER') {
    requests = await prisma.assistanceRequest.findMany({
      where: { customerId: userId },
      include: { technician: { include: { user: true } }, rating: true },
      orderBy: { createdAt: 'desc' }
    });
  } else {
    const tech = await prisma.technicianProfile.findUnique({ where: { userId } });
    if (!tech) return reply.status(404).send({ message: 'Tech profile not found' });
    requests = await prisma.assistanceRequest.findMany({
      where: { technicianId: tech.id },
      include: { customer: true, rating: true },
      orderBy: { createdAt: 'desc' }
    });
  }
  return reply.send(requests);
}
