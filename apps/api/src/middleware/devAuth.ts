import type { RequestHandler } from "express";
import { RoleSchema, type Role } from "@predioon/shared";

declare global {
  namespace Express {
    interface Request { auth?: { userId: string; role: Role; buildingId?: string } }
  }
}

export const devAuth: RequestHandler = (req, _res, next) => {
  const role = RoleSchema.catch("BUILDING_ADMIN").parse(req.header("x-role"));
  const defaultUserId = role === "PLATFORM_ADMIN"
    ? "platform_admin"
    : role === "RESIDENT"
      ? "resident_demo"
      : "building_admin";

  req.auth = {
    userId: req.header("x-user-id") ?? defaultUserId,
    role,
    buildingId: req.header("x-building-id") ?? "bld_001",
  };
  next();
};
