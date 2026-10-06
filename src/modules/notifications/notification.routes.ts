import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../common/middlewares/auth.middleware';
import {
  VAPID_PUBLIC_KEY,
  savePushSubscription,
  removePushSubscription,
  sendPushToUser,
} from '../../common/services/notification.service';

export async function notificationRoutes(fastify: FastifyInstance) {
  // Public endpoint for frontend to get VAPID public key
  fastify.get('/vapid-key', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ publicKey: VAPID_PUBLIC_KEY });
  });

  // Authenticated endpoint to register a browser's push subscription
  fastify.post('/subscribe', { preHandler: [authenticate as any] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { subscription } = req.body as any;
    if (!subscription || !subscription.endpoint) {
      return reply.status(400).send({ message: 'Valid push subscription object is required' });
    }

    await savePushSubscription(req.user.id, subscription);
    return reply.status(200).send({ success: true, message: 'Push subscription registered successfully' });
  });

  // Authenticated endpoint to unsubscribe
  fastify.post('/unsubscribe', { preHandler: [authenticate as any] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { endpoint } = req.body as any;
    if (!endpoint) {
      return reply.status(400).send({ message: 'Endpoint is required' });
    }

    await removePushSubscription(req.user.id, endpoint);
    return reply.status(200).send({ success: true, message: 'Unsubscribed successfully' });
  });

  // Authenticated test endpoint
  fastify.post('/test', { preHandler: [authenticate as any] }, async (req: FastifyRequest, reply: FastifyReply) => {
    await sendPushToUser(req.user.id, {
      title: '🔔 إشعار تجريبي من إصلاح',
      body: 'تهانينا! الإشعارات الخارجية تعمل بنجاح ومطابقة لأحدث المعايير.',
      url: '/',
    });
    return reply.send({ success: true, message: 'Test notification sent' });
  });
}
