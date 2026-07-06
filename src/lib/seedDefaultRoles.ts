import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { RolePermissionConfig, ApprovalFlowRule } from "../types";

export const defaultRolePermissions: RolePermissionConfig[] = [
  {
    id: "employee",
    name: "employee",
    displayName: "พนักงาน",
    description: "Employee role",
    isActive: true,
    level: 10,
    permissions: {
      viewDashboard: true,
      createAdvance: true,
      approveAdvance: false,
      rejectAdvance: false,
      batchApproveAdvance: false,
      uploadTransferSlip: false,
      submitClearance: true,
      reviewClearance: false,
      closeAdvance: false,
      viewExecutiveReport: false,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "own",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: false
    },
    dashboard: {
      heroType: "profile",
      menuVariant: "default",
      kpiPreset: "employee"
    }
  },
  {
    id: "foreman",
    name: "foreman",
    displayName: "โฟร์แมน",
    description: "Foreman role",
    isActive: true,
    level: 20,
    permissions: {
      viewDashboard: true,
      createAdvance: true,
      approveAdvance: false,
      rejectAdvance: false,
      batchApproveAdvance: false,
      uploadTransferSlip: false,
      submitClearance: true,
      reviewClearance: false,
      closeAdvance: false,
      viewExecutiveReport: false,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "own",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: false
    },
    dashboard: {
      heroType: "profile",
      menuVariant: "default",
      kpiPreset: "employee"
    }
  },
  {
    id: "pm",
    name: "pm",
    displayName: "PM",
    description: "Project Manager role",
    isActive: true,
    level: 30,
    permissions: {
      viewDashboard: true,
      createAdvance: true,
      approveAdvance: false,
      rejectAdvance: false,
      batchApproveAdvance: false,
      uploadTransferSlip: false,
      submitClearance: true,
      reviewClearance: false,
      closeAdvance: false,
      viewExecutiveReport: false,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "own",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: false
    },
    dashboard: {
      heroType: "profile",
      menuVariant: "default",
      kpiPreset: "employee"
    }
  },
  {
    id: "accounting",
    name: "accounting",
    displayName: "บัญชี",
    description: "Accounting role",
    isActive: true,
    level: 40,
    permissions: {
      viewDashboard: true,
      createAdvance: true,
      approveAdvance: false,
      rejectAdvance: false,
      batchApproveAdvance: false,
      uploadTransferSlip: false,
      submitClearance: true,
      reviewClearance: true,
      closeAdvance: true,
      viewExecutiveReport: false,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "all_projects",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: false
    },
    dashboard: {
      heroType: "accounting",
      menuVariant: "accounting",
      kpiPreset: "accounting"
    }
  },
  {
    id: "executive",
    name: "executive",
    displayName: "ผู้บริหาร",
    description: "Executive role",
    isActive: true,
    level: 80,
    permissions: {
      viewDashboard: true,
      createAdvance: false,
      approveAdvance: true,
      rejectAdvance: true,
      batchApproveAdvance: false,
      uploadTransferSlip: true,
      submitClearance: false,
      reviewClearance: false,
      closeAdvance: false,
      viewExecutiveReport: true,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "all_projects",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: true
    },
    dashboard: {
      heroType: "executive",
      menuVariant: "executive",
      kpiPreset: "executive"
    }
  },
  {
    id: "ceo",
    name: "ceo",
    displayName: "CEO",
    description: "CEO role",
    isActive: true,
    level: 90,
    permissions: {
      viewDashboard: true,
      createAdvance: false,
      approveAdvance: true,
      rejectAdvance: true,
      batchApproveAdvance: false,
      uploadTransferSlip: true,
      submitClearance: false,
      reviewClearance: false,
      closeAdvance: false,
      viewExecutiveReport: true,
      manageSettings: false,
      manageUsers: false,
      manageProjects: false,
      manageRoles: false
    },
    approvalScope: {
      projectScope: "all_projects",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: false,
      requirePin: true,
      allowLineLiffApproval: true
    },
    dashboard: {
      heroType: "executive",
      menuVariant: "executive",
      kpiPreset: "ceo"
    }
  },
  {
    id: "admin",
    name: "admin",
    displayName: "Admin",
    description: "Administrator role",
    isActive: true,
    level: 100,
    permissions: {
      viewDashboard: true,
      createAdvance: true,
      approveAdvance: true,
      rejectAdvance: true,
      batchApproveAdvance: false, // Must be false for now
      uploadTransferSlip: true,
      submitClearance: true,
      reviewClearance: true,
      closeAdvance: true,
      viewExecutiveReport: true,
      manageSettings: true,
      manageUsers: true,
      manageProjects: true,
      manageRoles: true
    },
    approvalScope: {
      projectScope: "all_projects",
      maxAmountPerItem: null,
      maxAmountPerDay: null,
      canApproveOwnRequest: true,
      requirePin: true,
      allowLineLiffApproval: true
    },
    dashboard: {
      heroType: "system",
      menuVariant: "system",
      kpiPreset: "admin"
    }
  }
];

export const defaultApprovalRules: ApprovalFlowRule[] = [
  {
    id: "rule_default_1",
    name: "Default Advance Approval",
    documentType: "ADVANCE",
    minAmount: 0,
    maxAmount: null,
    projectScope: "all_projects",
    approverPositionIds: ["executive", "ceo", "admin"],
    requiredApprovalCount: 1,
    approvalOrder: "any",
    allowLineLiffApproval: true,
    allowBatchApproval: false,
    canApproveOwnRequest: false,
    isActive: true
  }
];

export const seedDefaultRolesAndRules = async () => {
  try {
    const docRef = doc(db, "settings", "global");
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        rolePermissions: { roles: defaultRolePermissions },
        approvalWorkflow: { rules: defaultApprovalRules }
      }, { merge: true });
      return;
    }

    const data = snap.data();
    let updates: any = {};
    let needsUpdate = false;

    if (!data.rolePermissions || !data.rolePermissions.roles || data.rolePermissions.roles.length === 0) {
      updates["rolePermissions.roles"] = defaultRolePermissions;
      needsUpdate = true;
    }

    if (!data.approvalWorkflow || !data.approvalWorkflow.rules || data.approvalWorkflow.rules.length === 0) {
      // also check legacy approvalFlowRules
      if (!data.approvalFlowRules || data.approvalFlowRules.length === 0) {
          updates["approvalWorkflow.rules"] = defaultApprovalRules;
          updates["approvalFlowRules"] = defaultApprovalRules; // keep legacy in sync for now
          needsUpdate = true;
      } else {
         updates["approvalWorkflow.rules"] = data.approvalFlowRules;
         needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await updateDoc(docRef, updates);
      console.log("Seeded rolePermissions and approvalWorkflow rules.");
    }
  } catch (error) {
    console.error("Error seeding roles and rules", error);
  }
};
