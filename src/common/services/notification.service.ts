import webpush from 'web-push';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || '');

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BOqxVSbHxLK9fKHtA8tF0yOpHx-EgAMzDKjtX_ArHHVH6Vb8gqQuZ6p8eET0WsCG_tZv_tdKgkxNaMKbHWzG7yE';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '_APAZ0JIKfPjIJw74wgLVXfmoOBJ4i40fiKfwB8GcOo';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@eslaah.app';

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.error('Failed to configure WebPush VAPID details:', err);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

/**
 * Save user's browser push subscription in Redis
 */
export async function savePushSubscription(userId: string, subscription: any): Promise<void> {
  if (!userId || !subscription?.endpoint) return;
  const key = `push_subs:${userId}`;
  const subString = JSON.stringify(subscription);
  await redis.sadd(key, subString);
}

/**
 * Remove user's push subscription from Redis
 */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  if (!userId || !endpoint) return;
  const key = `push_subs:${userId}`;
  const subs = await redis.smembers(key);
  for (const s of subs) {
    try {
      const parsed = JSON.parse(s);
      if (parsed.endpoint === endpoint) {
        await redis.srem(key, s);
      }
    } catch {}
  }
}

/**
 * Send Web Push notification to a specific user across all their registered devices
 */
export async function sendPushToUser(userId: string, payload: PushNotificationPayload): Promise<void> {
  if (!userId) return;

  const key = `push_subs:${userId}`;
  const subs = await redis.smembers(key);
  if (!subs || subs.length === 0) return;

  const notificationData = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'eslaah-alert',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
  });

  const sendPromises = subs.map(async (subStr) => {
    try {
      const sub = JSON.parse(subStr);
      await webpush.sendNotification(sub, notificationData, {
        TTL: 86400, // 24 hours
        urgency: 'high',
      });
    } catch (err: any) {
      // 404 Not Found or 410 Gone means the subscription is no longer valid or unsubscribed
      if (err.statusCode === 404 || err.statusCode === 410) {
        await redis.srem(key, subStr);
      } else {
        console.error('Error sending push notification:', err.message || err);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}
