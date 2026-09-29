import { Type, type Static } from "@sinclair/typebox";

export const UserRoleSchema = Type.Union([
  Type.Literal("admin_master"),
  Type.Literal("admin"),
  Type.Literal("employee_manager"),
  Type.Literal("employee")
]);

export const AssignableUserRoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("employee_manager"),
  Type.Literal("employee")
]);

export const LoginInputSchema = Type.Object({
  username: Type.String({ minLength: 3, maxLength: 64 }),
  password: Type.String({ minLength: 1, maxLength: 128 })
}, { additionalProperties: false });

export const BootstrapAdminInputSchema = Type.Object({
  username: Type.String({ minLength: 3, maxLength: 64 }),
  password: Type.String({ minLength: 5, maxLength: 128 })
}, { additionalProperties: false });

export const UserCreateInputSchema = Type.Object({
  username: Type.String({ minLength: 3, maxLength: 64 }),
  password: Type.String({ minLength: 5, maxLength: 128 }),
  role: AssignableUserRoleSchema
}, { additionalProperties: false });

export const UserIdSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
});

export const SetUserActiveInputSchema = Type.Object({ active: Type.Boolean() }, { additionalProperties: false });

export const UserSchema = Type.Object({
  id: UserIdSchema,
  username: Type.String({ minLength: 3, maxLength: 64 }),
  role: UserRoleSchema,
  active: Type.Boolean(),
  createdAt: Type.String({ format: "date-time" }),
  lastLoginAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()])
}, { additionalProperties: false });

export const AuthStateSchema = Type.Object({
  needsBootstrap: Type.Boolean(),
  user: Type.Union([UserSchema, Type.Null()])
}, { additionalProperties: false });

export type UserRole = Static<typeof UserRoleSchema>;
export type AssignableUserRole = Static<typeof AssignableUserRoleSchema>;
export type LoginInput = Static<typeof LoginInputSchema>;
export type BootstrapAdminInput = Static<typeof BootstrapAdminInputSchema>;
export type UserCreateInput = Static<typeof UserCreateInputSchema>;
export type User = Static<typeof UserSchema>;
export type AuthState = Static<typeof AuthStateSchema>;
