import { FastifyReply, FastifyRequest } from 'fastify';

export const authorizeRoles = (...allowedRoles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;

    if (!user || !allowedRoles.includes(user.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
    }
  };
};