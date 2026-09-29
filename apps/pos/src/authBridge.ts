import type {
  AuthState,
  BootstrapAdminInput,
  LoginInput,
  User,
  UserCreateInput
} from "@mercado-pos/contracts";

export const AUTH_CHANNELS = {
  state: "auth:state",
  bootstrapAdmin: "auth:bootstrap-admin",
  login: "auth:login",
  logout: "auth:logout",
  listUsers: "auth:list-users",
  createUser: "auth:create-user",
  setUserActive: "auth:set-user-active"
} as const;

export interface AuthBridge {
  state(): Promise<AuthState>;
  bootstrapAdmin(input: BootstrapAdminInput): Promise<User>;
  login(input: LoginInput): Promise<User>;
  logout(): Promise<void>;
  listUsers(): Promise<User[]>;
  createUser(input: UserCreateInput): Promise<User>;
  setUserActive(id: string, active: boolean): Promise<User>;
}
