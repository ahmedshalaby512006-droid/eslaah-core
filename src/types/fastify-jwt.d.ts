import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string;
      email: string;
      role: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
    };
    user: {
      id: string;
      email: string;
      role: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
    };
  }
}