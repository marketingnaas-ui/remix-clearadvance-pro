/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import SignatureCanvas from 'react-signature-canvas';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc,
  deleteDoc 
} from "firebase/firestore";
import { db, hashPIN } from "../lib/firebase";
import { exportToExcel } from "../lib/excelExport";
import * as XLSX from "xlsx";
import { Employee, UserRole, AuditLog, ActionType, AISettings, AIUsageLog } from "../types";
import { DocumentFormats, DEFAULT_DOCUMENT_FORMATS, generateFormattedId, saveDocumentFormats } from "../lib/idGenerator";
import {
  GoogleWorkspaceSettings,
  fetchAccessToken,
  requestGoogleAccessToken,
  createSpreadsheet,
  syncDatabaseToSheets,
  syncVaultFoldersToDrive
} from "../lib/workspaceSync";
import { useGooglePicker } from "../lib/useGooglePicker";
import { 
  Users, 
  FolderGit, 
  Tag, 
  ShieldCheck, 
  Check, 
  X, 
  Database,
  UserCheck, 
  ChevronRight, 
  Plus, 
  Trash2, 
  AlertCircle,
  RefreshCw,
  Grid,
  List,
  Bot,
  Sparkles,
  BookOpen,
  Settings,
  Upload,
  Eye,
  HelpCircle,
  FileSpreadsheet,
  PlusCircle,
  Edit2,
  PenTool,
  Cloud,
  FileText,
  Bell,
  HardDrive,
  Activity,
  Download,
  Maximize,
  CheckCircle,
  CheckSquare
} from "lucide-react";
import AILoadingModal from "./AILoadingModal";

interface AdminSettingsProps {
  currentEmployee: Employee;
}

export interface LineMessageTrigger {
  id: string;
  name: string;
  isActive: boolean;
  messageTemplate: string;
  type?: "text" | "flex";
}

interface ApprovalConditionRule {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  approverRoles: UserRole[];
  isActive: boolean;
}

const LINE_VARIABLES = [
  { name: "{advId}", desc: "รหัสใบเบิก (เช่น ADV-2401-001)" },
  { name: "{employeeName}", desc: "ชื่อพนักงานที่ทำรายการ" },
  { name: "{amount}", desc: "จำนวนเงินรวม" },
  { name: "{status}", desc: "สถานะปัจจุบันของรายการ" },
  { name: "{projectName}", desc: "ชื่อโครงการ" },
  { name: "{category}", desc: "หมวดหมู่ค่าใช้จ่าย" },
  { name: "{remark}", desc: "หมายเหตุ" },
  { name: "{date}", desc: "วันที่ทำรายการ" },
];

const DEFAULT_LINE_TRIGGERS: LineMessageTrigger[] = [
  { id: "onNewRequest", name: "เมื่อพนักงานยื่นเรื่องขอเบิกใหม่ (รออนุมัติ)", isActive: true, messageTemplate: "มีรายการขอเบิกเงินใหม่\nรหัส: {advId}\nผู้ขอเบิก: {employeeName}\nยอดเงิน: {amount} บาท", type: "text" },
  { id: "onManagerApproval", name: "เมื่อหัวหน้างานอนุมัติ", isActive: true, messageTemplate: "รายการ {advId} อนุมัติแล้ว\nรอตรวจสอบจากบัญชี", type: "text" },
  { id: "onClearanceSubmitted", name: "เมื่อพนักงานส่งเอกสารเคลียร์ยอด", isActive: true, messageTemplate: "รายการ {advId} ส่งเอกสารเคลียร์ยอดแล้ว", type: "text" },
  { id: "onSettlement", name: "เมื่อบัญชีปิดยอด Settlement", isActive: true, messageTemplate: "รายการ {advId} ปิดยอดเรียบร้อยแล้ว\nโอนเงินสำเร็จ", type: "text" }
];

export default function AdminSettings({ currentEmployee }: AdminSettingsProps) {
  const [activeSubTab, setActiveSubTab] = useState<"users" | "projects" | "categories" | "ai_bot" | "ai_ocr" | "document_numbers" | "approval_workflow" | "workspace" | "doc_templates" | "line_notifications" | "advance_data" | "system_usage">("users");
  const [workspaceSettings, setWorkspaceSettings] = useState<GoogleWorkspaceSettings>({});
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryDetails, setCategoryDetails] = useState<{ [catName: string]: { categoryId: string } }>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "card">("table");

  const { openPicker, isPickerLoaded } = useGooglePicker();

  // New config fields
  const [newProject, setNewProject] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingCategoryIndex, setEditingCategoryIndex] = useState<number | null>(null);
  const [editingCategoryText, setEditingCategoryText] = useState("");
  const [editingProjectIndex, setEditingProjectIndex] = useState<number | null>(null);
  const [editingProjectText, setEditingProjectText] = useState("");
  const [projectDialog, setProjectDialog] = useState<{ isOpen: boolean; proj: string; details: any } | null>(null);

  // AI & Budget config fields
  const [steelPriceUrl, setSteelPriceUrl] = useState("https://www.depthai.go.th");
  const [laborCostUrl, setLaborCostUrl] = useState("https://www.moph.go.th");
  const [cementPriceUrl, setCementPriceUrl] = useState("https://www.moc.go.th");
  const [projBudgets, setProjBudgets] = useState<{ [projectName: string]: number }>({});
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>("gemini-3.5-flash");
  const [selectedAiOcrModel, setSelectedAiOcrModel] = useState<string>("gemini-3.5-flash");
  const [aiUsageLogs, setAiUsageLogs] = useState<AIUsageLog[]>([]);
  const [dbStats, setDbStats] = useState<{ [coll: string]: number }>({});

  const GEMINI_MODELS = [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", rpm: "15 / 1K", tpm: "2M / 4M", rpd: "10K / 50K", description: "รุ่นมาตรฐานสำหรับงานทั่วไป รวดเร็ว ประหยัด และมีประสิทธิภาพสูงสุด" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", rpm: "5 / 100", tpm: "1M / 2M", rpd: "250 / 1K", description: "ประสิทธิภาพสูงสุด สำหรับงานวิเคราะห์ที่ซับซ้อนและการวางแผนระบบ" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", rpm: "10 / 4K", tpm: "2M / 8M", rpd: "15K / Unlimited", description: "รุ่นเล็กราคาประหยัด เน้นการตอบสนองที่รวดเร็วเป็นพิเศษ" },
    { id: "gemini-2.5-flash-image", name: "Nano Banana (Gemini 2.5 Flash Image)", rpm: "4 / 500", tpm: "24 / 500K", rpd: "8 / 2K", description: "โมเดลพิเศษสำหรับสร้างและแต่งภาพความละเอียดสูง" },
  ];

  useEffect(() => {
    // Load AI Settings and Stats
    const loadAiAndDbStats = async () => {
      try {
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        if (settingsSnap.exists()) {
          const config = settingsSnap.data().aiConfig;
          if (config?.activeModel) setSelectedGeminiModel(config.activeModel);
        }

        // Load recent AI usage logs
        const logsSnap = await getDocs(collection(db, "aiUsageLogs"));
        const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as AIUsageLog))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 50);
        setAiUsageLogs(logs);

        // Basic DB Stats (counts)
        const collections = ["employees", "advances", "clearingLogs", "clearingItems", "vaultFiles", "auditLogs"];
        const stats: { [coll: string]: number } = {};
        for (const coll of collections) {
          const snap = await getDocs(collection(db, coll));
          stats[coll] = snap.size;
        }
        setDbStats(stats);
      } catch (err) {
        console.error("Error loading stats:", err);
      }
    };
    if (activeSubTab === "ai_bot") loadAiAndDbStats();
  }, [activeSubTab]);

  // Dynamic Document Number Formats
  const [docFormats, setDocFormats] = useState<DocumentFormats>(DEFAULT_DOCUMENT_FORMATS);

  interface AdvanceDataColumn {
    id: string;
    label: string;
    dataSource: string;
  }
  const defaultAdvanceDataColumns: AdvanceDataColumn[] = [
    { id: "adv_status", label: "1. Adv_Status", dataSource: "adv.status" },
    { id: "adv_no", label: "2. ADV_No", dataSource: "adv.advId" },
    { id: "adv_request_date", label: "3. Request_Date", dataSource: "adv.createdAt" },
    { id: "adv_due_date", label: "4. Due_Date", dataSource: "adv.neededDate" },
    { id: "adv_requester", label: "5. Requester_Name", dataSource: "adv.employeeName" },
    { id: "adv_project", label: "6. Project_Name", dataSource: "adv.projectId" },
    { id: "adv_source_bank", label: "7. Source_Bank", dataSource: "company.sourceBankName" },
    { id: "adv_source_account_name", label: "8. Source_Acc_Name", dataSource: "company.sourceAccountName" },
    { id: "adv_source_account_no", label: "9. Source_Acc_No", dataSource: "company.sourceAccountNo" },
    { id: "adv_recipient_bank", label: "10. Recipient_Bank", dataSource: "employee.bankName" },
    { id: "adv_recipient_account_no", label: "11. Recipient_Acc_No", dataSource: "employee.bankNo" },
    { id: "adv_total_requested", label: "12. Total_Requested", dataSource: "adv.requestAmount" },
    { id: "adv_total_cleared", label: "13. Total_Cleared", dataSource: "adv.approvedClearingAmountTotal" },
    { id: "adv_outstanding", label: "14. Outstanding_Bal", dataSource: "adv.outstandingAmount" },
    { id: "clr_status", label: "15. Clearing_Status", dataSource: "clearing.status" },
    { id: "clr_no", label: "16. CLR_No", dataSource: "clearingLog.clearingNo" },
    { id: "clr_ref_adv_no", label: "17. Ref_ADV_No", dataSource: "clearingItem.advId" },
    { id: "clr_item_date", label: "18. Item_Date", dataSource: "clearingItem.documentDate" },
    { id: "clr_vendor_name", label: "19. Vendor_Name", dataSource: "clearingItem.vendorName" },
    { id: "clr_tax_id", label: "20. Tax_ID", dataSource: "clearingItem.vendorTaxId" },
    { id: "clr_receipt_no", label: "21. Receipt_No", dataSource: "clearingItem.invoiceNo" },
    { id: "clr_tax_invoice_no", label: "22. Tax_Invoice_No", dataSource: "clearingItem.invoiceNo" },
    { id: "clr_description", label: "23. Item_Description", dataSource: "clearingItem.itemName" },
    { id: "clr_project", label: "24. Clearing_Project", dataSource: "clearingItem.projectSplits/projectId" },
    { id: "clr_amount_net", label: "25. Amount_Net", dataSource: "clearingItem.netAmount" },
    { id: "clr_vat", label: "26. VAT_Amount", dataSource: "clearingItem.vatAmount" },
    { id: "clr_discount", label: "27. Discount_Amt", dataSource: "clearingItem.discount" },
    { id: "clr_other_cost", label: "28. Other_Cost", dataSource: "clearingItem.otherExpenses" },
    { id: "clr_carry_forward", label: "29. Carry_Forward_Bal", dataSource: "calculated.runningBalanceBefore" },
    { id: "clr_total", label: "30. Total_Amount", dataSource: "calculated.totalAmount" },
    { id: "clr_current_outstanding", label: "31. Current_Outstanding", dataSource: "calculated.runningBalanceAfter" },
  ];
  const [advanceDataColumns, setAdvanceDataColumns] = useState<AdvanceDataColumn[]>(defaultAdvanceDataColumns);

  // Dynamic Project budgets & AI estimations
  const [projectDetails, setProjectDetails] = useState<{
    [projectName: string]: {
      projectId?: string;
      contractBudget: number;
      pettyCashBudget: number;
      aiReasoning?: string;
    }
  }>({});
  const [estimatingBudgetFor, setEstimatingBudgetFor] = useState<string | null>(null);

  // Document Template states
  const [compName, setCompName] = useState("");
  const [compAddress, setCompAddress] = useState("");
  const [compContact, setCompContact] = useState("");
  const [compLogoUrl, setCompLogoUrl] = useState("");

  const handleSaveDocTemplates = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        docTemplate: {
          companyName: compName,
          companyAddress: compAddress,
          companyContact: compContact,
          companyLogoUrl: compLogoUrl
        }
      }, { merge: true });
      setSuccess("บันทึกการตั้งค่ารูปแบบเอกสารเรียบร้อยแล้ว!");
    } catch (err: any) {
      console.error(err);
      setError("ไม่สามารถบันทึกรูปแบบเอกสารได้: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // LINE Messaging API states
  const [lineChannelAccessToken, setLineChannelAccessToken] = useState("");
  const [lineChannelSecret, setLineChannelSecret] = useState("");
  const [lineLiffId, setLineLiffId] = useState("");
  const [lineTriggers, setLineTriggers] = useState<LineMessageTrigger[]>(DEFAULT_LINE_TRIGGERS);
  const [previewTriggerId, setPreviewTriggerId] = useState<string>("onNewRequest");
  const [newLineTriggerName, setNewLineTriggerName] = useState("");
  const [newLineTriggerTemplate, setNewLineTriggerTemplate] = useState("");
  const [newLineTriggerType, setNewLineTriggerType] = useState<"text" | "flex">("text");

  // AI Settings File Import states
  const [importing, setImporting] = useState(false);
  const [importedData, setImportedData] = useState<any | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);

  // Excel bulk data import states
  const [excelImporting, setExcelImporting] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelSheetsData, setExcelSheetsData] = useState<{ [sheetName: string]: { headers: string[], rows: any[], collection: string } }>({});

  // Employee editing states
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editEmpCode, setEditEmpCode] = useState("");
  const [editEmpName, setEditEmpName] = useState("");
  const [editEmpUsername, setEditEmpUsername] = useState("");
  const [editEmpNickname, setEditEmpNickname] = useState("");
  const [editEmpPin, setEditEmpPin] = useState("");
  const [editEmpRole, setEditEmpRole] = useState<UserRole>(UserRole.EMPLOYEE);
  const [editEmpBankName, setEditEmpBankName] = useState("");
  const [editEmpBankNo, setEditEmpBankNo] = useState("");
  const [editEmpBankAccountName, setEditEmpBankAccountName] = useState("");
  const [editEmpStatus, setEditEmpStatus] = useState<"Active" | "Disabled" | "Suspended">("Active");
  const [editEmpProfileImage, setEditEmpProfileImage] = useState("");
  const [editEmpLineUserId, setEditEmpLineUserId] = useState("");
  const [editEmpSignature, setEditEmpSignature] = useState("");
  const sigCanvasRef = useRef<SignatureCanvas>(null);

  // AI Raw Text Import states
  const [rawTextImportOpen, setRawTextImportOpen] = useState(false);
  const [rawTextContent, setRawTextContent] = useState("");
  const [selectedImportTab, setSelectedImportTab] = useState<"all" | "projects" | "categories" | "document_numbers" | "doc_templates">("all");

  // Bulk Import state variables
  const [isBulkImportUsersOpen, setIsBulkImportUsersOpen] = useState(false);
  const [bulkUsersText, setBulkUsersText] = useState("");
  const [isBulkImportProjectsOpen, setIsBulkImportProjectsOpen] = useState(false);
  const [bulkProjectsText, setBulkProjectsText] = useState("");
  const [isBulkImportCategoriesOpen, setIsBulkImportCategoriesOpen] = useState(false);
  const [bulkCategoriesText, setBulkCategoriesText] = useState("");

  const startEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    setEditEmpCode(emp.employeeCode || emp.id || "");
    setEditEmpName(emp.name || "");
    setEditEmpUsername(emp.username || "");
    setEditEmpNickname(emp.nickname || "");
    setEditEmpPin(emp.plainPin || "");
    setEditEmpRole(emp.role);
    setEditEmpBankName(emp.bankName || "");
    setEditEmpBankNo(emp.bankNo || "");
    setEditEmpBankAccountName(emp.bankAccountName || "");
    setEditEmpStatus(emp.status || (emp.isActive ? "Active" : "Suspended"));
    setEditEmpProfileImage(emp.profileImage || "");
    setEditEmpLineUserId(emp.lineUserId || "");
    setEditEmpSignature(emp.signatureUrl || "");
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditEmpSignature(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;

    if (!editEmpName.trim()) {
      alert("กรุณากรอกชื่อพนักงาน");
      return;
    }
    if (!editEmpUsername.trim()) {
      alert("กรุณากรอกยูเซอร์เนม");
      return;
    }
    if (!editEmpPin.trim() || editEmpPin.length < 4) {
      alert("กรุณากรอกรหัสพนักงาน (PIN) อย่างน้อย 4 ตัวอักษร");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Check username uniqueness
      const lowercaseUsername = editEmpUsername.trim().toLowerCase();
      const duplicate = employees.find(
        (emp) => emp.id !== editingEmployee.id && emp.username?.toLowerCase() === lowercaseUsername
      );
      if (duplicate) {
        throw new Error("ชื่อผู้ใช้นี้ (username) ถูกใช้งานโดยพนักงานท่านอื่นแล้ว กรุณาเปลี่ยนใหม่");
      }

      // Hash PIN if changed
      let pinHash = editingEmployee.pinHash;
      if (editEmpPin !== editingEmployee.plainPin) {
        pinHash = await hashPIN(editEmpPin);
      }

      const empRef = doc(db, "employees", editingEmployee.id);
      const updatedEmployee: Employee = {
        ...editingEmployee,
        employeeCode: editEmpCode.trim(),
        name: editEmpName.trim(),
        username: editEmpUsername.trim(),
        nickname: editEmpNickname.trim(),
        pinHash: pinHash,
        plainPin: editEmpPin,
        role: editEmpRole,
        bankName: editEmpBankName.trim(),
        bankNo: editEmpBankNo.trim(),
        bankAccountName: editEmpBankAccountName.trim(),
        status: editEmpStatus,
        isActive: editEmpStatus === "Active",
        isApprovedByAdmin: editEmpStatus === "Active" ? true : editingEmployee.isApprovedByAdmin,
        profileImage: editEmpProfileImage || "",
        lineUserId: editEmpLineUserId.trim(),
        signatureUrl: editEmpSignature || "",
      };

      await setDoc(empRef, updatedEmployee);

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `แก้ไขข้อมูลและสิทธิ์พนักงาน @${editEmpUsername} โดยแอดมิน`
      );

      setSuccess(`บันทึกการแก้ไขข้อมูลของพนักงาน "${editEmpName}" เรียบร้อยแล้ว ✨`);
      setEditingEmployee(null);
      await fetchAllData();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูลพนักงาน");
    } finally {
      setSaving(false);
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Employees
      const snapEmployees = await getDocs(collection(db, "employees"));
      const empList: Employee[] = [];
      snapEmployees.forEach((docSnap) => {
        empList.push({ id: docSnap.id, ...docSnap.data() } as Employee);
      });
      setEmployees(empList);

      // 2. Fetch Settings
      const settingsRef = doc(db, "settings", "global");
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const data = settingsSnap.data();
        setProjects(data.projects || []);
        setCategories(data.categories || []);
        
        // Load AI Config
        if (data.aiConfig) {
          setSteelPriceUrl(data.aiConfig.steelPriceUrl || "https://www.depthai.go.th");
          setLaborCostUrl(data.aiConfig.laborCostUrl || "https://www.moph.go.th");
          setCementPriceUrl(data.aiConfig.cementPriceUrl || "https://www.moc.go.th");
          if (data.aiConfig.activeModel) setSelectedGeminiModel(data.aiConfig.activeModel);
          if (data.aiConfig.aiOcrModel) setSelectedAiOcrModel(data.aiConfig.aiOcrModel);
        }
        setProjBudgets(data.projectBudgets || {});

        // Load dynamic docFormats
        if (data.documentFormats) {
          setDocFormats({
            ...DEFAULT_DOCUMENT_FORMATS,
            ...data.documentFormats
          });
        }
        if (data.advanceDataColumns) {
          setAdvanceDataColumns(data.advanceDataColumns);
        }

        // Load projectDetails
        if (data.projectDetails) {
          setProjectDetails(data.projectDetails);
        }


        // Load lineMessagingConfig
        if (data.lineMessagingConfig) {
          setLineChannelAccessToken(data.lineMessagingConfig.channelAccessToken || "");
          setLineChannelSecret(data.lineMessagingConfig.channelSecret || "");
          setLineLiffId(data.lineMessagingConfig.liffId || "");
          if (data.lineMessagingConfig.triggers) {
            setLineTriggers(data.lineMessagingConfig.triggers);
          }
        }

        // Load docTemplate
        if (data.docTemplate) {
          setCompName(data.docTemplate.companyName || "");
          setCompAddress(data.docTemplate.companyAddress || "");
          setCompContact(data.docTemplate.companyContact || "");
          setCompLogoUrl(data.docTemplate.companyLogoUrl || "");
        }

        // Load approvalWorkflow
        if (data.approvalWorkflow) {
          setApprovalThreshold(data.approvalWorkflow.threshold || 5000);
          setAutoApproveAccounting(data.approvalWorkflow.autoApproveAccounting ?? true);
          if (Array.isArray(data.approvalWorkflow.rules) && data.approvalWorkflow.rules.length > 0) {
            setApprovalRules(data.approvalWorkflow.rules);
          }
        }

        // Load categoryDetails
        if (data.categoryDetails) {
          setCategoryDetails(data.categoryDetails);
        }

        // Load googleWorkspace
        if (data.googleWorkspace) {
          setWorkspaceSettings(data.googleWorkspace);
        }
      }
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถดึงข้อมูลระบบได้");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    const checkToken = async () => {
      try {
        const token = await fetchAccessToken();
        setAccessToken(token);
      } catch (err) {
        console.error("Error checking token:", err);
      }
    };
    checkToken();
  }, [activeSubTab]);

  // Write immutable audit log helper
  const writeAuditLog = async (action: ActionType, note: string) => {
    try {
      const auditId = `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const log: AuditLog = {
        id: auditId,
        advId: "ADMIN-CONFIG",
        actionType: action,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: "ADMIN_VIEW",
        afterStatus: "ADMIN_UPDATE",
        note,
      };
      await setDoc(doc(db, "auditLogs", auditId), log);
    } catch (err) {
      console.error("Audit log write failed:", err);
    }
  };

  // Approve User registration (SRS 2.1)
  const handleApproveUser = async (emp: Employee, targetRole: UserRole) => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const empRef = doc(db, "employees", emp.id);
      await updateDoc(empRef, {
        isActive: true,
        isApprovedByAdmin: true,
        status: "Active",
        role: targetRole,
      });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE, // Using existing or close operational helper
        `อนุมัติการสมัครสมาชิกพนักงาน @${emp.username || emp.id} และกำหนดระดับสิทธิ์เป็น ${targetRole}`
      );

      setSuccess(`อนุมัติการสมัครสมาชิกและตั้งสิทธิ์พนักงาน "${emp.name}" เรียบร้อยแล้ว!`);
      await fetchAllData();
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถอนุมัติผู้ใช้งานได้");
    } finally {
      setSaving(false);
    }
  };

  // Reject / Deny user registration or delete
  const handleRejectUser = async (empId: string) => {
    if (!window.confirm("คุณแน่ใจหรือไม่ว่าต้องการปฏิเสธ/ลบผู้ใช้งานท่านนี้ออกจากระบบ?")) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      // In Firestore we can delete the record or set status as Disabled
      const empRef = doc(db, "employees", empId);
      await updateDoc(empRef, {
        isActive: false,
        isApprovedByAdmin: false,
        status: "Disabled"
      });

      await writeAuditLog(
        ActionType.RETURN_CLEARING,
        `ปฏิเสธหรือระงับการใช้งานบัญชีพนักงาน ID: ${empId}`
      );

      setSuccess("ระงับ/ปฏิเสธการเข้าใช้งานเรียบร้อยแล้ว");
      await fetchAllData();
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการทำรายการ");
    } finally {
      setSaving(false);
    }
  };

  // Permanently delete employee from database
  const handleDeleteEmployee = async (empId: string, empName: string) => {
    if (!window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบพนักงาน "${empName}" ออกจากระบบอย่างถาวร? การดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await deleteDoc(doc(db, "employees", empId));

      await writeAuditLog(
        ActionType.SYSTEM_CONFIG_CHANGED, // We can reuse standard configuration changed action type
        `ลบข้อมูลพนักงานถาวร: ${empName} (ID: ${empId})`
      );

      setSuccess(`ลบข้อมูลพนักงาน "${empName}" สำเร็จแล้ว`);
      await fetchAllData();
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถลบข้อมูลพนักงานได้");
    } finally {
      setSaving(false);
    }
  };

  // Update user role dynamically
  const handleRoleChange = async (empId: string, username: string, newRole: UserRole) => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const empRef = doc(db, "employees", empId);
      await updateDoc(empRef, { role: newRole });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `อัปเดตบทบาทของพนักงาน @${username || empId} เป็น ${newRole}`
      );

      setSuccess(`อัปเดตสิทธิ์การใช้งานเป็น "${newRole}" เรียบร้อยแล้ว`);
      await fetchAllData();
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถเปลี่ยนบทบาทผู้ใช้งานได้");
    } finally {
      setSaving(false);
    }
  };

  // Update user status active toggle
  const handleStatusToggle = async (empId: string, currentStatus: string) => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    const nextStatus = currentStatus === "Active" ? "Suspended" : "Active";
    const nextIsActive = nextStatus === "Active";

    try {
      const empRef = doc(db, "employees", empId);
      await updateDoc(empRef, { 
        status: nextStatus,
        isActive: nextIsActive
      });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `เปลี่ยนสถานะการใช้งานพนักงาน ID: ${empId} เป็น ${nextStatus}`
      );

      setSuccess(`เปลี่ยนสถานะบัญชีผู้ใช้เป็น "${nextStatus}" เรียบร้อยแล้ว`);
      await fetchAllData();
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถอัปเดตสถานะผู้ใช้งานได้");
    } finally {
      setSaving(false);
    }
  };

  // Add Project
  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.trim()) return;
    if (projects.includes(newProject.trim())) {
      setError("ชื่อโครงการนี้มีอยู่แล้วในระบบ");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const pName = newProject.trim();
      const updated = [...projects, pName];
      
      // Initialize project details with empty budgets
      const updatedDetails = {
        ...projectDetails,
        [pName]: {
          contractBudget: 0,
          pettyCashBudget: 0,
          aiReasoning: "รอนำเข้ามูลค่าสัญญาหรือระบุตัวเลขเพื่อวิเคราะห์ประมาณการจาก AI"
        }
      };

      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, { 
        projects: updated,
        projectDetails: updatedDetails
      }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `เพิ่มโครงการใหม่: ${pName}`
      );

      setProjects(updated);
      setProjectDetails(updatedDetails);
      setNewProject("");
      setSuccess("เพิ่มโครงการใหม่สำเร็จ!");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถบันทึกโครงการได้");
    } finally {
      setSaving(false);
    }
  };

  // AI-Powered Budget Estimation Logic
  const handleEstimateBudget = async (projName: string, totalBudget: number) => {
    if (totalBudget <= 0) {
      alert("กรุณากรอกระบุงบประมาณโครงการตามสัญญาที่มีค่ามากกว่า 0 บาท ก่อนให้ AI ประเมิน");
      return;
    }
    setEstimatingBudgetFor(projName);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/gemini/estimate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          totalContractBudget: totalBudget,
          user: { id: currentEmployee.id, name: currentEmployee.name }
        }),
      });
      const resJson = await res.json();
      if (resJson.status === "success" && resJson.data) {
        setProjectDetails((prev) => ({
          ...prev,
          [projName]: {
            ...(prev[projName] || { projectId: "", contractBudget: 0, pettyCashBudget: 0 }),
            contractBudget: totalBudget,
            pettyCashBudget: resJson.data.estimatedPettyCashBudget,
            aiReasoning: resJson.data.reasoning,
          },
        }));
        setSuccess(`AI ประเมินสัดส่วนงบเงินทดรองจ่ายสำหรับโครงการ "${projName}" สำเร็จ!`);
      } else {
        throw new Error(resJson.error || "คำนวณงบล้มเหลว");
      }
    } catch (err: any) {
      console.error(err);
      setError(`ไม่สามารถประมาณงบจ่ายหน้างานด้วย AI ได้: ${err?.message || err}`);
    } finally {
      setEstimatingBudgetFor(null);
    }
  };

  const handleProjectDetailBudgetChange = (projName: string, field: "contractBudget" | "pettyCashBudget", val: string) => {
    const num = parseFloat(val) || 0;
    setProjectDetails((prev) => ({
      ...prev,
      [projName]: {
        ...(prev[projName] || { projectId: "", contractBudget: 0, pettyCashBudget: 0 }),
        [field]: num,
      }
    }));
  };

  // Save Project Details
  const handleSaveProjectDetails = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const syncBudgets: { [key: string]: number } = {};
      Object.entries(projectDetails).forEach(([projName, det]) => {
        syncBudgets[projName] = det.contractBudget || 0;
      });

      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        projectDetails: projectDetails,
        projectBudgets: syncBudgets
      }, { merge: true });

      setProjBudgets(syncBudgets); // Update state!

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `อัปเดตสัญญางบประมาณโครงการและงบเงินทดรองจ่าย`
      );
      setSuccess("บันทึกข้อมูลสัญญางบประมาณโครงการและงบเงินทดรองจ่าย เรียบร้อยแล้ว ✨");
    } catch (err: any) {
      console.error(err);
      setError(`บันทึกงบประมาณล้มเหลว: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // Document Format Configuration Save
  const handleSaveDocumentFormats = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveDocumentFormats(docFormats);
      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `อัปเดตรูปแบบรหัสเอกสารและบันทึกลง settings/global.documentFormats`
      );
      setSuccess("บันทึกรูปแบบรหัสเอกสารลงฐานข้อมูลแล้ว รูปแบบใหม่จะถูกใช้กับเอกสารถัดไปทันที");
    } catch (err: any) {
      console.error(err);
      setError(`ไม่สามารถบันทึกรหัสเอกสารได้: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };


  // Approval Workflow states
  const [approvalThreshold, setApprovalThreshold] = useState<number>(5000);
  const [autoApproveAccounting, setAutoApproveAccounting] = useState<boolean>(true);
  const [approvalRules, setApprovalRules] = useState<ApprovalConditionRule[]>([
    {
      id: "rule-under-5000",
      name: "ยอดต่ำกว่า 5,000 บาท",
      minAmount: 0,
      maxAmount: 5000,
      approverRoles: [UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.ADMIN],
      isActive: true,
    },
    {
      id: "rule-5000-up",
      name: "ยอดตั้งแต่ 5,000 บาทขึ้นไป",
      minAmount: 5000.01,
      maxAmount: 999999999,
      approverRoles: [UserRole.ADMIN],
      isActive: true,
    },
  ]);

  const handleSaveApprovalWorkflow = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        approvalWorkflow: {
          threshold: approvalThreshold,
          autoApproveAccounting: autoApproveAccounting,
          rules: approvalRules
        }
      }, { merge: true });
      setSuccess("บันทึกเวิร์คโฟลการอนุมัติเรียบร้อยแล้ว!");
    } catch (err: any) {
      console.error(err);
      setError("ไม่สามารถบันทึกเวิร์คโฟลการอนุมัติได้: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLineSettings = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const invalidFlex = lineTriggers.find((trigger) => trigger.type === "flex" && parseFlexPreview(trigger.messageTemplate).error);
      if (invalidFlex) {
        throw new Error(`Flex Message JSON ของ "${invalidFlex.name}" ไม่ถูกต้อง กรุณาแก้ไขก่อนบันทึก`);
      }
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        lineMessagingConfig: {
          channelAccessToken: lineChannelAccessToken,
          channelSecret: lineChannelSecret,
          liffId: lineLiffId,
          triggers: lineTriggers
        }
      }, { merge: true });
      await writeAuditLog(ActionType.SYSTEM_CONFIG_CHANGED, "ปรับปรุงการตั้งค่า LINE Messaging API");
      setSuccess("บันทึกการตั้งค่า LINE Messaging API เรียบร้อยแล้ว!");
    } catch (err: any) {
      console.error(err);
      setError(`บันทึกตั้งค่าการแจ้งเตือนทาง LINE ล้มเหลว: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateWorkspaceSetting = async (updated: Partial<GoogleWorkspaceSettings>) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      const current = { ...workspaceSettings, ...updated };
      await setDoc(settingsRef, {
        googleWorkspace: current
      }, { merge: true });
      setWorkspaceSettings(current);
      setSuccess("อัปเดตการตั้งค่า Google Workspace สำเร็จเรียบร้อย!");
    } catch (err: any) {
      console.error(err);
      setError("ไม่สามารถอัปเดตการตั้งค่า Google Workspace ได้: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Bulk Import Handlers
  const handleBulkImportUsers = async () => {
    if (!bulkUsersText.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const lines = bulkUsersText.split("\n").map(l => l.trim()).filter(Boolean);
      let importedCount = 0;
      let skippedCount = 0;

      for (const line of lines) {
        const parts = line.split(",").map(p => p.trim());
        const name = parts[0];
        if (!name) continue;

        let username = parts[1] || "";
        if (!username) {
          const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
          username = cleanName || `emp_${Math.floor(Math.random() * 10000)}`;
        }

        const duplicate = employees.find(emp => emp.username?.toLowerCase() === username.toLowerCase());
        if (duplicate) {
          skippedCount++;
          continue;
        }

        const pin = parts[2] || "1234";
        const roleInput = parts[3] || "Requester";
        let role = UserRole.EMPLOYEE;
        if (roleInput.toLowerCase() === "admin" || roleInput === "ผู้ดูแลระบบ") {
          role = UserRole.ADMIN;
        } else if (roleInput.toLowerCase() === "approver" || roleInput === "ผู้อนุมัติ" || roleInput.toLowerCase() === "manager" || roleInput === "ผู้จัดการ") {
          role = UserRole.MANAGER;
        } else if (roleInput.toLowerCase() === "accounting" || roleInput === "ฝ่ายบัญชี" || roleInput.toLowerCase() === "accountant" || roleInput === "นักบัญชี") {
          role = UserRole.ACCOUNTANT;
        }

        const bankName = parts[4] || "";
        const bankNo = parts[5] || "";
        const bankAccountName = parts[6] || name;

        const pinHash = await hashPIN(pin);
        const newEmpId = `bulk_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const empRef = doc(db, "employees", newEmpId);
        
        const newEmployee: Employee = {
          id: newEmpId,
          name,
          username,
          nickname: "",
          pinHash,
          plainPin: pin,
          role,
          bankName,
          bankNo,
          bankAccountName,
          status: "Active",
          isActive: true,
          isApprovedByAdmin: true,
          profileImage: "",
          lineUserId: "",
          signatureUrl: "",
        };

        await setDoc(empRef, newEmployee);
        importedCount++;
      }

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `นำเข้าพนักงานแบบกลุ่มจำนวน ${importedCount} รายการ`
      );

      setSuccess(`นำเข้าพนักงานสำเร็จ ${importedCount} รายการ! ${skippedCount > 0 ? `(ข้ามบัญชีซ้ำ ${skippedCount} รายการ)` : ""}`);
      setIsBulkImportUsersOpen(false);
      setBulkUsersText("");
      await fetchAllData();
    } catch (err: any) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการนำเข้าผู้ใช้แบบกลุ่ม: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Helper to slugify text safely
  const slugify = (text: string): string => {
    if (!text) return "unknown";
    return text
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\wก-๙\-]+/g, "")
      .replace(/\-\-+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
  };

  // Detect matching collection based on columns or sheet names (client-side matching)
  const detectCollection = (sheetName: string, headers: string[]): string => {
    const nameLower = sheetName.toLowerCase();
    
    // Sheet name checks
    if (nameLower.includes("employee") || nameLower.includes("พนักงาน") || nameLower.includes("member")) return "employees";
    if (nameLower.includes("project") || nameLower.includes("โครงการ") || nameLower.includes("งานก่อสร้าง")) return "projects";
    if (nameLower.includes("advance") || nameLower.includes("เงินทดรอง") || nameLower.includes("ใบขอเงิน")) return "advances";
    if (nameLower.includes("clearingitem") || nameLower.includes("clearing item") || nameLower.includes("ใบเสร็จ") || nameLower.includes("รายการใบเสร็จ")) return "clearingItems";
    if (nameLower.includes("clearinglog") || nameLower.includes("clearing log") || nameLower.includes("ประวัติเคลียร์")) return "clearingLogs";
    if (nameLower.includes("gl") || nameLower.includes("ledger") || nameLower.includes("แยกประเภท") || nameLower.includes("บัญชี")) return "GL";
    if (nameLower.includes("track") || nameLower.includes("document tracking") || nameLower.includes("ติดตามเอกสาร")) return "document_tracking";
    if (nameLower.includes("cost") || nameLower.includes("ต้นทุน") || nameLower.includes("รายงานต้นทุน")) return "project_costs";

    // Header column keywords checks
    const headersJoined = headers.map(h => h.toLowerCase()).join(",");
    if (headersJoined.includes("employee") || headersJoined.includes("pinhash") || headersJoined.includes("รหัสพนักงาน") || headersJoined.includes("ธนาคาร")) return "employees";
    if (headersJoined.includes("project") || headersJoined.includes("budget") || headersJoined.includes("งบประมาณ") || headersJoined.includes("สัญญาก่อสร้าง")) return "projects";
    if (headersJoined.includes("advid") || headersJoined.includes("requestamount") || headersJoined.includes("เงินทดรองจ่าย")) return "advances";
    if (headersJoined.includes("vendorname") || headersJoined.includes("invoiceno") || headersJoined.includes("vatamount") || headersJoined.includes("เลขผู้เสียภาษี")) return "clearingItems";
    if (headersJoined.includes("gl") || headersJoined.includes("debit") || headersJoined.includes("credit") || headersJoined.includes("เดบิต")) return "GL";
    if (headersJoined.includes("documenttype") || headersJoined.includes("tracking") || headersJoined.includes("สถานะเอกสาร")) return "document_tracking";
    if (headersJoined.includes("contractbudget") || headersJoined.includes("pettycashbudget") || headersJoined.includes("รายงานต้นทุน")) return "project_costs";

    return "GL"; // Default
  };

  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFile(file);
    setExcelImporting(true);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const parsedSheets: any = {};

        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          if (rows.length > 0) {
            const headers = Object.keys(rows[0]);
            const collectionType = detectCollection(sheetName, headers);
            parsedSheets[sheetName] = {
              headers,
              rows,
              collection: collectionType
            };
          }
        });

        setExcelSheetsData(parsedSheets);
        setSuccess(`อ่านไฟล์ Excel สำเร็จ ตรวจพบจำนวนหน้า (Sheets): ${workbook.SheetNames.length} หน้า`);
      } catch (err: any) {
        console.error(err);
        setError("ไม่สามารถอ่านไฟล์ Excel ได้: " + err.message);
      } finally {
        setExcelImporting(false);
      }
    };
    reader.onerror = () => {
      setError("เกิดข้อผิดพลาดในการโหลดไฟล์");
      setExcelImporting(false);
    };
    reader.readAsBinaryString(file);
  };

  const handleExcelSheetCollectionChange = (sheetName: string, collectionName: string) => {
    setExcelSheetsData(prev => ({
      ...prev,
      [sheetName]: {
        ...prev[sheetName],
        collection: collectionName
      }
    }));
  };

  const handleExcelImportSubmit = async () => {
    if (!excelFile || Object.keys(excelSheetsData).length === 0) {
      setError("กรุณาเลือกไฟล์ Excel ก่อนนำเข้า");
      return;
    }

    setExcelImporting(true);
    setError(null);
    setSuccess(null);

    try {
      let totalImported = 0;

      for (const [sheetName, sheetInfo] of Object.entries(excelSheetsData)) {
        const { collection: collectionName, rows } = sheetInfo;
        
        for (let idx = 0; idx < rows.length; idx++) {
          const row: any = rows[idx];
          const rowIndex = idx + 2; // header is row 1

          // Generate Doc ID (Requirement 6)
          let docId = `row-${rowIndex}-${Date.now()}`;
          
          // Try to extract existing ID
          const possibleIds = [
            "id", "Id", "ID", "docId", "doc_id", "documentId",
            "employeeid", "employeeId", "empId", "emp_id", "empCode", "employeeCode",
            "projectid", "projectId", "projId", "proj_id", "project_id",
            "advid", "advId", "adv_id", "advanceId",
            "clearingid", "clearingId", "clearing_id",
            "glid", "glId", "gl_id", "entryNo"
          ];

          for (const field of possibleIds) {
            if (row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== "") {
              docId = slugify(String(row[field]));
              break;
            }
          }

          // Fallbacks for ID generation
          if (docId.startsWith("row-")) {
            if (collectionName === "employees") {
              const name = row["name"] || row["ชื่อ"] || row["ชื่อ-นามสกุล"] || row["FullName"];
              if (name) docId = slugify(`emp-${name}`);
            } else if (collectionName === "projects") {
              const name = row["name"] || row["projectName"] || row["ชื่อโครงการ"] || row["ชื่อโครงการก่อสร้าง"];
              if (name) docId = slugify(`proj-${name}`);
            } else if (collectionName === "advances") {
              const advId = row["advId"] || row["เลขที่เอกสาร"] || row["รหัสใบขอเงิน"];
              if (advId) docId = slugify(advId);
            }
          }

          // Parse and Map row standard fields based on collection schema (Requirement 9)
          const finalDoc: any = {
            rawData: { ...row },
            sourceFile: excelFile.name,
            sourceSheet: sheetName,
            sourceRow: rowIndex,
            importedAt: new Date().toISOString()
          };

          const getVal = (keys: string[], defaultVal: any = undefined) => {
            for (const key of keys) {
              if (row[key] !== undefined && row[key] !== null) return row[key];
            }
            return defaultVal;
          };

          const getNum = (keys: string[], defaultVal = 0) => {
            const val = getVal(keys);
            if (val === undefined || val === "") return defaultVal;
            const num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
            return isNaN(num) ? defaultVal : num;
          };

          const getBool = (keys: string[], defaultVal = false) => {
            const val = getVal(keys);
            if (val === undefined || val === "") return defaultVal;
            const str = String(val).toLowerCase().trim();
            return ["true", "yes", "y", "1", "เปิดใช้งาน", "อนุมัติ"].includes(str) || val === true;
          };

          const getDateStr = (keys: string[]) => {
            const val = getVal(keys);
            if (!val) return "";
            if (val instanceof Date) return val.toISOString();
            if (typeof val === "number") {
              try {
                const date = XLSX.SSF.parse_date_code(val);
                return new Date(date.y, date.m - 1, date.d).toISOString().split("T")[0];
              } catch (e) {}
            }
            return String(val).trim();
          };

          // Populate mapped schema fields
          if (collectionName === "employees") {
            finalDoc.id = String(getVal(["id", "Id", "employeeId", "รหัสพนักงาน"]) || "");
            finalDoc.name = String(getVal(["name", "ชื่อ", "ชื่อ-นามสกุล", "FullName"]) || "");
            finalDoc.nickname = String(getVal(["nickname", "ชื่อเล่น"]) || "");
            finalDoc.employeeCode = String(getVal(["employeeCode", "empCode", "รหัสพนักงาน"]) || "");
            finalDoc.username = String(getVal(["username", "ชื่อผู้ใช้"]) || slugify(finalDoc.name));
            finalDoc.role = String(getVal(["role", "ตำแหน่ง", "บทบาท"]) || "Employee");
            finalDoc.pinHash = String(getVal(["pinHash"]) || "");
            finalDoc.plainPin = String(getVal(["plainPin", "pin", "รหัสพิน"]) || "");
            if (finalDoc.plainPin && !finalDoc.pinHash) {
              finalDoc.pinHash = await hashPIN(finalDoc.plainPin);
            }
            finalDoc.bankName = String(getVal(["bankName", "ธนาคาร"]) || "");
            finalDoc.bankNo = String(getVal(["bankNo", "เลขบัญชี"]) || "");
            finalDoc.bankAccountName = String(getVal(["bankAccountName", "ชื่อบัญชี"]) || finalDoc.name);
            finalDoc.isActive = getBool(["isActive", "status", "สถานะใช้งาน"], true);
            finalDoc.status = "Active";
          } else if (collectionName === "projects") {
            finalDoc.id = String(getVal(["id", "projectId"]) || "");
            finalDoc.name = String(getVal(["name", "projectName", "ชื่อโครงการ"]) || "");
            finalDoc.projectId = String(getVal(["projectId", "รหัสโครงการ"]) || finalDoc.id || slugify(finalDoc.name).toUpperCase());
            finalDoc.contractBudget = getNum(["contractBudget", "งบสัญญา", "งบประมาณโครงการ", "budget"]);
            finalDoc.pettyCashBudget = getNum(["pettyCashBudget", "งบหน้างาน", "pettyCash"]);
            finalDoc.aiReasoning = String(getVal(["aiReasoning", "เหตุผล"]) || "นำเข้าผ่านระบบนำเข้าข้อมูล");
          } else if (collectionName === "advances") {
            finalDoc.id = String(getVal(["id", "advId"]) || "");
            finalDoc.advId = String(getVal(["advId", "รหัสใบขอเงิน"]) || "");
            finalDoc.employeeId = String(getVal(["employeeId"]) || "");
            finalDoc.employeeName = String(getVal(["employeeName", "ชื่อพนักงาน"]) || "");
            finalDoc.projectId = String(getVal(["projectId", "โครงการ"]) || "");
            finalDoc.category = String(getVal(["category", "หมวดหมู่"]) || "");
            finalDoc.requestAmount = getNum(["requestAmount", "จำนวนเงินเบิก"]);
            finalDoc.status = String(getVal(["status"]) || "WAITING_CLEARANCE").toUpperCase();
            finalDoc.createdAt = getDateStr(["createdAt", "วันที่สร้าง", "วันที่"]);
            finalDoc.neededDate = getDateStr(["neededDate", "วันที่ต้องการ"]) || "";
            finalDoc.details = String(getVal(["details", "รายละเอียด"]) || "");
          } else if (collectionName === "clearingItems") {
            finalDoc.id = String(getVal(["id", "clearingItemId"]) || "");
            finalDoc.advId = String(getVal(["advId"]) || "");
            finalDoc.vendorName = String(getVal(["vendorName", "ร้านค้า"]) || "");
            finalDoc.invoiceNo = String(getVal(["invoiceNo", "เลขที่เอกสาร"]) || "");
            finalDoc.itemName = String(getVal(["itemName", "รายละเอียด"]) || "");
            finalDoc.qty = getNum(["qty"], 1);
            finalDoc.unitPrice = getNum(["unitPrice", "ราคา"]);
            finalDoc.netAmount = getNum(["netAmount", "ยอดสุทธิ"]);
            finalDoc.vatAmount = getNum(["vatAmount", "ภาษีมูลค่าเพิ่ม"], 0);
            finalDoc.whtAmount = getNum(["whtAmount", "ภาษีหัก ณ ที่จ่าย"], 0);
            finalDoc.status = String(getVal(["status"]) || "APPROVED").toUpperCase();
          } else if (collectionName === "GL") {
            finalDoc.id = String(getVal(["id", "glId"]) || "");
            finalDoc.docNo = String(getVal(["docNo", "เลขที่เอกสาร"]) || "");
            finalDoc.date = getDateStr(["date", "วันที่"]) || "";
            finalDoc.accountCode = String(getVal(["accountCode"]) || "");
            finalDoc.accountName = String(getVal(["accountName"]) || "");
            finalDoc.projectId = String(getVal(["projectId"]) || "");
            finalDoc.category = String(getVal(["category"]) || "");
            finalDoc.debit = getNum(["debit"], 0);
            finalDoc.credit = getNum(["credit"], 0);
            finalDoc.amount = getNum(["amount"], finalDoc.debit || finalDoc.credit || 0);
            finalDoc.employeeName = String(getVal(["employeeName"]) || "");
          } else if (collectionName === "document_tracking") {
            finalDoc.id = String(getVal(["id", "trackingId"]) || "");
            finalDoc.documentNo = String(getVal(["documentNo", "เลขที่เอกสาร"]) || "");
            finalDoc.documentType = String(getVal(["documentType", "ประเภท"]) || "");
            finalDoc.status = String(getVal(["status"]) || "PENDING").toUpperCase();
            finalDoc.employeeName = String(getVal(["employeeName"]) || "");
            finalDoc.projectId = String(getVal(["projectId"]) || "");
            finalDoc.amount = getNum(["amount"], 0);
            finalDoc.createdAt = getDateStr(["createdAt", "วันที่สร้าง"]) || "";
          } else if (collectionName === "project_costs") {
            finalDoc.id = String(getVal(["id", "costId"]) || "");
            finalDoc.projectName = String(getVal(["projectName", "โครงการ"]) || "");
            finalDoc.contractBudget = getNum(["contractBudget"]);
            finalDoc.pettyCashBudget = getNum(["pettyCashBudget"]);
            finalDoc.totalAdvanceRequested = getNum(["totalAdvanceRequested"], 0);
            finalDoc.totalAdvanceApproved = getNum(["totalAdvanceApproved"], 0);
            finalDoc.totalClearingSubmitted = getNum(["totalClearingSubmitted"], 0);
            finalDoc.totalClearingApproved = getNum(["totalClearingApproved"], 0);
          }

          // Clean undefined keys
          Object.keys(finalDoc).forEach(key => {
            if (finalDoc[key] === undefined) {
              delete finalDoc[key];
            }
          });

          // Write with merge: true to prevent data loss
          await setDoc(doc(db, collectionName, docId), finalDoc, { merge: true });
          totalImported++;
        }
      }

      // Automatically sync and compute analytical collections
      const { autoUpdateSystemCollections } = await import("../lib/systemCollections");
      await autoUpdateSystemCollections();

      setSuccess(`นำเข้าข้อมูล Excel เข้า Firestore สำเร็จเสร็จสิ้น! บันทึกข้อมูลรวม ${totalImported} แถวในระบบฐานข้อมูล`);
      setExcelFile(null);
      setExcelSheetsData({});
      await fetchAllData();
    } catch (err: any) {
      console.error(err);
      setError("เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล Excel: " + err.message);
    } finally {
      setExcelImporting(false);
    }
  };

  const handleBulkImportProjects = async () => {
    if (!bulkProjectsText.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const lines = bulkProjectsText.split("\n").map(l => l.trim()).filter(Boolean);
      let finalProjects = [...projects];
      let finalDetails = { ...projectDetails };
      let finalProjectBudgets = { ...projBudgets };
      let importedCount = 0;

      for (const line of lines) {
        const parts = line.split(",").map(p => p.trim());
        const name = parts[0];
        if (!name) continue;

        if (!finalProjects.includes(name)) {
          finalProjects.push(name);
        }

        const contractBudget = parseFloat(parts[1]) || 0;
        const pettyCashBudget = parseFloat(parts[2]) || 0;
        const customId = parts[3] || (name.substring(0, 3).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900));
        
        finalDetails[name] = {
          projectId: customId,
          contractBudget: contractBudget || finalDetails[name]?.contractBudget || 0,
          pettyCashBudget: pettyCashBudget || finalDetails[name]?.pettyCashBudget || 0,
          aiReasoning: "นำเข้าข้อมูลแบบกลุ่ม (Bulk Import)"
        };

        finalProjectBudgets[name] = contractBudget || finalProjectBudgets[name] || 0;
        importedCount++;
      }

      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        projects: finalProjects,
        projectDetails: finalDetails,
        projectBudgets: finalProjectBudgets
      }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `นำเข้าโครงการแบบกลุ่มสำเร็จจำนวน ${importedCount} รายการ`
      );

      setProjects(finalProjects);
      setProjectDetails(finalDetails);
      setProjBudgets(finalProjectBudgets);
      setSuccess(`นำเข้าโครงการและงบประมาณแบบกลุ่มสำเร็จ ${importedCount} รายการ!`);
      setIsBulkImportProjectsOpen(false);
      setBulkProjectsText("");
    } catch (err: any) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการนำเข้าโครงการแบบกลุ่ม: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkImportCategories = async () => {
    if (!bulkCategoriesText.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const lines = bulkCategoriesText.split("\n").map(l => l.trim()).filter(Boolean);
      let finalCategories = [...categories];
      let importedCount = 0;

      for (const line of lines) {
        const name = line.trim();
        if (!name) continue;

        if (!finalCategories.includes(name)) {
          finalCategories.push(name);
          importedCount++;
        }
      }

      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        categories: finalCategories
      }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `นำเข้าหมวดหมู่ค่าใช้จ่ายแบบกลุ่มสำเร็จจำนวน ${importedCount} รายการ`
      );

      setCategories(finalCategories);
      setSuccess(`นำเข้าหมวดหมู่ค่าใช้จ่ายสำเร็จ ${importedCount} รายการ!`);
      setIsBulkImportCategoriesOpen(false);
      setBulkCategoriesText("");
    } catch (err: any) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการนำเข้าหมวดหมู่แบบกลุ่ม: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCategoryDetails = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        categoryDetails: categoryDetails
      }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `อัปเดตรหัสหมวดหมู่ค่าใช้จ่าย`
      );
      setSuccess("บันทึกรหัสหมวดหมู่ค่าใช้จ่าย เรียบร้อยแล้ว ✨");
    } catch (err: any) {
      console.error(err);
      setError(`บันทึกรหัสหมวดหมู่ล้มเหลว: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // AI-Powered Document Importer Logic
  const handleAiSettingsImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64 = (event.target?.result as string).split(",")[1];
          const res = await fetch("/api/gemini/import-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64Data: base64,
              mimeType: file.type || "application/octet-stream",
              targetTab: selectedImportTab,
              user: { id: currentEmployee.id, name: currentEmployee.name }
            }),
          });
          const resJson = await res.json();
          if (resJson.status === "success" && resJson.data) {
            setImportedData(resJson.data);
            setImportPreviewOpen(true);
          } else {
            throw new Error(resJson.error || "AI ประมวลผลเอกสารสกัดล้มเหลว");
          }
        } catch (err: any) {
          console.error(err);
          setError(`นำเข้าข้อมูลอัจฉริยะล้มเหลว: ${err?.message || err}`);
        } finally {
          setImporting(false);
        }
      };
      reader.onerror = (err) => {
        console.error("FileReader Error:", err);
        setError("ไม่สามารถอ่านไฟล์ที่เลือกได้");
        setImporting(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      setError(`นำเข้าข้อมูลอัจฉริยะล้มเหลว: ${err?.message || err}`);
    } finally {
      // reset file input
      e.target.value = "";
    }
  };

  const handleAiTextImport = async () => {
    if (!rawTextContent.trim()) {
      alert("กรุณากรอกข้อความรายละเอียดการตั้งค่า");
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/gemini/import-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: rawTextContent.trim(),
          targetTab: selectedImportTab,
          user: { id: currentEmployee.id, name: currentEmployee.name }
        }),
      });
      const resJson = await res.json();
      if (resJson.status === "success" && resJson.data) {
        setImportedData(resJson.data);
        setImportPreviewOpen(true);
        setRawTextImportOpen(false); // Close the text input drawer/modal
        setRawTextContent(""); // Clear text
      } else {
        throw new Error(resJson.error || "AI ประมวลผลข้อความสกัดล้มเหลว");
      }
    } catch (err: any) {
      console.error(err);
      setError(`นำเข้าข้อมูลข้อความอัจฉริยะล้มเหลว: ${err?.message || err}`);
    } finally {
      setImporting(false);
    }
  };

  const confirmAiImport = async () => {
    if (!importedData) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let finalProjects = [...projects];
      let finalDetails = { ...projectDetails };
      let finalCategories = [...categories];
      let finalDocFormats = { ...docFormats };
      let finalDocTemplate = {
        companyName: compName || "",
        companyAddress: compAddress || "",
        companyContact: compContact || "",
        companyLogoUrl: compLogoUrl || ""
      };

      // 1. Merge Projects and Budgets
      if (importedData.projects && importedData.projects.length > 0) {
        importedData.projects.forEach((p: any) => {
          if (!p) return;
          let name = "";
          let contractBudget = 0;
          let pettyCashBudget = 0;
          let reasoning = "";

          if (typeof p === "string") {
            name = p.trim();
          } else if (typeof p === "object") {
            name = (p.name || "").trim();
            contractBudget = Number(p.contractBudget) || 0;
            pettyCashBudget = Number(p.pettyCashBudget) || 0;
            reasoning = p.reasoning || "";
          }

          if (!name) return;

          if (!finalProjects.includes(name)) {
            finalProjects.push(name);
          }
          finalDetails[name] = {
            projectId: finalDetails[name]?.projectId || name.substring(0, 3).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000),
            contractBudget: contractBudget || finalDetails[name]?.contractBudget || 0,
            pettyCashBudget: pettyCashBudget || finalDetails[name]?.pettyCashBudget || 0,
            aiReasoning: reasoning || finalDetails[name]?.aiReasoning || "นำเข้าอัจฉริยะด้วยโมเดล AI ผ่านเอกสารโครงสร้างระบบ",
          };
        });
      }

      // 2. Merge Expense Categories
      if (importedData.categories && importedData.categories.length > 0) {
        importedData.categories.forEach((cat: any) => {
          if (!cat) return;
          let name = "";
          if (typeof cat === "string") {
            name = cat.trim();
          } else if (typeof cat === "object" && cat.name) {
            name = String(cat.name).trim();
          } else if (typeof cat === "object") {
            name = String(Object.values(cat)[0] || "").trim();
          }
          if (!name) return;
          if (!finalCategories.includes(name)) {
            finalCategories.push(name);
          }
        });
      }

      // 3. Merge Document Formats
      if (importedData.documentFormats) {
        finalDocFormats = {
          ...finalDocFormats,
          employee: importedData.documentFormats.employee || finalDocFormats.employee || "EMP-{seq:4}",
          project: importedData.documentFormats.project || finalDocFormats.project || "PRJ-{seq:3}",
          category: importedData.documentFormats.category || finalDocFormats.category || "CAT-{seq:3}",
          advance: importedData.documentFormats.advance || finalDocFormats.advance || "ADV-{yy}{mm}-{seq:4}",
          clearing: importedData.documentFormats.clearing || finalDocFormats.clearing || "CLR-{yy}{mm}-{seq:4}",
        };
      }

      // 4. Merge Document Template
      if (importedData.docTemplate) {
        finalDocTemplate = {
          companyName: importedData.docTemplate.companyName || finalDocTemplate.companyName || "",
          companyAddress: importedData.docTemplate.companyAddress || finalDocTemplate.companyAddress || "",
          companyContact: importedData.docTemplate.companyContact || finalDocTemplate.companyContact || "",
          companyLogoUrl: importedData.docTemplate.companyLogoUrl || finalDocTemplate.companyLogoUrl || "",
        };
      }

      // Compute projectBudgets in sync with projectDetails
      const finalProjectBudgets: { [projectName: string]: number } = {};
      finalProjects.forEach((pName) => {
        finalProjectBudgets[pName] = finalDetails[pName]?.contractBudget || 0;
      });

      // Write everything back to Firebase
      const settingsRef = doc(db, "settings", "global");
      const updatePayload: any = {
        projects: finalProjects,
        projectDetails: finalDetails,
        projectBudgets: finalProjectBudgets,
        categories: finalCategories,
        documentFormats: finalDocFormats,
      };
      if (importedData.docTemplate) {
        updatePayload.docTemplate = finalDocTemplate;
      }
      await setDoc(settingsRef, updatePayload, { merge: true });

      // Update state
      setProjects(finalProjects);
      setProjectDetails(finalDetails);
      setProjBudgets(finalProjectBudgets);
      setCategories(finalCategories);
      setDocFormats(finalDocFormats);
      if (importedData.docTemplate) {
        setCompName(finalDocTemplate.companyName || "");
        setCompAddress(finalDocTemplate.companyAddress || "");
        setCompContact(finalDocTemplate.companyContact || "");
        setCompLogoUrl(finalDocTemplate.companyLogoUrl || "");
      }

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `นำเข้าการตั้งค่าและงบประมาณสะสมโครงการด้วย AI อัจฉริยะ`
      );

      setSuccess("นำเข้า แปลง และเติมข้อมูลโครงการ งบประมาณ หมวดหมู่ และรหัสเอกสารโดย AI เรียบร้อยสมบูรณ์แล้ว! ✨");
      setImportedData(null);
      setImportPreviewOpen(false);
    } catch (err: any) {
      console.error(err);
      setError(`ไม่สามารถเซฟข้อมูลที่สกัดจาก AI ได้: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // Remove Project
  const handleRemoveProject = async (projName: string) => {
    if (!window.confirm(`คุณแน่ใจที่จะลบโครงการ "${projName}"?`)) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = projects.filter((p) => p !== projName);
      const updatedDetails = { ...projectDetails };
      const updatedBudgets = { ...projBudgets };
      delete updatedDetails[projName];
      delete updatedBudgets[projName];
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        projects: updated,
        projectDetails: updatedDetails,
        projectBudgets: updatedBudgets
      }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `ลบโครงการ: ${projName}`
      );

      setProjects(updated);
      setProjectDetails(updatedDetails);
      setProjBudgets(updatedBudgets);
      setSuccess("ลบโครงการเรียบร้อยแล้ว");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถลบโครงการได้");
    } finally {
      setSaving(false);
    }
  };

  // Add Expense Category
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategory.trim()) return;
    if (categories.includes(newCategory.trim())) {
      setError("หมวดหมู่ค่าใช้จ่ายนี้มีอยู่แล้วในระบบ");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = [...categories, newCategory.trim()];
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, { categories: updated }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `เพิ่มหมวดหมู่ค่าใช้จ่ายใหม่: ${newCategory.trim()}`
      );

      setCategories(updated);
      setNewCategory("");
      setSuccess("เพิ่มหมวดหมู่สำเร็จ!");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถบันทึกหมวดหมู่ได้");
    } finally {
      setSaving(false);
    }
  };

  // Remove Expense Category
  const handleEditCategory = async (index: number) => {
    if (!editingCategoryText.trim()) return;
    if (categories[index] === editingCategoryText.trim()) {
      setEditingCategoryIndex(null);
      return;
    }
    if (categories.includes(editingCategoryText.trim())) {
      setError("หมวดหมู่ค่าใช้จ่ายนี้มีอยู่แล้วในระบบ");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const oldName = categories[index];
      const newName = editingCategoryText.trim();
      const updated = [...categories];
      updated[index] = newName;
      const updatedCategoryDetails = { ...categoryDetails };
      if (updatedCategoryDetails[oldName]) {
        updatedCategoryDetails[newName] = updatedCategoryDetails[oldName];
        delete updatedCategoryDetails[oldName];
      }
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, { categories: updated, categoryDetails: updatedCategoryDetails }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `แก้ไขหมวดหมู่ค่าใช้จ่ายจาก "${oldName}" เป็น "${newName}"`
      );

      setCategories(updated);
      setCategoryDetails(updatedCategoryDetails);
      setEditingCategoryIndex(null);
      setSuccess("แก้ไขหมวดหมู่สำเร็จ!");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถแก้ไขหมวดหมู่ได้");
    } finally {
      setSaving(false);
    }
  };

  const handleEditProjectName = async (index: number) => {
    if (!editingProjectText.trim()) return;
    if (projects[index] === editingProjectText.trim()) {
      setEditingProjectIndex(null);
      return;
    }
    if (projects.includes(editingProjectText.trim())) {
      setError("ชื่อโครงการนี้มีอยู่แล้วในระบบ");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const oldName = projects[index];
      const newName = editingProjectText.trim();
      const updated = [...projects];
      updated[index] = newName;
      
      const updatedDetails = { ...projectDetails };
      if (updatedDetails[oldName]) {
        updatedDetails[newName] = updatedDetails[oldName];
        delete updatedDetails[oldName];
      }

      // Sync names in projectBudgets
      const updatedProjectBudgets = { ...projBudgets };
      if (updatedProjectBudgets[oldName] !== undefined) {
        updatedProjectBudgets[newName] = updatedProjectBudgets[oldName];
        delete updatedProjectBudgets[oldName];
      }

      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, { 
        projects: updated,
        projectDetails: updatedDetails,
        projectBudgets: updatedProjectBudgets
      }, { merge: true });

      setProjBudgets(updatedProjectBudgets); // update state!

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `แก้ไขชื่อโครงการจาก "${oldName}" เป็น "${newName}"`
      );

      setProjects(updated);
      setProjectDetails(updatedDetails);
      setEditingProjectIndex(null);
      setSuccess("แก้ไขชื่อโครงการสำเร็จ!");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถแก้ไขชื่อโครงการได้");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCategory = async (catName: string) => {
    if (!window.confirm(`คุณแน่ใจที่จะลบหมวดหมู่ "${catName}"?`)) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = categories.filter((c) => c !== catName);
      const updatedCategoryDetails = { ...categoryDetails };
      delete updatedCategoryDetails[catName];
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, { categories: updated, categoryDetails: updatedCategoryDetails }, { merge: true });

      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `ลบหมวดหมู่ค่าใช้จ่าย: ${catName}`
      );

      setCategories(updated);
      setCategoryDetails(updatedCategoryDetails);
      setSuccess("ลบหมวดหมู่ค่าใช้จ่ายเรียบร้อยแล้ว");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถลบหมวดหมู่ค่าใช้จ่ายได้");
    } finally {
      setSaving(false);
    }
  };

  // Save AI Bot and budgets settings
  const handleSaveAdvanceDataColumns = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        advanceDataColumns
      }, { merge: true });
      await writeAuditLog(ActionType.ACCOUNTING_APPROVE, `แก้ไขโครงสร้างตารางข้อมูล Advance Data Center (31 คอลัมน์)`);
      setSuccess("บันทึกการตั้งค่าตาราง Advance Data Center สำเร็จ!");
    } catch (err: any) {
      console.error(err);
      setError("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        aiConfig: {
          activeModel: selectedGeminiModel,
          aiOcrModel: selectedAiOcrModel,
          steelPriceUrl,
          laborCostUrl,
          cementPriceUrl
        }
      }, { merge: true });
      
      await writeAuditLog(
        ActionType.ACCOUNTING_APPROVE,
        `อัปเดตการตั้งค่าเว็บไซต์อ้างอิง AI บอท`
      );
      setSuccess("บันทึกการตั้งค่า AI บอท สำเร็จ!");
    } catch (err) {
      console.error(err);
      setError("ไม่สามารถบันทึกการตั้งค่าได้");
    } finally {
      setSaving(false);
    }
  };

  const handleBudgetChange = (projName: string, value: string) => {
    const num = parseFloat(value) || 0;
    setProjBudgets(prev => ({
      ...prev,
      [projName]: num
    }));
  };

  const sampleLineVariables: Record<string, string> = {
    advId: "ADV-2606-001",
    employeeName: "สมชาย ใจดี",
    amount: "5,000",
    status: "รออนุมัติ",
    projectName: "Project Alpha",
    category: "ค่าเดินทาง",
    remark: "ขอเบิกค่าใช้จ่ายหน้างาน",
    date: new Date().toLocaleDateString("th-TH"),
  };

  const replaceLineVariables = (template: string) =>
    Object.entries(sampleLineVariables).reduce(
      (result, [key, value]) => result.replace(new RegExp(`{${key}}`, "g"), value),
      template || ""
    );

  const getPreviewTrigger = () => lineTriggers.find(t => t.id === previewTriggerId);

  const parseFlexPreview = (template: string): { value: any | null; error: string | null } => {
    try {
      const parsed = JSON.parse(replaceLineVariables(template));
      return { value: parsed.type === "flex" && parsed.contents ? parsed.contents : parsed, error: null };
    } catch (err: any) {
      return { value: null, error: err?.message || "JSON ไม่ถูกต้อง" };
    }
  };

  const renderFlexBox = (box: any, idx = 0): React.ReactNode => {
    if (!box) return null;
    if (box.type === "text") {
      const weight = box.weight === "bold" ? "font-bold" : "";
      const size = box.size === "xl" || box.size === "lg" ? "text-sm" : box.size === "xs" || box.size === "xxs" ? "text-[10px]" : "text-xs";
      return (
        <p key={idx} className={`${weight} ${size} text-stone-800 whitespace-pre-wrap`} style={{ color: box.color }}>
          {box.text || ""}
        </p>
      );
    }
    if (box.type === "separator") {
      return <div key={idx} className="border-t border-stone-200 my-2" />;
    }
    if (box.type === "image") {
      return <img key={idx} src={box.url} alt="" className="w-full max-h-40 object-cover bg-stone-100" />;
    }
    if (box.type === "button") {
      return (
        <div key={idx} className="text-center border border-stone-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-emerald-700">
          {box.action?.label || "Button"}
        </div>
      );
    }
    const children = Array.isArray(box.contents) ? box.contents : [];
    return (
      <div key={idx} className={`flex ${box.layout === "horizontal" ? "flex-row items-center" : "flex-col"} gap-2`}>
        {children.map((child: any, childIdx: number) => renderFlexBox(child, childIdx))}
      </div>
    );
  };

  const renderFlexPreview = (contents: any) => {
    if (!contents) return null;
    if (contents.type === "carousel") {
      return (
        <div className="flex gap-3 overflow-x-auto max-w-full">
          {(contents.contents || []).map((bubble: any, idx: number) => (
            <div key={idx} className="w-56 shrink-0 bg-white border border-stone-200 rounded-xl overflow-hidden">
              {renderFlexPreview(bubble)}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm max-w-[92%] text-left">
        {contents.hero && <div>{renderFlexBox(contents.hero)}</div>}
        {contents.header && <div className="p-3 border-b border-stone-100">{renderFlexBox(contents.header)}</div>}
        {contents.body && <div className="p-3 space-y-2">{renderFlexBox(contents.body)}</div>}
        {contents.footer && <div className="p-3 bg-stone-50 border-t border-stone-100">{renderFlexBox(contents.footer)}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6" id="admin_settings_panel">
      <AILoadingModal isOpen={importing} message="iClear Bot กำลังวิเคราะห์และแยกข้อมูลโครงสร้างตาราง..." />
      
      {/* Upper Title Block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 border border-stone-200 rounded-3xl shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">การตั้งค่าและการจัดการระบบ (Admin Console)</h2>
          <p className="text-xs text-stone-500 mt-1 font-sans">
            ควบคุมจัดการข้อมูลผู้ใช้, สิทธิ์การทำงาน (RBAC), โครงการก่อสร้าง และหมวดหมู่การเบิกจ่าย
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* AI Import target select */}
          <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 shadow-xs">
            <Bot className="w-3.5 h-3.5 text-stone-500" />
            <span className="text-[10px] font-extrabold text-stone-400 uppercase tracking-wider hidden sm:inline">เป้าหมายนำเข้า AI:</span>
            <select
              value={selectedImportTab}
              onChange={(e) => setSelectedImportTab(e.target.value as any)}
              className="bg-transparent border-0 outline-none text-xs font-bold text-stone-700 cursor-pointer focus:ring-0 p-0"
            >
              <option value="all">⚡ ทั้งหมด (ตรวจจับอัจฉริยะ)</option>
              <option value="projects">📁 โครงการ & งบประมาณ</option>
              <option value="categories">🏷️ หมวดหมู่ค่าใช้จ่าย</option>
              <option value="document_numbers">🔢 รูปแบบรหัสเอกสาร</option>
              <option value="doc_templates">📄 เทมเพลตเอกสารบริษัท</option>
            </select>
          </div>

          {/* Hidden File Input for AI settings extraction */}
          <input
            type="file"
            id="ai-settings-file-uploader"
            className="hidden"
            accept="image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleAiSettingsImport}
          />
          <button
            onClick={() => document.getElementById("ai-settings-file-uploader")?.click()}
            disabled={importing || saving}
            type="button"
            className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2.5 bg-stone-900 hover:bg-stone-950 text-white rounded-xl shadow-xs transition disabled:opacity-50"
            title="อัปโหลดตารางตั้งค่า รูปภาพ หรือ PDF เพื่อใช้ AI สกัดป้อนอัตโนมัติ"
          >
            <Sparkles className={`w-3.5 h-3.5 ${importing ? "animate-spin text-amber-300" : "text-amber-400"}`} />
            {importing ? "AI กำลังวิเคราะห์สกัด..." : "🪄 นำเข้าตั้งค่าด้วย AI (อัปโหลดไฟล์)"}
          </button>

          <button
            onClick={() => setRawTextImportOpen(true)}
            disabled={importing || saving}
            type="button"
            className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2.5 bg-stone-100 hover:bg-stone-205 text-stone-900 rounded-xl shadow-xs transition disabled:opacity-50 border border-stone-200"
            title="พิมพ์หรือวางข้อความตั้งค่า เพื่อใช้ AI สกัดป้อนอัตโนมัติ"
          >
            <Sparkles className={`w-3.5 h-3.5 ${importing ? "animate-spin text-stone-400" : "text-stone-500"}`} />
            ⌨️ พิมพ์นำเข้าด้วย AI (Text Import)
          </button>

          <button
            onClick={fetchAllData}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 bg-stone-100 hover:bg-stone-200 rounded-xl transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            โหลดข้อมูลใหม่
          </button>
        </div>
      </div>

      {/* AI Imported Settings Preview Modal */}
      {importPreviewOpen && importedData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl border shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <span className="p-1.5 bg-stone-100 rounded-lg text-stone-900">
                <Sparkles className="w-5 h-5 text-amber-500" />
              </span>
              <div>
                <h3 className="font-extrabold text-stone-950 text-sm">สกัดข้อมูลการตั้งค่าอัจฉริยะสำเร็จ ✨</h3>
                <p className="text-[10px] text-stone-400 font-medium">กรุณาตรวจสอบข้อมูลที่ระบบวิเคราะห์พบบนหน้าเอกสารเพื่อนำเข้า</p>
              </div>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 text-xs">
              {/* Reasoning */}
              <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-200/60 text-amber-900 text-[11px] font-semibold leading-relaxed">
                📢 AI สรุปผลการสแกน: {importedData.reasoning}
              </div>

              {/* Projects found */}
              {importedData.projects && importedData.projects.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-stone-800 uppercase tracking-widest text-[9px]">📁 โครงการและงบประมาณที่พบ ({importedData.projects.length})</h4>
                  <div className="bg-stone-50 border p-2 rounded-lg space-y-1">
                    {importedData.projects.map((p: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-[11px] font-semibold py-0.5">
                        <span className="text-stone-850 font-bold">● {p.name}</span>
                        <span className="text-stone-500 font-mono">
                          สัญญา: {(p.contractBudget || 0).toLocaleString()} | ทดรอง: {(p.pettyCashBudget || 0).toLocaleString()} THB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Categories found */}
              {importedData.categories && importedData.categories.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-stone-800 uppercase tracking-widest text-[9px]">🏷️ หมวดหมู่ค่าใช้จ่ายที่พบ ({importedData.categories.length})</h4>
                  <div className="bg-stone-50 border p-2 rounded-lg flex flex-wrap gap-1">
                    {importedData.categories.map((c: string, idx: number) => (
                      <span key={idx} className="bg-white border text-stone-800 font-bold px-2 py-0.5 rounded text-[10px]">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Reference URLs found */}
              {importedData.referenceUrls && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-stone-800 uppercase tracking-widest text-[9px]">🌐 ลิงก์ราคากลางอ้างอิง</h4>
                  <div className="bg-stone-50 border p-2 rounded-lg space-y-1 font-mono text-[10px]">
                    {importedData.referenceUrls.steelPriceUrl && <div>เหล็ก: {importedData.referenceUrls.steelPriceUrl}</div>}
                    {importedData.referenceUrls.laborCostUrl && <div>ค่าแรง: {importedData.referenceUrls.laborCostUrl}</div>}
                    {importedData.referenceUrls.cementPriceUrl && <div>ปูน: {importedData.referenceUrls.cementPriceUrl}</div>}
                  </div>
                </div>
              )}

              {/* Document formats found */}
              {importedData.documentFormats && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-stone-800 uppercase tracking-widest text-[9px]">🔢 รูปแบบรหัสที่ตรวจพบ</h4>
                  <div className="bg-stone-50 border p-2 rounded-lg space-y-1 font-mono text-[10px]">
                    {Object.entries(importedData.documentFormats).map(([k, v]) => (
                      <div key={k}>{k}: <span className="font-bold text-stone-800">{String(v)}</span></div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document template details found */}
              {importedData.docTemplate && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-stone-800 uppercase tracking-widest text-[9px]">📄 ข้อมูลเทมเพลตเอกสารบริษัท</h4>
                  <div className="bg-stone-50 border p-2 rounded-lg space-y-1 text-[10px]">
                    {importedData.docTemplate.companyName && <div>ชื่อบริษัท: <span className="text-stone-850 font-bold">{importedData.docTemplate.companyName}</span></div>}
                    {importedData.docTemplate.companyAddress && <div>ที่อยู่: <span className="text-stone-600">{importedData.docTemplate.companyAddress}</span></div>}
                    {importedData.docTemplate.companyContact && <div>ช่องทางติดต่อ: <span className="text-stone-600">{importedData.docTemplate.companyContact}</span></div>}
                    {importedData.docTemplate.companyLogoUrl && <div>URL โลโก้: <span className="text-blue-600 underline font-mono break-all">{importedData.docTemplate.companyLogoUrl}</span></div>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t">
              <button
                type="button"
                onClick={() => {
                  setImportedData(null);
                  setImportPreviewOpen(false);
                }}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl text-xs transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmAiImport}
                disabled={saving}
                className="px-4 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> ยืนยันการเติมข้อมูล (Merge Settings)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub tabs switches */}
      <div className="flex flex-wrap border-b border-stone-200 bg-white p-2 rounded-2xl border gap-2">
        <button
          onClick={() => {
            setActiveSubTab("users");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "users"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Users className="w-4 h-4" />
          จัดการผู้ใช้งาน & อนุมัติสิทธิ์ ({employees.length})
        </button>
        <button
          onClick={() => {
            setActiveSubTab("projects");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "projects"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <FolderGit className="w-4 h-4" />
          จัดการโครงการ (Cost Centers)
        </button>
        <button
          onClick={() => {
            setActiveSubTab("categories");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "categories"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Tag className="w-4 h-4" />
          หมวดหมู่ค่าใช้จ่าย
        </button>
        <button
          onClick={() => {
            setActiveSubTab("ai_bot");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "ai_bot"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          ตั้งค่า AI สมองกล
        </button>
        <button
          onClick={() => {
            setActiveSubTab("ai_ocr");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "ai_ocr"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Maximize className="w-4 h-4" />
          ตั้งค่า AI OCR
        </button>
        <button
          onClick={() => {
            setActiveSubTab("document_numbers");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "document_numbers"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          ตั้งค่ารหัสเอกสาร
        </button>
        <button
          onClick={() => {
            setActiveSubTab("doc_templates");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "doc_templates"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <FileText className="w-4 h-4" />
          ตั้งค่าเทมเพลตเอกสาร
        </button>
        <button
          onClick={() => {
            setActiveSubTab("line_notifications");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "line_notifications"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Bell className="w-4 h-4" />
          ตั้งค่าการแจ้งเตือน
        </button>
        <button
          onClick={() => {
            setActiveSubTab("approval_workflow");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "approval_workflow"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Settings className="w-4 h-4" />
          ลำดับการอนุมัติ (Workflow)
        </button>
        <button
          onClick={() => {
            setActiveSubTab("workspace");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "workspace"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Cloud className="w-4 h-4" />
          ซิงค์ Google Workspace (Sheets / Drive)
        </button>
        <button
          onClick={() => {
            setActiveSubTab("system_usage");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "system_usage"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Activity className="w-4 h-4" />
          การใช้งาน AI & สำรองข้อมูล
        </button>
        <button
          onClick={() => {
            setActiveSubTab("advance_data");
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === "advance_data"
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Advance Data Center
        </button>
        <button
          onClick={() => {
            setActiveSubTab("data_import" as any);
            setError(null);
            setSuccess(null);
          }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            activeSubTab === ("data_import" as any)
              ? "bg-stone-950 text-stone-50 shadow-sm"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          <Database className="w-4 h-4 text-amber-500" />
          นำเข้า Excel เข้า Firestore
        </button>
      </div>

      {/* Notifications banner */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-2xl text-xs flex items-center gap-3 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs flex items-center gap-3 animate-fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{success}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-white border border-stone-200 rounded-3xl shadow-xs p-6">
        {loading ? (
          <div className="text-center py-16 text-stone-500 text-xs flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <span>กำลังโหลดฐานข้อมูล...</span>
          </div>
        ) : (
          <>
            {/* SUB TAB: User Management */}
            {activeSubTab === "users" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-stone-900">ทะเบียนและระดับสิทธิ์ผู้ใช้งาน (User & Role Directory)</h3>
                    <p className="text-xs text-stone-500">
                      อนุมัติพนักงานที่ลงทะเบียนเข้ามาใหม่ ยกระดับสิทธิ์ หรือเปลี่ยนสถานะการเปิดใช้งาน
                    </p>
                  </div>

                  <div className="flex bg-stone-100 border border-stone-200 rounded-lg p-0.5 shrink-0 self-start sm:self-auto">
                    <button
                      onClick={() => exportToExcel(employees, `Employees_Directory_${new Date().toISOString().split('T')[0]}`)}
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold flex items-center gap-1 text-emerald-700 hover:bg-emerald-50 transition"
                      title="ส่งออกรายชื่อพนักงานเป็น Excel"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                    </button>
                    <div className="w-[1px] bg-stone-200 mx-0.5 my-1" />
                    <button
                      type="button"
                      onClick={() => setIsBulkImportUsersOpen(true)}
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold flex items-center gap-1 text-blue-700 hover:bg-blue-50 transition"
                      title="นำเข้ารายชื่อพนักงานหลายรายการ (Bulk Import)"
                    >
                      <Plus className="w-3.5 h-3.5" /> นำเข้า (Bulk)
                    </button>
                    <div className="w-[1px] bg-stone-200 mx-0.5 my-1" />
                    <button
                      onClick={() => setViewMode("table")}
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                        viewMode === "table" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <List className="w-3.5 h-3.5" /> ตาราง
                    </button>
                    <button
                      onClick={() => setViewMode("card")}
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                        viewMode === "card" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" /> การ์ด
                    </button>
                  </div>
                </div>

                {viewMode === "table" ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                          <th className="py-3 px-4">รูปโปรไฟล์</th>
                          <th className="py-3 px-4">ชื่อ / บัญชีผู้ใช้</th>
                          <th className="py-3 px-4">บทบาท (RBAC)</th>
                          <th className="py-3 px-4">บัญชีธนาคาร</th>
                          <th className="py-3 px-4">สถานะ (Status)</th>
                          <th className="py-3 px-4 text-right">ดำเนินการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {employees.map((emp) => {
                          const isPending = emp.isApprovedByAdmin === false;
                          return (
                            <tr key={emp.id} className="hover:bg-stone-50/50">
                              
                              {/* Profile Thumbnail Render */}
                              <td className="py-3 px-4">
                                <div className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                                  {emp.profilePhotoURL || emp.profileImage ? (
                                    <img 
                                      src={emp.profilePhotoURL || emp.profileImage} 
                                      alt={emp.name} 
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <Users className="w-4 h-4 text-stone-400" />
                                  )}
                                </div>
                              </td>

                              <td className="py-3 px-4">
                                <div className="font-bold text-stone-900">{emp.name}</div>
                                {emp.username && (
                                  <div className="text-[10px] text-stone-500 font-mono">
                                    @{emp.username}
                                  </div>
                                )}
                                <div className="text-[10px] text-stone-400 font-mono">ID: {emp.id}</div>
                                {emp.plainPin && (
                                  <div className="text-[10px] text-stone-600 font-mono bg-stone-100 px-1.5 py-0.5 rounded w-max mt-1 border border-stone-200/50">
                                    PIN/รหัส: <span className="font-extrabold text-stone-950">{emp.plainPin}</span>
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-4 font-semibold">
                                {isPending ? (
                                  <span className="text-amber-600 bg-amber-50 px-2 py-0.5 border border-amber-200/50 rounded-md font-bold">
                                    รอ Admin กำหนดบทบาท
                                  </span>
                                ) : (
                                  <select
                                    value={emp.role}
                                    onChange={(e) => handleRoleChange(emp.id, emp.username || "", e.target.value as UserRole)}
                                    className="bg-stone-50 border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-800"
                                  >
                                    <option value={UserRole.EMPLOYEE}>Employee (พนักงาน)</option>
                                    <option value={UserRole.MANAGER}>Manager (ผู้จัดการ)</option>
                                    <option value={UserRole.ACCOUNTANT}>Accountant (นักบัญชี)</option>
                                    <option value={UserRole.ADMIN}>Admin (ผู้ดูแลระบบ)</option>
                                  </select>
                                )}
                              </td>

                              <td className="py-3 px-4 font-mono text-[11px] text-stone-600">
                                <div className="font-sans font-semibold text-stone-800">{emp.bankName}</div>
                                <div>{emp.bankNo}</div>
                                <div className="text-[10px] text-stone-400 font-sans">{emp.bankAccountName}</div>
                              </td>

                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      emp.status === "Active" || emp.isActive !== false
                                        ? "bg-emerald-500"
                                        : "bg-red-500"
                                    }`}
                                  />
                                  <span className="font-bold">
                                    {emp.status || (emp.isActive !== false ? "Active" : "Suspended")}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3 px-4 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => startEditEmployee(emp)}
                                    className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md font-bold text-[10px] border border-stone-250"
                                  >
                                    แก้ไข
                                  </button>
                                  {isPending ? (
                                    <>
                                      {/* Fast approval buttons directly inside admin management */}
                                      <button
                                        onClick={() => handleApproveUser(emp, UserRole.EMPLOYEE)}
                                        disabled={saving}
                                        className="px-2.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-stone-50 font-bold rounded-lg transition"
                                      >
                                        อนุมัติ (Employee)
                                      </button>
                                      <button
                                        onClick={() => handleApproveUser(emp, UserRole.MANAGER)}
                                        disabled={saving}
                                        className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg transition"
                                      >
                                        อนุมัติ (Manager)
                                      </button>
                                      <button
                                        onClick={() => handleRejectUser(emp.id)}
                                        disabled={saving}
                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                                        title="ปฏิเสธการลงทะเบียน"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => handleStatusToggle(emp.id, emp.status || "Active")}
                                      disabled={saving}
                                      className={`px-2 py-1 rounded-md font-bold text-[10px] transition ${
                                        emp.status === "Active" || emp.isActive !== false
                                          ? "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                                          : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                                      }`}
                                    >
                                      {emp.status === "Active" || emp.isActive !== false ? "ระงับการใช้" : "เปิดการใช้งาน"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                                    disabled={saving}
                                    className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md font-bold text-[10px] border border-red-200 flex items-center gap-1 transition"
                                    title="ลบพนักงานอย่างถาวร"
                                  >
                                    <Trash2 className="w-3 h-3" /> ลบ
                                  </button>
                                </div>
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {employees.map((emp) => {
                      const isPending = emp.isApprovedByAdmin === false;
                      return (
                        <div key={emp.id} className="bg-stone-50 border border-stone-200 rounded-2xl p-4 shadow-xs hover:shadow-sm transition flex flex-col justify-between gap-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-stone-200 border border-stone-300 overflow-hidden flex items-center justify-center shrink-0">
                                {emp.profilePhotoURL || emp.profileImage ? (
                                  <img 
                                    src={emp.profilePhotoURL || emp.profileImage} 
                                    alt={emp.name} 
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <Users className="w-5 h-5 text-stone-500" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-bold text-stone-900 text-sm truncate">{emp.name}</h4>
                                {emp.username && (
                                  <p className="text-[10px] text-stone-500 font-mono truncate">@{emp.username}</p>
                                )}
                                <p className="text-[9px] text-stone-400 font-mono truncate">ID: {emp.id}</p>
                                {emp.plainPin && (
                                  <p className="text-[10px] text-stone-600 font-mono bg-stone-200/50 px-1.5 py-0.5 rounded w-max mt-1 border border-stone-300/30">
                                    PIN/รหัส: <span className="font-extrabold text-stone-950">{emp.plainPin}</span>
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="border-t border-stone-200/60 pt-2.5 space-y-2 text-xs">
                              <div className="flex justify-between items-center">
                                <span className="text-stone-400 text-[10px] font-bold">บทบาท (RBAC)</span>
                                {isPending ? (
                                  <span className="text-amber-600 bg-amber-50 px-2 py-0.5 border border-amber-200/50 rounded-md font-bold text-[10px]">
                                    รอ Admin อนุมัติ
                                  </span>
                                ) : (
                                  <select
                                    value={emp.role}
                                    onChange={(e) => handleRoleChange(emp.id, emp.username || "", e.target.value as UserRole)}
                                    className="bg-white border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-800 text-[11px]"
                                  >
                                    <option value={UserRole.EMPLOYEE}>Employee (พนักงาน)</option>
                                    <option value={UserRole.MANAGER}>Manager (ผู้จัดการ)</option>
                                    <option value={UserRole.ACCOUNTANT}>Accountant (นักบัญชี)</option>
                                    <option value={UserRole.ADMIN}>Admin (ผู้ดูแลระบบ)</option>
                                  </select>
                                )}
                              </div>

                              <div className="bg-white p-2.5 rounded-xl border border-stone-250/60 space-y-1">
                                <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block">ช่องทางรับเงินโอน</span>
                                <p className="font-bold text-stone-800 text-[11px] truncate">{emp.bankName || "ยังไม่บันทึกธนาคาร"}</p>
                                {emp.bankNo && <p className="text-[10px] text-stone-600 font-mono truncate">{emp.bankNo}</p>}
                                {emp.bankAccountName && <p className="text-[9px] text-stone-500 truncate">({emp.bankAccountName})</p>}
                              </div>

                              <div className="flex justify-between items-center pt-1">
                                <span className="text-stone-400 text-[10px] font-bold">สถานะบัญชี</span>
                                <div className="flex items-center gap-1.5 bg-white border border-stone-200 px-2.5 py-1 rounded-full">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      emp.status === "Active" || emp.isActive !== false
                                        ? "bg-emerald-500"
                                        : "bg-red-500"
                                    }`}
                                  />
                                  <span className="font-bold text-[10px] text-stone-700">
                                    {emp.status || (emp.isActive !== false ? "Active" : "Suspended")}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-3 border-t border-stone-200/60 flex flex-col gap-2 w-full">
                            <button
                              onClick={() => startEditEmployee(emp)}
                              className="w-full py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl text-[11px] border border-stone-250 text-center transition"
                            >
                              📝 แก้ไขข้อมูลทั้งหมด
                            </button>
                            {isPending ? (
                              <div className="flex justify-end gap-1.5 w-full">
                                <button
                                  onClick={() => handleApproveUser(emp, UserRole.EMPLOYEE)}
                                  disabled={saving}
                                  className="flex-1 py-1.5 bg-stone-900 hover:bg-stone-800 text-stone-50 font-bold rounded-lg text-[10px] text-center transition"
                                >
                                  Employee
                                </button>
                                <button
                                  onClick={() => handleApproveUser(emp, UserRole.MANAGER)}
                                  disabled={saving}
                                  className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-[10px] text-center transition"
                                >
                                  Manager
                                </button>
                                <button
                                  onClick={() => handleRejectUser(emp.id)}
                                  disabled={saving}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition shrink-0"
                                  title="ปฏิเสธการลงทะเบียน"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleStatusToggle(emp.id, emp.status || "Active")}
                                disabled={saving}
                                className={`w-full py-2 rounded-xl font-bold text-[11px] transition ${
                                  emp.status === "Active" || emp.isActive !== false
                                    ? "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                                    : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                                }`}
                              >
                                {emp.status === "Active" || emp.isActive !== false ? "🔴 ระงับสิทธิ์การใช้งาน" : "🟢 เปิดสิทธิ์การใช้งาน"}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                              disabled={saving}
                              className="w-full py-2 bg-red-600 hover:bg-red-750 text-white font-bold rounded-xl text-[11px] transition flex items-center justify-center gap-1.5 shadow-sm"
                              title="ลบข้อมูลพนักงานถาวร"
                            >
                              <Trash2 className="w-4 h-4" /> 🗑️ ลบพนักงานถาวร
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* SUB TAB: Projects Administration */}
            {activeSubTab === "projects" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">จัดการโครงการก่อสร้าง (Project Settings)</h3>
                  <p className="text-xs text-stone-500">
                    เพิ่มโครงการใหม่ สำหรับให้พนักงานเลือกเบิกจ่าย
                  </p>
                </div>

                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-stone-500" />
                    <span className="text-xs font-semibold text-stone-700">พื้นที่เก็บข้อมูลโครงการ:</span>
                    <span className="text-xs font-bold text-emerald-600">ไม่จำกัด (Unlimited)</span>
                  </div>
                  <div className="text-[10px] text-stone-500 font-medium">
                    จำนวนโฟลเดอร์โครงการ: <span className="font-bold text-stone-900">{projects.length}</span> โฟลเดอร์
                  </div>
                </div>

                {/* Add New project form */}
                <div className="flex flex-wrap items-center gap-2">
                  <form onSubmit={handleAddProject} className="flex-1 flex gap-2 max-w-md">
                    <input
                      type="text"
                      required
                      placeholder="ป้อนชื่อโครงการ เช่น Project Gamma (ศูนย์กระจายสินค้า)"
                      value={newProject}
                      onChange={(e) => setNewProject(e.target.value)}
                      className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl transition flex items-center gap-1 shrink-0 text-xs"
                    >
                      <Plus className="w-4 h-4" /> เพิ่มโครงการ
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => setIsBulkImportProjectsOpen(true)}
                    className="px-4 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 font-bold rounded-xl transition flex items-center gap-1 shrink-0 text-xs"
                  >
                    <Plus className="w-4 h-4 text-stone-500" /> นำเข้าโครงการแบบกลุ่ม (Bulk Import)
                  </button>
                </div>

                {/* List Table */}
                <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                        <th className="py-3 px-4">ชื่อโครงการ / รายละเอียดงบประมาณ</th>
                        <th className="py-3 px-4 text-center w-32">งบประมาณ (THB)</th>
                        <th className="py-3 px-4 text-center w-32">งบทดรองจ่าย (THB)</th>
                        <th className="py-3 px-4 text-center w-20">ดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {projects.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-stone-400 font-bold italic">
                            ไม่มีรายชื่อโครงการในระบบ กรุณาป้อนเพิ่มโครงการด้านบน
                          </td>
                        </tr>
                      ) : (
                        projects.map((proj, i) => {
                          return (
                            <tr key={i} className="hover:bg-stone-50/30">
                              <td className="py-3 px-4">
                                {editingProjectIndex === i ? (
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      value={editingProjectText}
                                      onChange={(e) => setEditingProjectText(e.target.value)}
                                      className="px-2 py-1 bg-stone-50 border border-stone-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 w-full max-w-[200px] font-bold"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleEditProjectName(i)}
                                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingProjectIndex(null)}
                                      className="p-1 text-stone-500 hover:bg-stone-100 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="font-bold text-stone-900">{proj}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <label className="text-[9px] font-black text-stone-400 uppercase tracking-tighter">รหัสโครงการ:</label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setProjectDialog({
                                              isOpen: true,
                                              proj: proj,
                                              details: projectDetails[proj] || { contractBudget: 0, pettyCashBudget: 0, projectId: "" }
                                          });
                                        }}
                                        className="bg-transparent border-b border-dashed border-stone-300 text-[10px] font-mono font-bold text-stone-600 focus:outline-none focus:border-stone-900 w-24 text-left"
                                      >
                                        {projectDetails[proj]?.projectId || "คลิกเพื่อแก้ไข..."}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <input
                                  type="number"
                                  value={projectDetails[proj]?.contractBudget || 0}
                                  onChange={(e) => handleProjectDetailBudgetChange(proj, "contractBudget", e.target.value)}
                                  className="w-full bg-transparent text-center font-mono font-bold text-stone-900 text-[11px] focus:outline-none"
                                />
                              </td>
                              <td className="py-3 px-4 text-center">
                                <input
                                  type="number"
                                  value={projectDetails[proj]?.pettyCashBudget || 0}
                                  onChange={(e) => handleProjectDetailBudgetChange(proj, "pettyCashBudget", e.target.value)}
                                  className="w-full bg-transparent text-center font-mono font-bold text-stone-900 text-[11px] focus:outline-none"
                                />
                              </td>
                              
                              <td className="py-3 px-4 text-center">
                                <div className="flex justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingProjectIndex(i);
                                      setEditingProjectText(proj);
                                    }}
                                    disabled={saving}
                                    className="p-1.5 text-stone-500 hover:bg-stone-50 rounded-lg transition"
                                    title="แก้ไขชื่อโครงการ"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveProject(proj)}
                                    disabled={saving}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                                    title="ลบโครงการ"
                                  >
                                    <Trash2 className="w-4.5 h-4.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {projects.length > 0 && (
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleSaveProjectDetails}
                      disabled={saving}
                      className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-xs"
                    >
                      <Check className="w-4 h-4" /> บันทึกงบประมาณและรายละเอียดทั้งหมด
                    </button>
                  </div>
                )}

                {projectDialog && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
                      <h3 className="text-sm font-bold text-stone-900 border-b pb-3">แก้ไขข้อมูลโครงการ</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-black text-stone-400 uppercase">ชื่อโครงการ</label>
                          <input type="text" value={projectDialog.proj} disabled className="w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-xl text-xs font-bold" />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-stone-400 uppercase">รหัสโครงการ (Prefix: {projectDialog.proj.substring(0, 3).toUpperCase()})</label>
                          <div className="flex items-center gap-1">
                             <span className="font-mono text-xs font-bold text-stone-950">{projectDialog.proj.substring(0, 3).toUpperCase()}-</span>
                             <input
                               type="text"
                               value={projectDialog.details.projectId?.replace(projectDialog.proj.substring(0, 3).toUpperCase() + "-", "") || ""}
                               onChange={(e) => {
                                 setProjectDialog({ ...projectDialog, details: { ...projectDialog.details, projectId: projectDialog.proj.substring(0, 3).toUpperCase() + "-" + e.target.value } });
                               }}
                               className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold"
                               placeholder="รหัสต่อท้าย"
                             />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-stone-400 uppercase">งบประมาณตามสัญญา (THB)</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={projectDialog.details.contractBudget || ""}
                              onChange={(e) => setProjectDialog({...projectDialog, details: {...projectDialog.details, contractBudget: parseFloat(e.target.value) || 0}})}
                              className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-1 focus:ring-stone-950"
                              placeholder="เช่น 15000000"
                            />
                            <button
                              type="button"
                              disabled={estimatingBudgetFor !== null || !(projectDialog.details.contractBudget > 0)}
                              onClick={() => handleEstimateBudget(projectDialog.proj, projectDialog.details.contractBudget)}
                              className="px-3 py-2 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-850 font-bold rounded-xl text-xs transition flex items-center gap-1 shrink-0 h-9 cursor-pointer"
                              title="ให้ AI ประมาณการงบสำรองจ่ายหน้างานตามหลักความเหมาะสม"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                              {estimatingBudgetFor === projectDialog.proj ? "กำลังคำนวณ..." : "AI ประเมิน"}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-stone-400 uppercase">งบเงินทดรองจ่ายสำรองหน้างาน (THB)</label>
                          <input
                            type="number"
                            value={projectDialog.details.pettyCashBudget || ""}
                            onChange={(e) => setProjectDialog({...projectDialog, details: {...projectDialog.details, pettyCashBudget: parseFloat(e.target.value) || 0}})}
                            className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-1 focus:ring-stone-950"
                            placeholder="เช่น 1200000"
                          />
                        </div>
                        {projectDialog.details.aiReasoning && (
                          <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-xl">
                            <span className="text-[9px] font-black text-amber-800 uppercase block mb-1">เหตุผลเชิงเทคนิคและสถิติจาก AI:</span>
                            <p className="text-[10px] text-amber-900 leading-relaxed font-medium">{projectDialog.details.aiReasoning}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                         <button onClick={() => setProjectDialog(null)} className="px-4 py-2 text-xs font-bold text-stone-500 hover:bg-stone-100 rounded-xl">ยกเลิก</button>
                         <button onClick={() => {
                             setProjectDetails(prev => {
                                const updatedDetails = { ...prev, [projectDialog.proj]: projectDialog.details };
                                // Sync projectBudgets
                                const syncBudgets: { [key: string]: number } = {};
                                Object.entries(updatedDetails).forEach(([projName, det]) => {
                                  syncBudgets[projName] = det.contractBudget || 0;
                                });
                                setProjBudgets(syncBudgets);

                                // Save to Firestore
                                const settingsRef = doc(db, "settings", "global");
                                setDoc(settingsRef, {
                                  projectDetails: updatedDetails,
                                  projectBudgets: syncBudgets
                                }, { merge: true }).then(() => {
                                  setSuccess(`ปรับปรุงข้อมูลโครงการ "${projectDialog.proj}" สำเร็จและบันทึกลง Firestore แล้ว ✨`);
                                }).catch((err: any) => {
                                  console.error(err);
                                  setError("ไม่สามารถเซฟโครงการลงฐานข้อมูล: " + err.message);
                                });

                                return updatedDetails;
                              });
                             setProjectDialog(null);
                         }} className="px-4 py-2 text-xs font-bold bg-stone-950 text-white rounded-xl">บันทึก</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUB TAB: Categories Administration */}
            {activeSubTab === "categories" && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-stone-900">จัดการหมวดหมู่ค่าใช้จ่าย (Expense Categories)</h3>
                    <p className="text-xs text-stone-500">
                      กำหนดหมวดหมู่ของค่าใช้จ่ายในระบบเบิกจ่าย เพื่อใช้วัดผลและจัดกลุ่มบัญชีในรายงานสถิติทางการเงิน
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const dataToExport = categories.map(cat => ({ "ชื่อหมวดหมู่": cat }));
                      exportToExcel(dataToExport, "Expense_Categories");
                    }}
                    className="p-2 bg-white border border-stone-200 text-stone-600 hover:text-emerald-600 rounded-xl shadow-xs transition flex items-center gap-1.5 text-[10px] font-bold"
                  >
                    <Download className="w-3.5 h-3.5" /> Export Excel
                  </button>
                </div>

                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-stone-500" />
                    <span className="text-xs font-semibold text-stone-700">พื้นที่เก็บข้อมูลหมวดหมู่:</span>
                    <span className="text-xs font-bold text-emerald-600">ไม่จำกัด (Unlimited)</span>
                  </div>
                  <div className="text-[10px] text-stone-500 font-medium">
                    จำนวนหมวดหมู่: <span className="font-bold text-stone-900">{categories.length}</span> โฟลเดอร์
                  </div>
                </div>

                {/* Add new category form */}
                <div className="flex flex-wrap items-center gap-2">
                  <form onSubmit={handleAddCategory} className="flex-1 flex gap-2 max-w-md">
                    <input
                      type="text"
                      required
                      placeholder="เช่น Material Cost (ค่าวัสดุก่อสร้าง)"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl transition flex items-center gap-1 shrink-0 text-xs"
                    >
                      <Plus className="w-4 h-4" /> เพิ่มหมวดหมู่
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => setIsBulkImportCategoriesOpen(true)}
                    className="px-4 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 font-bold rounded-xl transition flex items-center gap-1 shrink-0 text-xs"
                  >
                    <Plus className="w-4 h-4 text-stone-500" /> นำเข้าหมวดหมู่แบบกลุ่ม (Bulk Import)
                  </button>
                </div>

                {/* List Table */}
                <div className="max-w-2xl border border-stone-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                        <th className="py-2.5 px-4">ชื่อหมวดหมู่ค่าใช้จ่าย</th>
                        <th className="py-2.5 px-4 w-40">รหัสหมวดหมู่ (Category ID)</th>
                        <th className="py-2.5 px-4 text-right">ดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {categories.map((cat, i) => (
                        <tr key={i} className="hover:bg-stone-50/30">
                          <td className="py-3 px-4 font-semibold text-stone-800">
                            {editingCategoryIndex === i ? (
                              <div className="flex gap-2 items-center">
                                <input
                                  type="text"
                                  value={editingCategoryText}
                                  onChange={(e) => setEditingCategoryText(e.target.value)}
                                  className="px-2 py-1 bg-stone-50 border border-stone-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 w-full max-w-[200px] font-bold"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleEditCategory(i)}
                                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCategoryIndex(null)}
                                  className="p-1 text-stone-500 hover:bg-stone-100 rounded"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              cat
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <input
                              type="text"
                              placeholder="เช่น CAT-01"
                              value={categoryDetails[cat]?.categoryId || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCategoryDetails(prev => ({
                                  ...prev,
                                  [cat]: { categoryId: val }
                                }));
                              }}
                              className="bg-transparent border-b border-dashed border-stone-300 text-[11px] font-mono font-bold text-stone-600 focus:outline-none focus:border-stone-900 w-full"
                            />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCategoryIndex(i);
                                  setEditingCategoryText(cat);
                                }}
                                disabled={saving}
                                className="p-1 text-stone-500 hover:bg-stone-50 rounded transition"
                                title="แก้ไข"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                 type="button"
                                 onClick={() => handleRemoveCategory(cat)}
                                 disabled={saving}
                                 className="p-1 text-red-500 hover:bg-red-50 rounded transition"
                                 title="ลบหมวดหมู่"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {categories.length > 0 && (
                  <div className="flex justify-start max-w-2xl pt-2">
                    <button
                      type="button"
                      onClick={handleSaveCategoryDetails}
                      disabled={saving}
                      className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> บันทึกรหัสหมวดหมู่ทั้งหมด
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SUB TAB: AI Bot Settings */}
            {activeSubTab === "ai_bot" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">การตั้งค่าความฉลาดของระบบ (AI Intelligence Center)</h3>
                  <p className="text-xs text-stone-500">
                    ตั้งค่ารุ่นโมเดล Gemini และแหล่งข้อมูลราคากลาง รวมถึงตรวจสอบปริมาณการใช้งานและงบประมาณ AI
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <form onSubmit={handleSaveAiConfig} className="space-y-6 bg-white border border-stone-200 p-6 rounded-2xl shadow-xs">
                      <div className="space-y-4">
                        <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider border-b pb-2 flex items-center gap-2">
                          <Bot className="w-4 h-4 text-stone-950" /> 1. รุ่นโมเดลสมองกล (Gemini Model Selection)
                        </h4>
                        
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-stone-700 block">เลือกโมเดล Gemini ที่ต้องการใช้งานในระบบ (คลิกที่แถวเพื่อเลือก)</label>
                          <div className="overflow-hidden border border-stone-200 rounded-xl shadow-sm bg-white">
                            <table className="w-full text-left text-[11px] border-collapse">
                              <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">Model</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">RPM</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">TPM</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">RPD</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-50">
                                {GEMINI_MODELS.map(m => (
                                  <tr 
                                    key={m.id} 
                                    onClick={() => setSelectedGeminiModel(m.id)}
                                    className={`cursor-pointer transition-colors ${
                                      selectedGeminiModel === m.id ? "bg-stone-900 text-white" : "hover:bg-stone-50"
                                    }`}
                                  >
                                    <td className="py-3 px-4">
                                      <div className="font-bold">{m.name}</div>
                                      <div className={`text-[9px] ${selectedGeminiModel === m.id ? "text-stone-400" : "text-stone-500"}`}>{m.description}</div>
                                    </td>
                                    <td className="py-3 px-4 font-mono font-bold text-stone-500">{m.rpm}</td>
                                    <td className="py-3 px-4 font-mono font-bold text-stone-500">{m.tpm}</td>
                                    <td className="py-3 px-4 font-mono font-bold text-stone-500">{m.rpd}</td>
                                    <td className="py-3 px-4 text-center">
                                      {selectedGeminiModel === m.id ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-black uppercase text-[8px]">
                                          <Check className="w-2.5 h-2.5" /> Active
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone-100 text-stone-400 rounded-full font-black uppercase text-[8px]">
                                          Standby
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-stone-400 pt-1 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-500" /> 
                            ข้อมูลการใช้งาน RPM/TPM/RPD อ้างอิงจากขีดจำกัดการใช้งานจริง (Rate Limits) ของแต่ละโมเดล
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-stone-100">
                        <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider border-b pb-2 flex items-center gap-2">
                          <Eye className="w-4 h-4 text-stone-700" /> 2. แหล่งข้อมูลเว็บไซต์อ้างอิงของ AI (Reference Web Links)
                        </h4>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-stone-700 block">ลิงก์ราคากลางเหล็ก (Steel Price)</label>
                            <input
                              type="url"
                              required
                              placeholder="https://www.depthai.go.th"
                              value={steelPriceUrl}
                              onChange={(e) => setSteelPriceUrl(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-stone-700 block">ลิงก์ราคากลางค่าแรง (Labor Rates)</label>
                            <input
                              type="url"
                              required
                              placeholder="https://www.moph.go.th"
                              value={laborCostUrl}
                              onChange={(e) => setLaborCostUrl(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                            />
                          </div>

                          <div className="space-y-1.5 sm:col-span-2">
                            <label className="text-xs font-bold text-stone-700 block">ลิงก์ราคากลางปูนและวัสดุ (Materials Reference)</label>
                            <input
                              type="url"
                              required
                              placeholder="https://www.moc.go.th"
                              value={cementPriceUrl}
                              onChange={(e) => setCementPriceUrl(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-stone-50 font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
                        >
                          <Check className="w-4 h-4" /> บันทึกการตั้งค่าสมองกล
                        </button>
                      </div>
                    </form>

                    {/* AI Usage Logs */}
                    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
                      <div className="p-4 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider flex items-center gap-2">
                            <Activity className="w-4 h-4 text-stone-600" /> ประวัติการเรียกใช้ AI ล่าสุด (AI Usage History)
                          </h4>
                          <button
                            type="button"
                            onClick={() => {
                              const dataToExport = aiUsageLogs.map(log => ({
                                "วัน-เวลา": new Date(log.timestamp).toLocaleString("th-TH"),
                                "ประเภท": log.taskType,
                                "รุ่นโมเดล": log.model,
                                "ผู้ใช้": log.userName,
                                "ค่าใช้จ่าย (฿)": log.estimatedCostThb
                              }));
                              exportToExcel(dataToExport, "AI_Usage_Logs");
                            }}
                            className="p-1.5 bg-white border border-stone-200 text-stone-600 hover:text-emerald-600 rounded-lg shadow-xs transition flex items-center gap-1 text-[10px] font-bold"
                          >
                            <Download className="w-3 h-3" /> Export Excel
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[10px] font-bold text-stone-500 uppercase">Live Tracking</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead className="bg-stone-50/50 border-b border-stone-100">
                            <tr>
                              <th className="py-2.5 px-4 font-bold text-stone-400">วัน-เวลา</th>
                              <th className="py-2.5 px-4 font-bold text-stone-400">ประเภท</th>
                              <th className="py-2.5 px-4 font-bold text-stone-400">รุ่นโมเดล</th>
                              <th className="py-2.5 px-4 font-bold text-stone-400">ผู้ใช้</th>
                              <th className="py-2.5 px-4 font-bold text-stone-400 text-right">ค่าใช้จ่าย (โดยประมาณ)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-50">
                            {aiUsageLogs.length > 0 ? aiUsageLogs.map(log => (
                              <tr key={log.id} className="hover:bg-stone-50/30 transition">
                                <td className="py-2.5 px-4 font-medium text-stone-500">{new Date(log.timestamp).toLocaleString("th-TH")}</td>
                                <td className="py-2.5 px-4">
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                    log.taskType === "OCR" ? "bg-blue-50 text-blue-700" :
                                    log.taskType === "CHAT" ? "bg-amber-50 text-amber-700" : "bg-stone-50 text-stone-700"
                                  }`}>
                                    {log.taskType}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-stone-600 font-mono text-[10px]">{log.model}</td>
                                <td className="py-2.5 px-4 font-bold text-stone-900">{log.userName}</td>
                                <td className="py-2.5 px-4 text-right font-black text-stone-950">฿{log.estimatedCostThb.toFixed(4)}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-stone-400 italic">ไม่พบประวัติการเรียกใช้งาน AI ในขณะนี้</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar Stats */}
                  <div className="space-y-6">
                    {/* DB Statistics */}
                    <div className="bg-stone-950 text-stone-100 p-6 rounded-3xl space-y-6 shadow-xl relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Cloud className="w-24 h-24" />
                      </div>
                      <div className="relative z-10 space-y-4">
                        <h4 className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-stone-400">
                          <HardDrive className="w-4 h-4" /> ปริมาณการใช้ฐานข้อมูล (Firestore Usage)
                        </h4>
                        
                        <div className="space-y-3">
                          {Object.entries(dbStats).map(([coll, count]) => (
                            <div key={coll} className="flex justify-between items-center text-xs border-b border-stone-800 pb-2">
                              <span className="text-stone-500 font-medium capitalize">{coll.replace(/([A-Z])/g, ' $1').trim()}</span>
                              <span className="font-mono font-bold text-stone-200">{count.toLocaleString()} <span className="text-[10px] text-stone-600 font-normal">docs</span></span>
                            </div>
                          ))}
                        </div>

                        <div className="pt-2 space-y-2">
                          <div className="flex justify-between items-center text-[11px] font-bold">
                            <span className="text-stone-400">พื้นที่จัดเก็บโดยรวม</span>
                            <span className="text-emerald-400">ปกติ (Free Tier)</span>
                          </div>
                          <div className="w-full bg-stone-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full w-[15%]" />
                          </div>
                          <p className="text-[10px] text-stone-500 leading-relaxed italic">
                            💡 ระบบใช้ Firebase Free Tier (1GB Storage). ขณะนี้การใช้งานยังอยู่ในระดับต่ำ หากยอดเบิกเกิน 50,000 รายการ/วัน อาจมีค่าใช้จ่ายเพิ่มเติม
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* AI Cost Summary */}
                    <div className="bg-white border border-stone-200 p-6 rounded-3xl space-y-4 shadow-sm">
                      <h4 className="text-xs font-black text-stone-900 uppercase tracking-wider flex items-center gap-2">
                        <Tag className="w-4 h-4 text-amber-500" /> สรุปงบประมาณ AI เดือนนี้
                      </h4>
                      <div className="space-y-4">
                        <div className="text-center py-4 bg-stone-50 rounded-2xl border border-stone-100">
                          <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดใช้จ่ายสะสม (Est.)</p>
                          <p className="text-3xl font-black text-stone-950">฿{aiUsageLogs.reduce((sum, l) => sum + l.estimatedCostThb, 0).toFixed(2)}</p>
                        </div>
                        
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-500">จำนวนการสกัด (OCR)</span>
                            <span className="font-bold">{aiUsageLogs.filter(l => l.taskType === "OCR").length} ครั้ง</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-500">จำนวนการสนทนา (Chat)</span>
                            <span className="font-bold">{aiUsageLogs.filter(l => l.taskType === "CHAT").length} ครั้ง</span>
                          </div>
                        </div>

                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                          <p className="text-[10px] text-blue-700 leading-tight">
                            ** ค่าใช้จ่ายถูกคำนวณตามอัตรา Google AI SDK ปัจจุบัน ($0.10/1M tokens สำหรับ Flash) โดยประมาณการอัตราแลกเปลี่ยน ฿36/$1
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: AI OCR Settings */}
            {activeSubTab === "ai_ocr" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">การตั้งค่าความฉลาดของระบบ OCR (สแกนใบเสร็จ)</h3>
                  <p className="text-xs text-stone-500">
                    ตั้งค่ารุ่นโมเดล Gemini สำหรับใช้อ่านค่าและวิเคราะห์เอกสารใบเสร็จ/บิลโดยเฉพาะ
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <form onSubmit={handleSaveAiConfig} className="space-y-6 bg-white border border-stone-200 p-6 rounded-2xl shadow-xs">
                      <div className="space-y-4">
                        <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider border-b pb-2 flex items-center gap-2">
                          <Maximize className="w-4 h-4 text-stone-950" /> 1. รุ่นโมเดลสมองกลสำหรับ OCR (AI OCR Model Selection)
                        </h4>
                        
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-stone-700 block">เลือกโมเดล Gemini สำหรับใช้อ่านข้อมูลจากภาพ (คลิกที่แถวเพื่อเลือก)</label>
                          <div className="overflow-hidden border border-stone-200 rounded-xl shadow-sm bg-white">
                            <table className="w-full text-left text-[11px] border-collapse">
                              <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">Model</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">RPM</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">TPM</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter">RPD</th>
                                  <th className="py-2.5 px-4 font-black text-stone-400 uppercase tracking-tighter text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-50">
                                {GEMINI_MODELS.map(m => (
                                  <tr 
                                    key={m.id} 
                                    onClick={() => setSelectedAiOcrModel(m.id)}
                                    className={`cursor-pointer transition-colors ${
                                      selectedAiOcrModel === m.id ? "bg-stone-900 text-white" : "hover:bg-stone-50"
                                    }`}
                                  >
                                    <td className="py-3 px-4">
                                      <div className="font-bold flex items-center gap-1.5">
                                        {m.name} 
                                        {selectedAiOcrModel === m.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                                      </div>
                                      <div className={`text-[9px] mt-0.5 ${selectedAiOcrModel === m.id ? "text-stone-300" : "text-stone-500"}`}>{m.description}</div>
                                    </td>
                                    <td className="py-3 px-4 font-mono">{m.rpm}</td>
                                    <td className="py-3 px-4 font-mono">{m.tpm}</td>
                                    <td className="py-3 px-4 font-mono">{m.rpd}</td>
                                    <td className="py-3 px-4 text-center">
                                      {selectedAiOcrModel === m.id ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                                          <CheckCircle className="w-3 h-3" /> ACTIVE
                                        </span>
                                      ) : (
                                        <span className="inline-block px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[9px] font-bold">
                                          STANDBY
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
                        >
                          <Check className="w-4 h-4" /> {saving ? "กำลังบันทึก..." : "บันทึกใช้จริงทันที"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: Document Numbering Settings */}
            {activeSubTab === "document_numbers" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">ตั้งค่ารหัสและการรันนิ่งเอกสารในระบบ (Document Numbering Settings)</h3>
                  <p className="text-xs text-stone-500">
                    ระบุรูปแบบการตั้งชื่อรหัสเลขที่รายการต่างๆ สำหรับใช้จัดเก็บและค้นหาอ้างอิง รองรับเครื่องหมายครอบเช่น <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px] font-bold">{"{yy}"}</code> ปี, <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px] font-bold">{"{mm}"}</code> เดือน และ <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px] font-bold">{"{seq:X}"}</code> เลขคิวคิวคิว
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  {/* Patterns Forms */}
                  <div className="space-y-4 bg-white border border-stone-200 p-5 rounded-2xl shadow-xs">
                    <h4 className="text-xs font-black text-stone-800 uppercase tracking-widest border-b pb-2 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-stone-700" /> รูปแบบรหัสรายการทั้งหมด (ID Pattern Presets)
                    </h4>

                    <div className="space-y-3 text-xs">
                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">รหัสพนักงานใหม่ (Employee Code Format)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.employee}
                          onChange={(e) => setDocFormats({ ...docFormats, employee: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">รหัสโครงการใหม่ (Project Cost-Center ID Format)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.project}
                          onChange={(e) => setDocFormats({ ...docFormats, project: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">รหัสหมวดหมู่ค่าใช้จ่าย (Expense Category ID Format)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.category}
                          onChange={(e) => setDocFormats({ ...docFormats, category: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">เลขที่ใบเสนอเบิกเงินทดรองจ่าย (Advance Request ID Format)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.advance}
                          onChange={(e) => setDocFormats({ ...docFormats, advance: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">เลขที่ใบเคลียร์ยอด/ใบเสร็จ (Clearing List Formats)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.clearing}
                          onChange={(e) => setDocFormats({ ...docFormats, clearing: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">เลขที่รายงานสรุปรายการค่าใช้จ่ายจากเงินทดรองจ่าย (Expense Summary Report Format)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.clearingCheck}
                          onChange={(e) => setDocFormats({ ...docFormats, clearingCheck: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-stone-700 block">เลขที่เอกสารแนบเคลียร์อื่นๆ (Clearing Doc Attachment)</label>
                        <input
                          type="text"
                          required
                          value={docFormats.clearingDoc}
                          onChange={(e) => setDocFormats({ ...docFormats, clearingDoc: e.target.value })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl font-mono text-xs focus:ring-1 focus:ring-stone-950"
                        />
                      </div>
                    </div>

                    <div className="pt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveDocumentFormats}
                        disabled={saving}
                        className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition"
                      >
                        <Check className="w-4 h-4" /> บันทึกรหัสเอกสารใหม่
                      </button>
                    </div>
                  </div>

                  {/* Realtime Live ID Preview */}
                  <div className="bg-stone-50 border border-stone-200 p-5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-black text-stone-950 uppercase tracking-widest flex items-center gap-1.5 border-b pb-2">
                      <Eye className="w-4 h-4 text-stone-700" /> ตัวอย่างพรีวิวทันที (Live Realtime Previews)
                    </h4>
                    <p className="text-[10px] text-stone-400 font-medium">นี่คือตัวอย่างรหัสเอกสารจริงที่จะเกิดขึ้นจากการตั้งค่าปัจจุบันของท่าน โดยคำนวณคิวลำดับที่ 5</p>

                    <div className="space-y-3 font-mono text-[11px] font-semibold text-stone-700">
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs">
                        <span className="text-stone-400">รหัสพนักงาน:</span>
                        <span className="text-stone-950 font-black">{generateFormattedId(docFormats.employee || "EMP-{seq:4}", 5)}</span>
                      </div>
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs">
                        <span className="text-stone-400">รหัสโครงการ:</span>
                        <span className="text-stone-950 font-black">{generateFormattedId(docFormats.project || "PRJ-{seq:3}", 5)}</span>
                      </div>
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs">
                        <span className="text-stone-400">หมวดหมู่:</span>
                        <span className="text-stone-950 font-black">{generateFormattedId(docFormats.category || "CAT-{seq:3}", 5)}</span>
                      </div>
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs text-amber-950">
                        <span className="text-amber-700">ใบเสนอเบิกเงินทดรองจ่าย:</span>
                        <span className="font-black text-xs text-amber-950">{generateFormattedId(docFormats.advance || "ADV-{yy}{mm}-P{seq:3}", 5)}</span>
                      </div>
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs text-stone-600">
                        <span className="text-stone-400">ใบเสร็จ/บิลเคลียร์ (รอบ 2):</span>
                        <span className="font-bold text-stone-900">{generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 5, { advId: "ADV-2606-P005", roundNo: 2 })}</span>
                      </div>
                      <div className="p-2.5 bg-white border rounded-xl flex justify-between items-center shadow-2xs text-stone-600">
                        <span className="text-stone-400">รายงานสรุปรายการค่าใช้จ่ายจากเงินทดรองจ่าย:</span>
                        <span className="font-bold text-stone-900">{generateFormattedId(docFormats.clearingCheck || "RV-{advId}-{roundNo}", 5, { advId: "ADV-2606-P005", roundNo: 1 })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: Other Settings */}
            {/* SUB TAB: Document Templates */}
            {activeSubTab === "doc_templates" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">ตั้งค่า Template เอกสาร (Document Template Settings)</h3>
                  <p className="text-xs text-stone-500">
                    ตั้งค่าข้อมูลบริษัท โลโก้ และที่อยู่ที่จะไปปรากฏในเอกสารรายงานต่างๆ ในตู้นิรภัย
                  </p>
                </div>

                <div className="bg-white border border-stone-200 p-6 rounded-2xl shadow-xs space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-stone-700 block">ชื่อบริษัท (Company Name)</label>
                      <input
                        type="text"
                        value={compName}
                        onChange={(e) => setCompName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-stone-700 block">URL โลโก้บริษัท (Logo URL)</label>
                      <input
                        type="text"
                        value={compLogoUrl}
                        onChange={(e) => setCompLogoUrl(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-stone-700 block">ที่อยู่บริษัท (Company Address)</label>
                      <textarea
                        rows={3}
                        value={compAddress}
                        onChange={(e) => setCompAddress(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-stone-700 block">ข้อมูลติดต่อ (Contact Info)</label>
                      <input
                        type="text"
                        value={compContact}
                        onChange={(e) => setCompContact(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveDocTemplates}
                      disabled={saving}
                      className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
                    >
                      <Check className="w-4 h-4" /> บันทึกเทมเพลต
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: Approval Workflow */}
            {activeSubTab === "approval_workflow" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">ลำดับการอนุมัติ (Approval Workflow & Conditions)</h3>
                  <p className="text-xs text-stone-500">
                    กำหนดเงื่อนไขการอนุมัติ เช่น วงเงินที่ฝ่ายบัญชีสามารถอนุมัติได้ทันทีโดยไม่ต้องผ่านผู้บริหาร
                  </p>
                </div>

                <div className="bg-white border border-stone-200 p-6 rounded-2xl shadow-xs space-y-6">
                  <div className="space-y-6">
                    <div className="relative">
                      {/* Flow Line */}
                      <div className="absolute top-8 left-8 right-8 h-1 bg-stone-100 rounded-full z-0"></div>
                      
                      <div className="grid grid-cols-3 gap-4 relative z-10">
                        {/* Step 1: Employee */}
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-white border-2 border-stone-200 flex items-center justify-center shadow-sm">
                            <Users className="w-6 h-6 text-stone-400" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-stone-900">ผู้ขอเบิก (Employee)</p>
                            <p className="text-[10px] text-stone-500">สร้างใบเบิก/ส่งเอกสาร</p>
                          </div>
                        </div>

                        {/* Step 2: Accountant */}
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-white border-2 border-emerald-500 text-emerald-600 flex items-center justify-center shadow-sm">
                            <CheckSquare className="w-6 h-6" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-stone-900">บัญชี (Accountant)</p>
                            <p className="text-[10px] text-stone-500">ตรวจสอบความถูกต้อง</p>
                          </div>
                        </div>

                        {/* Step 3: Admin */}
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-white border-2 border-amber-500 text-amber-500 flex items-center justify-center shadow-sm">
                            <ShieldCheck className="w-6 h-6" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-stone-900">ผู้บริหาร (Admin)</p>
                            <p className="text-[10px] text-stone-500">ผู้อนุมัติขั้นสูงสุด</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-stone-100 pt-6 space-y-4">
                      <h4 className="text-[11px] font-black text-stone-900 uppercase tracking-wider flex items-center gap-2">
                        <Settings className="w-4 h-4" /> เงื่อนไขการอนุมัติ (Approval Conditions)
                      </h4>
                      <div className="flex items-center justify-between p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <div>
                          <p className="text-xs font-bold text-stone-900">เงื่อนไขข้ามการอนุมัติของผู้บริหาร (Auto-Approve for Admin)</p>
                          <p className="text-[10px] text-stone-500">หากมูลค่าต่ำกว่าจำนวนนี้ ฝ่ายบัญชีสามารถกดอนุมัติจ่ายเงินได้ทันที</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={approvalThreshold}
                            onChange={(e) => setApprovalThreshold(Number(e.target.value))}
                            className="w-24 px-2 py-1.5 border border-stone-300 rounded-lg text-xs font-mono font-bold text-right focus:ring-1 focus:ring-stone-950"
                          />
                          <span className="text-xs font-bold text-stone-500">บาท</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <div>
                          <p className="text-xs font-bold text-stone-900">เปิดใช้งานระบบข้ามการอนุมัติอัตโนมัติ</p>
                          <p className="text-[10px] text-stone-500">หากปิด ทุกรายการเบิกจะต้องให้ Admin อนุมัติ</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoApproveAccounting(!autoApproveAccounting)}
                          className={`w-12 h-6 rounded-full transition-colors relative ${autoApproveAccounting ? "bg-emerald-500" : "bg-stone-300"}`}
                        >
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autoApproveAccounting ? "left-7" : "left-1"}`} />
                        </button>
                      </div>

                      <div className="p-4 bg-white rounded-xl border border-stone-200 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-stone-900">เงื่อนไขผู้มีสิทธิ์อนุมัติหลายระดับ</p>
                            <p className="text-[10px] text-stone-500">กำหนดช่วงวงเงิน และเลือกตำแหน่งที่สามารถอนุมัติได้ในแต่ละช่วง</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setApprovalRules([
                              ...approvalRules,
                              {
                                id: `rule-${Date.now()}`,
                                name: "เงื่อนไขใหม่",
                                minAmount: 0,
                                maxAmount: 0,
                                approverRoles: [UserRole.ADMIN],
                                isActive: true,
                              }
                            ])}
                            className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-[10px] font-bold flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> เพิ่มเงื่อนไข
                          </button>
                        </div>

                        <div className="overflow-x-auto border border-stone-200 rounded-xl">
                          <table className="w-full text-xs">
                            <thead className="bg-stone-50 border-b border-stone-200 text-[10px] text-stone-500 uppercase">
                              <tr>
                                <th className="px-3 py-2 text-left">ชื่อเงื่อนไข</th>
                                <th className="px-3 py-2 text-right">ตั้งแต่</th>
                                <th className="px-3 py-2 text-right">ไม่เกิน</th>
                                <th className="px-3 py-2 text-left">ตำแหน่งที่อนุมัติได้</th>
                                <th className="px-3 py-2 text-center">เปิดใช้</th>
                                <th className="px-3 py-2 text-center">ลบ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {approvalRules.map((rule, idx) => (
                                <tr key={rule.id}>
                                  <td className="px-3 py-2">
                                    <input
                                      type="text"
                                      value={rule.name}
                                      onChange={(e) => {
                                        const updated = [...approvalRules];
                                        updated[idx] = { ...rule, name: e.target.value };
                                        setApprovalRules(updated);
                                      }}
                                      className="w-44 px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-xs font-bold"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <input
                                      type="number"
                                      value={rule.minAmount}
                                      onChange={(e) => {
                                        const updated = [...approvalRules];
                                        updated[idx] = { ...rule, minAmount: Number(e.target.value) || 0 };
                                        setApprovalRules(updated);
                                      }}
                                      className="w-24 px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-xs font-mono text-right"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <input
                                      type="number"
                                      value={rule.maxAmount}
                                      onChange={(e) => {
                                        const updated = [...approvalRules];
                                        updated[idx] = { ...rule, maxAmount: Number(e.target.value) || 0 };
                                        setApprovalRules(updated);
                                      }}
                                      className="w-24 px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-xs font-mono text-right"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-2">
                                      {[UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.ADMIN].map((role) => (
                                        <label key={role} className="inline-flex items-center gap-1 text-[10px] font-bold text-stone-600">
                                          <input
                                            type="checkbox"
                                            checked={rule.approverRoles.includes(role)}
                                            onChange={(e) => {
                                              const roles = e.target.checked
                                                ? Array.from(new Set([...rule.approverRoles, role]))
                                                : rule.approverRoles.filter((item) => item !== role);
                                              const updated = [...approvalRules];
                                              updated[idx] = { ...rule, approverRoles: roles };
                                              setApprovalRules(updated);
                                            }}
                                            className="rounded text-stone-950 focus:ring-stone-950"
                                          />
                                          {role}
                                        </label>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={rule.isActive}
                                      onChange={(e) => {
                                        const updated = [...approvalRules];
                                        updated[idx] = { ...rule, isActive: e.target.checked };
                                        setApprovalRules(updated);
                                      }}
                                      className="rounded text-stone-950 focus:ring-stone-950"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => setApprovalRules(approvalRules.filter((item) => item.id !== rule.id))}
                                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveApprovalWorkflow}
                      disabled={saving}
                      className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
                    >
                      <Check className="w-4 h-4" /> บันทึกเวิร์คโฟล
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: Advance Data Center Settings */}
            {activeSubTab === "advance_data" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">การแสดงผลฐานข้อมูล (Advance Data Center)</h3>
                  <p className="text-xs text-stone-500">
                    กำหนดค่าและแหล่งข้อมูล (Data Source) สำหรับคอลัมน์ทั้ง 31 คอลัมน์ที่แสดงในตาราง Advance Data Center
                  </p>
                </div>

                <div className="bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col max-h-[70vh]">
                  <div className="flex justify-between items-center p-4 border-b border-stone-100 bg-stone-50">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const newCols = [...advanceDataColumns, { id: `col_${Date.now()}`, label: `New Column`, dataSource: "Not set" }];
                          setAdvanceDataColumns(newCols);
                        }}
                        className="px-3 py-1.5 bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-lg text-[10px] font-bold shadow-2xs flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> เพิ่มคอลัมน์
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveAdvanceDataColumns}
                      disabled={saving}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] flex items-center gap-1.5 transition shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" /> {saving ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto bg-stone-50 p-4">
                    <table className="w-full text-left text-xs border-collapse bg-white shadow-sm rounded-lg overflow-hidden border border-stone-200">
                      <thead className="bg-stone-100/50 border-b border-stone-200">
                        <tr>
                          <th className="py-2.5 px-3 font-bold text-stone-600 w-12 text-center">No.</th>
                          <th className="py-2.5 px-3 font-bold text-stone-600">Column Name (ชื่อคอลัมน์)</th>
                          <th className="py-2.5 px-3 font-bold text-stone-600">Data Source (แหล่งที่มา/ตัวแปร)</th>
                          <th className="py-2.5 px-3 font-bold text-stone-600 w-24 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {advanceDataColumns.map((col, idx) => (
                          <tr key={col.id} className="hover:bg-stone-50/50 group">
                            <td className="py-2 px-3 text-center text-stone-400 font-mono text-[10px]">{idx + 1}</td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={col.label}
                                onChange={(e) => {
                                  const newCols = [...advanceDataColumns];
                                  newCols[idx].label = e.target.value;
                                  setAdvanceDataColumns(newCols);
                                }}
                                className="w-full bg-transparent border border-transparent hover:border-stone-200 focus:border-stone-300 focus:bg-white rounded px-2 py-1 transition-colors"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={col.dataSource}
                                onChange={(e) => {
                                  const newCols = [...advanceDataColumns];
                                  newCols[idx].dataSource = e.target.value;
                                  setAdvanceDataColumns(newCols);
                                }}
                                className="w-full font-mono text-[10px] text-stone-600 bg-transparent border border-transparent hover:border-stone-200 focus:border-stone-300 focus:bg-white rounded px-2 py-1 transition-colors"
                                placeholder="e.g. item.amount"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const newCols = advanceDataColumns.filter((_, i) => i !== idx);
                                  setAdvanceDataColumns(newCols);
                                }}
                                className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeSubTab === "workspace" && (
              <div className="space-y-6 animate-fade-in">
                {/* New Prominent Links Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {workspaceSettings.spreadsheetUrl && (
                    <a
                      href={workspaceSettings.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-between group hover:bg-emerald-100 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white text-emerald-600 rounded-lg shadow-sm">
                          <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-emerald-900">เปิด Google Sheets</span>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-600 group-hover:underline">ไปยังไฟล์ →</span>
                    </a>
                  )}
                  {workspaceSettings.parentFolderId && (
                    <a
                      href={`https://drive.google.com/drive/folders/${workspaceSettings.parentFolderId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between group hover:bg-blue-100 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white text-blue-600 rounded-lg shadow-sm">
                          <HardDrive className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-blue-900">เปิด Google Drive</span>
                      </div>
                      <span className="text-[10px] font-bold text-blue-600 group-hover:underline">ไปยังไฟล์ →</span>
                    </a>
                  )}
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-stone-900">การเชื่อมต่อฐานข้อมูล Google Workspace (Sheets & Drive)</h3>
                    <p className="text-xs text-stone-500">
                      ตั้งค่าและซิงค์ข้อมูลทั้ง 3 ตารางหลัก (Advances, Clearing Items, Employees) ลง Google Sheets และจัดทำโฟลเดอร์ตู้นิรภัยโดยอัตโนมัติลง Google Drive
                    </p>
                  </div>
                </div>

                {/* Connection Status Badge */}
                <div className="p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-stone-50 border-stone-200">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${accessToken ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div>
                      <p className="text-xs font-bold text-stone-900">
                        {accessToken ? "เชื่อมต่อกับสิทธิ์ Google Workspace สำเร็จ" : "ไม่ได้เชื่อมต่อกับบัญชี Google"}
                      </p>
                      <p className="text-[10px] text-stone-500 font-medium">
                        {accessToken 
                          ? "สิทธิ์การเข้าถึง Sheets และ Drive พร้อมใช้งาน (ได้รับอนุญาตตามความต้องการ)" 
                          : "ไม่พบ Active Token กรุณาเปิดแอปในหน้าต่างหลักเพื่อยืนยันสิทธิ์กับระบบ"}
                      </p>
                    </div>
                  </div>
                  {!accessToken && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const token = await requestGoogleAccessToken();
                          if (!token) {
                            setError("ไม่พบ Token ล่าสุด กรุณาอนุมัติสิทธิ์ Google Workspace ก่อน");
                            return;
                          }
                          setAccessToken(token);
                          setSuccess("เชื่อมต่อ Google Workspace สำเร็จ สิทธิ์ Sheets และ Drive พร้อมใช้งานแล้ว");
                        } catch (err: any) {
                          setError(err?.message || "เชื่อมต่อ Google Workspace ไม่สำเร็จ");
                        }
                      }}
                      className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-[11px] font-bold rounded-xl transition"
                    >
                      เชื่อมต่อ Google Workspace
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Google Sheets Sync Setup */}
                  <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-stone-100">
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-stone-900">1. Google Sheets (ระบบบันทึกฐานข้อมูลการเงิน)</h4>
                        <p className="text-[10px] text-stone-500 font-medium">บันทึกทั้ง 3 ตารางหลักลงในแผ่นงานแยกกันโดยอัตโนมัติ</p>
                      </div>
                    </div>

                    {workspaceSettings.spreadsheetId ? (
                      <div className="space-y-4">
                        <div className="p-3 bg-stone-50 border border-stone-150 rounded-xl space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-400">Spreadsheet ID:</span>
                            <span className="font-mono text-stone-600 truncate max-w-[180px]" title={workspaceSettings.spreadsheetId}>{workspaceSettings.spreadsheetId}</span>
                          </div>
                          {workspaceSettings.lastSyncedAt && (
                            <div className="flex justify-between">
                              <span className="text-stone-400">ซิงค์ล่าสุดเมื่อ:</span>
                              <span className="font-bold text-stone-800">{workspaceSettings.lastSyncedAt}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <a
                            href={workspaceSettings.spreadsheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs transition"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" /> เปิดแผ่นงาน Google Sheets
                          </a>

                          <button
                            type="button"
                            onClick={async () => {
                              if (!accessToken) {
                                setError("ไม่พบ Google Access Token กรุณาลงชื่อเข้าใช้อีกครั้ง");
                                return;
                              }
                              setSyncingSheets(true);
                              setError(null);
                              setSuccess(null);
                              try {
                                await syncDatabaseToSheets(workspaceSettings.spreadsheetId!, accessToken);
                                setSuccess("ซิงค์ข้อมูลทั้ง 3 ตารางหลักไปยัง Google Sheets สำเร็จเรียบร้อยแล้ว!");
                                setWorkspaceSettings(prev => ({
                                  ...prev,
                                  lastSyncedAt: new Date().toLocaleString("th-TH")
                                }));
                              } catch (err: any) {
                                console.error(err);
                                setError("ไม่สามารถซิงค์ข้อมูลลงแผ่นงานได้: " + err.message);
                              } finally {
                                setSyncingSheets(false);
                              }
                            }}
                            disabled={syncingSheets}
                            className="px-3.5 py-2 bg-stone-950 hover:bg-stone-900 text-white rounded-xl font-bold text-xs inline-flex items-center gap-1.5 transition"
                          >
                            {syncingSheets ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            บังคับซิงค์ข้อมูลทั้งหมดทันที
                          </button>
                        </div>

                        {/* Auto-Sync Toggle Option */}
                        <div className="pt-2">
                          <label className="flex items-center gap-3 cursor-pointer p-3 bg-stone-50 border border-stone-100 rounded-xl hover:bg-stone-100/50 transition">
                            <input
                              type="checkbox"
                              checked={workspaceSettings.autoSyncSheets !== false}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setWorkspaceSettings(prev => ({ ...prev, autoSyncSheets: checked }));
                                await handleUpdateWorkspaceSetting({ autoSyncSheets: checked });
                              }}
                              className="rounded text-stone-950 focus:ring-stone-950 h-4 w-4"
                            />
                            <div>
                              <span className="text-xs font-bold text-stone-900 block">เปิดการซิงค์ข้อมูลอัตโนมัติ (Auto-Sync)</span>
                              <span className="text-[10px] text-stone-500">บันทึกประวัติ อัปเดตเงินทดรองจ่าย และรายการเคลียร์ลงชีตอัตโนมัติเมื่อเกิดกิจกรรมจริง</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs text-stone-500">
                          ระบบยังไม่มีการสร้างหรือเชื่อมโยง Google Sheets กรุณากดปุ่มด้านล่างเพื่อทำการติดตั้งแผ่นงานใหม่ หรือเลือกไฟล์ที่มีอยู่แล้ว
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!accessToken) {
                                setError("กรุณาเชื่อมโยงกับสิทธิ์ Google Workspace ของคุณก่อนสร้างสเปรดชีต");
                                return;
                              }
                              setSyncingSheets(true);
                              setError(null);
                              setSuccess(null);
                              try {
                                const sheetInfo = await createSpreadsheet(accessToken);
                                await syncDatabaseToSheets(sheetInfo.id, accessToken);
                                const newSet: GoogleWorkspaceSettings = {
                                  ...workspaceSettings,
                                  spreadsheetId: sheetInfo.id,
                                  spreadsheetUrl: sheetInfo.url,
                                  autoSyncSheets: true
                                };
                                setWorkspaceSettings(newSet);
                                await handleUpdateWorkspaceSetting(newSet);
                                setSuccess("ติดตั้ง Google Sheets และซิงค์ข้อมูลพื้นฐานเสร็จสมบูรณ์!");
                              } catch (err: any) {
                                console.error(err);
                                setError("ไม่สามารถสร้าง Google Sheets ได้: " + err.message);
                              } finally {
                                setSyncingSheets(false);
                              }
                            }}
                            disabled={syncingSheets}
                            className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-2xs transition"
                          >
                            {syncingSheets ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                            สร้างอัตโนมัติ
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => {
                              openPicker("spreadsheet", async (result) => {
                                setSyncingSheets(true);
                                try {
                                  const newSet: GoogleWorkspaceSettings = {
                                    ...workspaceSettings,
                                    spreadsheetId: result.id,
                                    spreadsheetUrl: result.url,
                                    autoSyncSheets: true
                                  };
                                  setWorkspaceSettings(newSet);
                                  await handleUpdateWorkspaceSetting(newSet);
                                  setSuccess("เชื่อมโยง Google Sheets เรียบร้อยแล้ว!");
                                } catch (e: any) {
                                  setError(e.message);
                                } finally {
                                  setSyncingSheets(false);
                                }
                              });
                            }}
                            disabled={!isPickerLoaded || syncingSheets}
                            className="py-2.5 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-2xs transition disabled:opacity-50"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            เลือกจาก Drive
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Google Drive Folders Setup */}
                  <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-stone-100">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-stone-900">2. Google Drive (ระบบโฟลเดอร์ตู้เก็บนิรภัย)</h4>
                        <p className="text-[10px] text-stone-500 font-medium">แยกจัดเก็บไฟล์ของแต่ละตู้นิรภัย (Grouped by Invoice / ID)</p>
                      </div>
                    </div>

                    {workspaceSettings.parentFolderId ? (
                      <div className="space-y-4">
                        <div className="p-3 bg-stone-50 border border-stone-150 rounded-xl space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-400">โฟลเดอร์หลัก:</span>
                            <span className="font-bold text-stone-800">Remix Clear Advance Vaults</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">จำนวนตู้นิรภัยที่สร้าง:</span>
                            <span className="font-bold text-stone-800">
                              {Object.keys(workspaceSettings.vaultFolderIds || {}).length} รายการ
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`https://drive.google.com/drive/folders/${workspaceSettings.parentFolderId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs transition"
                          >
                            <HardDrive className="w-3.5 h-3.5" /> เปิดโฟลเดอร์หลักบน Google Drive
                          </a>

                          <button
                            type="button"
                            onClick={async () => {
                              if (!accessToken) {
                                setError("ไม่พบ Google Access Token กรุณาลงชื่อเข้าใช้อีกครั้ง");
                                return;
                              }
                              setSyncingDrive(true);
                              setError(null);
                              setSuccess(null);
                              try {
                                const res = await syncVaultFoldersToDrive(accessToken);
                                setWorkspaceSettings(prev => ({
                                  ...prev,
                                  parentFolderId: res.parentFolderId,
                                  vaultFolderIds: res.vaultFolderIds,
                                  lastSyncedAt: new Date().toLocaleString("th-TH")
                                }));
                                setSuccess("ตรวจสอบความปลอดภัยและสร้างโฟลเดอร์ตู้นิรภัยใหม่ใน Google Drive สำเร็จ!");
                              } catch (err: any) {
                                console.error(err);
                                setError("เกิดข้อผิดพลาดในการซิงค์ข้อมูล Google Drive: " + err.message);
                              } finally {
                                setSyncingDrive(false);
                              }
                            }}
                            disabled={syncingDrive}
                            className="px-3.5 py-2 bg-stone-950 hover:bg-stone-900 text-white rounded-xl font-bold text-xs inline-flex items-center gap-1.5 transition"
                          >
                            {syncingDrive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            ตรวจสอบและจัดระเบียบตู้เดี๋ยวนี้
                          </button>
                        </div>

                        {/* Folders List Table */}
                        <div className="border border-stone-200 rounded-xl overflow-hidden text-[10px] max-h-[140px] overflow-y-auto font-mono">
                          <table className="w-full text-left">
                            <thead className="sticky top-0 bg-stone-50 border-b border-stone-200 text-stone-500">
                              <tr>
                                <th className="p-2 pl-3">รหัสเอกสารตู้นิรภัย</th>
                                <th className="p-2">Google Drive Folder URL</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 text-stone-600">
                              {Object.entries(workspaceSettings.vaultFolderIds || {}).map(([advId, fId]) => (
                                <tr key={advId} className="hover:bg-stone-50/50">
                                  <td className="p-2 pl-3 font-bold text-stone-900">{advId}</td>
                                  <td className="p-2 text-stone-400 select-all truncate max-w-[150px]">
                                    <a
                                      href={`https://drive.google.com/drive/folders/${fId}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline animate-fade-in"
                                    >
                                      เปิดโฟลเดอร์ย่อย ({fId})
                                    </a>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Auto-Sync Drive Toggle */}
                        <div className="pt-2">
                          <label className="flex items-center gap-3 cursor-pointer p-3 bg-stone-50 border border-stone-100 rounded-xl hover:bg-stone-100/50 transition">
                            <input
                              type="checkbox"
                              checked={workspaceSettings.autoSyncDrive !== false}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setWorkspaceSettings(prev => ({ ...prev, autoSyncDrive: checked }));
                                await handleUpdateWorkspaceSetting({ autoSyncDrive: checked });
                              }}
                              className="rounded text-stone-950 focus:ring-stone-950 h-4 w-4"
                            />
                            <div>
                              <span className="text-xs font-bold text-stone-900 block">เปิดการสร้างตู้นิรภัยย่อยอัตโนมัติ (Auto Drive)</span>
                              <span className="text-[10px] text-stone-500">สร้างโฟลเดอร์สำหรับใบขอเงินใหม่ใน Google Drive ทันทีเมื่อเกิดเอกสารขึ้นในระบบ</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs text-stone-500">
                          ยังไม่มีการสร้างตู้เก็บเอกสารตู้นิรภัยหลักใน Google Drive กรุณากดปุ่มด้านล่างเพื่อเริ่มสร้างหรือเลือกโฟลเดอร์จาก Drive ของคุณ
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!accessToken) {
                                setError("กรุณาเชื่อมต่อกับ Google Workspace ก่อนดำเนินการ");
                                return;
                              }
                              setSyncingDrive(true);
                              setError(null);
                              setSuccess(null);
                              try {
                                const res = await syncVaultFoldersToDrive(accessToken);
                                const newSet: GoogleWorkspaceSettings = {
                                  ...workspaceSettings,
                                  parentFolderId: res.parentFolderId,
                                  vaultFolderIds: res.vaultFolderIds,
                                  autoSyncDrive: true
                                };
                                setWorkspaceSettings(newSet);
                                await handleUpdateWorkspaceSetting(newSet);
                                setSuccess("ติดตั้งตู้จัดเก็บเอกสารและสร้างโฟลเดอร์ย่อยสำเร็จ!");
                              } catch (err: any) {
                                console.error(err);
                                setError("เกิดข้อผิดพลาด: " + err.message);
                              } finally {
                                setSyncingDrive(false);
                              }
                            }}
                            disabled={syncingDrive}
                            className="py-2.5 bg-stone-950 hover:bg-stone-900 text-white rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 transition"
                          >
                            {syncingDrive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
                            สร้างอัตโนมัติ
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => {
                              openPicker("folder", async (result) => {
                                setSyncingDrive(true);
                                try {
                                  const newSet: GoogleWorkspaceSettings = {
                                    ...workspaceSettings,
                                    parentFolderId: result.id,
                                    autoSyncDrive: true
                                  };
                                  setWorkspaceSettings(newSet);
                                  await handleUpdateWorkspaceSetting(newSet);
                                  setSuccess("เชื่อมโยงโฟลเดอร์ตู้นิรภัยหลักสำเร็จ!");
                                } catch (e: any) {
                                  setError(e.message);
                                } finally {
                                  setSyncingDrive(false);
                                }
                              });
                            }}
                            disabled={!isPickerLoaded || syncingDrive}
                            className="py-2.5 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-2xs transition disabled:opacity-50"
                          >
                            <FolderGit className="w-3.5 h-3.5" />
                            เลือกจาก Drive
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 1. Edit Employee Modal */}
      {editingEmployee && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="edit_employee_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  📝 แก้ไขข้อมูลและสิทธิ์พนักงาน: {editingEmployee.name}
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">แก้ไขรายชื่อ สิทธิ์ บทบาท พาสเวิร์ด/PIN บัญชีธนาคาร หรือสถานะของพนักงาน</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEmployee(null)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Scrollable Body */}
            <form onSubmit={handleSaveEmployee} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Employee Code */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รหัสพนักงาน</label>
                  <input
                    type="text"
                    required
                    value={editEmpCode}
                    onChange={(e) => setEditEmpCode(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono font-black text-stone-950 focus:ring-1 focus:ring-stone-950"
                    placeholder="เช่น EMP-0001"
                  />
                </div>

                {/* Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">ชื่อ-นามสกุลจริง</label>
                  <input
                    type="text"
                    required
                    value={editEmpName}
                    onChange={(e) => setEditEmpName(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-950 font-bold focus:ring-1 focus:ring-stone-950"
                  />
                </div>

                {/* Nickname */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">ชื่อเล่น (ถ้ามี)</label>
                  <input
                    type="text"
                    value={editEmpNickname}
                    onChange={(e) => setEditEmpNickname(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:ring-1 focus:ring-stone-950"
                  />
                </div>

                {/* Username */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">ยูเซอร์เนม (Username - สำหรับล็อกอิน)</label>
                  <input
                    type="text"
                    required
                    value={editEmpUsername}
                    onChange={(e) => setEditEmpUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono font-bold text-stone-750 focus:ring-1 focus:ring-stone-950"
                  />
                </div>

                {/* PIN */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รหัสผ่านสำหรับเข้าสู่ระบบ (PIN 4 หลัก)</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={editEmpPin}
                    onChange={(e) => setEditEmpPin(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono font-black text-stone-950 focus:ring-1 focus:ring-stone-950"
                    placeholder="เช่น 1234 หรือ 999999"
                  />
                </div>

                {/* Role */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">บทบาทระดับสิทธิ์ (Role RBAC)</label>
                  <select
                    value={editEmpRole}
                    onChange={(e) => setEditEmpRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-850 focus:ring-1 focus:ring-stone-950"
                  >
                    <option value={UserRole.EMPLOYEE}>Employee (พนักงานทั่วไป)</option>
                    <option value={UserRole.MANAGER}>Manager (ผู้จัดการโครงการ)</option>
                    <option value={UserRole.ACCOUNTANT}>Accountant (นักบัญชีการเงิน)</option>
                    <option value={UserRole.ADMIN}>Admin (ผู้ดูแลระบบสูงสุด)</option>
                  </select>
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">สถานะบัญชีการใช้งาน</label>
                  <select
                    value={editEmpStatus}
                    onChange={(e) => setEditEmpStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-850 focus:ring-1 focus:ring-stone-950"
                  >
                    <option value="Active">Active (ใช้งานได้ปกติ)</option>
                    <option value="Suspended">Suspended (ระงับชั่วคราว)</option>
                    <option value="Disabled">Disabled (ปิดการใช้งาน)</option>
                  </select>
                </div>

                {/* LINE User ID */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">LINE User ID (สำหรับแจ้งเตือน)</label>
                  <input
                    type="text"
                    value={editEmpLineUserId}
                    onChange={(e) => setEditEmpLineUserId(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono font-bold text-stone-850 focus:ring-1 focus:ring-stone-950"
                    placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                </div>
              </div>

              {/* Bank Transfer Details Section */}
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                <h4 className="text-[11px] font-black text-stone-950 uppercase tracking-widest border-b pb-1">ข้อมูลช่องทางรับเงินโอนเงินหน้างาน</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-stone-400 uppercase block">ธนาคารรับเงิน</label>
                    <input
                      type="text"
                      value={editEmpBankName}
                      onChange={(e) => setEditEmpBankName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-stone-950"
                      placeholder="เช่น ธนาคารกสิกรไทย"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-stone-400 uppercase block">เลขบัญชีธนาคาร</label>
                    <input
                      type="text"
                      value={editEmpBankNo}
                      onChange={(e) => setEditEmpBankNo(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-mono font-bold focus:ring-1 focus:ring-stone-950"
                      placeholder="เช่น 123-4-56789-0"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[9px] font-black text-stone-400 uppercase block">ชื่อบัญชีรับเงิน</label>
                    <input
                      type="text"
                      value={editEmpBankAccountName}
                      onChange={(e) => setEditEmpBankAccountName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-stone-950"
                      placeholder="ระบุชื่อบัญชีธนาคาร"
                    />
                  </div>
                </div>
              </div>

              {/* Profile Image Preview/Field */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รูปถ่ายพนักงาน</label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-full border bg-stone-100 overflow-hidden shrink-0 flex items-center justify-center">
                    {editEmpProfileImage ? (
                      <img src={editEmpProfileImage} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <Users className="w-6 h-6 text-stone-400" />
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          setEditEmpProfileImage(event.target?.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono focus:ring-1 focus:ring-stone-950"
                  />
                </div>
              </div>

              {/* Electronic Signature Section */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block flex items-center justify-between">
                  <span>ลายเซ็นอิเล็กทรอนิกส์ (Electronic Signature)</span>
                  <button type="button" onClick={() => sigCanvasRef.current?.clear()} className="text-[9px] text-stone-400 hover:text-stone-900">ล้างลายเซ็น</button>
                </label>
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col gap-3">
                  <div className="w-full bg-white rounded-xl border border-stone-200 overflow-hidden relative" style={{ height: "150px" }}>
                    <SignatureCanvas 
                      ref={sigCanvasRef} 
                      penColor="black"
                      canvasProps={{ className: "w-full h-full" }} 
                      onEnd={() => setEditEmpSignature(sigCanvasRef.current?.toDataURL() || "")}
                    />
                    {!editEmpSignature && (
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center gap-1.5 text-stone-300">
                        <PenTool className="w-6 h-6" />
                        <span className="text-[10px] font-bold">วาดลายเซ็นที่นี่</span>
                      </div>
                    )}
                  </div>
                  {editEmpSignature && !sigCanvasRef.current?.isEmpty() ? (
                    <div className="text-[9px] text-emerald-600 font-bold flex items-center gap-1 justify-end">
                      <Check className="w-3 h-3" /> วาดลายเซ็นใหม่แล้ว
                    </div>
                  ) : editEmpSignature ? (
                    <div className="relative group w-full h-24 bg-white rounded-xl border border-stone-200 overflow-hidden flex items-center justify-center">
                      <img src={editEmpSignature} alt="Signature" className="max-h-full max-w-full object-contain" />
                      <button
                        type="button"
                        onClick={() => {
                          setEditEmpSignature("");
                          sigCanvasRef.current?.clear();
                        }}
                        className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-white text-red-500 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <label className="flex-1 px-3 py-2 bg-white border border-stone-200 rounded-xl text-[10px] font-black text-stone-700 text-center cursor-pointer hover:bg-stone-50 transition shadow-xs">
                      อัปโหลดลายเซ็น (PNG)
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleSignatureUpload}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditEmpSignature("")}
                      className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-xl text-[10px] font-black transition"
                    >
                      ล้างข้อมูล
                    </button>
                  </div>
                  <p className="text-[9px] text-stone-400 italic">* แนะนำรูปภาพที่มีพื้นหลังโปร่งใส (Transparent PNG)</p>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="pt-4 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 font-bold rounded-xl text-xs transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
                >
                  {saving ? "กำลังบันทึก..." : <><Check className="w-4 h-4" /> บันทึกสิทธิ์และข้อมูลผู้ใช้ทั้งหมด</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUB TAB: System AI Usage & Backup */}
      {activeSubTab === "system_usage" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-stone-900">การใช้งาน AI & การสำรองข้อมูล (AI Usage & Backup)</h3>
              <p className="text-xs text-stone-500">
                ตรวจสอบปริมาณการใช้งาน AI ในระบบ และตั้งค่าการสำรองข้อมูลลงฐานข้อมูล Firebase แบบเรียลไทม์
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Backup & Database Info */}
            <div className="bg-white border border-stone-200 rounded-2xl shadow-xs p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
                <HardDrive className="w-5 h-5 text-stone-600" />
                <h4 className="font-bold text-stone-900 text-sm">การสำรองข้อมูล (Backup)</h4>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-stone-600">
                  ระบบทำการแบล็กอัปข้อมูลทุกอย่างลงฐานข้อมูล Cloud Firestore โดยอัตโนมัติ
                  คุณไม่จำเป็นต้องสำรองข้อมูลด้วยตนเอง ข้อมูลจะถูกดึงมาใช้เป็นค่าเริ่มต้นในทุกๆ การล็อกอินเสมอ
                </p>
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-stone-600">สถานะการสำรองข้อมูล:</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3"/> อัตโนมัติ (Real-time)</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-stone-600">ฐานข้อมูลหลัก:</span>
                    <span className="font-mono text-stone-900">Google Cloud Firestore</span>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Usage */}
            <div className="bg-white border border-stone-200 rounded-2xl shadow-xs p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-stone-600" />
                  <h4 className="font-bold text-stone-900 text-sm">การใช้งาน AI & ค่าใช้จ่าย</h4>
                </div>
              </div>
              
              <div className="space-y-4">
                <p className="text-xs text-stone-600">
                  ประมาณการปริมาณการใช้งาน AI ในระบบ (คำนวณจากข้อมูลในฐานข้อมูล)
                </p>

                <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 space-y-3">
                   <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-stone-700">สกัดข้อมูลใบเสร็จ (AI OCR)</span>
                      <span className="text-xs font-black text-stone-900">~ 0.001$ / บิล</span>
                   </div>
                   <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-stone-700">ผู้ช่วยถามตอบ (Prince AI)</span>
                      <span className="text-xs font-black text-stone-900">~ 0.002$ / ข้อความ</span>
                   </div>
                   <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-stone-700">วิเคราะห์นำเข้าตั้งค่า (AI Settings)</span>
                      <span className="text-xs font-black text-stone-900">~ 0.005$ / ครั้ง</span>
                   </div>
                </div>

                <div className="pt-2">
                  <label className="block text-[10px] font-extrabold text-stone-500 uppercase tracking-widest mb-1.5">
                    เลือกเวอร์ชัน AI (เผื่อระบบมีปัญหา)
                  </label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-900"
                  >
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash (ปัจจุบัน - แนะนำ)</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (แม่นยำสูง - ช้า)</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (รุ่นเล็ก ประหยัด)</option>
                  </select>
                  <p className="text-[10px] text-stone-400 mt-1.5">
                    หมายเหตุ: ค่านี้มีผลกับการทำงานของ OCR ใบเสร็จและแชทบอท
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB TAB: Direct Excel/CSV Data Importer */}
      {activeSubTab === ("data_import" as any) && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-stone-900">ระบบนำเข้าข้อมูล Excel / CSV สู่ Firestore (Excel Bulk Importer)</h3>
              <p className="text-xs text-stone-500">
                อัปโหลดไฟล์ Excel เพื่อนำเข้าตารางข้อมูลเข้าสู่ collections ในระบบ Firestore โดยตรง พร้อมจับคู่คอลัมน์อัตโนมัติและระบบป้องกันข้อมูลซ้ำซ้อน
              </p>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="border-2 border-dashed border-stone-200 hover:border-stone-400 rounded-2xl p-8 text-center cursor-pointer transition relative bg-stone-50">
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleExcelFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center gap-2">
                <Database className="w-10 h-10 text-stone-400" />
                <span className="text-xs font-bold text-stone-700">คลิกหรือลากไฟล์ Excel (.xlsx, .xls) หรือ CSV มาวางที่นี่</span>
                <span className="text-[10px] text-stone-400">ระบบจะวิเคราะห์หน้าชีท และจัดโครงสร้างให้สอดคล้องกับ schema หลักโดยอัตโนมัติ</span>
              </div>
            </div>

            {excelFile && (
              <div className="p-4 bg-stone-50 border border-stone-100 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-stone-800">{excelFile.name}</h4>
                    <p className="text-[10px] text-stone-500">ขนาด: {(excelFile.size / 1024).toFixed(2)} KB • พร้อมนำเข้าข้อมูล</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setExcelFile(null);
                    setExcelSheetsData({});
                  }}
                  className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-700 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {Object.keys(excelSheetsData).length > 0 && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-stone-800">รายการชีทที่ตรวจพบและจับคู่ Collection ปลายทาง</h4>
              
              {Object.entries(excelSheetsData).map(([sheetName, info]: [string, any]) => {
                const availableCollections = [
                  { id: "employees", name: "Employees (ข้อมูลบุคลากร)" },
                  { id: "projects", name: "Projects (ฐานข้อมูลโครงการ)" },
                  { id: "advances", name: "Advances (เอกสารใบขอเบิก)" },
                  { id: "clearingItems", name: "Clearing Items (รายการใบเสร็จ)" },
                  { id: "GL", name: "GL (บัญชีแยกประเภท)" },
                  { id: "document_tracking", name: "Document Tracking (ติดตามเอกสารต้นฉบับ)" },
                  { id: "project_costs", name: "Project Costs (รายงานต้นทุนโครงการ)" }
                ];

                return (
                  <div key={sheetName} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black px-2 py-1 bg-amber-50 text-amber-800 border border-amber-100 rounded-lg">
                          Sheet: {sheetName}
                        </span>
                        <span className="text-[10px] text-stone-500 font-medium">
                          ({info.rows.length} แถว • {info.headers.length} คอลัมน์)
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-stone-500">นำเข้าสู่ Collection:</label>
                        <select
                          value={info.collection}
                          onChange={(e) => handleExcelSheetCollectionChange(sheetName, e.target.value)}
                          className="bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-900"
                        >
                          {availableCollections.map(col => (
                            <option key={col.id} value={col.id}>{col.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block">คอลัมน์ที่ตรวจพบ:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {info.headers.map((header: string) => (
                          <span key={header} className="text-[9px] font-mono bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded-md border border-stone-150">
                            {header}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <details className="group">
                        <summary className="text-[10px] font-black text-stone-500 hover:text-stone-900 cursor-pointer outline-none transition select-none flex items-center gap-1">
                          <span>🔍 ดูแถวข้อมูลตัวอย่าง (5 แถวแรก)</span>
                        </summary>
                        <div className="mt-3 overflow-x-auto border border-stone-100 rounded-xl">
                          <table className="w-full text-[10px] text-left border-collapse font-mono">
                            <thead>
                              <tr className="bg-stone-50 border-b border-stone-150">
                                {info.headers.slice(0, 8).map((header: string) => (
                                  <th key={header} className="px-3 py-2 font-bold text-stone-600 border-r border-stone-100">{header}</th>
                                ))}
                                {info.headers.length > 8 && <th className="px-3 py-2 text-stone-400 font-medium">...</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {info.rows.slice(0, 5).map((row: any, rIdx: number) => (
                                <tr key={rIdx} className="border-b border-stone-100 hover:bg-stone-50/50">
                                  {info.headers.slice(0, 8).map((header: string) => (
                                    <td key={header} className="px-3 py-2 text-stone-800 border-r border-stone-100 whitespace-nowrap overflow-hidden max-w-[150px] text-ellipsis">
                                      {String(row[header] !== undefined ? row[header] : "")}
                                    </td>
                                  ))}
                                  {info.headers.length > 8 && <td className="px-3 py-2 text-stone-400">...</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  disabled={excelImporting}
                  onClick={handleExcelImportSubmit}
                  className="px-6 py-3 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-2xl text-xs flex items-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
                >
                  {excelImporting ? (
                    <span>กำลังนำเข้าและคำนวณ...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      นำเข้าข้อมูลที่เลือกทั้งหมดเข้าสู่ Firestore
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB TAB: Document Templates */}
      {activeSubTab === "doc_templates" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-stone-900">หน้าตั้งค่าเทมเพลตเอกสาร (Document Page Templates)</h3>
              <p className="text-xs text-stone-500">
                จัดการรูปแบบหน้าตาเอกสารต่างๆ ในระบบ เช่น ใบเบิก ใบเสร็จ และสลิปการโอนเงิน (Coming Soon)
              </p>
            </div>
          </div>
          
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-stone-500" />
              <span className="text-xs font-semibold text-stone-700">พื้นที่เก็บไฟล์เทมเพลต:</span>
              <span className="text-xs font-bold text-emerald-600">ไม่จำกัด (Unlimited)</span>
            </div>
            <div className="text-[10px] text-stone-500 font-medium">
              จำนวนไฟล์ในระบบ: <span className="font-bold text-stone-900">0</span> ไฟล์
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs text-center text-stone-500 text-sm italic">
            ฟีเจอร์นี้อยู่ระหว่างการพัฒนา... สามารถระบุรูปแบบเทมเพลตและอัปโหลดไฟล์ HTML/PDF ในภายหลัง
          </div>
        </div>
      )}

      {/* SUB TAB: LINE Notifications */}
      {activeSubTab === "line_notifications" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-stone-900">หน้าตั้งค่าการแจ้งเตือนทาง LINE (LINE Notifications)</h3>
              <p className="text-xs text-stone-500">
                ตั้งค่าและเลือกว่าจะให้มีการแจ้งเตือนทาง LINE ในขั้นตอนใดบ้าง เช่น เมื่อมีการส่งขอเบิก เมื่อบัญชีอนุมัติ หรือเมื่อโอนเงินสำเร็จ
              </p>
            </div>
            <button
              onClick={handleSaveLineSettings}
              disabled={saving}
              className="px-5 py-2.5 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> บันทึกการตั้งค่า LINE
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs p-6 space-y-6">
                <div className="bg-stone-900 text-stone-100 p-5 rounded-2xl shadow-lg space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-stone-500 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" /> ตัวแปรที่รองรับ (Available Variables)
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {LINE_VARIABLES.map(v => (
                      <div key={v.name} className="flex flex-col">
                        <span className="text-[10px] font-mono font-bold text-amber-400">{v.name}</span>
                        <span className="text-[9px] text-stone-400">{v.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-stone-800">
                    <p className="text-[9px] text-stone-500 italic">
                      * สำหรับ Flex Message ให้วางโครงสร้าง JSON ในช่องข้อความ ระบบจะทำการสกัดตัวแปรให้อัตโนมัติ
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-stone-700 block">LINE Channel Access Token</label>
                   <input
                      type="text"
                      placeholder="Paste Channel Access Token here..."
                      value={lineChannelAccessToken}
                      onChange={(e) => setLineChannelAccessToken(e.target.value)}
                      className="w-full max-w-2xl px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-stone-700 block">LINE Channel Secret</label>
                   <input
                      type="password"
                      placeholder="Paste Channel Secret here..."
                      value={lineChannelSecret}
                      onChange={(e) => setLineChannelSecret(e.target.value)}
                      className="w-full max-w-md px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-stone-700 block">LINE LIFF ID</label>
                   <input
                      type="text"
                      placeholder="Paste LIFF ID here..."
                      value={lineLiffId}
                      onChange={(e) => setLineLiffId(e.target.value)}
                      className="w-full max-w-md px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-950 text-xs font-mono"
                   />
                 </div>
               </div>
               
                <div className="pt-4 border-t border-stone-100 space-y-4">
                  <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider mb-2">รูปแบบข้อความแจ้งเตือน (Notification Triggers)</h4>
                  
                  <div className="space-y-3">
                    {lineTriggers.map((trigger, idx) => (
                      <div key={trigger.id} className="border border-stone-200 rounded-xl p-3 bg-stone-50 relative group">
                        <div className="flex gap-2 items-start justify-between">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between gap-4">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={trigger.isActive} 
                                  onChange={(e) => {
                                    const updated = [...lineTriggers];
                                    updated[idx].isActive = e.target.checked;
                                    setLineTriggers(updated);
                                  }}
                                  className="w-4 h-4 rounded text-stone-950 border-stone-300 focus:ring-stone-950" 
                                />
                                <input 
                                  type="text"
                                  value={trigger.name}
                                  onChange={(e) => {
                                    const updated = [...lineTriggers];
                                    updated[idx].name = e.target.value;
                                    setLineTriggers(updated);
                                  }}
                                  className="text-xs font-bold text-stone-800 bg-transparent border-b border-dashed border-stone-300 focus:outline-none focus:border-stone-950 px-1 w-full max-w-[200px]"
                                />
                              </label>
                              
                              <div className="flex bg-stone-200 p-0.5 rounded-lg shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...lineTriggers];
                                    updated[idx].type = "text";
                                    setLineTriggers(updated);
                                  }}
                                  className={`px-2 py-0.5 text-[9px] font-bold rounded-md transition ${trigger.type === "text" || !trigger.type ? "bg-white text-stone-950 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                                >
                                  TEXT
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...lineTriggers];
                                    updated[idx].type = "flex";
                                    setLineTriggers(updated);
                                  }}
                                  className={`px-2 py-0.5 text-[9px] font-bold rounded-md transition ${trigger.type === "flex" ? "bg-white text-stone-950 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                                >
                                  FLEX
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={trigger.messageTemplate}
                              placeholder={trigger.type === "flex" ? "Paste Flex Message JSON here..." : "Type message template here..."}
                              onChange={(e) => {
                                const updated = [...lineTriggers];
                                updated[idx].messageTemplate = e.target.value;
                                setLineTriggers(updated);
                              }}
                              rows={3}
                              className="w-full text-xs font-mono bg-white border border-stone-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-stone-950"
                            />
                          </div>
                          <div className="flex flex-col gap-1 items-end shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewTriggerId(trigger.id)}
                              className={`text-[10px] font-bold px-2 py-1 rounded ${previewTriggerId === trigger.id ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-600 hover:bg-stone-300"}`}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if(window.confirm("ลบรูปแบบข้อความนี้?")) {
                                  const updated = lineTriggers.filter((_, i) => i !== idx);
                                  setLineTriggers(updated);
                                  if (previewTriggerId === trigger.id) setPreviewTriggerId(updated.length > 0 ? updated[0].id : "");
                                }
                              }}
                              className="text-red-500 hover:bg-red-50 p-1 rounded transition mt-2"
                              title="ลบ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 flex flex-col gap-2 border-t border-stone-100">
                    <div className="flex items-center justify-between">
                      <h5 className="text-[10px] font-bold text-stone-500 uppercase">เพิ่มรูปแบบใหม่</h5>
                      <div className="flex bg-stone-100 p-0.5 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setNewLineTriggerType("text")}
                          className={`px-2 py-0.5 text-[9px] font-bold rounded-md transition ${newLineTriggerType === "text" ? "bg-white text-stone-950 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                        >
                          TEXT
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewLineTriggerType("flex")}
                          className={`px-2 py-0.5 text-[9px] font-bold rounded-md transition ${newLineTriggerType === "flex" ? "bg-white text-stone-950 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                        >
                          FLEX
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="ชื่อเหตุการณ์ (เช่น เตือนทุกสิ้นเดือน)"
                      value={newLineTriggerName}
                      onChange={(e) => setNewLineTriggerName(e.target.value)}
                      className="w-full text-xs bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-950"
                    />
                    <textarea
                      placeholder={newLineTriggerType === "flex" ? "วางโครงสร้าง JSON ของ Flex Message ที่นี่..." : "ข้อความ (รองรับตัวแปร {advId}, {employeeName}, {amount})"}
                      value={newLineTriggerTemplate}
                      onChange={(e) => setNewLineTriggerTemplate(e.target.value)}
                      rows={2}
                      className="w-full text-xs font-mono bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-950"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newLineTriggerName.trim() || !newLineTriggerTemplate.trim()) return;
                        const newTrigger: LineMessageTrigger = {
                          id: `trigger_${Date.now()}`,
                          name: newLineTriggerName.trim(),
                          isActive: true,
                          messageTemplate: newLineTriggerTemplate.trim(),
                          type: newLineTriggerType
                        };
                        setLineTriggers([...lineTriggers, newTrigger]);
                        setNewLineTriggerName("");
                        setNewLineTriggerTemplate("");
                      }}
                      className="text-xs font-bold text-stone-950 bg-stone-200 hover:bg-stone-300 px-3 py-1.5 rounded-lg transition self-start"
                    >
                      + เพิ่มรูปแบบ
                    </button>
                  </div>
               </div>
            </div>

            {/* Mobile Mockup */}
            <div className="flex justify-center items-start pt-6">
              <div className="w-[300px] h-[600px] bg-stone-900 rounded-[40px] p-3 shadow-2xl relative border-[6px] border-stone-800">
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-stone-800 rounded-b-xl z-10"></div>
                {/* Screen */}
                <div className="bg-[#849ebf] w-full h-full rounded-[30px] overflow-hidden flex flex-col relative">
                  {/* Header */}
                  <div className="bg-[#2c3e50] h-14 flex items-center px-4 text-white font-semibold pt-2">
                     <div className="w-8 h-8 bg-stone-200 rounded-full flex items-center justify-center text-[#2c3e50] mr-2 shrink-0 overflow-hidden">
                       <img src="https://upload.wikimedia.org/wikipedia/commons/4/41/LINE_logo.svg" alt="LINE" className="w-full h-full object-cover" />
                     </div>
                     <span className="truncate">Constructech Bot</span>
                  </div>
                  {/* Chat Area */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 pt-6">
                    <div className="text-center text-[10px] text-white/70 mb-4 bg-black/20 rounded-full px-2 py-0.5 w-fit mx-auto">Today</div>
                    
                    {/* Preview Message */}
                    {getPreviewTrigger() && (
                      <div className="flex items-start">
                        <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center mr-2 shrink-0 overflow-hidden">
                          <img src="https://upload.wikimedia.org/wikipedia/commons/4/41/LINE_logo.svg" alt="LINE" className="w-full h-full object-cover" />
                        </div>
                        {getPreviewTrigger()?.type === "flex" ? (
                          (() => {
                            const parsed = parseFlexPreview(getPreviewTrigger()?.messageTemplate || "");
                            return parsed.error ? (
                              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-2xl rounded-tl-sm max-w-[85%] text-[11px] font-bold">
                                JSON Flex Message ไม่ถูกต้อง: {parsed.error}
                              </div>
                            ) : (
                              renderFlexPreview(parsed.value)
                            );
                          })()
                        ) : (
                          <div className="bg-white text-[#333333] p-3 rounded-2xl rounded-tl-sm shadow-sm max-w-[80%] text-xs whitespace-pre-wrap leading-relaxed relative">
                             {replaceLineVariables(getPreviewTrigger()?.messageTemplate || "")}
                             <div className="absolute right-[-30px] bottom-0 text-[9px] text-white/70">10:42</div>
                          </div>
                        )}
                      </div>
                    )}
                    {!getPreviewTrigger() && (
                      <div className="text-center text-xs text-white/70 italic mt-10">กรุณาเลือก Preview รูปแบบข้อความ</div>
                    )}
                  </div>
                  {/* Input area */}
                  <div className="bg-white h-12 flex items-center px-3 border-t border-stone-200">
                    <div className="w-6 h-6 rounded-full border-2 border-stone-300 mr-2"></div>
                    <div className="flex-1 bg-stone-100 h-8 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. AI Raw Text Importer Modal */}
      {rawTextImportOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="ai_text_import_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  ⌨️ พิมพ์ป้อนข้อมูลตั้งค่าระบบด้วย AI อัจฉริยะ (AI Raw Text Importer)
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">พิมพ์อธิบายข้อมูลที่ต้องการให้ระบบนำเข้าในรูปแบบแชตหรือข้อความธรรมดา AI จะสกัดให้ทันที</p>
              </div>
              <button
                type="button"
                onClick={() => setRawTextImportOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Area */}
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รายละเอียดโครงการและข้อมูลที่ต้องการให้สกัด</label>
                <textarea
                  rows={8}
                  value={rawTextContent}
                  onChange={(e) => setRawTextContent(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-sans text-stone-900 focus:ring-1 focus:ring-stone-950 focus:outline-none"
                  placeholder={`ระบุโครงการ งบประมาณ หรือหมวดหมู่ของคุณที่ต้องการให้ AI สกัดลงตารางอัตโนมัติ

ตัวอย่างเช่น:
1. โครงการปรับปรุงออฟฟิศพญาไท งบสัญญาทั้งหมด 20,000,000 บาท และกำหนดเงินทดรองจ่ายหน้างานไว้ 1,500,000 บาท
2. โครงการคอนโดมิเนียมสุขุมวิท งบสัญญา 85,000,000 บาท และเงินทดรองสะสม 5,000,000 บาท
3. เพิ่มหมวดหมู่ค่าใช้จ่ายสำหรับการเคลียร์ยอด: ค่าทรายหยาบ, ค่าปูนขาวสำเร็จรูป, ค่าเหล็กเส้นกลม, ค่าเครื่องดื่มคนงานหน้างาน, ค่าทางด่วน`}
                />
              </div>

              {/* Actions Footer */}
              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setRawTextImportOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 font-bold rounded-xl text-xs transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleAiTextImport}
                  disabled={importing || !rawTextContent.trim()}
                  className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
                >
                  {importing ? "AI กำลังสกัดป้อน..." : <><Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> วิเคราะห์สะกดและเติมตารางทันที</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 3. Bulk Import Users Modal */}
      {isBulkImportUsersOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="bulk_import_users_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  👥 นำเข้ารายชื่อพนักงานแบบกลุ่ม (Bulk Import Users)
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">ระบุรายชื่อพนักงาน บัญชีผู้ใช้งาน และสิทธิ์ เพื่อเพิ่มลงระบบพร้อมกันหลายรายการ</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkImportUsersOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รายชื่อพนักงาน (หนึ่งพนักงานต่อหนึ่งบรรทัด)</label>
                <div className="bg-amber-50/60 border border-amber-100 p-3 rounded-xl text-[11px] text-amber-800 leading-relaxed mb-2 font-medium">
                  <span className="font-bold block mb-1">💡 รูปแบบที่รองรับ (ใส่เครื่องหมายจุลภาคคั่น):</span>
                  ชื่อนามสกุล, บัญชีผู้ใช้, รหัสผ่านPIN(4หลัก), ระดับสิทธิ์, ธนาคาร, เลขที่บัญชี, ชื่อบัญชีธนาคาร<br />
                  <span className="font-bold mt-1 block">ตัวอย่าง:</span>
                  นายสมศักดิ์ รักดี, somsak, 1234, Requester, กสิกรไทย, 1234567890, นายสมศักดิ์ รักดี<br />
                  น.ส.ใจดี เรียนรู้, jaidee, 5678, Approver, ไทยพาณิชย์, 0987654321, น.ส.ใจดี เรียนรู้<br />
                  <span className="text-stone-500 text-[10px] mt-1 block">*หากป้อนเฉพาะชื่อ ระบบจะสุ่มบัญชีผู้ใช้ และใช้ PIN เริ่มต้น "1234" และสิทธิ์ "Requester" อัตโนมัติ</span>
                </div>
                <textarea
                  rows={8}
                  value={bulkUsersText}
                  onChange={(e) => setBulkUsersText(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-mono text-stone-900 focus:ring-1 focus:ring-stone-950 focus:outline-none"
                  placeholder={`สมเกียรติ รักงาน, somkiat, 1234, Requester, กรุงเทพ, 1112223334
นารี ทนทาน, naree, 1234, Accounting, ออมสิน, 5556667778`}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsBulkImportUsersOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 font-bold rounded-xl text-xs transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleBulkImportUsers}
                  disabled={saving || !bulkUsersText.trim()}
                  className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
                >
                  {saving ? "กำลังนำเข้า..." : <><Check className="w-3.5 h-3.5 text-emerald-400" /> นำเข้ารายการพนักงานทั้งหมด</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Bulk Import Projects Modal */}
      {isBulkImportProjectsOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="bulk_import_projects_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  🏗️ นำเข้าโครงการและงบประมาณแบบกลุ่ม (Bulk Import Projects)
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">ระบุรายชื่อโครงการ มูลค่าสัญญา และงบเงินทดรองจ่ายสำรองของแต่ละโครงการ</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkImportProjectsOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รายชื่อโครงการ (หนึ่งโครงการต่อหนึ่งบรรทัด)</label>
                <div className="bg-amber-50/60 border border-amber-100 p-3 rounded-xl text-[11px] text-amber-800 leading-relaxed mb-2 font-medium">
                  <span className="font-bold block mb-1">💡 รูปแบบที่รองรับ (ใส่เครื่องหมายจุลภาคคั่น):</span>
                  ชื่อโครงการ, งบประมาณสัญญา(ตัวเลข), งบเงินทดรองจ่ายสำรอง(ตัวเลข)<br />
                  <span className="font-bold mt-1 block">ตัวอย่าง:</span>
                  Project Delta (อาคารผู้โดยสาร), 15000000, 1200000<br />
                  Project Epsilon (สะพานข้ามแม่น้ำ), 24500000, 1800000<br />
                  <span className="text-stone-500 text-[10px] mt-1 block">*หากป้อนเฉพาะชื่อระบบจะเซ็ตงบประมาณเป็น 0 บาทโดยอัตโนมัติ</span>
                </div>
                <textarea
                  rows={8}
                  value={bulkProjectsText}
                  onChange={(e) => setBulkProjectsText(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-mono text-stone-900 focus:ring-1 focus:ring-stone-950 focus:outline-none"
                  placeholder={`Project Omega, 5000000, 450000
Project Alpha, 12000000, 1000000`}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsBulkImportProjectsOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 font-bold rounded-xl text-xs transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleBulkImportProjects}
                  disabled={saving || !bulkProjectsText.trim()}
                  className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
                >
                  {saving ? "กำลังนำเข้า..." : <><Check className="w-3.5 h-3.5 text-emerald-400" /> นำเข้ารายการโครงการทั้งหมด</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Bulk Import Categories Modal */}
      {isBulkImportCategoriesOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="bulk_import_categories_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  🏷️ นำเข้าหมวดหมู่ค่าใช้จ่ายแบบกลุ่ม (Bulk Import Categories)
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">ระบุรายชื่อหมวดหมู่ค่าใช้จ่ายที่ต้องการเปิดให้พนักงานใช้เลือกสำหรับทำเรื่องเบิกงบประมาณ</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkImportCategoriesOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wider block">รายชื่อหมวดหมู่ (หนึ่งหมวดหมู่ต่อหนึ่งบรรทัด)</label>
                <div className="bg-amber-50/60 border border-amber-100 p-3 rounded-xl text-[11px] text-amber-800 leading-relaxed mb-2 font-medium">
                  <span className="font-bold block mb-1">💡 รูปแบบที่รองรับ:</span>
                  ป้อนชื่อหมวดหมู่ที่คุณต้องการได้โดยตรง บรรทัดละ 1 หมวดหมู่<br />
                  <span className="font-bold mt-1 block">ตัวอย่าง:</span>
                  ค่าวัสดุก่อสร้างเบ็ดเตล็ด<br />
                  ค่าเดินทางและน้ำมันรถขนส่ง<br />
                  ค่าแรงงานและจ้างเหมารายวัน<br />
                  ค่าอาหารและน้ำดื่มสำหรับแคมป์คนงาน
                </div>
                <textarea
                  rows={8}
                  value={bulkCategoriesText}
                  onChange={(e) => setBulkCategoriesText(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-mono text-stone-900 focus:ring-1 focus:ring-stone-950 focus:outline-none"
                  placeholder={`ค่าขนถ่ายขยะวัสดุหน้างาน
ค่าภาษีท้องถิ่นและอนุญาตก่อสร้าง
ค่าประกันอัคคีภัยไซต์งาน`}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsBulkImportCategoriesOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 font-bold rounded-xl text-xs transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleBulkImportCategories}
                  disabled={saving || !bulkCategoriesText.trim()}
                  className="px-5 py-2 bg-stone-950 hover:bg-stone-900 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5"
                >
                  {saving ? "กำลังนำเข้า..." : <><Check className="w-3.5 h-3.5 text-emerald-400" /> นำเข้ารายการหมวดหมู่ทั้งหมด</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
