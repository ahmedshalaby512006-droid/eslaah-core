import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { getIO } from '../../server';
import { sendPushToUser } from '../../common/services/notification.service';
import { z } from 'zod';

const prisma = new PrismaClient();

const createIncidentSchema = z.object({
  incidentType: z.enum(['ROAD_ACCIDENT', 'SUDDEN_BREAKDOWN']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  photoUrl: z.string().optional(),
  description: z.string().max(1000).optional(),
});

export async function createEmergencyIncidentHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = createIncidentSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0].message });
  }

  const { incidentType, latitude, longitude, photoUrl, description } = result.data;
  const reporterId = request.user.id;

  // 1. Cross-Verification Logic to prevent false alarms:
  // If multiple alerts are triggered within a 1km (1000m) radius within the last 5 minutes:
  let initialStatus: 'PENDING' | 'VERIFIED' = 'PENDING';
  let nearbyCount = 0;

  try {
    const nearbyIncidents: any = await prisma.$queryRaw`
      SELECT id, reporter_id as "reporterId", status
      FROM "emergency_incidents"
      WHERE "created_at" >= NOW() - INTERVAL '5 minutes'
        AND "status" IN ('PENDING', 'VERIFIED')
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326)::geography,
          1000
        )
      LIMIT 10;
    `;

    nearbyCount = nearbyIncidents?.length || 0;
    if (nearbyCount > 0) {
      initialStatus = 'VERIFIED';

      // Automatically escalate previous nearby PENDING alerts to VERIFIED as well
      await prisma.$executeRaw`
        UPDATE "emergency_incidents"
        SET "status" = 'VERIFIED'::"IncidentStatus", "updated_at" = NOW()
        WHERE "created_at" >= NOW() - INTERVAL '5 minutes'
          AND "status" = 'PENDING'::"IncidentStatus"
          AND ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326)::geography,
            1000
          );
      `;
    }
  } catch (geoErr) {
    console.warn('Spatial cross-verification fallback:', geoErr);
  }

  // 2. Insert the Emergency Incident
  const [incident]: any = await prisma.$queryRaw`
    INSERT INTO "emergency_incidents" (
      "id",
      "reporter_id",
      "incident_type",
      "status",
      "latitude",
      "longitude",
      "location",
      "photo_url",
      "description",
      "created_at",
      "updated_at"
    ) VALUES (
      gen_random_uuid(),
      ${reporterId}::uuid,
      ${incidentType}::"IncidentType",
      ${initialStatus}::"IncidentStatus",
      ${latitude}::float8,
      ${longitude}::float8,
      ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326),
      ${photoUrl || null},
      ${description || null},
      NOW(),
      NOW()
    )
    RETURNING 
      "id",
      "reporter_id" AS "reporterId",
      "incident_type" AS "incidentType",
      "status",
      "latitude",
      "longitude",
      "photo_url" AS "photoUrl",
      "description",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt";
  `;

  const reporter = await prisma.user.findUnique({
    where: { id: reporterId },
    select: { fullName: true, phoneNumber: true },
  });

  const fullPayload = {
    ...incident,
    reporter,
    isCrossVerified: initialStatus === 'VERIFIED',
    nearbyAlertCount: nearbyCount + 1,
  };

  // 3. Real-Time Broadcasts:
  const io = getIO();
  if (io) {
    // a) Broadcast SOS incident to emergency dashboards & responders
    io.emit('sos_incident_created', fullPayload);

    if (initialStatus === 'VERIFIED') {
      io.emit('sos_incident_verified', {
        incidentId: incident.id,
        latitude,
        longitude,
        incidentType,
        verifiedAt: new Date().toISOString(),
      });
    }

    // b) Broadcast proximity alert for active drivers within 2km
    io.emit('sos_proximity_alert', {
      incidentId: incident.id,
      incidentType,
      latitude,
      longitude,
      radiusMeters: 2000,
      alertMessage:
        incidentType === 'ROAD_ACCIDENT'
          ? '⚠️ تحذير أمني: تم الإبلاغ عن حادث سير بالقرب منك، يرجى تخفيف السرعة وتوخي الحذر.'
          : '⚠️ تنبيه طوارئ: تم الإبلاغ عن عطل مفاجئ على مسار الطريق.',
      createdAt: incident.createdAt,
    });
  }

  // c) Web Push Notification to online responders/technicians
  try {
    const onlineTechs = await prisma.technicianProfile.findMany({
      where: { isOnline: true },
      select: { userId: true },
      take: 20,
    });

    const notifTitle =
      incidentType === 'ROAD_ACCIDENT'
        ? '🚨 نداء استغاثة: حادث سير في النطاق!'
        : '🚨 بلاغ طوارئ: عطل مفاجئ على الطريق!';

    for (const t of onlineTechs) {
      sendPushToUser(t.userId, {
        title: notifTitle,
        body: `تم إرسال بلاغ طوارئ جديد بالقرب منك (${initialStatus === 'VERIFIED' ? 'مؤكد ✓' : 'قيد المتابعة'}).`,
        url: '/tech/dashboard',
        tag: `sos-${incident.id}`,
      }).catch(() => {});
    }
  } catch (pushErr) {
    console.warn('Push dispatch error for SOS:', pushErr);
  }

  return reply.status(201).send(fullPayload);
}

export async function getActiveIncidentsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const incidents = await prisma.emergencyIncident.findMany({
    where: {
      status: { in: ['PENDING', 'VERIFIED'] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    include: {
      reporter: {
        select: { fullName: true, phoneNumber: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return reply.send(incidents);
}

export async function updateIncidentStatusHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { status: 'VERIFIED' | 'RESOLVED' | 'CANCELLED' } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  const { status } = request.body || {};

  if (!['VERIFIED', 'RESOLVED', 'CANCELLED'].includes(status)) {
    return reply.status(400).send({ message: 'Invalid incident status' });
  }

  const updated = await prisma.emergencyIncident.update({
    where: { id },
    data: {
      status,
      resolvedAt: status === 'RESOLVED' ? new Date() : undefined,
    },
  });

  getIO()?.emit('sos_incident_updated', updated);

  return reply.send(updated);
}
