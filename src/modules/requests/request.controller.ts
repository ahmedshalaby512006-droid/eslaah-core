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

 // تأكد أن result.data تحتوي على latitude و longitude
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

return reply.status(201).send(newRequest);

  return reply.status(201).send(newRequest);
}

export async function getQueuedRequestsHandler(request: FastifyRequest, reply: FastifyReply) {
  const list = await prisma.assistanceRequest.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'desc' },
  });
  return reply.status(200).send(list);
}

export async function getActiveCustomerRequestHandler(request: FastifyRequest, reply: FastifyReply) {
  const activeReq = await prisma.assistanceRequest.findFirst({
    where: {
      customerId: request.user.id,
      status: { in: ['QUEUED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
    },
    orderBy: { createdAt: 'desc' },
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
      data: {
        userId,
        isOnline: true,
      },
    });
  }

  const updated = await prisma.assistanceRequest.updateMany({
    where: {
      id,
      status: 'QUEUED',
    },
    data: {
      status: 'ACCEPTED',
      technicianId: techProfile.id,
      acceptedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    return reply.status(409).send({ message: 'عذراً، تم إلغاء هذا الطلب من قبل العميل.' });
  }

  const job = await prisma.assistanceRequest.findUnique({
    where: { id },
  });

  return reply.status(200).send(job);
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

  return reply.status(200).send(updated);
}

export async function cancelCustomerRequestHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  const customerId = request.user.id;

  // تحديث ذري: لن ينجح إلا إذا كان الطلب ما زال QUEUED
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
    return reply.status(409).send({ message: 'لا يمكن إلغاء الطلب، لقد تم قبوله بالفعل من فني أو تم إنهاؤه.' });
  }

  return reply.status(200).send({ message: 'تم إلغاء الطلب بنجاح' });
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
  return reply.status(201).send(msg);
}