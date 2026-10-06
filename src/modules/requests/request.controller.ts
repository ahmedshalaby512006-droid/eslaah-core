import { getIO } from '../../server';
import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createAssistanceRequestSchema, updateRequestStatusSchema } from './request.schema';
import { sendPushToUser } from '../../common/services/notification.service';

async function extractCoordinates(input: string): Promise<{ lat: number; lng: number } | null> {
  if (!input || typeof input !== 'string') return null;

  // 1. Direct coordinate format: "lat, lng"
  const directMatch = input.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (directMatch) {
    const lat = parseFloat(directMatch[1]);
    const lng = parseFloat(directMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  // 2. Query parameters or path in URL without outbound network requests
  const urlCoordMatch = input.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || 
                        input.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                        input.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (urlCoordMatch) {
    const lat = parseFloat(urlCoordMatch[1]);
    const lng = parseFloat(urlCoordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  // 3. For shortened links (e.g., maps.app.goo.gl, goo.gl), perform strict allowlisted resolution to prevent SSRF
  if (input.includes('http://') || input.includes('https://')) {
    try {
      const parsedUrl = new URL(input.trim());
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return null;
      }

      const allowedHosts = [
        'maps.google.com',
        'www.google.com',
        'google.com',
        'maps.app.goo.gl',
        'goo.gl',
      ];
      const host = parsedUrl.hostname.toLowerCase();
      const isAllowed = allowedHosts.some(allowed => host === allowed || host.endsWith('.' + allowed));
      if (!isAllowed) {
        return null;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(parsedUrl.toString(), {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeout);

      const finalUrl = res.url;
      const resolvedMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || 
                            finalUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                            finalUrl.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (resolvedMatch) {
        const lat = parseFloat(resolvedMatch[1]);
        const lng = parseFloat(resolvedMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          return { lat, lng };
        }
      }
    } catch {
      // Safe fallback on network failure or abort
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

  // Push notifications to eligible/online technicians
  try {
    const techProfiles = await prisma.technicianProfile.findMany({
      where: { isOnline: true },
      select: { userId: true, vehicleSpecialties: true, malfunctionSpecialties: true },
      take: 50,
    });
    
    for (const tp of techProfiles) {
      const matchVehicle = !tp.vehicleSpecialties?.length || tp.vehicleSpecialties.includes(vehicleType);
      const matchMalfunc = !tp.malfunctionSpecialties?.length || tp.malfunctionSpecialties.includes(malfunctionCategory);
      if (matchVehicle && matchMalfunc) {
        sendPushToUser(tp.userId, {
          title: '🚗 طلب صيانة جديد متاح الآن!',
          body: `يوجد طلب صيانة سيارة جديد (${malfunctionCategory}). اضغط لتقديم عرضك.`,
          url: '/tech/dashboard',
          tag: `new-req-${newRequest.id}`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Error sending tech push notifications:', err);
  }

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

  if (!activeReq) return reply.send(null);

  // If request is QUEUED, filter out technicians who are currently busy with another active job
  if (activeReq.status === 'QUEUED' && activeReq.offers && activeReq.offers.length > 0) {
    const candidateTechIds = activeReq.offers.map((o: any) => o.technicianId);
    const busyJobs = await prisma.assistanceRequest.findMany({
      where: {
        technicianId: { in: candidateTechIds },
        status: { in: ['DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
      },
      select: { technicianId: true }
    });
    const busyTechIdSet = new Set(busyJobs.map((b: any) => b.technicianId));

    activeReq.offers = activeReq.offers.filter((o: any) => !busyTechIdSet.has(o.technicianId));
  }

  return reply.send(activeReq);
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

  // Prevent sending offers if technician currently has an active job
  const activeJob = await prisma.assistanceRequest.findFirst({
    where: {
      technicianId: techProfile.id,
      status: { in: ['DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
    }
  });
  if (activeJob) {
    return reply.status(400).send({ message: 'Complete your current active job first before offering new services.' });
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

    // Send push notification to the customer
    sendPushToUser(req.customerId, {
      title: '🔧 عرض صيانة جديد!',
      body: 'قام فني صيانة بتقديم عرض لمساعدتك. اضغط لمراجعة العرض.',
      url: '/customer/dashboard',
      tag: `offer-${id}`,
    }).catch(() => {});

    return reply.status(200).send({ success: true, message: 'Offer sent' });
  } catch (e: any) {
    return reply.status(400).send({ message: e.message || 'Error sending offer' });
  }
}

export async function acceptTechnicianOfferHandler(request: any, reply: any) {
  const { id } = request.params;
  const { technicianId } = request.body;
  const customerId = request.user.id;
  
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Verify this customer's request is still in QUEUED status
      const customerReq = await tx.assistanceRequest.findFirst({
        where: { id, customerId, status: 'QUEUED' }
      });
      if (!customerReq) {
        throw new Error('REQUEST_NOT_AVAILABLE');
      }

      // 2. Concurrency Lock: Check if technician already took another job at the exact same moment
      const existingActiveJob = await tx.assistanceRequest.findFirst({
        where: {
          technicianId,
          status: { in: ['DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
        }
      });
      if (existingActiveJob) {
        throw new Error('TECHNICIAN_BUSY');
      }

      // 3. Atomically accept this technician for this request
      await tx.assistanceRequest.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          technicianId,
          acceptedAt: new Date()
        }
      });

      // 4. Delete all offers for THIS customer request
      await tx.requestOffer.deleteMany({
        where: { requestId: id }
      });
    });

    getIO()?.emit('data_updated');
    getIO()?.emit('request_accepted', { customerId, technicianId });

    // Send push notification to the accepted technician
    try {
      const tech = await prisma.technicianProfile.findUnique({
        where: { id: technicianId },
        select: { userId: true },
      });
      if (tech?.userId) {
        sendPushToUser(tech.userId, {
          title: '🎉 مبروك! تم قبول عرضك',
          body: 'وافق العميل على عرض الصيانة الخاص بك. اضغط لبدء التوجه للعميل.',
          url: '/tech/dashboard',
          tag: `accepted-${id}`,
        }).catch(() => {});
      }
    } catch {}

    return reply.send({ success: true });
  } catch (err: any) {
    if (err.message === 'TECHNICIAN_BUSY') {
      return reply.status(409).send({
        message: 'عذراً، هذا الفني أصبح مرتبطاً بطلب صيانة نشط آخر في هذه اللحظة.'
      });
    }
    if (err.message === 'REQUEST_NOT_AVAILABLE') {
      return reply.status(409).send({
        message: 'هذا الطلب لم يعد متاحاً أو تم قبوله بالفعل.'
      });
    }
    return reply.status(400).send({ message: err.message || 'Failed to accept technician offer' });
  }
}

export async function rejectTechnicianOfferHandler(request: any, reply: any) {
  const { id } = request.params;
  const { technicianId } = request.body;
  const userId = request.user.id;
  const userRole = request.user.role;

  const existingReq = await prisma.assistanceRequest.findUnique({
    where: { id }
  });

  if (!existingReq) {
    return reply.status(404).send({ message: 'Request not found' });
  }

  if (existingReq.customerId !== userId && userRole !== 'ADMIN') {
    return reply.status(403).send({ message: 'Unauthorized to reject offers on this request' });
  }
  
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

  const existingReq = await prisma.assistanceRequest.findUnique({
    where: { id }
  });

  if (!existingReq) {
    return reply.status(404).send({ message: 'Request not found' });
  }

  const userId = request.user.id;
  const userRole = request.user.role;

  if (userRole !== 'ADMIN') {
    const techProfile = await prisma.technicianProfile.findUnique({
      where: { userId }
    });

    if (!techProfile || existingReq.technicianId !== techProfile.id) {
      return reply.status(403).send({ message: 'You are not assigned to this request.' });
    }
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

  // Push notifications to customer on status transitions
  const statusTitles: Record<string, { title: string; body: string }> = {
    'ARRIVED': {
      title: '📍 وصل الفني إلى موقعك!',
      body: 'الفني وصل لموقع سيارتك وهو بانتظارك الآن لبدء العمل.',
    },
    'IN_PROGRESS': {
      title: '⚙️ بدأت عملية الصيانة',
      body: 'يقوم الفني الآن بفحص وإصلاح سيارتك.',
    },
    'COMPLETED': {
      title: '✅ اكتملت الصيانة بنجاح!',
      body: 'تم الانتهاء من تصليح سيارتك. نتمنى لك رحلة آمنة، يرجى تقييم الفني.',
    },
  };

  if (statusTitles[result.data.status] && existingReq.customerId) {
    sendPushToUser(existingReq.customerId, {
      title: statusTitles[result.data.status].title,
      body: statusTitles[result.data.status].body,
      url: '/customer/dashboard',
      tag: `status-${id}-${result.data.status}`,
    }).catch(() => {});
  }

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
  getIO()?.emit('request_cancelled', { requestId: id });
  return reply.status(200).send({ message: 'Request cancelled successfully.' });
}

export async function getMessagesHandler(req: any, reply: any) {
  const { requestId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  const assistanceReq = await prisma.assistanceRequest.findUnique({
    where: { id: requestId },
    include: { technician: true }
  });

  if (!assistanceReq) {
    return reply.status(404).send({ message: 'Request not found' });
  }

  const isCustomer = assistanceReq.customerId === userId;
  const isAssignedTech = assistanceReq.technician?.userId === userId;
  const isAdmin = userRole === 'ADMIN';

  if (!isCustomer && !isAssignedTech && !isAdmin) {
    return reply.status(403).send({ message: 'Unauthorized to view messages for this request' });
  }

  const messages = await prisma.message.findMany({
    where: { requestId },
    orderBy: { createdAt: 'asc' },
  });
  return reply.send(messages);
}

export async function sendMessageHandler(req: any, reply: any) {
  const { requestId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!text || text.length > 2000) {
    return reply.status(400).send({ message: 'Message text must be between 1 and 2000 characters' });
  }

  const assistanceReq = await prisma.assistanceRequest.findUnique({
    where: { id: requestId },
    include: { technician: true }
  });

  if (!assistanceReq) {
    return reply.status(404).send({ message: 'Request not found' });
  }

  const isCustomer = assistanceReq.customerId === userId;
  const isAssignedTech = assistanceReq.technician?.userId === userId;
  const isAdmin = userRole === 'ADMIN';

  if (!isCustomer && !isAssignedTech && !isAdmin) {
    return reply.status(403).send({ message: 'Unauthorized to send messages for this request' });
  }

  const msg = await prisma.message.create({
    data: {
      requestId,
      senderId: userId,
      senderRole: userRole,
      text,
    },
  });
  getIO()?.emit('data_updated');

  // Push notifications for chat messages
  if (userId === assistanceReq.customerId) {
    if (assistanceReq.technician?.userId) {
      sendPushToUser(assistanceReq.technician.userId, {
        title: '💬 رسالة جديدة من العميل',
        body: text.length > 80 ? text.substring(0, 77) + '...' : text,
        url: '/tech/dashboard',
        tag: `msg-${requestId}`,
      }).catch(() => {});
    }
  } else {
    sendPushToUser(assistanceReq.customerId, {
      title: '💬 رسالة جديدة من الفني',
      body: text.length > 80 ? text.substring(0, 77) + '...' : text,
      url: '/customer/dashboard',
      tag: `msg-${requestId}`,
    }).catch(() => {});
  }

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
