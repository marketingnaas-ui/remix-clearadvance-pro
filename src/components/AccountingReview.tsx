/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { collection, doc, getDocs, updateDoc, query, where, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType, safeJsonStringify } from "../lib/firebase";
import { triggerAutoSyncSheetsIfEnabled, triggerAutoSyncVaultFoldersIfEnabled } from "../lib/workspaceSync";
import { sendLineNotification } from "../lib/lineNotify";
import { Advance, AdvanceStatus, ClearingLog, ClearingItem, ActionType, AuditLog, Employee, UserRole } from "../types";
import { exportToExcel } from "../lib/excelExport";
import { FileText, ZoomIn, ZoomOut, Check, X, AlertTriangle, CornerUpLeft, BookOpen, Clock, Calendar, Landmark, DollarSign, ListFilter, RefreshCw, Eye, Sparkles, FileSpreadsheet, Search, Filter, List, Grid } from "lucide-react";

interface AccountingReviewProps {
  currentEmployee: Employee;
}

export default function AccountingReview({ currentEmployee }: AccountingReviewProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [selectedAdv, setSelectedAdv] = useState<Advance | null>(null);
  const [clearingLogs, setClearingLogs] = useState<ClearingLog[]>([]);
  const [clearingItems, setClearingItems] = useState<ClearingItem[]>([]);
  const [activeItem, setActiveItem] = useState<ClearingItem | null>(null);
  const [allAdvances, setAllAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");

  // Filtering & Sorting States
  const [searchTerm, setSearchTerm] = useState("");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"date" | "name" | "status">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Split View controls
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [returnedReason, setReturnedReason] = useState<string>("");
  const [approvedAmountOverride, setApprovedAmountOverride] = useState<number>(0);
  const [accountantNote, setAccountantNote] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState<"return" | "partial" | "close" | null>(null);

  // Dynamic calculations for Active Item being edited
  const [editedVendorName, setEditedVendorName] = useState<string>("");
  const [editedNetAmt, setEditedNetAmt] = useState<number>(0);

  const getThaiStatus = (status: AdvanceStatus | string) => {
    switch (status) {
      case AdvanceStatus.PENDING_APPROVAL:
        return "รออนุมัติ";
      case AdvanceStatus.WAITING_TRANSFER:
        return "รอโอนเงิน";
      case AdvanceStatus.WAITING_CLEARANCE:
        return "รอเคลียร์บิล";
      case AdvanceStatus.PENDING_AUDIT:
        return "รอตรวจสอบบิล";
      case AdvanceStatus.PARTIALLY_CLEARED:
        return "เคลียร์บางส่วน";
      case AdvanceStatus.WAITING_ORIGINAL_DOC:
        return "รอเอกสารตัวจริง";
      case AdvanceStatus.RETURNED:
        return "บิลถูกตีกลับ";
      case AdvanceStatus.CLOSED:
        return "ปิดบัญชีแล้ว";
      case AdvanceStatus.REJECTED:
        return "ปฏิเสธ";
      default:
        return status || "-";
    }
  };

  const getStatusBadge = (status: AdvanceStatus | string) => {
    const text = getThaiStatus(status);
    switch (status) {
      case AdvanceStatus.PENDING_APPROVAL:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_TRANSFER:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_CLEARANCE:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PENDING_AUDIT:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PARTIALLY_CLEARED:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_ORIGINAL_DOC:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.RETURNED:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.CLOSED:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      case AdvanceStatus.REJECTED:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-600 border border-stone-200 rounded-md uppercase whitespace-nowrap">{text}</span>;
    }
  };

  useEffect(() => {
    // Listen to advances based on active tab
    const pendingStatuses = [AdvanceStatus.PENDING_AUDIT, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.WAITING_ORIGINAL_DOC];
    const statuses = activeTab === "pending" 
      ? pendingStatuses
      : Object.values(AdvanceStatus).filter(s => !pendingStatuses.includes(s));

    const q = query(
      collection(db, "advances"),
      where("status", "in", statuses)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Advance);
      });
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setAdvances(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(new Error(safeJsonStringify(error)), OperationType.GET, "advances", false);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [activeTab]);

  // Derived filtered and sorted advances
  const filteredAndSortedAdvances = useMemo(() => {
    let result = [...advances];

    // Search filter
    if (searchTerm) {
      const lowSearch = searchTerm.toLowerCase();
      result = result.filter(a => 
        a.advId.toLowerCase().includes(lowSearch) || 
        a.employeeName.toLowerCase().includes(lowSearch) || 
        a.projectId.toLowerCase().includes(lowSearch)
      );
    }

    // Project filter
    if (projectFilter !== "ALL") {
      result = result.filter(a => a.projectId === projectFilter);
    }

    // Status filter
    if (statusFilter !== "ALL") {
      result = result.filter(a => a.status === statusFilter);
    }

    // Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "date") {
        comparison = b.createdAt.localeCompare(a.createdAt);
      } else if (sortBy === "name") {
        comparison = a.employeeName.localeCompare(b.employeeName);
      } else if (sortBy === "status") {
        comparison = a.status.localeCompare(b.status);
      }

      return sortOrder === "desc" ? comparison : -comparison;
    });

    return result;
  }, [advances, searchTerm, projectFilter, statusFilter, sortBy, sortOrder]);

  const projectsList = useMemo(() => {
    return Array.from(new Set(allAdvances.map(a => a.projectId).filter(Boolean))).sort();
  }, [allAdvances]);

  useEffect(() => {
    const qAll = collection(db, "advances");
    const unsubAll = onSnapshot(qAll, (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach(d => list.push({ id: d.id, ...d.data() } as Advance));
      setAllAdvances(list);
    }, (err) => {
      handleFirestoreError(new Error(safeJsonStringify(err)), OperationType.GET, "advances", false);
    });
    return () => unsubAll();
  }, []);

  // Whenever a parent Advance is selected, load its associated Clearing round logs and line items
  useEffect(() => {
    if (!selectedAdv) {
      setClearingLogs([]);
      setClearingItems([]);
      setActiveItem(null);
      return;
    }

    const loadClearingData = async () => {
      try {
        const qLogs = query(collection(db, "clearingLogs"), where("advId", "==", selectedAdv.advId));
        const snapLogs = await getDocs(qLogs);
        const logsList: ClearingLog[] = [];
        snapLogs.forEach((d) => logsList.push({ id: d.id, ...d.data() } as ClearingLog));
        logsList.sort((a, b) => a.roundNo - b.roundNo);
        setClearingLogs(logsList);

        const qItems = query(collection(db, "clearingItems"), where("advId", "==", selectedAdv.advId));
        const snapItems = await getDocs(qItems);
        const itemsList: ClearingItem[] = [];
        snapItems.forEach((d) => itemsList.push({ id: d.id, ...d.data() } as ClearingItem));
        setClearingItems(itemsList);

        if (itemsList.length > 0) {
          // Set first line item as active for the Split View preview
          const pendingItem = itemsList.find((i) => !i.accountantApproved) || itemsList[0];
          handleSetActiveItem(pendingItem);
        } else {
          setActiveItem(null);
        }
      } catch (err) {
        console.error("Error loading clearing logs:", err);
      }
    };

    loadClearingData();
  }, [selectedAdv]);

  const handleSetActiveItem = (item: ClearingItem) => {
    setActiveItem(item);
    setEditedVendorName(item.vendorName);
    setEditedNetAmt(item.netAmount);
    setApprovedAmountOverride(item.netAmount);
  };

  // Helper to determine the overall Advance status based on all clearing items
  const updateOverallAdvanceStatus = async (advId: string, currentItems: ClearingItem[]) => {
    const adv = allAdvances.find(a => a.advId === advId);
    if (!adv) return;

    const allReviewed = currentItems.every(item => item.accountantApproved || item.status === AdvanceStatus.WAITING_ORIGINAL_DOC);
    const anyWaiting = currentItems.some(item => item.status === AdvanceStatus.WAITING_ORIGINAL_DOC);
    
    let nextStatus = adv.status;
    
    if (allReviewed) {
      if (anyWaiting) {
        nextStatus = AdvanceStatus.WAITING_ORIGINAL_DOC;
      } else {
        nextStatus = AdvanceStatus.CLOSED;
      }
    } else {
      const anyApproved = currentItems.some(item => item.accountantApproved);
      nextStatus = anyApproved ? AdvanceStatus.PARTIALLY_CLEARED : AdvanceStatus.PENDING_AUDIT;
    }

    const nextApprovedClearingTotal = currentItems.reduce((sum, item) => sum + (item.accountantApproved ? item.netAmount : 0), 0);
    const nextOutstanding = adv.requestAmount - nextApprovedClearingTotal;

    await updateDoc(doc(db, "advances", adv.id), {
      status: nextStatus,
      approvedClearingAmountTotal: nextApprovedClearingTotal,
      outstandingAmount: nextOutstanding,
      settlementResult: nextOutstanding,
      closedAt: nextStatus === AdvanceStatus.CLOSED ? new Date().toISOString() : null,
    });

    if (nextStatus === AdvanceStatus.CLOSED) {
      // Send real LINE Notification
      await sendLineNotification({
        triggerId: "onSettlement",
        variables: {
          advId: adv.advId,
          employeeName: adv.employeeName,
          amount: nextApprovedClearingTotal.toLocaleString("th-TH"),
          status: "เคลียร์ยอดสมบูรณ์ (ปิดใบเบิก)",
          projectName: adv.projectId,
          category: adv.category,
          remark: `ยอดเคลียร์เงินรวมทั้งสิ้น ${nextApprovedClearingTotal.toLocaleString("th-TH")} บาท ส่วนต่าง ${nextOutstanding.toLocaleString("th-TH")} บาท`,
          date: new Date().toLocaleDateString("th-TH")
        },
        targetEmployeeId: adv.employeeId
      });

      // Save Settlement Summary PDF/txt to vault
      const settlementBal = adv.requestAmount - nextApprovedClearingTotal;
      const vaultId = `file-${Date.now()}`;
      await setDoc(doc(db, "vaultFiles", vaultId), {
        id: vaultId,
        advId: adv.advId,
        fileType: "SETTLEMENT",
        fileUrl: "https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=600",
        fileName: `settlement-summary-${adv.advId}.txt`,
        uploadedBy: currentEmployee.name,
        uploadedAt: new Date().toISOString(),
      });
    }

    return { nextStatus, nextOutstanding };
  };

  // 1. Accountant Action: Approve / Clear Entirely
  const handleApproveItem = async () => {
    if (!selectedAdv || !activeItem) return;
    setError(null);
    setSuccess(null);

    try {
      // Update item approval status
      const itemRef = doc(db, "clearingItems", activeItem.id);
      await updateDoc(itemRef, {
        accountantApproved: true,
        vendorName: editedVendorName,
        netAmount: editedNetAmt,
        accountantNote,
      });

      // Update local items list for status calculation
      const updatedItems = clearingItems.map(item => 
        item.id === activeItem.id 
          ? { ...item, accountantApproved: true, netAmount: editedNetAmt, vendorName: editedVendorName } 
          : item
      );

      // Update clearing log status
      const logRef = doc(db, "clearingLogs", activeItem.clearingLogId);
      await updateDoc(logRef, {
        status: "APPROVED",
        totalApprovedAmount: editedNetAmt,
        accountantNote: accountantNote || "อนุมัติรายการใช้จ่ายผ่านระบบตรวจสอบสำเร็จ",
      });

      const { nextStatus } = await updateOverallAdvanceStatus(selectedAdv.advId, updatedItems) || {};

      // Write Audit Trail Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.ACCOUNTING_APPROVE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: nextStatus,
        note: `ตรวจสอบผ่านบัญชีร้านค้า ${editedVendorName} ยอดเงิน ${editedNetAmt} บาท`,
      } as AuditLog);

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`บันทึกการตรวจสอบบิล ${editedVendorName} เรียบร้อยแล้ว (สถานะใบเบิก: ${nextStatus})`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(safeJsonStringify(err));
      setError("เกิดข้อผิดพลาดในการตรวจสอบบัญชี");
    }
  };

  // 2. Accountant Action: Partial Clear
  const handlePartialClear = async () => {
    if (!selectedAdv || !activeItem) return;
    if (approvedAmountOverride <= 0 || approvedAmountOverride > editedNetAmt) {
      setError(`จำนวนยอดเงินอนุมัติบางส่วนต้องอยู่ระหว่าง 1 ถึง ${editedNetAmt} บาท`);
      return;
    }

    setError(null);
    setSuccess(null);
    setShowDialog(null);

    try {
      // Update item
      const itemRef = doc(db, "clearingItems", activeItem.id);
      await updateDoc(itemRef, {
        accountantApproved: true,
        vendorName: editedVendorName,
        netAmount: approvedAmountOverride,
        accountantNote,
      });

      // Update local items list for status calculation
      const updatedItems = clearingItems.map(item => 
        item.id === activeItem.id 
          ? { ...item, accountantApproved: true, netAmount: approvedAmountOverride, vendorName: editedVendorName } 
          : item
      );

      // Update clearing log
      const logRef = doc(db, "clearingLogs", activeItem.clearingLogId);
      await updateDoc(logRef, {
        status: "PARTIAL",
        totalApprovedAmount: approvedAmountOverride,
        accountantNote: accountantNote || `อนุมัติจ่ายบางส่วนจำนวน ${approvedAmountOverride} บาท จากยอดบิลรวม ${editedNetAmt} บาท`,
      });

      const { nextStatus } = await updateOverallAdvanceStatus(selectedAdv.advId, updatedItems) || {};

      // Audit Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.PARTIAL_CLEAR,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: nextStatus,
        note: `อนุมัติเคลียร์จ่ายบางส่วนร้านค้า ${editedVendorName} ยอดเงิน ${approvedAmountOverride} บาท`,
      } as AuditLog);

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`บันทึกอนุมัติการเคลียร์บางส่วนร้านค้า ${editedVendorName} สำเร็จ (สถานะใบเบิก: ${nextStatus})`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(safeJsonStringify(err));
      setError("เกิดข้อผิดพลาดในการทำรายการ");
    }
  };

  // 3. Accountant Action: Return / Bounce
  const handleReturnItem = async () => {
    if (!selectedAdv) return;
    if (!returnedReason.trim()) {
      setError("กรุณากรอกเหตุผลความจำเป็นในการส่งกลับแก้ไข");
      return;
    }

    setError(null);
    setSuccess(null);
    setShowDialog(null);

    try {
      if (activeItem) {
        // Update item
        const itemRef = doc(db, "clearingItems", activeItem.id);
        await updateDoc(itemRef, {
          accountantApproved: false,
        });

        // Update clearing log
        const logRef = doc(db, "clearingLogs", activeItem.clearingLogId);
        await updateDoc(logRef, {
          status: "RETURNED",
          returnedReason,
        });
      } else if (clearingLogs.length > 0) {
        const latestLog = clearingLogs[clearingLogs.length - 1];
        const logRef = doc(db, "clearingLogs", latestLog.id);
        await updateDoc(logRef, {
          status: "RETURNED",
          returnedReason,
        });
      }

      // Update parent advance status to RETURNED
      const advRef = doc(db, "advances", selectedAdv.id);
      await updateDoc(advRef, {
        status: AdvanceStatus.RETURNED,
        returnedReason,
      });

      // Audit Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.RETURN_CLEARING,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: AdvanceStatus.RETURNED,
        note: `ตีกลับรายการบิลไปให้พนักงานแก้ไขเพิ่มเติม เหตุผล: ${returnedReason}`,
      } as AuditLog);

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`ตีกลับเอกสารเคลียร์ยอด ${selectedAdv.advId} ให้พนักงานแก้ไข เรียบร้อยแล้ว`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(safeJsonStringify(err));
      setError("เกิดข้อผิดพลาดในการส่งคืนข้อมูล");
    }
  };

  // 4. Accountant Action: Wait for Original Document
  const handleWaitOriginalDoc = async () => {
    if (!selectedAdv || !activeItem) return;
    
    setError(null);
    setSuccess(null);
    
    try {
      // 1. Update the individual clearing item status
      const itemRef = doc(db, "clearingItems", activeItem.id);
      await updateDoc(itemRef, {
        accountantApproved: true,
        status: AdvanceStatus.WAITING_ORIGINAL_DOC,
        vendorName: editedVendorName,
        netAmount: editedNetAmt,
        accountantNote,
      });

      // Update local items list for status calculation
      const updatedItems = clearingItems.map(item => 
        item.id === activeItem.id 
          ? { ...item, accountantApproved: true, status: AdvanceStatus.WAITING_ORIGINAL_DOC, netAmount: editedNetAmt, vendorName: editedVendorName } 
          : item
      );

      const { nextStatus } = await updateOverallAdvanceStatus(selectedAdv.advId, updatedItems) || {};

      // 3. Write Audit Trail Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.ACCOUNTING_APPROVE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: nextStatus,
        note: `ตรวจสอบผ่านบัญชี (รอเอกสารจริง) ร้านค้า ${editedVendorName} ยอดเงิน ${editedNetAmt} บาท`,
      } as AuditLog);

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`บันทึกการตรวจสอบบิล ${editedVendorName} เรียบร้อยแล้ว (สถานะใบเบิก: ${nextStatus})`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(safeJsonStringify(err));
      setError("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ");
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(val);
  };

  const stats = {
    outstanding: allAdvances.filter(a => [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED].includes(a.status)).reduce((acc, a) => acc + a.outstandingAmount, 0),
    closed: allAdvances.filter(a => a.status === AdvanceStatus.CLOSED).length,
    totalItems: allAdvances.length,
    totalValue: allAdvances.reduce((acc, a) => acc + a.requestAmount, 0)
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in" id="accounting_review_tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-stone-900 text-stone-100 rounded-xl">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-stone-900">การตรวจสอบบัญชีและเอกสาร (Audit & Review)</h2>
            <p className="text-xs text-stone-500">ตรวจสอบความถูกต้องของใบเสร็จจากพนักงาน และทำการสั่ง settlement หรือปิดดุลบัญชี</p>
          </div>
        </div>

        <button
          onClick={() => exportToExcel(advances, `Accounting_Review_List_${new Date().toISOString().split('T')[0]}`)}
          className="px-4 py-2 bg-white border border-stone-200 text-emerald-700 hover:bg-emerald-50 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
          title="ส่งออกรายการที่รอตรวจสอบเป็น Excel"
        >
          <FileSpreadsheet className="w-4 h-4" /> <span>Export List to Excel</span>
        </button>
      </div>

      {/* KPI Stats for Accountant Dashboard */}
      {!selectedAdv && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">ยอดเงินรอเคลียร์สะสม</span>
            <span className="text-lg font-bold text-red-600 font-mono">{formatCurrency(stats.outstanding)}</span>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">ใบเบิกที่ปิดยอดแล้ว</span>
            <span className="text-lg font-bold text-emerald-600 font-mono">{stats.closed} <span className="text-[10px] text-stone-400 font-sans">รายการ</span></span>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">จำนวนใบเบิกทั้งหมด</span>
            <span className="text-lg font-bold text-stone-900 font-mono">{stats.totalItems} <span className="text-[10px] text-stone-400 font-sans">รายการ</span></span>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">มูลค่ารวมที่เบิกจ่าย</span>
            <span className="text-lg font-bold text-stone-900 font-mono">{formatCurrency(stats.totalValue)}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <Check className="w-5 h-5 text-emerald-600" />
          {success}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          {error}
        </div>
      )}

      {/* Main Review selection bar */}
      {!selectedAdv ? (
        <div className="space-y-4">
          <div className="flex p-1 bg-stone-100 rounded-2xl w-full sm:w-auto self-start">
            <button
              onClick={() => setActiveTab("pending")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === "pending" ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>รอตรวจสอบ</span>
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === "history" ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              <span>ประวัติรายการ</span>
            </button>
          </div>

      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="ค้นหาด้วยรหัสใบเบิก, พนักงาน, โครงการ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700"
                >
                  <option value="ALL">ทุกโครงการ</option>
                  {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700"
                >
                  <option value="ALL">ทุกสถานะ</option>
                  <option value={AdvanceStatus.PENDING_AUDIT}>รอตรวจสอบบิล</option>
                  <option value={AdvanceStatus.PARTIALLY_CLEARED}>เคลียร์บางส่วน</option>
                  <option value={AdvanceStatus.WAITING_CLEARANCE}>รอเคลียร์บิล</option>
                  <option value={AdvanceStatus.WAITING_ORIGINAL_DOC}>รอเอกสารจริง</option>
                  <option value={AdvanceStatus.CLOSED}>ปิดยอดแล้ว</option>
                  <option value={AdvanceStatus.RETURNED}>ถูกตีกลับ</option>
                </select>
                <div className="flex items-center gap-1 bg-stone-50 border border-stone-200 rounded-xl px-2">
                  <span className="text-[10px] font-bold text-stone-400 uppercase px-1">เรียงตาม:</span>
                  <button onClick={() => setSortBy("date")} className={`px-2 py-1.5 text-[10px] font-bold rounded-lg ${sortBy === "date" ? "bg-stone-900 text-white" : "text-stone-500"}`}>วันที่</button>
                  <button onClick={() => setSortBy("name")} className={`px-2 py-1.5 text-[10px] font-bold rounded-lg ${sortBy === "name" ? "bg-stone-900 text-white" : "text-stone-500"}`}>ชื่อ</button>
                  <button onClick={() => setSortBy("status")} className={`px-2 py-1.5 text-[10px] font-bold rounded-lg ${sortBy === "status" ? "bg-stone-900 text-white" : "text-stone-500"}`}>สถานะ</button>
                  <button onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")} className="p-1.5 text-stone-500 hover:text-stone-900 transition flex items-center gap-1">
                    <RefreshCw className={`w-3.5 h-3.5 ${sortOrder === "asc" ? "" : "rotate-180"}`} />
                    <span className="text-[9px] font-bold uppercase">
                      {sortBy === "date" 
                        ? (sortOrder === "desc" ? "ใหม่สุด" : "เก่าสุด")
                        : (sortOrder === "desc" ? "ฮ-ก" : "ก-ฮ")}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <h3 className="font-bold text-stone-900 text-sm">เลือกเอกสารใบเบิกเงินรอการตรวจสอบบัญชี</h3>
            {loading ? (
              <div className="text-center py-10 text-stone-500 text-xs">กำลังค้นหาข้อมูล...</div>
            ) : filteredAndSortedAdvances.length === 0 ? (
              <div className="text-center py-10 text-stone-400 text-xs">ไม่พบรายการใบเบิกตามเงื่อนไขที่เลือก</div>
            ) : (
              <div className="divide-y divide-stone-100">
                {filteredAndSortedAdvances.map((adv) => (
                  <div
                    key={adv.id}
                    onClick={() => setSelectedAdv(adv)}
                    className="py-4 px-2 hover:bg-stone-50 rounded-xl cursor-pointer transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-stone-900 bg-stone-100 border border-stone-200 px-2 py-1 rounded">{adv.advId}</span>
                      <div>
                        <h4 className="font-bold text-stone-800 text-sm">{adv.projectId}</h4>
                        <p className="text-xs text-stone-500">ผู้เบิก: {adv.employeeName} • ยื่นเมื่อ: {adv.createdAt.split("T")[0]}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs font-semibold text-stone-400">ยอดเบิก / คงค้าง</p>
                        <p className="text-sm font-bold font-mono text-stone-900">{formatCurrency(adv.requestAmount)} / <span className="text-red-600">{formatCurrency(adv.outstandingAmount)}</span></p>
                      </div>
                      {getStatusBadge(adv.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Queue Bar */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {filteredAndSortedAdvances.slice(0, 5).map((adv) => (
              <div 
                key={adv.id} 
                onClick={() => setSelectedAdv(adv)}
                className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer ${selectedAdv?.id === adv.id ? "bg-stone-900 border-stone-900 text-white" : "bg-white border-stone-200"}`}
              >
                <img src={adv.employeeImageUrl || "/placeholder.jpg"} className="w-6 h-6 rounded-full" />
                <div className="text-[10px] whitespace-nowrap">
                  <div className="font-bold">{adv.employeeName}</div>
                  <div className={selectedAdv?.id === adv.id ? "text-stone-300" : "text-stone-500"}>{adv.advId}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-stone-950 text-stone-100 px-6 py-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold text-white bg-stone-850 px-2.5 py-1 rounded border border-stone-800">{selectedAdv.advId}</span>
              <span className="text-xs text-stone-300 truncate">โครงการ: <span className="font-bold text-white">{selectedAdv.projectId}</span> • ผู้ขอ: <span className="font-semibold text-white">{selectedAdv.employeeName}</span></span>
            </div>
            <button onClick={() => setSelectedAdv(null)} className="px-3 py-1 bg-stone-800 hover:bg-stone-700 text-white border border-stone-700 rounded-lg text-xs font-semibold transition">เลือกเอกสารอื่น</button>
          </div>

          {/* New Summary Box */}
          <div className="grid grid-cols-4 gap-4 p-4 bg-white border border-stone-200 rounded-2xl shadow-sm">
            {[
              { label: "ยอดเบิกตามใบเบิก", value: selectedAdv.requestAmount },
              { label: "ยอดยกมา", value: selectedAdv.requestAmount - (clearingItems.filter(i => i.accountantApproved && i.clearingLogId !== (activeItem?.clearingLogId || "")).reduce((sum, item) => sum + item.netAmount, 0)) },
              { label: "ยอดเคลียร์ในเอกสารนี้", value: activeItem?.netAmount || 0 },
              { label: "ยอดคงค้าง", value: selectedAdv.outstandingAmount - (activeItem?.netAmount || 0) }
            ].map((item, idx) => (
              <div key={idx} className="space-y-1">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{item.label}</span>
                <span className="block text-sm font-bold font-mono text-stone-900">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[600px]">
            <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between gap-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-sm">หลักฐานใบเสร็จรับเงินจริง</h3>
                <div className="flex gap-2">
                  <button onClick={() => setZoomLevel(Math.max(50, zoomLevel - 25))} className="p-1.5 bg-stone-50 hover:bg-stone-150 rounded border border-stone-200 text-stone-600"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <span className="text-[10px] font-mono text-stone-500 font-bold self-center px-1">{zoomLevel}%</span>
                  <button onClick={() => setZoomLevel(Math.min(250, zoomLevel + 25))} className="p-1.5 bg-stone-50 hover:bg-stone-150 rounded border border-stone-200 text-stone-600"><ZoomIn className="w-3.5 h-3.5" /></button>
                </div>
              </div>

              {clearingItems.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-2 border-b border-stone-100">
                  {clearingItems.map((item, idx) => (
                    <button key={item.id} onClick={() => handleSetActiveItem(item)} className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition shrink-0 border ${activeItem?.id === item.id ? "bg-stone-900 border-stone-900 text-stone-50" : "bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100"}`}>
                      บิลชิ้นที่ #{idx + 1} ({formatCurrency(item.netAmount)})
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 min-h-[400px] bg-stone-50 border border-stone-200 rounded-2xl flex items-center justify-center overflow-auto p-4 relative flex-col gap-2">
                {(activeItem?.imageUrl || (activeItem?.additionalImageUrls && activeItem.additionalImageUrls.length > 0)) ? (
                  <>
                    {console.log("activeItem preview:", activeItem)}
                    {[...(activeItem.imageUrl && typeof activeItem.imageUrl === 'string' ? activeItem.imageUrl.split(',').filter(Boolean) : []), ...(activeItem.additionalImageUrls || [])].map((url, idx) => (
                      <img key={idx} src={url} alt={`Receipt ${idx + 1}`} style={{ transform: `scale(${zoomLevel / 100})` }} referrerPolicy="no-referrer" className="max-h-[380px] max-w-full object-contain rounded transition-transform origin-center shadow-md" />
                    ))}
                  </>
                ) : <div className="text-center text-stone-400 text-xs">ไม่มีไฟล์รูปใบเสร็จแนบในระบบ</div>}
              </div>

              <div className="flex flex-col gap-2.5">
                {activeItem && (
                  <div className={`flex-1 p-3 border rounded-xl text-xs flex items-center justify-between ${activeItem.ocrConfidence < 60 ? "bg-red-50 text-red-800 border-red-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}>
                    <span>ความแม่นยำตรวจวิเคราะห์ AI:</span>
                    <div className="flex items-center gap-2"><span className="font-bold font-mono">{activeItem.ocrConfidence}%</span>{activeItem.isAiAnalyzed && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px] uppercase">Verified by AI</span>}</div>
                  </div>
                )}
                {activeItem?.remarks && <div className="p-3 bg-stone-100 text-stone-700 border border-stone-200 rounded-xl text-xs italic"><strong>หมายเหตุพนักงาน:</strong> {activeItem.remarks}</div>}
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="border-b border-stone-100 pb-3 flex items-center justify-between"><h3 className="font-bold text-stone-900 text-sm">ข้อมูลสรุปบิลประมวลผล</h3></div>
                <div className="p-4 bg-[#f2f8ff] rounded-2xl border border-blue-100 text-xs space-y-2">
                  <p className="font-bold text-stone-900 font-sans border-b border-blue-200 pb-1 mb-2">สรุปรายการทั้งหมด ({clearingItems.length} รายการ):</p>
                  <div className="space-y-1 font-mono text-[11px] text-stone-700">
                    <div className="flex justify-between">
                      <span className="font-sans">ยอดรวมสุทธิ:</span>
                      <span className="font-bold text-black">{formatCurrency(clearingItems.reduce((acc, item) => acc + item.netAmount, 0))}</span>
                    </div>
                  </div>
                </div>

                {activeItem && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><span className="text-stone-400 font-semibold block uppercase text-[10px] mb-1">ชื่อร้านค้า</span><input type="text" value={editedVendorName} onChange={(e) => setEditedVendorName(e.target.value)} className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-stone-900 font-semibold" /></div>
                      <div><span className="text-stone-400 font-semibold block uppercase text-[10px] mb-1">ยอดเงินสุทธิ</span><input type="number" value={editedNetAmt || ""} onChange={(e) => { const val = parseFloat(e.target.value) || 0; setEditedNetAmt(val); setApprovedAmountOverride(val); }} className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-200 rounded-lg font-mono font-bold text-stone-900" /></div>
                    </div>
                    
                    {/* Add detailed view of employee submitted data */}
                    <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3">
                      <h4 className="text-[11px] font-bold text-stone-900 border-b border-stone-200 pb-2">รายละเอียดรายการในบิล</h4>
                      <div className="space-y-2">
                        {activeItem.lineItems?.map((li, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <div>
                              <span className="text-stone-800 font-semibold">{li.itemName}</span>
                              <div className="text-[10px] text-stone-500">{li.qty} x {formatCurrency(li.unitPrice)}</div>
                            </div>
                            <span className="font-mono font-bold text-stone-900">{formatCurrency(li.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-stone-200 pt-2 space-y-1 font-mono text-[10px] text-stone-600">
                        {activeItem.discount ? <div className="flex justify-between"><span>ส่วนลด:</span><span>-{formatCurrency(activeItem.discount)}</span></div> : null}
                        {activeItem.otherExpenses ? <div className="flex justify-between"><span>ค่าใช้จ่ายอื่นๆ:</span><span>{formatCurrency(activeItem.otherExpenses)}</span></div> : null}
                        <div className="flex justify-between"><span>VAT ({activeItem.vatType}):</span><span>{formatCurrency(activeItem.vatAmount || 0)}</span></div>
                        <div className="flex justify-between"><span>หัก ณ ที่จ่าย ({activeItem.whtRate}):</span><span>-{formatCurrency(activeItem.whtAmount || 0)}</span></div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">บันทึกบัญชี (Accountant Note)</label>
                  <input type="text" value={accountantNote} onChange={(e) => setAccountantNote(e.target.value)} placeholder="รายละเอียดคำสั่ง..." className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none" />
                </div>
              </div>

              {activeTab === "pending" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button onClick={handleApproveItem} className="py-3 bg-stone-950 hover:bg-stone-900 text-stone-50 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow"><Check className="w-3.5 h-3.5" /> อนุมัติเคลียร์</button>
                  <button onClick={handleWaitOriginalDoc} className="py-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> รอเอกสารจริง</button>
                  <button onClick={() => setShowDialog("partial")} className="py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-stone-200"><BookOpen className="w-3.5 h-3.5" /> อนุมัติบางส่วน</button>
                  <button onClick={() => setShowDialog("return")} className="py-3 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"><CornerUpLeft className="w-3.5 h-3.5" /> ตีกลับบิล</button>
                </div>
              )}
              {activeTab === "history" && (
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-center text-xs font-bold text-stone-500">
                  รายการนี้ตรวจสอบและลงบันทึกเสร็จสิ้นแล้ว (Read Only)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showDialog === "partial" && activeItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="bg-stone-950 text-stone-100 p-5 flex items-center justify-between"><h3 className="font-bold text-white text-sm">อนุมัติวงเงินเคลียร์บางส่วน</h3><button onClick={() => setShowDialog(null)}><X className="w-5 h-5 text-white" /></button></div>
            <div className="p-6 space-y-4">
              <input type="number" value={approvedAmountOverride || ""} onChange={(e) => setApprovedAmountOverride(parseFloat(e.target.value) || 0)} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl font-mono font-bold" />
            </div>
            <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end gap-2"><button onClick={() => setShowDialog(null)} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-semibold">ยกเลิก</button><button onClick={handlePartialClear} className="px-5 py-2 bg-stone-900 hover:bg-stone-850 text-white rounded-xl text-xs font-bold">ยืนยัน</button></div>
          </div>
        </div>
      )}

      {showDialog === "return" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="bg-stone-950 text-stone-100 p-5 flex items-center justify-between"><h3 className="font-bold text-white text-sm">ตีกลับเอกสาร (Bounce)</h3><button onClick={() => setShowDialog(null)}><X className="w-5 h-5 text-white" /></button></div>
            <div className="p-6 space-y-4"><textarea rows={3} value={returnedReason} onChange={(e) => setReturnedReason(e.target.value)} placeholder="ระบุเหตุผลในการตีกลับ..." className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none resize-none" /></div>
            <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end gap-2"><button onClick={() => setShowDialog(null)} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-semibold">ยกเลิก</button><button onClick={handleReturnItem} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold">ส่งกลับ</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
