import { z } from 'zod';
import { VehicleType, MalfunctionCategory, RequestStatus } from '@prisma/client';

export const createAssistanceRequestSchema = z.object({
  vehicleType: z.nativeEnum(VehicleType),
  malfunctionCategory: z.nativeEnum(MalfunctionCategory),
  addressDescription: z.string().optional(),
});

export const updateRequestStatusSchema = z.object({
  status: z.nativeEnum(RequestStatus),
});