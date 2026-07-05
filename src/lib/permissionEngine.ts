import {
  Advance,
  AdvanceStatus,
  ApprovalWorkflowConfig,
  ApprovalWorkflowRule,
  DashboardActionConfig,
  Employee,
  PermissionAction,
  PositionId,
  RolePermission,
  RolePermissionsConfig,
  UserRole,
} from "../types";

export type PermissionSource = "WEB" | "LINE_LIFF";

export interface PermissionSettings {
  rolePermissions?: RolePermissionsConfig;
  approvalWorkflow?: ApprovalWorkflowConfig;
  [key: string]: any;
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  matchedRule?: ApprovalWorkflowRule;
  matchedRole?: RolePermission;
  allowedActions: PermissionAction[];
  validLineUserId?: boolean;
  canApproveViaLine?: boolean;
  projectPass?: boolean;
  amountPass?: boolean;
}

const nowIso = () => new Date().toISOString();

export const allPermissionKeys: PermissionAction[] = [
  "viewDashboard",
  "createAdvance",
  "approveAdvance",
  "rejectAdvance",
  "batchApproveAdvance",
  "uploadTransferSlip",
  "submitClearance",
  "reviewClearance",
  "closeAdvance",
  "viewExecutiveReport",
  "manageSettings",
  "manageUsers",
  "manageProjects",
  "manageRoles",
];

export const legacyRoleToPosition: Record<UserRole, PositionId> = {
  [UserRole.EMPLOYEE]: "employee",
  [UserRole.MANAGER]: "manager",
  [UserRole.ACCOUNTANT]: "accountant",
  [UserRole.ADMIN]: "admin",
};

export const positionDisplayNames: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  accountant: "Accountant",
  admin: "Admin",
  pm: "PM",
  foreman: "Foreman",
  accounting: "Accounting",
  executive: "Executive",
  ceo: "CEO",
};

const aliasRoleIds: Record<string, string> = {
  accounting: "accountant",
  accountant: "accountant",
  manager: "manager",
};

const makePermissions = (enabled: PermissionAction[]): Record<PermissionAction, boolean> =>
  allPermissionKeys.reduce((acc, key) => {
    acc[key] = enabled.includes(key);
    return acc;
  }, {} as Record<PermissionAction, boolean>);

export const makeActions = (items: Array<[string, string, string, string?]>): DashboardActionConfig[] =>
  items.map(([id, label, targetTab, icon], index) => ({
    id,
    label,
    targetTab,
    icon,
    isActive: true,
    sortOrder: index + 1,
  }));

const employeeActions = makeActions([
  ["request", "เบิกเงิน", "request", "Send"],
  ["clearance", "เคลียร์ยอด", "clearance", "Receipt"],
  ["history", "ประวัติ", "audit", "FileText"],
]);

const employeeNav = makeActions([
  ["home", "หน้าหลัก", "dashboard", "LayoutDashboard"],
  ["request", "เบิกเงิน", "request", "Send"],
  ["clearance", "เคลียร์ยอด", "clearance", "Receipt"],
  ["more", "เพิ่มเติม", "more", "Settings"],
]);

const approvalActions = makeActions([
  ["approve", "อนุมัติ", "approval", "CheckSquare"],
  ["history", "ประวัติ", "audit", "FileText"],
]);

const approvalNav = makeActions([
  ["home", "หน้าหลัก", "dashboard", "LayoutDashboard"],
  ["approve", "อนุมัติ", "approval", "CheckSquare"],
  ["reports", "รายงาน", "reports", "BarChart3"],
  ["more", "เพิ่มเติม", "more", "Settings"],
]);

const defaultRole = (
  id: PositionId,
  displayName: string,
  description: string,
  level: number,
  enabled: PermissionAction[],
  approvalScope: Partial<RolePermission["approvalScope"]> = {},
  dashboard: Partial<RolePermission["dashboard"]> = {}
): RolePermission => ({
  id,
  name: String(id),
  displayName,
  description,
  isActive: true,
  level,
  permissions: makePermissions(enabled),
  approvalScope: {
    projectScope: "own_project",
    maxAmountPerItem: null,
    maxAmountPerDay: null,
    canApproveOwnRequest: false,
    requirePin: true,
    allowLineLiffApproval: false,
    ...approvalScope,
  },
  dashboard: {
    heroType: "profile",
    menuVariant: String(id),
    kpiPreset: String(id),
    quickActions: employeeActions,
    bottomNav: employeeNav,
    kpis: ["รายการรอดำเนินการ", "ยอดคงค้าง", "รายการเดือนนี้", "ใกล้ครบกำหนด"],
    ...dashboard,
  },
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

export const defaultRolePermissions: RolePermissionsConfig = {
  roles: [
    defaultRole("employee", "Employee", "Requester with own document access.", 10, ["viewDashboard", "createAdvance", "submitClearance"], { projectScope: "own" }),
    defaultRole("manager", "Manager", "Manager approver for managed projects.", 40, ["viewDashboard", "createAdvance", "approveAdvance", "rejectAdvance", "batchApproveAdvance", "submitClearance"], { projectScope: "own_project", allowLineLiffApproval: true, maxAmountPerItem: 5000 }, { heroType: "approval", quickActions: approvalActions, bottomNav: approvalNav }),
    defaultRole("accountant", "Accountant", "Accounting reviewer and closer.", 60, ["viewDashboard", "createAdvance", "uploadTransferSlip", "submitClearance", "reviewClearance", "closeAdvance"], { projectScope: "all_projects" }, { heroType: "accounting", bottomNav: approvalNav }),
    defaultRole("admin", "Admin", "Full system administrator.", 99, allPermissionKeys, { projectScope: "all_projects", allowLineLiffApproval: true }, { heroType: "system", quickActions: approvalActions, bottomNav: approvalNav }),
    defaultRole("pm", "PM", "Project manager approver for assigned projects.", 45, ["viewDashboard", "createAdvance", "approveAdvance", "rejectAdvance", "batchApproveAdvance", "submitClearance"], { projectScope: "own_project", allowLineLiffApproval: true, maxAmountPerItem: 5000 }, { heroType: "approval", quickActions: approvalActions, bottomNav: approvalNav }),
  ],
};

export const defaultApprovalWorkflow: ApprovalWorkflowConfig = {
  threshold: 5000,
  autoApproveAccounting: true,
  rules: [
    {
      id: "default-advance-manager-pm",
      name: "Advance approval by manager or PM",
      documentType: "ADVANCE",
      minAmount: 0,
      maxAmount: 5000,
      projectScope: "own_project",
      selectedProjectIds: [],
      approverRoleIds: ["manager", "pm", "admin"],
      approverPositionIds: ["manager", "pm", "admin"],
      requiredApprovalCount: 1,
      approvalOrder: "any",
      allowLineLiffApproval: true,
      allowBatchApproval: true,
      canApproveOwnRequest: false,
      isActive: true,
    },
  ],
};

const normalizeRoleId = (value?: string | null): string | undefined => {
  const raw = value?.trim();
  if (!raw) return undefined;
  const legacyRole = (Object.values(UserRole) as string[]).find((role) => role.toLowerCase() === raw.toLowerCase()) as UserRole | undefined;
  const normalized = legacyRole ? legacyRoleToPosition[legacyRole] : raw.toLowerCase();
  return aliasRoleIds[normalized] || normalized;
};

export function normalizePositionId(value?: string | null): PositionId | undefined {
  return normalizeRoleId(value);
}

export function mergeRolePermissions(existing?: any): RolePermissionsConfig {
  const existingRoles = Array.isArray(existing?.roles)
    ? existing.roles
    : existing && typeof existing === "object"
      ? Object.entries(existing).map(([id, value]) => ({ id, ...(value as object) }))
      : [];
  const merged = new Map<string, RolePermission>();

  for (const role of defaultRolePermissions.roles) merged.set(role.id, role);

  for (const role of existingRoles) {
    const id = normalizeRoleId(role.id || role.name) || String(role.id || role.name || "").trim();
    if (!id) continue;
    const fallback = merged.get(id) || defaultRole(id, role.displayName || id, role.description || "", Number(role.level || 50), []);
    merged.set(id, {
      ...fallback,
      ...role,
      id,
      name: role.name || id,
      displayName: role.displayName || fallback.displayName || id,
      isActive: role.isActive !== false,
      permissions: { ...fallback.permissions, ...(role.permissions || {}) },
      approvalScope: { ...fallback.approvalScope, ...(role.approvalScope || {}) },
      dashboard: { ...fallback.dashboard, ...(role.dashboard || {}) },
      createdAt: role.createdAt || fallback.createdAt || nowIso(),
      updatedAt: role.updatedAt || fallback.updatedAt || nowIso(),
    });
  }

  return { roles: Array.from(merged.values()).sort((a, b) => a.level - b.level) };
}

export function normalizeApprovalWorkflow(existing?: ApprovalWorkflowConfig): ApprovalWorkflowConfig {
  const rules = existing?.rules?.length ? existing.rules : defaultApprovalWorkflow.rules;
  return {
    ...defaultApprovalWorkflow,
    ...(existing || {}),
    rules: rules.map((rule) => ({
      ...defaultApprovalWorkflow.rules[0],
      ...rule,
      approverRoleIds: (rule.approverRoleIds?.length ? rule.approverRoleIds : rule.approverRoles || []).map((id) => normalizeRoleId(id) || id),
      approverPositionIds: (rule.approverPositionIds || []).map((id) => normalizeRoleId(id) || id),
    })),
  };
}

export function isValidLineUserId(lineUserId?: string | null): boolean {
  return typeof lineUserId === "string" && lineUserId.trim().startsWith("U");
}

export function resolveEmployeeLineUserId(employee?: Partial<Employee> | null): string | undefined {
  if (!employee) return undefined;
  if (isValidLineUserId(employee.lineUserId)) return employee.lineUserId?.trim();
  if (!employee.lineUserId && isValidLineUserId(employee.uid)) return employee.uid?.trim();
  return employee.lineUserId?.trim() || undefined;
}

export function normalizeEmployeeLineUserId(employee: Employee): Employee {
  const resolved = resolveEmployeeLineUserId(employee);
  return resolved && resolved !== employee.lineUserId ? { ...employee, lineUserId: resolved } : employee;
}

export function resolvePositionId(employee?: Partial<Employee> | null): PositionId {
  if (!employee) return "employee";
  return normalizeRoleId(employee.positionId)
    || normalizeRoleId(employee.roleId)
    || normalizeRoleId(employee.role)
    || "employee";
}

const isEmployeeActive = (employee?: Partial<Employee> | null) =>
  Boolean(employee) && employee.isActive !== false && !["Disabled", "Suspended", "DISABLED", "SUSPENDED"].includes(String(employee.status || ""));

const amountOf = (advance?: Partial<Advance> | null) =>
  Number(advance?.requestAmount || advance?.approvedAmount || advance?.amount || advance?.totalAmount || advance?.advanceAmount || 0);

const projectIdOf = (advance?: Partial<Advance> | null) => String(advance?.projectId || "");

export function getActiveRoles(config?: RolePermissionsConfig): RolePermission[] {
  return mergeRolePermissions(config).roles.filter((item) => item.isActive !== false).sort((a, b) => a.level - b.level);
}

export function getEmployeeEffectiveRole(employee: Partial<Employee> | null | undefined, settings?: PermissionSettings | RolePermissionsConfig): RolePermission | undefined {
  const roleConfig = "roles" in (settings || {}) ? settings as RolePermissionsConfig : (settings as PermissionSettings | undefined)?.rolePermissions;
  const roles = mergeRolePermissions(roleConfig).roles;
  const roleId = resolvePositionId(employee);
  return roles.find((role) => role.id === roleId) || roles.find((role) => normalizeRoleId(role.id) === normalizeRoleId(roleId));
}

export function getRolePermission(roleIdOrEmployee: string | Partial<Employee>, settings?: PermissionSettings | RolePermissionsConfig): RolePermission | undefined {
  const roleConfig = "roles" in (settings || {}) ? settings as RolePermissionsConfig : (settings as PermissionSettings | undefined)?.rolePermissions;
  const id = typeof roleIdOrEmployee === "string" ? normalizeRoleId(roleIdOrEmployee) : resolvePositionId(roleIdOrEmployee);
  return mergeRolePermissions(roleConfig).roles.find((role) => role.id === id || normalizeRoleId(role.id) === id);
}

export function hasPermission(employee: Partial<Employee>, action: PermissionAction, config?: RolePermissionsConfig): boolean {
  return Boolean(getRolePermission(employee, config)?.permissions[action]);
}

export function getApprovalRulesForDocument(documentType: string, amount: number, projectId: string, settings?: PermissionSettings): ApprovalWorkflowRule[] {
  const workflow = normalizeApprovalWorkflow(settings?.approvalWorkflow);
  return workflow.rules.filter((rule) => {
    if (rule.isActive === false) return false;
    if (rule.documentType && rule.documentType !== documentType) return false;
    if (amount < Number(rule.minAmount || 0)) return false;
    if (rule.maxAmount !== null && rule.maxAmount !== undefined && amount > Number(rule.maxAmount)) return false;
    if (rule.projectScope === "selected_projects" && !rule.selectedProjectIds?.includes(projectId)) return false;
    return true;
  });
}

export function getMatchingApprovalRule(advance: Partial<Advance>, workflow?: ApprovalWorkflowConfig): ApprovalWorkflowRule | undefined {
  return getApprovalRulesForDocument("ADVANCE", amountOf(advance), projectIdOf(advance), { approvalWorkflow: workflow })[0];
}

const roleAllowedByRule = (role: RolePermission | undefined, rule?: ApprovalWorkflowRule) => {
  if (!role || !rule) return false;
  const id = normalizeRoleId(role.id) || role.id;
  const positionIds = (rule.approverPositionIds || []).map((item) => normalizeRoleId(item) || item);
  const roleIds = (rule.approverRoleIds || []).map((item) => normalizeRoleId(item) || item);
  return positionIds.includes(id) || roleIds.includes(id);
};

const projectAllowed = (employee: Partial<Employee>, advance: Partial<Advance>, role: RolePermission | undefined, rule?: ApprovalWorkflowRule) => {
  const projectId = projectIdOf(advance);
  const scope = rule?.projectScope || role?.approvalScope.projectScope || "own_project";
  if (scope === "all_projects") return true;
  if (scope === "selected_projects") return Boolean(rule?.selectedProjectIds?.includes(projectId));
  if (scope === "own") return advance.employeeId === employee.id || advance.employeeId === employee.employeeId;
  return Boolean(employee.managedProjectIds?.includes(projectId) || employee.projectIds?.includes(projectId));
};

const roleAmountAllowed = (role: RolePermission | undefined, amount: number) => {
  const limit = role?.approvalScope.maxAmountPerItem;
  return limit === null || limit === undefined || amount <= Number(limit);
};

const result = (allowed: boolean, reason: string, matchedRole?: RolePermission, matchedRule?: ApprovalWorkflowRule, extra: Partial<PermissionResult> = {}): PermissionResult => ({
  allowed,
  reason,
  matchedRole,
  matchedRule,
  allowedActions: matchedRole ? allPermissionKeys.filter((key) => matchedRole.permissions[key]) : [],
  ...extra,
});

export function canUserPerformAction(user: Partial<Employee> | null | undefined, action: PermissionAction, context: any = {}, settings?: PermissionSettings): PermissionResult {
  const role = getEmployeeEffectiveRole(user, settings);
  if (!user) return result(false, "employee not found", role);
  if (!isEmployeeActive(user)) return result(false, "employee inactive or disabled", role);
  if (!role || role.isActive === false) return result(false, "role/position inactive", role);
  if (!role.permissions[action]) return result(false, "missing permission", role);
  if (context.advance && ["approveAdvance", "rejectAdvance"].includes(action)) {
    return action === "approveAdvance"
      ? canApproveAdvance(user as Employee, context.advance, settings, context.source)
      : canRejectAdvance(user as Employee, context.advance, settings, context.source);
  }
  return result(true, "allowed", role);
}

export function canApproveAdvance(user: Partial<Employee> | null | undefined, advance: Partial<Advance> | null | undefined, settings?: PermissionSettings, source: PermissionSource = "WEB"): PermissionResult {
  const role = getEmployeeEffectiveRole(user, settings);
  if (!user) return result(false, "employee not found", role);
  if (!advance) return result(false, "advance not found", role);
  if (!isEmployeeActive(user)) return result(false, "employee inactive or disabled", role);
  if (!role || role.isActive === false) return result(false, "role/position inactive", role);
  if (role.permissions.approveAdvance !== true) return result(false, "role does not allow approveAdvance", role);
  if (advance.status !== AdvanceStatus.PENDING_APPROVAL && String(advance.status) !== "PENDING_APPROVAL") return result(false, "advance is not PENDING_APPROVAL", role);

  const amount = amountOf(advance);
  const rules = getApprovalRulesForDocument("ADVANCE", amount, projectIdOf(advance), settings);
  const matchedRule = rules.find((rule) => roleAllowedByRule(role, rule) && projectAllowed(user, advance, role, rule)) || rules[0];
  const amountPass = roleAmountAllowed(role, amount);
  const projectPass = Boolean(matchedRule && projectAllowed(user, advance, role, matchedRule));
  const rulePass = Boolean(matchedRule && roleAllowedByRule(role, matchedRule));
  const selfPass = (matchedRule?.canApproveOwnRequest ?? role.approvalScope.canApproveOwnRequest) || ![user.id, user.employeeId].filter(Boolean).includes(String(advance.employeeId || ""));
  const linePass = source !== "LINE_LIFF" || (isValidLineUserId(resolveEmployeeLineUserId(user)) && role.approvalScope.allowLineLiffApproval && (matchedRule?.allowLineLiffApproval ?? false));
  const allowed = Boolean(matchedRule && amountPass && projectPass && rulePass && selfPass && linePass);

  const reason = allowed ? "allowed" : [
    !matchedRule && "no matching approval rule",
    !rulePass && "approval rule does not include role/position",
    !amountPass && "amount exceeds role limit",
    !projectPass && "project scope denied",
    !selfPass && "cannot approve own request",
    !linePass && "LINE LIFF approval is not allowed for this user/rule",
  ].filter(Boolean).join(", ");

  return result(allowed, reason, role, matchedRule, {
    validLineUserId: isValidLineUserId(resolveEmployeeLineUserId(user)),
    canApproveViaLine: isValidLineUserId(resolveEmployeeLineUserId(user)) && role.approvalScope.allowLineLiffApproval && Boolean(matchedRule?.allowLineLiffApproval),
    projectPass,
    amountPass,
  });
}

export function canRejectAdvance(user: Partial<Employee> | null | undefined, advance: Partial<Advance> | null | undefined, settings?: PermissionSettings, source: PermissionSource = "WEB"): PermissionResult {
  const role = getEmployeeEffectiveRole(user, settings);
  if (!role?.permissions.rejectAdvance) return result(false, "role does not allow rejectAdvance", role);
  const approvalResult = canApproveAdvance(user, advance, settings, source);
  return { ...approvalResult, allowed: approvalResult.allowed && role.permissions.rejectAdvance, reason: approvalResult.allowed ? "allowed" : approvalResult.reason };
}

export function canBatchApprove(user: Partial<Employee> | null | undefined, advances: Partial<Advance>[], settings?: PermissionSettings, source: PermissionSource = "WEB"): PermissionResult {
  const role = getEmployeeEffectiveRole(user, settings);
  if (!role?.permissions.batchApproveAdvance) return result(false, "batch approval is disabled", role);
  for (const advance of advances) {
    const approvalResult = canApproveAdvance(user, advance, settings, source);
    if (!approvalResult.allowed || approvalResult.matchedRule?.allowBatchApproval !== true) {
      return { ...approvalResult, allowed: false, reason: approvalResult.reason || "approval rule does not allow batch approval" };
    }
  }
  return result(true, "allowed", role);
}

export function resolveAllowedApprovers(advance: Partial<Advance>, employees: Employee[], settings?: PermissionSettings): Employee[] {
  return employees.filter((employee) => canApproveAdvance(employee, advance, settings, "WEB").allowed);
}

export function canViewAdvance(employee: Partial<Employee>, advance: Advance, config?: RolePermissionsConfig): boolean {
  const role = getEmployeeEffectiveRole(employee, { rolePermissions: config });
  return projectAllowed(employee, advance, role, getMatchingApprovalRule(advance));
}

export function filterAdvancesByVisibility(employee: Partial<Employee>, advances: Advance[], config?: RolePermissionsConfig): Advance[] {
  return advances.filter((advance) => canViewAdvance(employee, advance, config));
}

export function canPerformAdvanceAction(params: {
  employee: Employee;
  advance?: Advance | null;
  action: PermissionAction;
  source?: PermissionSource;
  rolePermissions?: RolePermissionsConfig;
  approvalWorkflow?: ApprovalWorkflowConfig;
}) {
  const settings = { rolePermissions: params.rolePermissions, approvalWorkflow: params.approvalWorkflow };
  return canUserPerformAction(params.employee, params.action, { advance: params.advance, source: params.source }, settings);
}

export function getHeroActions(employee: Partial<Employee>, config?: RolePermissionsConfig): DashboardActionConfig[] {
  return (getEmployeeEffectiveRole(employee, { rolePermissions: config })?.dashboard.quickActions || [])
    .filter((item) => item.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getBottomNavActions(employee: Partial<Employee>, config?: RolePermissionsConfig): DashboardActionConfig[] {
  return (getEmployeeEffectiveRole(employee, { rolePermissions: config })?.dashboard.bottomNav || [])
    .filter((item) => item.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
