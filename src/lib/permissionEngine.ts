/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, UserRole, Advance, ApprovalFlowRule, RolePermissionConfig } from "../types";

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  matchedRuleId?: string;
}

export const isValidLineUserId = (lineUserId?: string): boolean => {
  if (!lineUserId) return false;
  return lineUserId.startsWith("U");
};

export const normalizeEmployeeLineUserId = (employee: Partial<Employee>): string | undefined => {
  if (employee.lineUserId && isValidLineUserId(employee.lineUserId)) {
    return employee.lineUserId;
  }
  if (employee.uid && isValidLineUserId(employee.uid)) {
    return employee.uid;
  }
  return undefined;
};

export const resolveEmployeeLineUserId = (employee: Partial<Employee>): string | undefined => {
  return normalizeEmployeeLineUserId(employee);
};

export const derivePositionIdFromRole = (role?: UserRole | string): string => {
  if (!role) return "employee";
  const r = typeof role === 'string' ? role.toLowerCase() : String(role).toLowerCase();
  if (r === "employee") return "employee";
  if (r === "manager") return "pm";
  if (r === "accountant") return "accounting";
  if (r === "admin") return "admin";
  return "employee";
};

export const getEmployeePositionId = (employee: Partial<Employee>): string => {
  if (employee.positionId) return employee.positionId;
  if (employee.roleId) return employee.roleId;
  return derivePositionIdFromRole(employee.role);
};

/**
 * Validates whether an employee is allowed to approve a specific advance request
 * based on their LINE User ID, role/position, the request amount, and the project.
 */
export function checkApprovalPermission(
  employee: Employee,
  advance: Advance,
  rules: ApprovalFlowRule[]
): PermissionCheckResult {
  const isLineLiff = false; // We can assume false here for general check, real logic in LiffAction should pass source
  // The Prompt: Permission Engine ตรวจ lineUserId + role/position + amount + project
  // If the action is via LINE LIFF, we should check lineUserId. Here we do a general check first.

  // 2. Self approval check:
  // By default, a user cannot approve their own request unless a specific rule allows it
  if (employee.id === advance.employeeId) {
    // Look for a rule that matches this request and explicitly allows self-approval
    const selfApproveRule = rules.find(r => 
      r.isActive &&
      advance.requestAmount >= r.minAmount &&
      (r.maxAmount === null || advance.requestAmount <= r.maxAmount) &&
      r.canApproveOwnRequest
    );
    
    if (!selfApproveRule) {
      return {
        allowed: false,
        reason: "ไม่สามารถอนุมัติใบขอเบิกของตนเองได้"
      };
    }
  }

  // 3. Match against active approval rules
  const amt = advance.requestAmount;
  const proj = advance.projectId;

  const matchingRules = rules.filter(r => {
    if (!r.isActive) return false;
    
    // Amount range check (maxAmount null means no limit)
    const matchesMin = amt >= r.minAmount;
    const matchesMax = r.maxAmount === null || r.maxAmount === undefined || amt <= r.maxAmount;
    if (!matchesMin || !matchesMax) return false;

    // Project scope check
    if (r.projectScope === "specific_projects" || r.projectScope === "selected_projects") {
      // If rule specifies certain projects, check if advance project is covered
      const projectsList = (r as any).specificProjects || r.selectedProjectIds || [];
      if (projectsList.length > 0 && !projectsList.includes(proj)) {
        return false;
      }
    }

    // Document type check
    if (r.documentType && r.documentType !== "BOTH" && r.documentType !== "ADVANCE") {
      return false; // Not for ADVANCE
    }

    return true;
  });

  if (matchingRules.length === 0) {
    return {
      allowed: false,
      reason: `ไม่พบเงื่อนไขการอนุมัติ (Approval Rules) ที่เปิดใช้งานสำหรับยอดเงิน ฿${amt.toLocaleString()}`
    };
  }

  // Check if user's role or position qualifies in any matching rule
  const positionId = getEmployeePositionId(employee);
  const role = employee.role;

  for (const rule of matchingRules) {
    // Check by position
    const allowedPositions = rule.approverPositionIds || (rule as any).approverPositions || [];
    if (allowedPositions.length > 0) {
      if (allowedPositions.map((p: string) => p.toLowerCase()).includes(positionId.toLowerCase())) {
        return { allowed: true, matchedRuleId: rule.id };
      }
    }

    // Fallback to role-based check
    const allowedRoles = rule.approverRoles || rule.approverRoleIds || [];
    if (allowedRoles.length > 0) {
      if (allowedRoles.includes(role)) {
        return { allowed: true, matchedRuleId: rule.id };
      }
    }
    
    // Legacy single role check
    if (rule.approverRole === role) {
      return { allowed: true, matchedRuleId: rule.id };
    }
  }

  return {
    allowed: false,
    reason: `ตำแหน่งของคุณ (${employee.positionName || positionId}) ไม่มีสิทธิ์อนุมัติยอดเงิน ฿${amt.toLocaleString()} สำหรับโครงการ ${proj} ตามที่กำหนดไว้ใน Approval Matrix`
  };
}

export function checkGeneralPermission(
  employee: Employee,
  action: "canRequest" | "canClear" | "canApprove" | "canAudit" | "canCloseAccount" | "canViewDBD" | "canViewProjectCosts" | "canManageUsers" | "canManageSettings",
  rolePermissions?: RolePermissionConfig[]
): boolean {
  const positionId = getEmployeePositionId(employee);

  // If rolePermissions is provided from DB, use it
  if (rolePermissions && Array.isArray(rolePermissions)) {
    const config = rolePermissions.find(r => r.id === positionId);
    if (config) {
      if (action === "canRequest") return !!config.permissions.createAdvance;
      if (action === "canClear") return !!config.permissions.submitClearance;
      if (action === "canApprove") return !!config.permissions.approveAdvance;
      if (action === "canAudit") return !!config.permissions.reviewClearance;
      if (action === "canCloseAccount") return !!config.permissions.closeAdvance;
      if (action === "canViewDBD") return !!config.permissions.viewDashboard || !!config.permissions.viewExecutiveReport;
      if (action === "canViewProjectCosts") return !!config.permissions.viewDashboard;
      if (action === "canManageUsers") return !!config.permissions.manageUsers;
      if (action === "canManageSettings") return !!config.permissions.manageSettings;
    }
  }

  // Fallback default permissions
  const defaultPermissions: any = {
    admin: {
      canRequest: true,
      canClear: true,
      canApprove: true,
      canAudit: true,
      canCloseAccount: true,
      canViewDBD: true,
      canViewProjectCosts: true,
      canManageUsers: true,
      canManageSettings: true
    },
    ceo: {
      canRequest: false,
      canClear: false,
      canApprove: true,
      canAudit: false,
      canCloseAccount: false,
      canViewDBD: true,
      canViewProjectCosts: true,
      canManageUsers: false,
      canManageSettings: false
    },
    executive: {
      canRequest: false,
      canClear: false,
      canApprove: true,
      canAudit: false,
      canCloseAccount: false,
      canViewDBD: true,
      canViewProjectCosts: true,
      canManageUsers: false,
      canManageSettings: false
    },
    accounting: {
      canRequest: true,
      canClear: true,
      canApprove: false,
      canAudit: true,
      canCloseAccount: true,
      canViewDBD: true,
      canViewProjectCosts: true,
      canManageUsers: false,
      canManageSettings: false
    },
    pm: {
      canRequest: true,
      canClear: true,
      canApprove: false,
      canAudit: false,
      canCloseAccount: false,
      canViewDBD: false,
      canViewProjectCosts: true,
      canManageUsers: false,
      canManageSettings: false
    },
    foreman: {
      canRequest: true,
      canClear: true,
      canApprove: false,
      canAudit: false,
      canCloseAccount: false,
      canViewDBD: false,
      canViewProjectCosts: false,
      canManageUsers: false,
      canManageSettings: false
    },
    employee: {
      canRequest: true,
      canClear: true,
      canApprove: false,
      canAudit: false,
      canCloseAccount: false,
      canViewDBD: false,
      canViewProjectCosts: false,
      canManageUsers: false,
      canManageSettings: false
    }
  };

  if (defaultPermissions[positionId]) {
    return !!defaultPermissions[positionId][action];
  }

  // Final fallback based on legacy UserRole
  const role = employee.role;
  if (role === UserRole.ADMIN) return true;
  if (role === UserRole.ACCOUNTANT) {
    return ["canRequest", "canClear", "canAudit", "canCloseAccount", "canViewDBD", "canViewProjectCosts"].includes(action);
  }
  if (role === UserRole.MANAGER) {
    return ["canRequest", "canClear", "canViewProjectCosts"].includes(action); // Note manager mapping was changed above for new workflow. Managers can request, clear, but executive approves
  }
  return ["canRequest", "canClear"].includes(action);
}
