/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/errorUtils";
import { Advance, AdvanceStatus, Employee, UserRole, ActionType, AuditLog } from "../types";
import { checkApprovalPermission } from "../lib/permissionEngine";
import ClearanceSchedule from "./dashboard/ClearanceSchedule";
import { exportToExcel } from "../lib/excelExport";
import { motion } from "motion/react";
import {
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Wallet,
  FileCheck2,
  ArrowRightLeft,
  Send,
  ArrowUpRight,
  Receipt,
  HardDrive,
  History,
  Search,
  Filter,
  Check,
  X,
  Eye,
  User,
  Calendar,
  ChevronRight,
  Sparkles,
  Info,
  Grid,
  List,
  FileSpreadsheet,
  BarChart3
} from "lucide-react";
import regeneratedHero from "../assets/images/regenerated_image_1782709418470.png";

interface DashboardProps {
  currentEmployee: Employee;
  onNavigate: (tab: string) => void;
  onEditDraftAdvance?: (adv: Advance) => void;
  onEditDraftClearing?: (logId: string) => void;
  onProfileUpdate?: (updated: Employee) => void;
}

export default function Dashboard({ currentEmployee, onNavigate, onEditDraftAdvance, onEditDraftClearing, onProfileUpdate }: DashboardProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [draftClearingLogs, setDraftClearingLogs] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>(null);

  // Real-time listener for global settings/rules
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "global"), (snap) => {
      if (snap.exists()) {
        setGlobalSettings(snap.data());
      }
    });
    return () => unsub();
  }, []);

  // Search & Filter state (for Accountant and general views)
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");

  // Interaction Modals / States
  const [selectedAdv, setSelectedAdv] = useState<Advance | null>(null);

  const navigateToTransaction = (advId: string) => {
    const adv = advances.find(a => a.advId === advId);
    if (!adv) {
      onNavigate("audit");
      return;
    }

    // Determine navigation target based on role and status
    if (currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ADMIN) {
      if (adv.status === AdvanceStatus.PENDING_APPROVAL) {
        onNavigate("approval");
        return;
      }
    }

    if (currentEmployee.role === UserRole.ACCOUNTANT) {
      if (adv.status === AdvanceStatus.WAITING_TRANSFER || adv.status === AdvanceStatus.PENDING_AUDIT) {
        onNavigate("accounting");
        return;
      }
    }

    if (adv.status === AdvanceStatus.WAITING_CLEARANCE || adv.status === AdvanceStatus.PARTIALLY_CLEARED || adv.status === AdvanceStatus.RETURNED) {
      onNavigate("clearance");
      return;
    }

    onNavigate("audit");
  };

  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dashboardImage, setDashboardImage] = useState<string>(currentEmployee.profilePhotoURL || currentEmployee.profileImage || currentEmployee.linePictureUrl || "");
  const [isEditingImage, setIsEditingImage] = useState<boolean>(false);
  const [imageScale, setImageScale] = useState<number>(currentEmployee.imageScale || 1);
  const [imagePosition, setImagePosition] = useState<{x: number, y: number}>(currentEmployee.imagePosition || {x: 50, y: 50});
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const heroImageSrc = dashboardImage
    ? dashboardImage.startsWith("data:")
      ? dashboardImage
      : `${dashboardImage}${dashboardImage.includes("?") ? "&" : "?"}v=${currentEmployee.profilePhotoUpdatedAt?.seconds || ""}`
    : "";

  // Auto-dismiss success/error alerts after 4 seconds
  useEffect(() => {
    // Recalculate and update system analytical collections on mount
    import("../lib/systemCollections")
      .then(({ autoUpdateSystemCollections }) => {
        autoUpdateSystemCollections().catch(err => console.error("Error auto-updating system collections:", err));
      })
      .catch(err => console.error("Error loading systemCollections:", err));
  }, []);

  useEffect(() => {
    if (successMessage || errorMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, errorMessage]);

  useEffect(() => {
    setDashboardImage(currentEmployee.profilePhotoURL || currentEmployee.profileImage || currentEmployee.linePictureUrl || "");
    setImageScale(currentEmployee.imageScale || 1);
    setImagePosition(currentEmployee.imagePosition || { x: 50, y: 50 });
  }, [
    currentEmployee.profilePhotoURL,
    currentEmployee.profileImage,
    currentEmployee.linePictureUrl,
    currentEmployee.imageScale,
    currentEmployee.imagePosition,
  ]);

  // Notification Drawer State for Employees
  const [isNotificationOpen, setIsNotificationOpen] = useState<boolean>(false);
  const [activeTaskTab, setActiveTaskTab] = useState<"notifications" | "todo">("notifications");

  // Table vs Card View toggle states
  const [managerTableViewMode, setManagerTableViewMode] = useState<"table" | "card">("table");
  const [acctTableViewMode, setAcctTableViewMode] = useState<"table" | "card">("table");

  const [activeView, setActiveView] = useState<"overview" | "schedule">("overview");

  useEffect(() => {
    const advancesRef = collection(db, "advances");
    let q = query(advancesRef);

    // If standard employee, filter only their own requests
    if (currentEmployee.role === UserRole.EMPLOYEE) {
      q = query(advancesRef, where("employeeId", "==", currentEmployee.id));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Advance);
      });
      // Sort by newest created
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setAdvances(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "advances", false);
    });

    return () => unsubscribe();
  }, [currentEmployee]);

  // Fetch draft clearing logs for standard employees
  useEffect(() => {
    if (currentEmployee.role === UserRole.EMPLOYEE) {
      const q = query(
        collection(db, "clearingLogs"),
        where("status", "==", "DRAFT")
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          const log = { id: docSnap.id, ...docSnap.data() } as any;
          if (log.submittedBy === currentEmployee.name) {
            list.push(log);
          }
        });
        setDraftClearingLogs(list);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, "clearingLogs", false);
      });
      return () => unsubscribe();
    }
  }, [currentEmployee]);

  // Fetch employees list (for Manager/Accountant count and reference)
  useEffect(() => {
    if (currentEmployee.role !== UserRole.EMPLOYEE) {
      const unsubscribe = onSnapshot(collection(db, "employees"), (snapshot) => {
        const list: Employee[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Employee);
        });
        setEmployees(list);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, "employees", false);
      });
      return () => unsubscribe();
    }
  }, [currentEmployee]);

  // Fetch audit logs (for Notification list & timeline)
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "auditLogs"), (snapshot) => {
      const list: AuditLog[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as AuditLog);
      });
      list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setAuditLogs(list);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, "auditLogs", false);
    });
    return () => unsubscribe();
  }, []);

  // Filter out notifications relevant to Employee
  const employeeNotifications = auditLogs.filter((log) => {
    // Audit logs for Employee's own advances
    return advances.some((adv) => adv.advId === log.advId);
  }).slice(0, 10);

  // KPI Calculations
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(val);
  };

  const isAccountant = currentEmployee.role === UserRole.ACCOUNTANT;
  const isAdmin = currentEmployee.role === UserRole.ADMIN;
  const isCeo = currentEmployee.position === "กรรมการผู้จัดการ" || 
                 currentEmployee.position === "ผู้บริหาร" || 
                 currentEmployee.position?.toLowerCase() === "ceo" ||
                 currentEmployee.position?.toLowerCase() === "executive";

  const isFullAccess = isAccountant || isAdmin || isCeo;

  const kpiAdvances = isFullAccess
    ? advances
    : advances.filter((a) => a.employeeId === currentEmployee.id);

  // 1. Employee calculations (Strictly personal)
  const empPersonalAdvances = advances.filter((a) => a.employeeId === currentEmployee.id);
  const nonDraftAdvances = empPersonalAdvances.filter((a) => a.status !== AdvanceStatus.DRAFT);
  const draftAdvances = empPersonalAdvances.filter((a) => a.status === AdvanceStatus.DRAFT);

  const empOutstandingBalance = nonDraftAdvances
    .filter((a) => [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.RETURNED].includes(a.status))
    .reduce((sum, a) => sum + a.outstandingAmount, 0);

  const empTotalItemsCount = nonDraftAdvances.length;

  const empMoneyToClear = nonDraftAdvances
    .filter((a) => [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.PENDING_AUDIT, AdvanceStatus.RETURNED].includes(a.status))
    .reduce((sum, a) => sum + a.outstandingAmount, 0);

  const empTotalAdvanceAmount = nonDraftAdvances
    .filter((a) => a.status !== AdvanceStatus.REJECTED)
    .reduce((sum, a) => sum + (a.approvedAmount || a.requestAmount), 0);

  const empClosedAmount = nonDraftAdvances
    .filter((a) => a.status === AdvanceStatus.CLOSED)
    .reduce((sum, a) => sum + (a.approvedAmount || a.requestAmount), 0);

  const nowTime = new Date().getTime();
  const empOverdueAmount = nonDraftAdvances
    .filter((a) => {
      if (![AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.RETURNED].includes(a.status)) return false;
      if (!a.neededDate) return false;
      const diffDays = Math.ceil((new Date(a.neededDate).getTime() - nowTime) / (1000 * 60 * 60 * 24));
      return diffDays < 0;
    })
    .reduce((sum, a) => sum + a.outstandingAmount, 0);

  // 2. Manager calculations
  const managerPendingCount = kpiAdvances.filter((a) => a.status === AdvanceStatus.PENDING_APPROVAL).length;
  const managerPendingAmount = kpiAdvances
    .filter((a) => a.status === AdvanceStatus.PENDING_APPROVAL)
    .reduce((sum, a) => sum + a.requestAmount, 0);
  const managerTotalEmployees = employees.length || 1;

  // Recent created requests in last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const managerRecentCount = kpiAdvances.filter((a) => new Date(a.createdAt) >= sevenDaysAgo).length;

  // 3. Accountant calculations
  const acctPendingClearValue = kpiAdvances
    .filter((a) => [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.PENDING_AUDIT, AdvanceStatus.RETURNED].includes(a.status))
    .reduce((sum, a) => sum + a.outstandingAmount, 0);

  const acctOverdueAmount = kpiAdvances
    .filter((a) => {
      if (![AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.RETURNED].includes(a.status)) return false;
      if (!a.neededDate) return false;
      const diffDays = Math.ceil((new Date(a.neededDate).getTime() - nowTime) / (1000 * 60 * 60 * 24));
      return diffDays < 0;
    })
    .reduce((sum, a) => sum + a.outstandingAmount, 0);

  const acctClosedValue = kpiAdvances
    .filter((a) => a.status === AdvanceStatus.CLOSED)
    .reduce((sum, a) => sum + a.requestAmount, 0);

  const acctTotalItems = kpiAdvances.length;
  const acctTotalValue = kpiAdvances.reduce((sum, a) => sum + a.requestAmount, 0);

  // Unique project options list for filter dropdown
  const uniqueProjects = Array.from(new Set(advances.map((adv) => adv.projectId).filter(Boolean)));

  // Filtered advances for Accountant / Admin grid table
  const filteredAdvances = advances.filter((adv) => {
    const matchesSearch =
      adv.advId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      adv.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      adv.projectId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (adv.details && adv.details.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "ALL" ? true : adv.status === statusFilter;
    const matchesProject = projectFilter === "ALL" ? true : adv.projectId === projectFilter;

    return matchesSearch && matchesStatus && matchesProject;
  });

  const [confirmDialogApprove, setConfirmDialogApprove] = useState<{ isOpen: boolean; adv: Advance | null }>({ isOpen: false, adv: null });

  // Action: Approve Advance Request
  const handleApprove = async (adv: Advance) => {
    // Run the Permission Engine validation
    const rules = globalSettings?.approvalWorkflow?.rules || [];
    const permResult = checkApprovalPermission(currentEmployee, adv, rules);
    if (!permResult.allowed) {
      setErrorMessage(permResult.reason || "คุณไม่มีสิทธิ์อนุมัติยอดเงินนี้ตามเงื่อนไขในระบบ Matrix");
      return;
    }
    setConfirmDialogApprove({ isOpen: true, adv });
  };

  const executeApprove = async () => {
    const adv = confirmDialogApprove.adv;
    if (!adv) return;
    setConfirmDialogApprove({ isOpen: false, adv: null });
    
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const ref = doc(db, "advances", adv.id);
      await updateDoc(ref, {
        status: AdvanceStatus.WAITING_TRANSFER,
        approvedAt: new Date().toISOString(),
        approvedBy: currentEmployee.name,
      });

      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: adv.advId,
        actionType: ActionType.APPROVE_ADVANCE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: AdvanceStatus.PENDING_APPROVAL,
        afterStatus: AdvanceStatus.WAITING_TRANSFER,
        note: `อนุมัติใบขอเบิกเงิน โดยผู้จัดการ ${currentEmployee.name}`,
      } as AuditLog);

      setSuccessMessage(`อนุมัติใบขอเบิกเลขที่ ${adv.advId} เรียบร้อยแล้ว!`);
      setIsDetailModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setErrorMessage("เกิดข้อผิดพลาดในการอนุมัติรายการ: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Reject Request Modal Trigger
  const handleOpenReject = (adv: Advance) => {
    setSelectedAdv(adv);
    setRejectionReason("");
    setIsRejectModalOpen(true);
  };

  // Action: Confirm Reject
  const handleConfirmReject = async () => {
    if (!selectedAdv) return;
    if (!rejectionReason.trim()) {
      alert("กรุณาระบุเหตุผลในการปฏิเสธการอนุมัติ");
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const ref = doc(db, "advances", selectedAdv.id);
      await updateDoc(ref, {
        status: AdvanceStatus.REJECTED,
        note: selectedAdv.note 
          ? `${selectedAdv.note}\n[ปฏิเสธโดยผู้จัดการ]: ${rejectionReason}` 
          : `[ปฏิเสธโดยผู้จัดการ]: ${rejectionReason}`
      });

      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.REJECT_ADVANCE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: AdvanceStatus.PENDING_APPROVAL,
        afterStatus: AdvanceStatus.REJECTED,
        note: `ปฏิเสธคำขอโดยผู้จัดการ ${currentEmployee.name}. เหตุผล: ${rejectionReason}`,
      } as AuditLog);

      setSuccessMessage(`ปฏิเสธใบขอเบิกเลขที่ ${selectedAdv.advId} เรียบร้อยแล้ว`);
      setIsRejectModalOpen(false);
      setIsDetailModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setErrorMessage("เกิดข้อผิดพลาดในการปฏิเสธรายการ: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenDetails = (adv: Advance) => {
    setSelectedAdv(adv);
    setIsDetailModalOpen(true);
  };

  const getStatusBadge = (status: AdvanceStatus) => {
    switch (status) {
      case AdvanceStatus.DRAFT:
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><FileText className="w-3 h-3" /> บันทึกร่าง</span>;
      case AdvanceStatus.PENDING_APPROVAL:
        return <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> รออนุมัติ</span>;
      case AdvanceStatus.WAITING_TRANSFER:
        return <span className="px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><ArrowRightLeft className="w-3 h-3" /> รอโอนเงิน</span>;
      case AdvanceStatus.WAITING_CLEARANCE:
        return <span className="px-2.5 py-1 bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><Wallet className="w-3 h-3" /> รอเคลียร์</span>;
      case AdvanceStatus.PENDING_AUDIT:
        return <span className="px-2.5 py-1 bg-yellow-50 text-yellow-800 border border-yellow-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> รอตรวจบิล</span>;
      case AdvanceStatus.PARTIALLY_CLEARED:
        return <span className="px-2.5 py-1 bg-purple-50 text-purple-800 border border-purple-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><Wallet className="w-3 h-3" /> เคลียร์บางส่วน</span>;
      case AdvanceStatus.RETURNED:
        return <span className="px-2.5 py-1 bg-red-50 text-red-800 border border-red-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> ตีกลับเอกสาร</span>;
      case AdvanceStatus.REJECTED:
        return <span className="px-2.5 py-1 bg-stone-100 text-stone-700 border border-stone-300 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><X className="w-3 h-3" /> ปฏิเสธการอนุมัติ</span>;
      case AdvanceStatus.CLOSED:
        return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold rounded-full flex items-center gap-1 w-fit"><FileCheck2 className="w-3 h-3" /> ปิดยอดแล้ว</span>;
      default:
        return null;
    }
  };

  // Calculate urgent clearing items (nearing clearing deadline, sorted by neededDate ascending)
  const urgentClearingAdvances = kpiAdvances
    .filter((a) => 
      [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.RETURNED].includes(a.status) && 
      a.outstandingAmount > 0
    )
    .sort((a, b) => (a.neededDate || "").localeCompare(b.neededDate || ""))
    .slice(0, 5);

  // Calculate top 3 employees with highest total outstanding balances
  const empOutstandingMap: { [name: string]: { id: string; name: string; outstanding: number; count: number } } = {};
  kpiAdvances.forEach((a) => {
    if (a.outstandingAmount > 0) {
      const key = a.employeeName || "ไม่ระบุชื่อ";
      if (!empOutstandingMap[key]) {
        empOutstandingMap[key] = { id: a.employeeId, name: key, outstanding: 0, count: 0 };
      }
      empOutstandingMap[key].outstanding += a.outstandingAmount;
      empOutstandingMap[key].count += 1;
    }
  });
  const topEmployeesOutstanding = Object.values(empOutstandingMap)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 3);

  // Calculate stats for the Dynamic Hero Banner
  const getStats = () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfPrevDay = new Date(startOfDay);
    startOfPrevDay.setDate(startOfDay.getDate() - 1);

    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfPrevWeek = new Date(startOfWeek);
    startOfPrevWeek.setDate(startOfWeek.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    let todayCount = 0, todayAmount = 0, prevTodayAmount = 0;
    let weekCount = 0, weekAmount = 0, prevWeekAmount = 0;
    let monthCount = 0, monthAmount = 0, prevMonthAmount = 0;

    const userAdvances = kpiAdvances;
    userAdvances.forEach(adv => {
      const advDate = new Date(adv.createdAt);
      const amt = adv.requestAmount || 0;

      if (advDate >= startOfDay) {
        todayCount++; todayAmount += amt;
      } else if (advDate >= startOfPrevDay) {
        prevTodayAmount += amt;
      }

      if (advDate >= startOfWeek) {
        weekCount++; weekAmount += amt;
      } else if (advDate >= startOfPrevWeek) {
        prevWeekAmount += amt;
      }

      if (advDate >= startOfMonth) {
        monthCount++; monthAmount += amt;
      } else if (advDate >= startOfPrevMonth) {
        prevMonthAmount += amt;
      }
    });

    const calcDiff = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    return {
      today: { count: todayCount, amount: todayAmount, diff: calcDiff(todayAmount, prevTodayAmount) },
      week: { count: weekCount, amount: weekAmount, diff: calcDiff(weekAmount, prevWeekAmount) },
      month: { count: monthCount, amount: monthAmount, diff: calcDiff(monthAmount, prevMonthAmount) }
    };
  };
  const heroStats = getStats();

  let kpiPreset = "employee";
  if (currentEmployee.position) {
    const roleConfig = globalSettings?.rolePermissions?.roles?.find((r: any) => r.id === currentEmployee.position);
    if (roleConfig?.dashboard?.kpiPreset) {
      kpiPreset = roleConfig.dashboard.kpiPreset;
    }
  } else {
    if (currentEmployee.role === UserRole.ACCOUNTANT) kpiPreset = "accounting";
    else if (currentEmployee.role === UserRole.ADMIN || currentEmployee.role === UserRole.MANAGER) kpiPreset = "executive";
  }

  return (
    <div className="space-y-6 animate-fade-in" id="dashboard_tab">
      <div className="flex gap-2 border-b border-stone-200 pb-2">
        <button
          onClick={() => setActiveView("overview")}
          className={`px-4 py-2 font-bold text-sm rounded-xl transition ${
            activeView === "overview" ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          ภาพรวมสถิติ (Overview)
        </button>
        <button
          onClick={() => setActiveView("schedule")}
          className={`px-4 py-2 font-bold text-sm rounded-xl transition ${
            activeView === "schedule" ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          กำหนดการเคลียร์เอกสาร (Clearance Schedule)
        </button>
      </div>

      {activeView === "schedule" ? (
        <ClearanceSchedule advances={advances} />
      ) : (
        <div className="space-y-6">
          {/* Dynamic Hero Banner (Profile Image Based) */}
          <style>{`
            @keyframes hero-fade-in {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }
            @keyframes hero-zoom {
              0% { transform: scale(1.08); }
              100% { transform: scale(1.00); }
            }
            @keyframes glass-slide-up {
              0% { transform: translateY(20px); opacity: 0; }
              100% { transform: translateY(0px); opacity: 1; }
            }
            .animate-hero-fade {
              animation: hero-fade-in 700ms ease-out forwards;
            }
            .animate-hero-zoom {
              animation: hero-zoom 700ms ease-out forwards;
            }
            .animate-glass-slide {
              animation: glass-slide-up 700ms ease-out forwards;
              animation-delay: 200ms;
              opacity: 0;
            }
            .animate-wave {
              animation: wave-hand 1.8s ease-in-out infinite;
              transform-origin: 70% 70%;
            }
            @keyframes wave-hand {
              0%, 100% { transform: rotate(0deg); }
              25% { transform: rotate(-10deg); }
              75% { transform: rotate(15deg); }
            }
          `}</style>

          <div 
            className="relative w-full mx-auto rounded-[32px] overflow-hidden group"
            style={{ 
              height: 'clamp(380px, 90vw, 420px)',
              maxWidth: '600px',
              boxShadow: '0 24px 60px rgba(0,0,0,.15)',
              opacity: 0,
              animation: 'hero-fade-in 700ms ease-out forwards'
            }}
          >
            {/* Background Image */}
            {dashboardImage ? (
              <img
                src={heroImageSrc}
                alt="hero profile"
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{
                  objectPosition: "center",
                  imageRendering: "auto",
                  transform: `scale(${imageScale}) translate(${imagePosition.x - 50}%, ${imagePosition.y - 50}%)`,
                  transition: 'transform 0.1s ease-out'
                }}
              />
            ) : (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-stone-300 to-stone-400 animate-hero-zoom" />
            )}

            {isEditingImage && (
              <div className="absolute z-30 bottom-4 left-4 right-4 bg-white/80 backdrop-blur-md p-4 rounded-xl shadow-lg space-y-3">
                <div className="flex gap-4">
                  <label className="text-xs font-bold text-stone-900 w-16">Zoom</label>
                  <input type="range" min="1" max="3" step="0.1" value={imageScale} onChange={(e) => setImageScale(parseFloat(e.target.value))} className="flex-1" />
                </div>
                <div className="flex gap-4">
                  <label className="text-xs font-bold text-stone-900 w-16">X Pos</label>
                  <input type="range" min="0" max="100" value={imagePosition.x} onChange={(e) => setImagePosition(prev => ({...prev, x: parseInt(e.target.value)}))} className="flex-1" />
                </div>
                <div className="flex gap-4">
                  <label className="text-xs font-bold text-stone-900 w-16">Y Pos</label>
                  <input type="range" min="0" max="100" value={imagePosition.y} onChange={(e) => setImagePosition(prev => ({...prev, y: parseInt(e.target.value)}))} className="flex-1" />
                </div>
              </div>
            )}

            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                      const maxDim = 900;
                      let width = img.width;
                      let height = img.height;
                      
                      if (Math.max(width, height) > maxDim) {
                        if (width > height) {
                          height = Math.round((height * maxDim) / width);
                          width = maxDim;
                        } else {
                          width = Math.round((width * maxDim) / height);
                          height = maxDim;
                        }
                      }
                      
                      const canvas = document.createElement("canvas");
                      canvas.width = width;
                      canvas.height = height;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const fallbackDataUrl = canvas.toDataURL("image/jpeg", 0.76);
                        canvas.toBlob(
                          async (blob) => {
                            if (!blob) {
                              setErrorMessage("ไม่สามารถย่อขนาดรูปภาพได้");
                              return;
                            }
                            
                            const formData = new FormData();
                            formData.append("image", blob, file.name);
                            formData.append("employeeId", currentEmployee.id);
                            
                            try {
                              const response = await fetch("/api/upload-profile-image", {
                                method: "POST",
                                body: formData
                              });
                              
                              const result = await response.json();
                              if (result.status === "success") {
                                const persistedProfileImage = result.profileImage || fallbackDataUrl;
                                setDashboardImage(result.downloadURL);
                                setSuccessMessage("อัปเดตรูปภาพสำเร็จ");
                                
                                // Directly update Firestore on the client side to bypass Firebase Admin write restrictions
                                try {
                                  const employeeRef = doc(db, "employees", currentEmployee.id);
                                  await updateDoc(employeeRef, {
                                    profilePhotoURL: result.downloadURL,
                                    profileImage: persistedProfileImage,
                                    profilePhotoUpdatedAt: serverTimestamp()
                                  });
                                } catch (fsErr) {
                                  console.error("Firestore client-side profile update failed:", fsErr);
                                }

                                if (onProfileUpdate) {
                                  onProfileUpdate({
                                    ...currentEmployee,
                                    profilePhotoURL: result.downloadURL,
                                    profileImage: persistedProfileImage,
                                    profilePhotoUpdatedAt: { seconds: Math.floor(Date.now() / 1000) }
                                  });
                                }
                              } else {
                                throw new Error(result.error);
                              }
                            } catch (error) {
                              console.error("Error updating profile image:", error);
                              try {
                                const employeeRef = doc(db, "employees", currentEmployee.id);
                                await updateDoc(employeeRef, {
                                  profilePhotoURL: "",
                                  profileImage: fallbackDataUrl,
                                  profilePhotoUpdatedAt: serverTimestamp()
                                });
                                setDashboardImage(fallbackDataUrl);
                                setSuccessMessage("Saved profile image in Vercel fallback mode");
                                if (onProfileUpdate) {
                                  onProfileUpdate({
                                    ...currentEmployee,
                                    profilePhotoURL: "",
                                    profileImage: fallbackDataUrl,
                                    profilePhotoUpdatedAt: { seconds: Math.floor(Date.now() / 1000) }
                                  });
                                }
                                return;
                              } catch (fallbackError) {
                                console.error("Firestore fallback profile update failed:", fallbackError);
                              }
                              setErrorMessage("ไม่สามารถอัปเดตรูปภาพได้");
                            }
                          },
                          "image/jpeg",
                          0.76
                        );
                      } else {
                        setErrorMessage("ไม่สามารถสร้าง Canvas สำหรับจัดการรูปภาพได้");
                      }
                    };
                    img.src = event.target?.result as string;
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
            <div className="absolute z-20 top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-black/50 backdrop-blur-md text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-black/70 transition"
              >
                เปลี่ยนรูป
              </button>
              {dashboardImage && (
                <button 
                  onClick={async () => {
                    if (isEditingImage) {
                      // Save current settings to Firebase
                      try {
                        const employeeRef = doc(db, "employees", currentEmployee.id);
                        await updateDoc(employeeRef, {
                          imageScale,
                          imagePosition
                        });
                        setSuccessMessage("บันทึกการตั้งค่ารูปภาพสำเร็จ");
                        if (onProfileUpdate) {
                          onProfileUpdate({
                            ...currentEmployee,
                            imageScale,
                            imagePosition
                          });
                        }
                      } catch (error) {
                        console.error("Error saving image settings:", error);
                        setErrorMessage("ไม่สามารถบันทึกการตั้งค่าได้");
                      }
                    }
                    setIsEditingImage(!isEditingImage);
                  }}
                  className={`${isEditingImage ? 'bg-amber-500' : 'bg-black/50'} backdrop-blur-md text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-black/70 transition`}
                >
                  {isEditingImage ? 'เสร็จสิ้น' : 'ปรับแต่ง'}
                </button>
              )}
            </div>

            {/* Glass Gradient Overlay (Left to Right) */}
            <div 
              className="absolute inset-0 z-10"
              style={{
                background: "linear-gradient(90deg, rgba(18,18,18,.72) 0%, rgba(18,18,18,.50) 25%, rgba(18,18,18,.20) 55%, rgba(18,18,18,0) 100%)"
              }}
            />

            {/* Left Content (Glass Panel) */}
            <div 
              className="absolute z-20 flex flex-col justify-between"
              style={{
                top: '22px',
                left: '18px',
                width: '165px',
                height: '210px',
                padding: '16px',
                borderRadius: '24px',
                background: 'rgba(255,255,255,.10)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,.22)',
                boxShadow: '0 12px 40px rgba(0,0,0,.12)',
              }}
            >
              <div>
                <motion.h1 
                  initial={{ opacity: 0, x: -50, rotate: -5 }}
                  animate={{ opacity: 1, x: 0, rotate: 0 }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 100, 
                    damping: 10,
                    duration: 0.8 
                  }}
                  className="font-bold text-white tracking-tight flex items-center gap-1 mb-2 leading-none" 
                  style={{ fontSize: '38px' }}
                >
                  {currentEmployee.nickname || currentEmployee.name.split(" ")[0]} <span className="animate-wave inline-block origin-bottom-right text-3xl">👋</span>
                </motion.h1>
                
                <div className="flex flex-col gap-1.5">
                  <div>
                    <span 
                      className="inline-block px-2 py-0.5 text-[#856000] font-semibold uppercase rounded-full shadow-sm"
                      style={{ fontSize: '11px', background: 'linear-gradient(135deg, #FFD700 0%, #FDB931 100%)' }}
                    >
                      {(() => {
                        if (currentEmployee.position) {
                          switch (currentEmployee.position.toLowerCase()) {
                            case "admin": return "ผู้ดูแลระบบ (Admin)";
                            case "executive": return "ผู้บริหาร (Executive)";
                            case "ceo": return "ประธานเจ้าหน้าที่บริหาร (CEO)";
                            case "pm": return "ผู้จัดการโครงการ (PM)";
                            case "accounting": return "ฝ่ายบัญชี (Accounting)";
                            case "foreman": return "โฟร์แมน (Foreman)";
                            case "employee": return "พนักงานทั่วไป (Employee)";
                            default: return currentEmployee.position.toUpperCase();
                          }
                        }
                        switch (currentEmployee.role) {
                          case UserRole.ADMIN: return "ผู้ดูแลระบบ (Admin)";
                          case UserRole.ACCOUNTANT: return "ฝ่ายบัญชี (Accounting)";
                          case UserRole.MANAGER: return "ผู้จัดการ (Manager)";
                          case UserRole.EMPLOYEE: return "พนักงานทั่วไป (Employee)";
                          default: return currentEmployee.role;
                        }
                      })()}
                    </span>
                  </div>
                  <p className="font-normal" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)', lineHeight: '1.3' }}>
                    {currentEmployee.name}<br/>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>{currentEmployee.department || "แผนกทั่วไป"}</span>
                  </p>
                  <p className="text-emerald-400 font-medium flex items-center gap-1.5" style={{ fontSize: '12px', marginTop: '2px' }}>
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                    กำลังใช้งาน
                  </p>
                </div>
              </div>

              <button 
                onClick={() => onNavigate("profile_settings")}
                className="w-full flex items-center justify-center gap-1.5 transition-all"
                style={{
                  marginTop: '0px',
                  height: '40px',
                  borderRadius: '16px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: '600'
                }}
              >
                <User className="w-[14px] h-[14px]" /> แก้ไขโปรไฟล์
              </button>
            </div>

            {/* Bottom Statistic Glass */}
            <div 
              className="absolute z-20 flex animate-glass-slide items-center justify-between"
              style={{
                bottom: '18px',
                left: '18px',
                right: '18px',
                height: '110px',
                padding: '12px 8px',
                borderRadius: '26px',
                background: 'rgba(255,255,255,.16)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                border: '1px solid rgba(255,255,255,.22)',
                boxShadow: '0 12px 30px rgba(0,0,0,.10)',
                animationDelay: '250ms'
              }}
            >
              {/* Today */}
              <div className="flex-1 flex flex-col justify-center px-1 md:px-2 relative text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-100 flex items-center justify-center backdrop-blur-sm border border-purple-500/30 shrink-0">
                    <Calendar className="w-3.5 h-3.5 text-purple-100" />
                  </div>
                  <p className="font-medium text-white/90" style={{ fontSize: '12px' }}>วันนี้</p>
                </div>
                <p className="font-bold text-white leading-none mb-1" style={{ fontSize: '28px' }}>
                  {heroStats.today.count}
                </p>
                <p className="font-semibold text-white/90 leading-tight" style={{ fontSize: '13px' }}>
                  ฿{heroStats.today.amount > 99999 ? (heroStats.today.amount/1000).toFixed(1) + 'k' : heroStats.today.amount.toLocaleString("th-TH")}
                </p>
                <p className={`font-bold mt-0.5 ${heroStats.today.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontSize: '11px' }}>
                  {heroStats.today.diff >= 0 ? '▲' : '▼'}{Math.abs(heroStats.today.diff)}%
                </p>
              </div>

              {/* Divider */}
              <div className="w-px h-16 shrink-0" style={{ background: 'rgba(255,255,255,0.18)' }}></div>

              {/* This Week */}
              <div className="flex-1 flex flex-col justify-center px-1 md:px-2 relative text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-100 flex items-center justify-center backdrop-blur-sm border border-blue-500/30 shrink-0">
                    <BarChart3 className="w-3.5 h-3.5 text-blue-100" />
                  </div>
                  <p className="font-medium text-white/90" style={{ fontSize: '12px' }}>สัปดาห์นี้</p>
                </div>
                <p className="font-bold text-white leading-none mb-1" style={{ fontSize: '28px' }}>
                  {heroStats.week.count}
                </p>
                <p className="font-semibold text-white/90 leading-tight" style={{ fontSize: '13px' }}>
                  ฿{heroStats.week.amount > 999999 ? (heroStats.week.amount/1000000).toFixed(1) + 'M' : heroStats.week.amount.toLocaleString("th-TH")}
                </p>
                <p className={`font-bold mt-0.5 ${heroStats.week.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontSize: '11px' }}>
                  {heroStats.week.diff >= 0 ? '▲' : '▼'}{Math.abs(heroStats.week.diff)}%
                </p>
              </div>

              {/* Divider */}
              <div className="w-px h-16 shrink-0" style={{ background: 'rgba(255,255,255,0.18)' }}></div>

              {/* This Month */}
              <div className="flex-1 flex flex-col justify-center px-1 md:px-2 relative text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-100 flex items-center justify-center backdrop-blur-sm border border-amber-500/30 shrink-0">
                    <History className="w-3.5 h-3.5 text-amber-100" />
                  </div>
                  <p className="font-medium text-white/90" style={{ fontSize: '12px' }}>เดือนนี้</p>
                </div>
                <p className="font-bold text-white leading-none mb-1" style={{ fontSize: '28px' }}>
                  {heroStats.month.count}
                </p>
                <p className="font-semibold text-white/90 leading-tight" style={{ fontSize: '13px' }}>
                  ฿{heroStats.month.amount > 999999 ? (heroStats.month.amount/1000000).toFixed(1) + 'M' : heroStats.month.amount.toLocaleString("th-TH")}
                </p>
                <p className={`font-bold mt-0.5 ${heroStats.month.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontSize: '11px' }}>
                  {heroStats.month.diff >= 0 ? '▲' : '▼'}{Math.abs(heroStats.month.diff)}%
                </p>
              </div>

            </div>
          </div>

      {/* Global Status Alerts or Toast Messages */}
      {(successMessage || errorMessage) && (
        <motion.div 
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed top-4 right-4 z-50 max-w-sm w-full p-4 rounded-xl shadow-xl border flex items-start gap-3 bg-white border-stone-200"
        >
          {successMessage ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <div className="flex-1 text-xs font-bold text-stone-800">{successMessage}</div>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1 text-xs font-bold text-red-800">{errorMessage}</div>
            </>
          )}
          <button onClick={() => { setSuccessMessage(null); setErrorMessage(null); }} className="text-stone-400 hover:text-stone-600">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* UNIFIED DASHBOARD LAYOUT */}
      {/* ==================================================================== */}
      <div className="space-y-6">
        {/* Top Menu Cards (All Roles) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
          <button onClick={() => onNavigate("request")} className="bg-white/40 backdrop-blur-lg border border-white/40 hover:bg-white/60 hover:shadow-2xl rounded-[32px] p-5 md:p-6 transition-all duration-300 text-left flex flex-col gap-3 w-full group shadow-lg shadow-stone-200/40">
            <div className="w-12 h-12 bg-stone-900 group-hover:scale-110 transition-transform text-stone-50 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-stone-900/20">
              <Send className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-sm">ขอเบิก</h4>
              <p className="text-[11px] text-stone-500 mt-1 font-medium">เบิกเงินทดรองจ่าย</p>
            </div>
          </button>
          <button onClick={() => onNavigate("clearance")} className="bg-white/40 backdrop-blur-lg border border-white/40 hover:bg-white/60 hover:shadow-2xl rounded-[32px] p-5 md:p-6 transition-all duration-300 text-left flex flex-col gap-3 w-full group shadow-lg shadow-indigo-100/40">
            <div className="w-12 h-12 bg-indigo-600 group-hover:scale-110 transition-transform text-indigo-50 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-600/20">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-indigo-950 text-sm">เคลียร์ยอด</h4>
              <p className="text-[11px] text-stone-500 mt-1 font-medium">แนบใบเสร็จหักล้างยอด</p>
            </div>
          </button>
          <button onClick={() => setIsNotificationOpen(true)} className="bg-white/40 backdrop-blur-lg border border-white/40 hover:bg-white/60 hover:shadow-2xl rounded-[32px] p-5 md:p-6 transition-all duration-300 text-left flex flex-col gap-3 w-full group shadow-lg shadow-amber-100/40">
            <div className="w-12 h-12 bg-amber-500 group-hover:scale-110 transition-transform text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-amber-500/20">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-sm">แจ้งเตือน</h4>
              <p className="text-[11px] text-stone-500 mt-1 font-medium">ประวัติสถานะเอกสาร</p>
            </div>
          </button>
          <button onClick={() => onNavigate("audit")} className="bg-white/40 backdrop-blur-lg border border-white/40 hover:bg-white/60 hover:shadow-2xl rounded-[32px] p-5 md:p-6 transition-all duration-300 text-left flex flex-col gap-3 w-full group shadow-lg shadow-stone-100/40">
            <div className="w-12 h-12 bg-stone-100 group-hover:scale-110 transition-transform text-stone-700 rounded-2xl flex items-center justify-center shrink-0 shadow-lg border border-stone-200/50">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-sm">ประวัติ</h4>
              <p className="text-[11px] text-stone-500 mt-1 font-medium">รายการธุรกรรมทั้งหมด</p>
            </div>
          </button>
        </div>

        {/* KPI Preset Section */}
        {(() => {
          if (kpiPreset === "employee") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดค้างเคลียร์</p>
                  <p className="text-xl font-black text-stone-900 font-mono mt-1.5">{formatCurrency(empOutstandingBalance)}</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-stone-300 rounded-full"></div>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดเบิกสะสม</p>
                  <p className="text-xl font-black text-indigo-600 font-mono mt-1.5">{formatCurrency(empTotalAdvanceAmount)}</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-indigo-300 rounded-full"></div>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดเคลียร์แล้ว</p>
                  <p className="text-xl font-black text-emerald-600 font-mono mt-1.5">{formatCurrency(empClosedAmount)}</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-300 rounded-full"></div>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">รอส่งเอกสารตัวจริง</p>
                  <p className="text-xl font-black text-amber-600 font-mono mt-1.5">{kpiAdvances.filter(a => a.status === "WAITING_CLEARANCE" && a.employeeId === currentEmployee.id).length} คำขอ</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-amber-300 rounded-full"></div>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดเกินกำหนด</p>
                  <p className="text-xl font-black text-red-600 font-mono mt-1.5">{formatCurrency(empOverdueAmount)}</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-red-300 rounded-full"></div>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-200/30 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">จำนวนใบเบิกคงค้าง</p>
                  <p className="text-xl font-black text-stone-900 font-mono mt-1.5">{nonDraftAdvances.filter(a => a.status !== "CLOSED" && a.status !== "REJECTED").length} ใบ</p>
                  <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-stone-300 rounded-full"></div>
                </div>
              </div>
            );
          }

          if (kpiPreset === "accounting") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-blue-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">รอโอนเงิน</p>
                  <p className="text-xl font-black text-blue-600 font-mono mt-1.5">{kpiAdvances.filter(a => a.status === "WAITING_TRANSFER").length} รายการ</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-amber-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">รอตรวจบิล</p>
                  <p className="text-xl font-black text-yellow-600 font-mono mt-1.5">{kpiAdvances.filter(a => a.status === "PENDING_AUDIT").length} รายการ</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-indigo-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ติดตามเอกสาร (รอเคลียร์)</p>
                  <p className="text-xl font-black text-indigo-600 font-mono mt-1.5">{kpiAdvances.filter(a => a.status === "WAITING_CLEARANCE").length} รายการ</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">จำนวนใบเบิกคงค้าง</p>
                  <p className="text-xl font-black text-stone-900 font-mono mt-1.5">{acctTotalItems} ใบ</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-red-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดเงินเกินกำหนดเคลียร์</p>
                  <p className="text-xl font-black text-red-600 font-mono mt-1.5">{formatCurrency(acctOverdueAmount)}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">รอโอนคืนบริษัท (ตีกลับ)</p>
                  <p className="text-xl font-black text-stone-900 font-mono mt-1.5">{formatCurrency(kpiAdvances.filter(a => a.status === "RETURNED").reduce((sum, a) => sum + a.outstandingAmount, 0))}</p>
                </div>
              </div>
            );
          }

          if (kpiPreset === "executive" || kpiPreset === "admin" || kpiPreset === "ceo") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-amber-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">รออนุมัติ</p>
                  <p className="text-xl font-black text-amber-600 font-mono mt-1.5">{managerPendingCount} รายการ</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-blue-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดโอนวันนี้</p>
                  <p className="text-xl font-black text-blue-600 font-mono mt-1.5">{formatCurrency(heroStats.today.amount)}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-emerald-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดใช้จ่ายโครงการ (ปิดยอด)</p>
                  <p className="text-xl font-black text-emerald-600 font-mono mt-1.5">{formatCurrency(acctClosedValue)}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-indigo-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดค้างเคลียร์รวม</p>
                  <p className="text-xl font-black text-indigo-600 font-mono mt-1.5">{formatCurrency(acctPendingClearValue)}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-stone-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">ยอดค้างเบิกรวม</p>
                  <p className="text-xl font-black text-stone-900 font-mono mt-1.5">{formatCurrency(managerPendingAmount)}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-lg border border-white/40 rounded-[28px] p-5 shadow-lg shadow-red-100/20 relative group transition-all hover:bg-white/60">
                  <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">พนักงานค้างเคลียร์</p>
                  <div className="mt-1.5 space-y-1">
                    {topEmployeesOutstanding.length > 0 ? topEmployeesOutstanding.map((e, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px]">
                        <span className="truncate w-16 text-stone-800 font-medium">{e.name.split(" ")[0]}</span>
                        <span className="font-mono text-red-600 font-bold">{formatCurrency(e.outstanding)}</span>
                      </div>
                    )) : <p className="text-xs text-stone-400">- ไม่มี -</p>}
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* My Tasks (To-Do & Notifications) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex border-b border-stone-100">
            <button 
              onClick={() => setActiveTaskTab("notifications")}
              className={`flex-1 text-center py-3 font-bold text-sm transition-colors ${activeTaskTab === "notifications" ? "bg-stone-50 border-r border-stone-100 text-stone-900" : "bg-white text-stone-400 hover:text-stone-600 border-r border-stone-100"}`}
            >
              แจ้งเตือน (Notifications)
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${activeTaskTab === "notifications" ? "bg-indigo-100 text-indigo-700" : "bg-stone-100 text-stone-400"}`}>
                {employeeNotifications.length}
              </span>
            </button>
            <button 
              onClick={() => setActiveTaskTab("todo")}
              className={`flex-1 text-center py-3 font-bold text-sm transition-colors ${activeTaskTab === "todo" ? "bg-stone-50 text-stone-900" : "bg-white text-stone-400 hover:text-stone-600"}`}
            >
              งานที่ต้องทำ (To-Do)
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${activeTaskTab === "todo" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"}`}>
                {draftAdvances.length + draftClearingLogs.length + (currentEmployee.role !== UserRole.EMPLOYEE ? managerPendingCount : 0)}
              </span>
            </button>
          </div>
          <div className="p-4">
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {activeTaskTab === "notifications" ? (
                employeeNotifications.length === 0 ? (
                  <div className="py-10 text-center text-stone-400 text-xs italic">ไม่มีการแจ้งเตือนใหม่</div>
                ) : (
                  employeeNotifications.slice(0, 8).map(log => (
                    <button 
                      key={log.id} 
                      onClick={() => navigateToTransaction(log.advId)}
                      className="w-full flex items-start gap-3 bg-stone-50 hover:bg-stone-100 p-3 rounded-xl border border-stone-100 transition-colors text-left group"
                    >
                      <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg shrink-0 group-hover:scale-110 transition-transform">
                        <History className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-stone-800 line-clamp-2">{log.note}</p>
                        <p className="text-[10px] text-stone-400 mt-0.5">{log.timestamp.split("T")[0]} • {log.advId}</p>
                      </div>
                    </button>
                  ))
                )
              ) : (
                <div className="space-y-2">
                  {/* Drafts for all roles */}
                  {draftAdvances.length === 0 && draftClearingLogs.length === 0 && (currentEmployee.role === UserRole.EMPLOYEE || managerPendingCount === 0) && (
                    <div className="py-10 text-center text-stone-400 text-xs italic">ไม่มีงานค้างในขณะนี้</div>
                  )}
                  
                  {/* Pending Approvals for Managers */}
                  {(currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ADMIN) && advances.filter(a => a.status === AdvanceStatus.PENDING_APPROVAL).map(adv => (
                    <button 
                      key={adv.id}
                      onClick={() => onNavigate("approval")}
                      className="w-full flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-amber-500 text-white rounded-lg shadow-sm">
                          <Send className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-amber-900">{adv.advId}</p>
                          <p className="text-[10px] text-amber-700">รอคุณอนุมัติ • {formatCurrency(adv.requestAmount)}</p>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-amber-600 bg-white px-2 py-0.5 rounded-full border border-amber-200">อนุมัติ</div>
                    </button>
                  ))}

                  {/* Draft Advances */}
                  {draftAdvances.map(adv => (
                    <button 
                      key={adv.id}
                      onClick={() => onEditDraftAdvance && onEditDraftAdvance(adv)}
                      className="w-full flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-xl hover:bg-stone-100 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-stone-200 text-stone-600 rounded-lg">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-stone-800">{adv.advId || "Draft"}</p>
                          <p className="text-[10px] text-stone-500">บันทึกร่างคำขอ • {formatCurrency(adv.requestAmount)}</p>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-stone-400">แก้ไข</div>
                    </button>
                  ))}

                  {/* Draft Clearing */}
                  {draftClearingLogs.map(log => (
                    <button 
                      key={log.id}
                      onClick={() => onEditDraftClearing ? onEditDraftClearing(log.id) : onNavigate("clearance")}
                      className="w-full flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-xl hover:bg-stone-100 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-stone-200 text-stone-600 rounded-lg">
                          <Receipt className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-stone-800">{log.advId}</p>
                          <p className="text-[10px] text-stone-500">บันทึกร่างเคลียร์ยอด</p>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-stone-400">แก้ไข</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>


          {/* Drafts Section for Employee */}
          {(kpiPreset === "employee") && (draftAdvances.length > 0 || draftClearingLogs.length > 0) && (
            <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-5 md:p-6 shadow-xs space-y-4 animate-fade-in" id="drafts_section">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-amber-950 text-sm">📝 รายการบันทึกร่างของคุณ (Drafts)</h3>
                    <p className="text-[10px] text-amber-700">รายการแบบร่างที่ยังไม่ได้ยื่นคำขอ คุณสามารถกดแก้ไขและส่งคำขอได้ทันที</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full">
                  มีทั้งหมด {draftAdvances.length + draftClearingLogs.length} รายการร่าง
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Draft Advances */}
                {draftAdvances.map((adv) => (
                  <div key={adv.id} className="bg-white border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded uppercase">ร่างคำขอเบิกเงิน</span>
                      </div>
                      <p className="font-bold text-stone-800 text-[11px] truncate">{adv.projectId}</p>
                      <p className="text-[10px] text-stone-500 line-clamp-1">{adv.details}</p>
                      <p className="text-[11px] font-black text-amber-700 font-mono">{formatCurrency(adv.requestAmount)}</p>
                    </div>
                    <button
                      onClick={() => onEditDraftAdvance && onEditDraftAdvance(adv)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold rounded-lg text-[11px] transition flex items-center gap-1 shrink-0"
                    >
                      <FileText className="w-3 h-3" /> แก้ไข/ส่งคำขอ
                    </button>
                  </div>
                ))}
                {/* Draft Clearing Logs */}
                {draftClearingLogs.map((log) => (
                  <div key={log.id} className="bg-white border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-stone-900 text-xs">เคลียร์ยอด {log.advId}</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded uppercase">ร่างตัดยอด (รอบที่ {log.roundNo})</span>
                      </div>
                      <p className="text-[10px] text-stone-500">บันทึกร่างเมื่อ: {log.submittedAt ? log.submittedAt.split("T")[0] : "-"}</p>
                      <p className="text-[11px] font-black text-amber-700 font-mono">{formatCurrency(log.totalSubmittedAmount)}</p>
                    </div>
                    <button
                      onClick={() => onEditDraftClearing && onEditDraftClearing(log.id)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold rounded-lg text-[11px] transition flex items-center gap-1 shrink-0"
                    >
                      <FileText className="w-3 h-3" /> แก้ไข/ส่งคำขอ
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}


          {/* Recent list & guideline splits */}
          {kpiPreset === "employee" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between">
                <h3 className="font-bold text-stone-900 text-sm">รายการเบิกเงินล่าสุดของคุณ</h3>
                <span className="text-[10px] font-mono font-bold bg-stone-100 px-2 py-0.5 rounded text-stone-500 uppercase">ทั้งหมด {nonDraftAdvances.length} รายการ</span>
              </div>
              {loading ? (
                <div className="py-20 text-center text-stone-500 text-xs">กำลังโหลดข้อมูล...</div>
              ) : nonDraftAdvances.length === 0 ? (
                <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-3">
                  <FileText className="w-8 h-8 text-stone-300" />
                  <span>คุณยังไม่มีประวัติการขอเบิกเงินทดรองจ่าย</span>
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {nonDraftAdvances.slice(0, 5).map((adv) => (
                    <div key={adv.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/50 transition duration-150">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                          {getStatusBadge(adv.status)}
                        </div>
                        <p className="font-bold text-stone-800 text-xs">{adv.projectId}</p>
                        <p className="text-[11px] text-stone-500 truncate max-w-sm">{adv.details}</p>
                      </div>
                      <div className="flex sm:flex-col items-end justify-between sm:justify-center shrink-0">
                        <span className="text-[10px] text-stone-400 font-mono sm:mb-1">{adv.createdAt.split("T")[0]}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-stone-900 text-sm">{formatCurrency(adv.requestAmount)}</span>
                          <button
                            onClick={() => handleOpenDetails(adv)}
                            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-900 transition"
                            title="ดูรายละเอียด"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Instruction Guidelines Card */}
            <div className="bg-stone-900 text-stone-100 rounded-2xl p-6 shadow-sm border border-stone-800 space-y-4">
              <h3 className="font-bold text-white text-sm">คำแนะนำขั้นตอนการทำงาน</h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">1</span>
                  <div>
                    <p className="font-semibold text-white">ยื่นขอเบิกเงินทดรอง</p>
                    <p className="text-stone-400">พนักงานสร้างใบขอเบิกเงิน โดยกรอกข้อมูลและระบุยอดเงินที่จำเป็น</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">2</span>
                  <div>
                    <p className="font-semibold text-white">ผู้บริหารตรวจสอบและโอนเงิน</p>
                    <p className="text-stone-400">ผู้มีอำนาจตรวจสอบอนุมัติ อัปโหลดสลิปโอนเงินเข้าบัญชีพนักงาน</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">3</span>
                  <div>
                    <p className="font-semibold text-white">พนักงานเคลียร์บิล (Manual / AI Scan)</p>
                    <p className="text-stone-400">พนักงานใช้ AI OCR สแกนบิลใบเสร็จ เพื่อกรอกข้อมูลตัดค่าใช้จ่ายแบบทันที</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}


          {/* Recent list of requests with interactive Approve / Reject buttons */}
          {(kpiPreset === "executive" || kpiPreset === "admin" || kpiPreset === "ceo") && (
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-stone-900 text-sm">รายการรอการตรวจสอบและอนุมัติ</h3>
                <p className="text-[11px] text-stone-400 mt-0.5">รวมทั้งสิ้น {advances.filter(a => a.status === "PENDING_APPROVAL").length} คำขอที่รอการตัดสินใจ</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-stone-100 px-2.5 py-1 rounded text-stone-600 uppercase">รวมทั้งหมด {advances.length}</span>
                <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                  <button
                    onClick={() => setManagerTableViewMode("table")}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 ${managerTableViewMode === "table" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    <List className="w-3 h-3" />
                    <span>ตาราง</span>
                  </button>
                  <button
                    onClick={() => setManagerTableViewMode("card")}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 ${managerTableViewMode === "card" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    <Grid className="w-3 h-3" />
                    <span>การ์ด</span>
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-stone-500 text-xs">กำลังโหลดข้อมูล...</div>
            ) : advances.length === 0 ? (
              <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-stone-300" />
                <span>ไม่มีประวัติรายการเบิกเงินในขณะนี้</span>
              </div>
            ) : managerTableViewMode === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                      <th className="py-3 px-4">เลขที่เอกสาร / ผู้ขอเบิก</th>
                      <th className="py-3 px-4">โครงการ / รายละเอียด</th>
                      <th className="py-3 px-4 text-right">จำนวนเงิน</th>
                      <th className="py-3 px-4">สถานะ</th>
                      <th className="py-3 px-4 text-center">จัดการคำขอ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {advances.slice(0, 15).map((adv) => (
                      <tr key={adv.id} className="hover:bg-stone-50/50 transition duration-150">
                        <td className="py-4 px-4">
                          <div className="font-mono font-bold text-stone-900">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-medium uppercase">{adv.employeeName}</div>
                        </td>
                        <td className="py-4 px-4 max-w-xs">
                          <div className="font-bold text-stone-800 truncate">{adv.projectId}</div>
                          <div className="text-[11px] text-stone-500 truncate mt-0.5">{adv.details}</div>
                        </td>
                        <td className="py-4 px-4 text-right font-mono font-bold text-stone-900 text-sm">
                          {formatCurrency(adv.requestAmount)}
                        </td>
                        <td className="py-4 px-4">{getStatusBadge(adv.status)}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenDetails(adv)}
                              className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-lg transition flex items-center gap-1"
                              title="ดูรายละเอียดคำขอ"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ดูรายละเอียด</span>
                            </button>
                            {adv.status === "PENDING_APPROVAL" && (
                              <>
                                <button
                                  onClick={() => handleApprove(adv)}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition flex items-center gap-1"
                                  title="อนุมัติคำขอ"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  onClick={() => handleOpenReject(adv)}
                                  className="px-2.5 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 font-bold rounded-lg transition flex items-center gap-1"
                                  title="ปฏิเสธคำขอ"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 bg-stone-50/50 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {advances.slice(0, 15).map((adv) => (
                  <div key={adv.id} className="bg-white border border-stone-200 rounded-xl p-4 shadow-xs hover:shadow-md transition duration-200 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-bold uppercase mt-0.5">{adv.employeeName}</div>
                        </div>
                        {getStatusBadge(adv.status)}
                      </div>
                      <div className="pt-2 border-t border-stone-100 space-y-1">
                        <div className="text-xs font-bold text-stone-800 truncate">{adv.projectId}</div>
                        <div className="text-[11px] text-stone-500 line-clamp-2 leading-relaxed">{adv.details}</div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-stone-400 uppercase">จำนวนเงินเบิก</div>
                        <div className="font-mono font-black text-stone-900 text-sm mt-0.5">{formatCurrency(adv.requestAmount)}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleOpenDetails(adv)}
                          className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg transition"
                          title="ดูรายละเอียดคำขอ"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {adv.status === "PENDING_APPROVAL" && (
                          <>
                            <button
                              onClick={() => handleApprove(adv)}
                              className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
                              title="อนุมัติคำขอ"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleOpenReject(adv)}
                              className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition"
                              title="ปฏิเสธคำขอ"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}


          {kpiPreset === "accounting" && (
            <>
          {/* 🚨 Urgent Follow-up Box (กล่องข้อมูลติดตามเร่งด่วน) */}
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm text-stone-850 space-y-6">
            <div className="flex items-center gap-2.5 pb-4 border-b border-stone-200">
              <div className="p-2 bg-red-500/10 text-red-500 rounded-xl border border-red-500/20">
                <AlertCircle className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-[15px] text-black">กล่องข้อมูลติดตามเร่งด่วน (Urgent Follow-up Hub)</h3>
                <p className="text-[11px] text-black mt-0.5">ติดตามรายการใกล้กำหนดส่งเอกสารและสรุปยอดคงค้างพนักงานสูงสุด 3 อันดับแรก</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-stone-500" />
                  <span className="text-[11px] font-normal text-black">รายการใกล้กำหนดส่งเคลียร์เอกสาร (Top 5 Soonest)</span>
                </h4>

                {urgentClearingAdvances.length === 0 ? (
                  <div className="py-10 bg-stone-50 rounded-2xl border border-stone-200 text-center text-xs text-stone-500">
                    ไม่มีรายการค้างเคลียร์ในขณะนี้
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                    {urgentClearingAdvances.map((adv, idx) => {
                      const diffTime = new Date(adv.neededDate).getTime() - new Date().getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      const isOverdue = diffDays < 0;
                      const isFirst = idx === 0;

                      return (
                        <button
                          key={adv.id}
                          onClick={() => navigateToTransaction(adv.advId)}
                          className={`${isFirst ? "bg-[#696969] text-white border border-stone-200 shadow-lg shadow-stone-300" : "bg-white border border-stone-200 text-stone-800 hover:bg-stone-50 hover:shadow-md"} rounded-2xl p-4 transition-all duration-200 flex items-center justify-between gap-3 text-left w-full group cursor-pointer`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-bold text-xs truncate ${isFirst ? "text-white" : "text-stone-900"}`}>{adv.advId}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-medium truncate max-w-[120px] ${isFirst ? "bg-stone-900 text-white" : "bg-stone-200/60 text-stone-600"}`}>{adv.employeeName}</span>
                            </div>
                            <div className={`text-[11px] truncate ${isFirst ? "text-white/95" : "text-stone-500"}`}>
                              โครงการ: <span className={`${isFirst ? "text-white" : "text-stone-900"} font-bold`}>{adv.projectId}</span>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                              <Clock className={`w-3.5 h-3.5 ${isFirst ? "text-white/80" : "text-stone-400"}`} />
                              <span className={`text-[10px] font-bold ${isFirst ? "text-white" : isOverdue ? "text-red-500" : diffDays <= 7 ? "text-amber-600" : "text-stone-500"}`}>
                                {isOverdue 
                                  ? `เลยกำหนดมาแล้ว ${Math.abs(diffDays)} วัน` 
                                  : `เหลือเวลาอีก ${diffDays} วัน (${adv.neededDate})`}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <p className={`text-[10px] font-bold uppercase ${isFirst ? "text-white/80" : "text-stone-400"}`}>ยอดคงค้างเคลียร์</p>
                            <p className={`font-mono font-black text-xs sm:text-sm mt-0.5 ${isFirst ? "text-white" : "text-red-600"}`}>{formatCurrency(adv.outstandingAmount)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Search, Filter, and All Items List in Bottom Section */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
              <div>
                <h3 className="font-bold text-stone-900 text-sm">รายการคุมยอดทั้งหมดในระบบ</h3>
                <p className="text-[11px] text-stone-400 mt-0.5">ใช้ค้นหาและกรองตรวจสอบยอดเงินทดรองจ่ายของพนักงานทุกคน</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[11px] font-mono font-bold bg-stone-50 px-3 py-1.5 rounded-xl text-stone-600 border border-stone-200/50">
                  พบ {filteredAdvances.length} จากทั้งหมด {advances.length} รายการ
                </div>
                <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                  <button
                    onClick={() => exportToExcel(filteredAdvances, `Advances_Export_${new Date().toISOString().split('T')[0]}`)}
                    className="px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 text-emerald-700 hover:bg-emerald-50"
                    title="ส่งออกไฟล์ Excel"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>Excel</span>
                  </button>
                  <div className="w-[1px] bg-stone-200 mx-0.5 my-1" />
                  <button
                    onClick={() => setAcctTableViewMode("table")}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 ${acctTableViewMode === "table" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    <List className="w-3 h-3" />
                    <span>ตาราง</span>
                  </button>
                  <button
                    onClick={() => setAcctTableViewMode("card")}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 ${acctTableViewMode === "card" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    <Grid className="w-3 h-3" />
                    <span>การ์ด</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filter and Search controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อผู้เบิก, เลขเอกสาร, รหัสงาน..."
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition"
                />
              </div>
              <div className="relative">
                <Filter className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition appearance-none cursor-pointer"
                >
                  <option value="ALL">ทุกสถานะขั้นตอน</option>
                  <option value="PENDING_APPROVAL">รออนุมัติ (PENDING_APPROVAL)</option>
                  <option value="WAITING_TRANSFER">รอโอนเงิน (WAITING_TRANSFER)</option>
                  <option value="WAITING_CLEARANCE">รอเคลียร์ (WAITING_CLEARANCE)</option>
                  <option value="PENDING_AUDIT">รอตรวจสอบบิล (PENDING_AUDIT)</option>
                  <option value="PARTIALLY_CLEARED">เคลียร์บางส่วน (PARTIALLY_CLEARED)</option>
                  <option value="RETURNED">ตีกลับเอกสาร (RETURNED)</option>
                  <option value="REJECTED">ปฏิเสธการอนุมัติ (REJECTED)</option>
                  <option value="CLOSED">ปิดยอดแล้ว (CLOSED)</option>
                </select>
              </div>
              <div className="relative">
                <Filter className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition appearance-none cursor-pointer"
                >
                  <option value="ALL">ทุกรหัสโครงการ</option>
                  {uniqueProjects.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* List Table of Advances */}
            {filteredAdvances.length === 0 ? (
              <div className="py-16 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                <Info className="w-7 h-7 text-stone-300" />
                <span>ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหาและตัวกรองของคุณ</span>
              </div>
            ) : acctTableViewMode === "table" ? (
              <div className="overflow-x-auto border border-stone-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                      <th className="py-3 px-4">เลขที่เอกสาร / ผู้ขอเบิก</th>
                      <th className="py-3 px-4">โครงการ / แผนก</th>
                      <th className="py-3 px-4">วันที่เบิกเงิน</th>
                      <th className="py-3 px-4 text-right">จำนวนเบิกสุทธิ</th>
                      <th className="py-3 px-4 text-right">ยอดคงค้าง</th>
                      <th className="py-3 px-4">สถานะการทำงาน</th>
                      <th className="py-3 px-4 text-center">ดูข้อมูล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredAdvances.map((adv) => (
                      <tr key={adv.id} className="hover:bg-stone-50/40 transition duration-150">
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-stone-900">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-medium uppercase mt-0.5">{adv.employeeName}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-stone-800">{adv.projectId}</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">{adv.category}</div>
                        </td>
                        <td className="py-3.5 px-4 text-stone-500">
                          {adv.createdAt.split("T")[0]}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900">
                          {formatCurrency(adv.requestAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900">
                          <span className={adv.outstandingAmount > 0 ? "text-red-600" : "text-stone-400"}>
                            {formatCurrency(adv.outstandingAmount)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">{getStatusBadge(adv.status)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleOpenDetails(adv)}
                            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-900 transition"
                            title="ดูรายละเอียดเอกสาร"
                          >
                            <Eye className="w-4 h-4 mx-auto" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {filteredAdvances.map((adv) => (
                  <div key={adv.id} className="bg-stone-50/30 border border-stone-200 rounded-2xl p-4 shadow-xs hover:shadow-sm transition duration-150 flex flex-col justify-between gap-4">
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                          <p className="text-[10px] text-stone-400 font-bold uppercase mt-0.5">{adv.employeeName}</p>
                        </div>
                        {getStatusBadge(adv.status)}
                      </div>
                      <div className="border-t border-stone-100 pt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-stone-400 block font-bold uppercase text-[9px]">โครงการ</span>
                          <span className="text-stone-800 font-semibold truncate block">{adv.projectId}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 block font-bold uppercase text-[9px]">หมวดหมู่</span>
                          <span className="text-stone-800 font-semibold truncate block">{adv.category || "-"}</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-stone-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-stone-300" />
                        <span>วันที่เบิก: {adv.createdAt.split("T")[0]}</span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="text-[9px] font-bold text-stone-400 uppercase">ยอดเบิก / คงค้าง</div>
                        <div className="font-mono font-bold text-xs">
                          <span className="text-stone-900">{formatCurrency(adv.requestAmount)}</span>
                          <span className="text-stone-300 mx-1">/</span>
                          <span className={adv.outstandingAmount > 0 ? "text-red-500 font-extrabold" : "text-stone-400"}>
                            {formatCurrency(adv.outstandingAmount)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleOpenDetails(adv)}
                        className="p-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition flex items-center gap-1.5 text-[11px] font-bold"
                        title="ดูรายละเอียดเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>ดูข้อมูล</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
          )}


      </div>

      {/* ==================================================================== */}
      {/* 4. MODALS & SLIDE-OVERS */}
      {/* ==================================================================== */}

      {/* Rejection Note Dialog Modal */}
      {isRejectModalOpen && selectedAdv && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 animate-scale-in">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">ปฏิเสธคำขอเบิกเงิน</h3>
                <p className="text-[11px] text-stone-400 font-mono">เอกสารเลขที่: {selectedAdv.advId}</p>
              </div>
              <button onClick={() => setIsRejectModalOpen(false)} className="text-stone-400 hover:text-stone-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-700">ระบุเหตุผลการปฏิเสธการอนุมัติ <span className="text-red-500">*</span></label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="เช่น ข้อมูลโครงการไม่ชัดเจน ยอดเงินผิดพลาด กรุณาระบุรายละเอียด..."
                  rows={4}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-red-500 focus:bg-white transition"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReject}
                  disabled={actionLoading || !rejectionReason.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                >
                  {actionLoading ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  <span>ยืนยันปฏิเสธคำขอ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Approve Modal */}
      {confirmDialogApprove.isOpen && confirmDialogApprove.adv && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-stone-200 animate-scale-in space-y-4">
            <h3 className="text-base font-bold text-stone-900">ยืนยันการอนุมัติรายการ</h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              คุณแน่ใจหรือไม่ว่าต้องการอนุมัติใบขอเบิกเงิน <b>{confirmDialogApprove.adv.advId}</b> จำนวน <b>{confirmDialogApprove.adv.requestAmount.toLocaleString("th-TH")} บาท</b> ของคุณ <b>{confirmDialogApprove.adv.employeeName}</b>?
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialogApprove({ isOpen: false, adv: null })}
                className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={executeApprove}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5"
              >
                {actionLoading ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>อนุมัติรายการ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Request Details Side Sheet / Modal */}
      {isDetailModalOpen && selectedAdv && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-stone-200 animate-scale-in flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-5 border-b border-stone-100 flex items-start justify-between bg-stone-50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-stone-900 font-mono">{selectedAdv.advId}</span>
                  {getStatusBadge(selectedAdv.status)}
                </div>
                <p className="text-[11px] text-stone-500">โครงการ: {selectedAdv.projectId}</p>
              </div>
              <button onClick={() => setIsDetailModalOpen(false)} className="text-stone-400 hover:text-stone-600 p-1 hover:bg-stone-200/50 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">ผู้ยื่นขอเบิก</span>
                  <p className="text-stone-800 font-bold">{selectedAdv.employeeName}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">หมวดหมู่งบประมาณ</span>
                  <p className="text-stone-800 font-bold">{selectedAdv.category}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">ยอดขอเบิกสุทธิ</span>
                  <p className="text-stone-900 font-black font-mono text-sm">{formatCurrency(selectedAdv.requestAmount)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">ยอดค้างเคลียร์ปัจจุบัน</span>
                  <p className="text-red-600 font-black font-mono text-sm">{formatCurrency(selectedAdv.outstandingAmount)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">วันที่สร้างเอกสาร</span>
                  <p className="text-stone-800 font-medium font-mono">{selectedAdv.createdAt.split("T")[0]} {selectedAdv.createdAt.split("T")[1]?.slice(0,5)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">กำหนดส่งเคลียร์เอกสาร</span>
                  <p className="text-stone-800 font-semibold font-mono">{selectedAdv.neededDate || "ไม่ระบุ"}</p>
                </div>
              </div>

              <div className="space-y-1 bg-stone-50 border border-stone-200/60 rounded-xl p-3">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">จุดประสงค์และรายละเอียด</span>
                <p className="text-stone-700 leading-relaxed font-medium whitespace-pre-line mt-0.5">{selectedAdv.details || "ไม่มีรายละเอียดระบุไว้"}</p>
              </div>

              {selectedAdv.note && (
                <div className="space-y-1 bg-amber-50 border border-amber-200/60 rounded-xl p-3">
                  <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                    <Info className="w-3 h-3" /> บันทึกข้อความเพิ่มเติม / ความเห็นผู้ดูแล
                  </span>
                  <p className="text-stone-700 leading-relaxed font-medium whitespace-pre-line mt-0.5">{selectedAdv.note}</p>
                </div>
              )}

              {/* Approval Timeline in Audit logs */}
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">ประวัติการดำเนินการเอกสาร</span>
                <div className="space-y-2 border-l border-stone-200 pl-3.5 ml-1.5">
                  {auditLogs.filter(l => l.advId === selectedAdv.advId).map((log) => (
                    <div key={log.id} className="relative text-[11px]">
                      <span className="absolute -left-[19.5px] top-1 w-2.5 h-2.5 bg-stone-400 rounded-full border border-white" />
                      <div className="flex items-center justify-between font-mono text-stone-400 text-[10px] mb-0.5">
                        <span>{log.timestamp.split("T")[0]} {log.timestamp.split("T")[1]?.slice(0,5)}</span>
                        <span className="font-bold">{log.role}</span>
                      </div>
                      <p className="font-semibold text-stone-800">{log.note}</p>
                      <p className="text-stone-500 font-medium">โดย: {log.actionBy}</p>
                    </div>
                  ))}
                  {auditLogs.filter(l => l.advId === selectedAdv.advId).length === 0 && (
                    <p className="text-stone-400 italic">ไม่มีข้อมูลการทำรายการบันทึก</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer with action buttons inside Modal */}
            <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex justify-between items-center">
              <span className="text-[10px] font-mono font-bold text-stone-400">Remix Clear - Advance System</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsDetailModalOpen(false)}
                  className="px-4 py-2 bg-white border border-stone-200 text-stone-700 font-bold rounded-xl transition hover:bg-stone-50 text-xs"
                >
                  ปิดหน้าต่าง
                </button>

                {/* Manager actions if pending */}
                {(currentEmployee.position === "pm" || currentEmployee.position === "executive" || currentEmployee.position === "ceo" || (!currentEmployee.position && currentEmployee.role === UserRole.MANAGER)) && selectedAdv.status === AdvanceStatus.PENDING_APPROVAL && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenReject(selectedAdv)}
                      className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl transition text-xs flex items-center gap-1.5"
                    >
                      <X className="w-4 h-4" /> ปฏิเสธ (Reject)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(selectedAdv)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition text-xs flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" /> อนุมัติ (Approve)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Drawer Modal for Employees */}
      {isNotificationOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/40 flex items-center justify-end p-0 backdrop-blur-xs">
          <div className="bg-white max-w-md w-full h-screen shadow-2xl flex flex-col animate-slide-in">
            {/* Header */}
            <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
              <div className="flex items-center gap-2 text-stone-900">
                <History className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-sm">การแจ้งเตือน & อัปเดตสถานะ</h3>
              </div>
              <button onClick={() => setIsNotificationOpen(false)} className="text-stone-400 hover:text-stone-600 p-1.5 hover:bg-stone-200/50 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {employeeNotifications.length === 0 ? (
                <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                  <Clock className="w-8 h-8 text-stone-300" />
                  <span>ยังไม่มีการแจ้งเตือนรายการเอกสารในขณะนี้</span>
                </div>
              ) : (
                employeeNotifications.map((log) => (
                  <button 
                    key={log.id} 
                    onClick={() => {
                      setIsNotificationOpen(false);
                      navigateToTransaction(log.advId);
                    }}
                    className="bg-stone-50 border border-stone-200/60 hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow-md rounded-xl p-4 space-y-2 transition-all duration-200 text-left w-full group cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-stone-900 text-[11px] bg-white border border-stone-200 px-2 py-0.5 rounded group-hover:border-indigo-200 group-hover:text-indigo-600 transition-colors">{log.advId}</span>
                      <span className="text-[10px] text-stone-400 font-mono">{log.timestamp.split("T")[0]} {log.timestamp.split("T")[1]?.slice(0, 5)}</span>
                    </div>
                    <p className="text-xs font-bold text-stone-800 leading-relaxed group-hover:text-stone-950 transition-colors">{log.note}</p>
                    <div className="flex items-center justify-between text-[10px] text-stone-400">
                      <span>ดำเนินการโดย: {log.actionBy} ({log.role})</span>
                      <div className="flex items-center gap-1">
                        <span>สถานะก่อนหน้า:</span>
                        <span className="font-bold text-stone-600">{log.beforeStatus}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-stone-100 bg-stone-50 shrink-0 text-center text-[10px] text-stone-400 font-medium">
              แสดงเฉพาะ 10 รายการความเคลื่อนไหวล่าสุดของคุณ
            </div>
          </div>
        </div>
      )}
      
      {/* End of overview view */}
        </div>
      )}
    </div>
  );
}
