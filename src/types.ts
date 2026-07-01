/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum UserRole {
  EMPLOYEE = "Employee",
  MANAGER = "Manager",
  ACCOUNTANT = "Accountant",
  ADMIN = "Admin"
}

export enum AdvanceStatus {
  DRAFT = "DRAFT", // บันทึกร่าง
  PENDING_APPROVAL = "PENDING_APPROVAL", // รออนุมัติ
  WAITING_TRANSFER = "WAITING_TRANSFER", // รอโอน
  WAITING_CLEARANCE = "WAITING_CLEARANCE", // รอเคลียร์
  PENDING_AUDIT = "PENDING_AUDIT", // รอตรวจสอบ
  PARTIALLY_CLEARED = "PARTIALLY_CLEARED", // เคลียร์บางส่วนแล้ว
  RETURNED = "RETURNED", // ตีกลับ
  REJECTED = "REJECTED", // ไม่อนุมัติ
  WAITING_ORIGINAL_DOC = "WAITING_ORIGINAL_DOC", // รอเอกสารตัวจริง
  CLOSED = "CLOSED" // ปิดยอดแล้ว
}

export enum ActionType {
  CREATE_ADVANCE = "CREATE_ADVANCE",
  APPROVE_ADVANCE = "APPROVE_ADVANCE",
  REJECT_ADVANCE = "REJECT_ADVANCE",
  UPLOAD_TRANSFER_SLIP = "UPLOAD_TRANSFER_SLIP",
  SUBMIT_CLEARING = "SUBMIT_CLEARING",
  OCR_SCAN = "OCR_SCAN",
  ACCOUNTING_APPROVE = "ACCOUNTING_APPROVE",
  PARTIAL_CLEAR = "PARTIAL_CLEAR",
  RETURN_CLEARING = "RETURN_CLEARING",
  CLOSE_ADVANCE = "CLOSE_ADVANCE",
  SYSTEM_CONFIG_CHANGED = "SYSTEM_CONFIG_CHANGED",
  AI_CHAT = "AI_CHAT"
}

export interface AISettings {
  activeModel: string;
  usageLimitThb: number;
  currentUsageThb: number;
  lastUpdated: string;
}

export interface AIUsageLog {
  id: string;
  timestamp: string;
  model: string;
  taskType: "OCR" | "CHAT" | "ESTIMATE" | "IMPORT";
  promptTokens: number;
  completionTokens: number;
  estimatedCostThb: number;
  userId: string;
  userName: string;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string;
}

export interface Employee {
  id: string; // Document ID (UID after registered, or temp ID before)
  employeeId?: string;
  uid?: string; // Firebase Auth UID linked
  username?: string; // unique alphanumeric registration name
  employeeCode?: string; // dynamic formatted code from settings (e.g. EMP-0004)
  name: string;
  nickname?: string; // Employee nickname
  email?: string;
  phone?: string;
  role: UserRole;
  pinHash: string; // SHA-256 hashed PIN
  lineUserId?: string;
  lineDisplayName?: string;
  linePictureUrl?: string;
  department?: string;
  position?: string;
  company?: string;
  bankName: string;
  bankNo: string;
  bankAccountName: string;
  isActive: boolean;
  profileImage?: string; // base64 representation of 150x150px thumbnail
  profilePhotoURL?: string; // URL of actual image in storage
  profilePhotoUpdatedAt?: any; // Timestamp
  imageScale?: number;
  imagePosition?: { x: number; y: number };
  signatureUrl?: string; // base64 or URL of signature image
  status?: "Active" | "Disabled" | "Suspended";
  isApprovedByAdmin?: boolean;
  plainPin?: string; // Plain-text PIN for Admin visibility/reset
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface Project {
  id: string;
  projectId?: string;
  projectCode: string;
  projectName: string;
  companyName: string;
  clientName: string;
  pmId: string;
  pmName: string;
  contractAmount: number;
  budget: number;
  pettyCashBudget: number;
  location: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Completed" | "Suspended";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCost {
  id: string;
  projectId: string;
  projectName: string;
  contractBudget: number;
  pettyCashBudget: number;
  remainingPettyCashBudget: number;
  totalAdvanceRequested: number;
  totalAdvanceApproved: number;
  totalClearingSubmitted: number;
  totalClearingApproved: number;
  outstandingAmount: number;
  waitingApprovalAmount: number;
  waitingTransferAmount: number;
  waitingClearanceAmount: number;
  overdueAmount: number;
  overdueCount: number;
  clearanceRate: number;
  advanceExposure: number;
  riskScore: number;
  variance: number;
  lastUpdatedAt: string;
}

export interface Advance {
  id: string; // Document ID
  advId: string; // Format: ADV-YYMM-P###
  employeeId: string;
  employeeName: string;
  projectId: string;
  projectName?: string;
  category: string;
  requestAmount: number;
  approvedAmount?: number;
  approvedClearingAmountTotal: number;
  outstandingAmount: number;
  status: AdvanceStatus;
  createdAt: string; // ISO String
  approvedAt?: string;
  approvedBy?: string;
  transferredAt?: string;
  transferSlipUrl?: string;
  closedAt?: string;
  settlementResult?: number; // advanceAmount - approvedClearingAmountTotal
  details: string;
  neededDate: string; // Date to clear
  note?: string;
  attachmentUrl?: string;
  returnedReason?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface ClearingLog {
  id: string;
  advId: string;
  roundNo: number; // e.g., 1, 2, 3
  submittedBy: string; // Employee name
  submittedAt: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "RETURNED" | "PARTIAL";
  totalSubmittedAmount: number;
  totalApprovedAmount: number;
  clearingNo?: string;
  accountantNote?: string;
  returnedReason?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface ClearingItem {
  id: string;
  clearingLogId: string;
  advId: string;
  roundNo: number;
  vendorName: string;
  vendorTaxId?: string;
  documentType: string; // e.g., Receipt, Tax Invoice, Invoice
  invoiceNo?: string;
  documentDate: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  amount?: number;
  lineItems?: {
    itemName: string;
    qty: number;
    unitPrice: number;
    amount: number;
    projectId?: string;
  }[];
  vatType: "INCLUDED" | "EXCLUDED" | "NONE";
  vatAmount: number;
  whtRate: "NONE" | "1%" | "3%" | "5%";
  whtAmount: number;
  discount?: number;
  otherExpenses?: number;
  netAmount: number;
  imageUrl?: string;
  ocrConfidence: number; // 0-100
  isDuplicate: boolean;
  duplicateInfo?: { advId: string; date: string };
  isAiGenerated?: boolean;
  isAiAnalyzed?: boolean;
  remarks?: string;
  accountantApproved: boolean;
  projectSplits?: { projectId: string; amount: number }[];
  originalDocReceived?: boolean;
  originalDocReceivedAt?: string;
  originalDocReceivedBy?: string;
  rawOcrJson?: string; // Raw OCR JSON response from Gemini
  createdAt?: string;
  updatedAt?: string;
  status?: AdvanceStatus;
  [key: string]: any;
}

export interface VaultFile {
  id: string;
  advId: string;
  fileType: "REQUEST" | "SLIP" | "RECEIPT" | "SETTLEMENT" | "LOG";
  fileUrl: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AuditLog {
  id: string;
  advId: string;
  actionType: ActionType;
  actionBy: string;
  role: UserRole;
  timestamp: string;
  beforeStatus: string;
  afterStatus: string;
  note: string;
  relatedFileUrl?: string;
}

export interface ApprovalFlowRule {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  approverRole: string; // e.g., "MANAGER" | "ACCOUNTANT" | "ADMIN"
  isActive: boolean;
}

export interface DocumentTemplateConfig {
  logoUrl: string;
  companyName: string;
  taxId: string;
  address: string;
  telephone: string;
  footerNotes: string;
  authorizedSignatureName: string;
}

export interface SystemSettings {
  id: string; // "global"
  projects: string[];
  categories: string[];
  documentTypes: string[];
  lineConfig: {
    notifyToken?: string;
    liffId?: string;
    alerts?: {
      onAdvanceRequest: boolean;
      onApproval: boolean;
      onClearing: boolean;
      onDocReturn: boolean;
    };
  };
  runningNumbers: {
    yearMonth: string; // YYMM
    lastSequence: number; // e.g., 5
  };
  approvalFlowRules?: ApprovalFlowRule[];
  documentTemplates?: DocumentTemplateConfig;
}
