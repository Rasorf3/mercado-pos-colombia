import type { UserRole } from "@mercado-pos/contracts";

export type Capability =
  | "catalog:read"
  | "catalog:sale-read"
  | "catalog:manage"
  | "inventory:read"
  | "inventory:manage"
  | "sales:create"
  | "sales:history"
  | "clients:read"
  | "clients:lookup-for-sale"
  | "clients:create"
  | "clients:manage"
  | "clients:credit-manage"
  | "credit:read"
  | "credit:collect"
  | "users:manage"
  | "company:manage"
  | "sync:manage"
  | "sync:status"
  | "cash:close"
  | "suppliers:manage";

const ADMIN_CAPABILITIES: readonly Capability[] = [
  "catalog:read", "catalog:sale-read", "catalog:manage",
  "inventory:read", "inventory:manage", "sales:create", "sales:history",
  "clients:read", "clients:lookup-for-sale", "clients:create", "clients:manage",
  "clients:credit-manage", "credit:read", "credit:collect",
  "users:manage", "company:manage", "sync:manage", "sync:status", "cash:close", "suppliers:manage"
];

const ROLE_CAPABILITIES: Record<Exclude<UserRole, "admin_master">, readonly Capability[]> = {
  admin: ADMIN_CAPABILITIES,
  employee_manager: [
    "catalog:read", "catalog:sale-read", "catalog:manage", "inventory:read", "inventory:manage",
    "sales:create", "sales:history", "clients:read", "clients:lookup-for-sale", "clients:create", "clients:manage",
    "clients:credit-manage", "credit:read", "credit:collect",
    "sync:status", "cash:close", "suppliers:manage"
  ],
  employee: [
    "catalog:sale-read", "sales:create", "clients:lookup-for-sale", "clients:create",
    "clients:credit-manage", "credit:read", "credit:collect", "sync:status"
  ]
};

export function roleCan(role: UserRole, capability: Capability): boolean {
  return role === "admin_master" || ROLE_CAPABILITIES[role].includes(capability);
}

export function roleLabel(role: UserRole): string {
  return ({
    admin_master: "AdminMaster",
    admin: "Admin",
    employee_manager: "EmpleadoJefe",
    employee: "Empleado"
  })[role];
}
