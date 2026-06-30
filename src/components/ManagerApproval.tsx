/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, doc, updateDoc, onSnapshot, query, where, setDoc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { triggerAutoSyncSheetsIfEnabled, triggerAutoSyncVaultFoldersIfEnabled } from "../lib/workspaceSync";
import { sendLineNotification } from "../lib/lineNotify";
import { Advance, AdvanceStatus, Employee, ActionType, AuditLog, UserRole } from "../types";
import { exportToExcel } from "../lib/excelExport";
import { 
  Check, X, Eye, Upload, FileText, Image as ImageIcon, Landmark, 
  CreditCard, Calendar, Grid, List, RefreshCw, AlertCircle, 
  CheckCircle2, Copy, Search, FileSpreadsheet, Download, FileSpreadsheet as FileSpreadsheetIcon
} from "lucide-react";

interface ManagerApprovalProps {
  currentEmployee: Employee;
}

export default function ManagerApproval({ currentEmployee }: ManagerApprovalProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [activeTab, setActiveTab] = useState<"approve" | "transfer" | "history">("approve");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAdv, setSelectedAdv] = useState<Advance | null>(null);
  const [slipUrl, setSlipUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailModalAdv, setDetailModalAdv] = useState<Advance | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"info" | "docs" | "timeline">("info");
  const [advTimeline, setAdvTimeline] = useState<AuditLog[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  const handleOpenDetail = async (adv: Advance) => {
    setDetailModalAdv(adv);
    setActiveDetailTab("info");
    setLoadingTimeline(true);
    try {
      const q = query(collection(db, "auditLogs"), where("advId", "==", adv.advId));
      const snap = await getDocs(q);
      const logs: AuditLog[] = [];
      snap.forEach(d => logs.push(d.data() as AuditLog));
      logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setAdvTimeline(logs);
    } catch (err) {
      console.error("Timeline error:", err);
    } finally {
      setLoadingTimeline(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getThaiStatus = (status: AdvanceStatus | string) => {
    switch (status) {
      case AdvanceStatus.PENDING_APPROVAL:
        return "รออนุมัติ";
      case AdvanceStatus.WAITING_TRANSFER:
        return "รอโอนเงิน";
      case AdvanceStatus.WAITING_CLEARANCE:
        return "รอเคลียร์บิล";
      case AdvanceStatus.PENDING_AUDIT:
        return "รอตรวจสอบ";
      case AdvanceStatus.PARTIALLY_CLEARED:
        return "เคลียร์บางส่วน";
      case AdvanceStatus.RETURNED:
        return "บิลถูกตีกลับ";
      case AdvanceStatus.CLOSED:
        return "ปิดยอด";
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
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_TRANSFER:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_CLEARANCE:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PENDING_AUDIT:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PARTIALLY_CLEARED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.RETURNED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.CLOSED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-900 text-white border border-stone-950 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.REJECTED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-full whitespace-nowrap">{text}</span>;
      default:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-100 text-stone-600 rounded-full whitespace-nowrap">{text}</span>;
    }
  };

  // Load bank info for individual employee referenced in advance
  const [employeeBankInfos, setEmployeeBankInfos] = useState<{ [empId: string]: Employee }>({});

  const [selectedAdvIds, setSelectedAdvIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState<boolean>(false);

  // Filter advances based on the active tab and search query
  const filteredAdvances = advances.filter((adv) => {
    // Tab filter: "รายการในแถบอนุมัติ" (pending approval) vs "รายการในแถบรอโอน" (waiting transfer)
    const matchesTab = 
      activeTab === "approve"
        ? adv.status === AdvanceStatus.PENDING_APPROVAL
        : activeTab === "transfer"
        ? adv.status === AdvanceStatus.WAITING_TRANSFER
        : ![AdvanceStatus.PENDING_APPROVAL, AdvanceStatus.WAITING_TRANSFER].includes(adv.status);

    if (!matchesTab) return false;

    // Search filter: "ค้นหารายการจากชื่อคนเบิกชื่อโครงการหรือ ยอดเงินที่ขอหรือรายละเอียดได้"
    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();
      const employeeName = (adv.employeeName || "").toLowerCase();
      const projectId = (adv.projectId || "").toLowerCase();
      const details = (adv.details || "").toLowerCase();
      const requestAmountStr = adv.requestAmount ? adv.requestAmount.toString() : "";
      
      return (
        employeeName.includes(term) ||
        projectId.includes(term) ||
        details.includes(term) ||
        requestAmountStr.includes(term)
      );
    }

    return true;
  });

  // Specifically for bulk approval operations on the active tab
  const displayedPendingApprovalAdvances = filteredAdvances.filter(
    (adv) => adv.status === AdvanceStatus.PENDING_APPROVAL
  );

  const handleItemSelectToggle = (id: string) => {
    setSelectedAdvIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllToggle = () => {
    const pendingIds = displayedPendingApprovalAdvances.map((adv) => adv.id);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedAdvIds.includes(id));

    if (allSelected) {
      setSelectedAdvIds((prev) => prev.filter((id) => !pendingIds.includes(id)));
    } else {
      setSelectedAdvIds((prev) => {
        const unique = new Set([...prev, ...pendingIds]);
        return Array.from(unique);
      });
    }
  };

  const handleBulkApprove = async () => {
    const idsToApprove = selectedAdvIds.filter(id => 
      advances.find(adv => adv.id === id)?.status === AdvanceStatus.PENDING_APPROVAL
    );

    if (idsToApprove.length === 0) {
      setError("ไม่มีรายการสถานะรออนุมัติที่เลือกอยู่");
      return;
    }

    setError(null);
    setSuccess(null);
    setBulkProcessing(true);

    try {
      let count = 0;
      for (const id of idsToApprove) {
        const adv = advances.find(a => a.id === id);
        if (!adv) continue;

        const ref = doc(db, "advances", id);
        await updateDoc(ref, {
          status: AdvanceStatus.WAITING_TRANSFER,
          approvedAt: new Date().toISOString(),
          approvedBy: currentEmployee.name,
        });

        // Write Audit Log
        const auditId = `audit-${Date.now()}-${count}`;
        await setDoc(doc(db, "auditLogs", auditId), {
          id: auditId,
          advId: adv.advId,
          actionType: ActionType.APPROVE_ADVANCE,
          actionBy: currentEmployee.name,
          role: currentEmployee.role,
          timestamp: new Date().toISOString(),
          beforeStatus: AdvanceStatus.PENDING_APPROVAL,
          afterStatus: AdvanceStatus.WAITING_TRANSFER,
          note: `อนุมัติใบขอเบิกเงิน (กลุ่ม) โดยผู้จัดการ ${currentEmployee.name}`,
        } as AuditLog);

        sendLineNotification({
          triggerId: "onManagerApproval",
          variables: {
            advId: adv.advId,
            employeeName: adv.employeeName,
            amount: adv.requestAmount.toLocaleString("th-TH"),
            status: "อนุมัติแล้ว (รอโอนเงิน)",
            projectName: adv.projectId,
            category: adv.category,
            remark: adv.details || "ไม่มีรายละเอียด",
            date: new Date().toLocaleDateString("th-TH")
          },
          targetEmployeeId: adv.employeeId
        });

        count++;
      }

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`อนุมัติคำขอเบิกแบบกลุ่มรวม ${count} รายการเรียบร้อยแล้ว! สถานะเปลี่ยนเป็น "รอโอนเงิน"`);
      setSelectedAdvIds([]);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการอนุมัติแบบกลุ่ม");
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    const idsToReject = selectedAdvIds.filter(id => 
      advances.find(adv => adv.id === id)?.status === AdvanceStatus.PENDING_APPROVAL
    );

    if (idsToReject.length === 0) {
      setError("ไม่มีรายการสถานะรออนุมัติที่เลือกอยู่");
      return;
    }

    setError(null);
    setSuccess(null);
    setBulkProcessing(true);

    try {
      let count = 0;
      for (const id of idsToReject) {
        const adv = advances.find(a => a.id === id);
        if (!adv) continue;

        const ref = doc(db, "advances", id);
        await updateDoc(ref, {
          status: AdvanceStatus.REJECTED,
        });

        // Write Audit Log
        const auditId = `audit-${Date.now()}-${count}`;
        await setDoc(doc(db, "auditLogs", auditId), {
          id: auditId,
          advId: adv.advId,
          actionType: ActionType.REJECT_ADVANCE,
          actionBy: currentEmployee.name,
          role: currentEmployee.role,
          timestamp: new Date().toISOString(),
          beforeStatus: AdvanceStatus.PENDING_APPROVAL,
          afterStatus: AdvanceStatus.REJECTED,
          note: `ปฏิเสธ/ไม่อนุมัติใบขอเบิกเงิน (กลุ่ม) โดยผู้จัดการ ${currentEmployee.name}`,
        } as AuditLog);

        count++;
      }

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`ปฏิเสธคำขอเบิกแบบกลุ่มรวม ${count} รายการเรียบร้อยแล้ว`);
      setSelectedAdvIds([]);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการปฏิเสธแบบกลุ่ม");
    } finally {
      setBulkProcessing(false);
    }
  };

  useEffect(() => {
    // Listen to all advances for history and pending tabs
    const q = collection(db, "advances");

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Advance);
      });
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setAdvances(list);
      setLoading(false);

      // Fetch employee bank details for each unique employee
      const empIds = Array.from(new Set(list.map((a) => a.employeeId).filter(Boolean)));
      const bankMap: { [empId: string]: Employee } = { ...employeeBankInfos };
      for (const id of empIds) {
        if (id && !bankMap[id]) {
          try {
            const empDoc = await getDoc(doc(db, "employees", id));
            if (empDoc.exists()) {
              bankMap[id] = empDoc.data() as Employee;
              setEmployeeBankInfos({ ...bankMap });
            }
          } catch (err) {
            console.error(`Error loading employee info for ${id}:`, err);
          }
        }
      }
    }, (error) => {
      console.error("Manager snapshot loading error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleApprove = async (adv: Advance) => {
    setError(null);
    setSuccess(null);
    try {
      const ref = doc(db, "advances", adv.id);
      await updateDoc(ref, {
        status: AdvanceStatus.WAITING_TRANSFER,
        approvedAt: new Date().toISOString(),
        approvedBy: currentEmployee.name,
      });

      // Write Audit Log
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

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      sendLineNotification({
        triggerId: "onManagerApproval",
        variables: {
          advId: adv.advId,
          employeeName: adv.employeeName,
          amount: adv.requestAmount.toLocaleString("th-TH"),
          status: "อนุมัติแล้ว (รอโอนเงิน)",
          projectName: adv.projectId,
          category: adv.category,
          remark: adv.details || "ไม่มีรายละเอียด",
          date: new Date().toLocaleDateString("th-TH")
        },
        targetEmployeeId: adv.employeeId
      });

      setSuccess(`อนุมัติคำขอเบิก ${adv.advId} เรียบร้อยแล้ว! สถานะเปลี่ยนเป็น "รอโอนเงิน"`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการอนุมัติรายการ");
    }
  };

  const handleReject = async (adv: Advance) => {
    setError(null);
    setSuccess(null);
    try {
      const ref = doc(db, "advances", adv.id);
      await updateDoc(ref, {
        status: AdvanceStatus.REJECTED,
      });

      // Write Audit Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: adv.advId,
        actionType: ActionType.REJECT_ADVANCE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: AdvanceStatus.PENDING_APPROVAL,
        afterStatus: AdvanceStatus.REJECTED,
        note: `ปฏิเสธ/ไม่อนุมัติใบขอเบิกเงิน โดยผู้จัดการ ${currentEmployee.name}`,
      } as AuditLog);

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`ปฏิเสธคำขอเบิก ${adv.advId} เรียบร้อยแล้ว`);
      setSelectedAdv(null);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการทำรายการ");
    }
  };

  const handleUploadSlip = async (adv: Advance) => {
    if (!slipUrl.trim()) {
      setError("กรุณากรอก URL สลิปโอนเงินประกอบรายการ");
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      const ref = doc(db, "advances", adv.id);
      await updateDoc(ref, {
        status: AdvanceStatus.WAITING_CLEARANCE,
        transferSlipUrl: slipUrl,
        transferredAt: new Date().toISOString(),
      });

      // Write Audit Log
      const auditId = `audit-${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        advId: adv.advId,
        actionType: ActionType.UPLOAD_TRANSFER_SLIP,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: AdvanceStatus.WAITING_TRANSFER,
        afterStatus: AdvanceStatus.WAITING_CLEARANCE,
        note: `อัปโหลดสลิปและโอนเงินเสร็จสิ้น จำนวนเงิน ${adv.requestAmount} บาท`,
        relatedFileUrl: slipUrl,
      } as AuditLog);

      // Save to VaultFiles
      const vaultId = `file-${Date.now()}`;
      await setDoc(doc(db, "vaultFiles", vaultId), {
        id: vaultId,
        advId: adv.advId,
        fileType: "SLIP",
        fileUrl: slipUrl,
        fileName: `สลิปโอนเงิน-${adv.advId}.jpg`,
        uploadedBy: currentEmployee.name,
        uploadedAt: new Date().toISOString(),
      });

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`อัปโหลดหลักฐานการโอนเงิน ${adv.advId} สำเร็จแล้ว! สถานะเปลี่ยนเป็น "รอเคลียร์"`);
      setSelectedAdv(null);
      setSlipUrl("");
    } catch (err) {
      console.error("Upload Error:", err);
      setError(`เกิดข้อผิดพลาดในการอัปโหลดเอกสาร: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(val);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="manager_approval_tab">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900">การอนุมัติและการโอนเงินสำหรับผู้บริหาร</h2>
          <p className="text-xs text-stone-500">ตรวจสอบสิทธิ์ อนุมัติยอดเงินเบิก และกรอกสลิปหลักฐานการโอนเงินเข้าบัญชีพนักงาน</p>
        </div>

        {/* View toggles & Export */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const dataToExport = advances.map(adv => ({
                "เลขที่ใบเบิก": adv.advId,
                "ผู้เบิก": adv.employeeName,
                "โครงการ": adv.projectId,
                "ยอดเงินขอยืม": adv.requestAmount,
                "วันที่ต้องการ": adv.neededDate,
                "สถานะ": adv.status
              }));
              exportToExcel(dataToExport, "Manager_Approvals");
            }}
            className="px-3 py-1.5 bg-white border border-stone-200 text-emerald-700 hover:bg-emerald-50 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
            title="ส่งออกรายการทั้งหมดเป็น Excel"
          >
            <Download className="w-3.5 h-3.5" /> <span>Excel</span>
          </button>

          <div className="flex bg-stone-100 border border-stone-200 rounded-lg p-0.5 self-start sm:self-auto shrink-0">
            <button
              onClick={() => setViewMode("card")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                viewMode === "card" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              <Grid className="w-3.5 h-3.5" /> การ์ด
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                viewMode === "table" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              <List className="w-3.5 h-3.5" /> ตาราง
            </button>
          </div>
        </div>
      </div>

      {/* สองแถบรายการ (อนุมัติ vs รอโอน) พร้อมช่องค้นหารายละเอียดสูง */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* สองแถบตัวกรองสถานะ */}
        <div className="flex bg-stone-100 p-1 rounded-xl gap-1 shrink-0 self-start md:self-auto">
          <button
            onClick={() => {
              setActiveTab("approve");
              setSelectedAdvIds([]); // รีเซ็ตการเลือกกลุ่มเมื่อสลับแท็บ
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "approve"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-500 hover:text-stone-800 hover:bg-stone-50"
            }`}
          >
            <span>แถบรายการรออนุมัติ</span>
            <span className={`px-2 py-0.5 text-[10px] rounded-md font-mono font-bold ${
              activeTab === "approve" ? "bg-stone-800 text-amber-300" : "bg-stone-200 text-stone-700"
            }`}>
              {advances.filter(adv => adv.status === AdvanceStatus.PENDING_APPROVAL).length}
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab("transfer");
              setSelectedAdvIds([]); // รีเซ็ตการเลือกกลุ่มเมื่อสลับแท็บ
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "transfer"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-500 hover:text-stone-800 hover:bg-stone-50"
            }`}
          >
            <span>แถบรายการรอโอนเงิน</span>
            <span className={`px-2 py-0.5 text-[10px] rounded-md font-mono font-bold ${
              activeTab === "transfer" ? "bg-stone-800 text-blue-350" : "bg-stone-200 text-stone-700"
            }`}>
              {advances.filter(adv => adv.status === AdvanceStatus.WAITING_TRANSFER).length}
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab("history");
              setSelectedAdvIds([]); // รีเซ็ตการเลือกกลุ่มเมื่อสลับแท็บ
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "history"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-500 hover:text-stone-800 hover:bg-stone-50"
            }`}
          >
            <span>แถบประวัติรายการ</span>
            <span className={`px-2 py-0.5 text-[10px] rounded-md font-mono font-bold ${
              activeTab === "history" ? "bg-stone-800 text-emerald-300" : "bg-stone-200 text-stone-700"
            }`}>
              {advances.filter(adv => ![AdvanceStatus.PENDING_APPROVAL, AdvanceStatus.WAITING_TRANSFER].includes(adv.status)).length}
            </span>
          </button>
        </div>

        {/* ช่องค้นหารายละเอียด: ชื่อคนเบิก, ชื่อโครงการ, ยอดเงิน หรือรายละเอียด */}
        <div className="relative flex-1 max-w-md w-full">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="ค้นหาจาก ชื่อคนเบิก, ชื่อโครงการ, ยอดเงิน หรือรายละเอียด..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 text-stone-800 font-medium"
          />
        </div>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          {success}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          {error}
        </div>
      )}

      {/* Bulk actions selection control bar */}
      {!loading && activeTab === "approve" && displayedPendingApprovalAdvances.length > 0 && (
        <div className="flex items-center justify-between bg-stone-50 border border-stone-200/60 rounded-xl px-4 py-2.5 text-xs text-stone-600">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="select_all_pending"
              checked={displayedPendingApprovalAdvances.length > 0 && displayedPendingApprovalAdvances.every(adv => selectedAdvIds.includes(adv.id))}
              onChange={handleSelectAllToggle}
              className="rounded border-stone-300 text-stone-900 focus:ring-stone-950 w-4 h-4 cursor-pointer"
            />
            <label htmlFor="select_all_pending" className="font-semibold cursor-pointer select-none">
              เลือกทั้งหมดที่รออนุมัติ ({displayedPendingApprovalAdvances.length} รายการ)
            </label>
          </div>
          <span className="text-[10px] text-stone-400 font-medium hidden sm:inline">
            (ใช้สำหรับอนุมัติหรือปฏิเสธแบบกลุ่มพร้อมกัน)
          </span>
        </div>
      )}

      {/* Bulk actions execution ribbon */}
      {selectedAdvIds.length > 0 && (
        <div className="p-4 bg-stone-900 text-white rounded-xl shadow-md flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in" id="bulk_actions_ribbon">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
            <span className="bg-stone-800 px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-stone-300 border border-stone-700 inline-block text-center whitespace-nowrap">
              เลือกอยู่ {selectedAdvIds.length} รายการ
            </span>
            <p className="text-xs text-stone-300 text-center sm:text-left">
              เฉพาะคำขอที่เลือกซึ่งมีสถานะ "รออนุมัติ" เท่านั้นที่จะดำเนินขั้นตอนแบบกลุ่ม
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleBulkApprove}
              disabled={bulkProcessing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" /> อนุมัติกลุ่ม ({selectedAdvIds.filter(id => advances.find(a => a.id === id)?.status === AdvanceStatus.PENDING_APPROVAL).length})
            </button>
            <button
              onClick={handleBulkReject}
              disabled={bulkProcessing}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm"
            >
              <X className="w-3.5 h-3.5" /> ปฏิเสธกลุ่ม ({selectedAdvIds.filter(id => advances.find(a => a.id === id)?.status === AdvanceStatus.PENDING_APPROVAL).length})
            </button>
            <button
              onClick={() => setSelectedAdvIds([])}
              className="px-3 py-2 text-stone-400 hover:text-white text-xs transition font-semibold"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-stone-500">กำลังโหลดรายการรอพิจารณา...</div>
      ) : filteredAdvances.length === 0 ? (
        <div className="text-center py-20 bg-white border border-stone-200 rounded-2xl text-stone-500">
          <FileText className="w-10 h-10 mx-auto text-stone-300 mb-2" />
          <p className="text-sm">ไม่มีคำขอที่ตรงตามเงื่อนไขในแท็บนี้</p>
        </div>
      ) : viewMode === "card" ? (
        /* Card Layout View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAdvances.map((adv) => {
            const bankDetails = employeeBankInfos[adv.employeeId] || {
              bankName: "กำลังดึงข้อมูล...",
              bankNo: "-",
              bankAccountName: "-",
            };

            return (
              <div
                key={adv.id}
                className="bg-white border border-stone-200 hover:border-stone-400 rounded-2xl shadow-sm p-6 flex flex-col justify-between gap-5 transition-all duration-200"
              >
                {/* Upper header details */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {adv.status === AdvanceStatus.PENDING_APPROVAL && (
                        <input
                          type="checkbox"
                          checked={selectedAdvIds.includes(adv.id)}
                          onChange={() => handleItemSelectToggle(adv.id)}
                          className="rounded border-stone-300 text-stone-900 focus:ring-stone-950 w-4 h-4 cursor-pointer"
                        />
                      )}
                      <span className="font-mono text-xs font-bold text-stone-900 bg-stone-100 border border-stone-200 px-2 py-1 rounded">
                        {adv.advId}
                      </span>
                    </div>
                    {getStatusBadge(adv.status)}
                  </div>

                  <div>
                    <h3 className="font-bold text-stone-900 text-sm truncate">{adv.projectId}</h3>
                    <p className="text-[11px] text-stone-400 uppercase tracking-wider">{adv.category}</p>
                  </div>

                  <p className="text-[18px] font-normal font-['Noto_Sans_Thai'] bg-[#f6f9ff] text-[#000000] line-clamp-3 leading-normal h-[100px] p-2.5 rounded-xl border border-stone-200/50">{adv.details}</p>

                  {/* Financial stats */}
                  <div className="bg-stone-50 border border-stone-200/60 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-stone-400 text-[10px] block font-semibold uppercase">จำนวนเงินขอเบิก</span>
                      <span className="font-mono font-bold text-stone-900 text-sm">
                        {formatCurrency(adv.requestAmount)}
                      </span>
                    </div>
                    <div>
                      <span className="text-stone-400 text-[10px] block font-semibold uppercase">ผู้ขอเบิกเงิน</span>
                      <span className="font-semibold text-stone-800 text-xs block truncate">
                        {adv.employeeName}
                      </span>
                    </div>
                  </div>

                  {/* Bank detail layout (Visible only when WAITING_TRANSFER or inside detailed view) */}
                  <div className="border-t border-stone-100 pt-3 space-y-1.5 text-xs text-stone-600">
                    <p className="font-semibold text-stone-700 flex items-center gap-1">
                      <Landmark className="w-3.5 h-3.5 text-stone-500" /> ข้อมูลบัญชีสำหรับโอนเงิน:
                    </p>
                    <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/50 space-y-0.5 font-mono text-[10px]">
                      <div>ธนาคาร: {bankDetails.bankName}</div>
                      <div className="font-bold flex items-center justify-between gap-1">
                        <span>เลขบัญชี: {bankDetails.bankNo}</span>
                        {bankDetails.bankNo && bankDetails.bankNo !== "-" && (
                          <button
                            type="button"
                            onClick={() => handleCopyText(bankDetails.bankNo, adv.id)}
                            className="text-stone-400 hover:text-stone-900 transition p-1 hover:bg-stone-200 rounded flex items-center gap-0.5 font-sans font-bold text-[9px]"
                            title="คัดลอกเลขบัญชี"
                          >
                            {copiedId === adv.id ? (
                              <span className="text-emerald-600 flex items-center gap-0.5">
                                <Check className="w-2.5 h-2.5" /> คัดลอกแล้ว
                              </span>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5 text-stone-500" /> คัดลอก
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div>ชื่อบัญชี: {bankDetails.bankAccountName}</div>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleOpenDetail(adv)}
                    className="w-full py-2 bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" /> รายละเอียดคำขอ
                  </button>
                  <div className="flex gap-2">
                    {adv.status === AdvanceStatus.PENDING_APPROVAL ? (
                      <>
                        <button
                          onClick={() => handleApprove(adv)}
                          className="flex-1 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" /> อนุมัติ
                        </button>
                        <button
                          onClick={() => handleReject(adv)}
                          className="py-2 px-3 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-xs rounded-xl transition flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5" /> ปฏิเสธ
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setSelectedAdv(adv)}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" /> แนบหลักฐานสลิปโอนเงิน
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table Layout View */
        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                <th className="py-3 px-4 w-12 text-center">
                  {activeTab === "approve" && (
                    <input
                      type="checkbox"
                      checked={displayedPendingApprovalAdvances.length > 0 && displayedPendingApprovalAdvances.every(adv => selectedAdvIds.includes(adv.id))}
                      onChange={handleSelectAllToggle}
                      className="rounded border-stone-300 text-stone-900 focus:ring-stone-950 w-4 h-4 cursor-pointer"
                    />
                  )}
                </th>
                <th className="py-3 px-4">เลขที่เอกสาร</th>
                <th className="py-3 px-4">ผู้ขอเบิก</th>
                <th className="py-3 px-4">โครงการ / รายละเอียด</th>
                <th className="py-3 px-4">ข้อมูลบัญชี</th>
                <th className="py-3 px-4 text-right">ยอดเบิก</th>
                <th className="py-3 px-4">สถานะ</th>
                <th className="py-3 px-4 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredAdvances.map((adv) => {
                const bankDetails = employeeBankInfos[adv.employeeId] || {
                  bankName: "-",
                  bankNo: "-",
                  bankAccountName: "-",
                };

                return (
                  <tr key={adv.id} className="hover:bg-stone-50/50">
                    <td className="py-4 px-4 w-12 text-center">
                      {adv.status === AdvanceStatus.PENDING_APPROVAL ? (
                        <input
                          type="checkbox"
                          checked={selectedAdvIds.includes(adv.id)}
                          onChange={() => handleItemSelectToggle(adv.id)}
                          className="rounded border-stone-300 text-stone-900 focus:ring-stone-950 w-4 h-4 cursor-pointer"
                        />
                      ) : (
                        <span className="text-stone-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4 font-mono font-bold text-stone-900">{adv.advId}</td>
                    <td className="py-4 px-4">{adv.employeeName}</td>
                    <td className="py-4 px-4 max-w-xs">
                      <div className="font-semibold text-stone-900 truncate">{adv.projectId}</div>
                      <div className="text-xs text-stone-500 truncate">{adv.details}</div>
                    </td>
                    <td className="py-4 px-4 text-xs">
                      <div className="font-mono">{bankDetails.bankName}</div>
                      <div className="font-mono font-bold">{bankDetails.bankNo}</div>
                    </td>
                    <td className="py-4 px-4 text-right font-mono font-bold text-stone-900">
                      {formatCurrency(adv.requestAmount)}
                    </td>
                    <td className="py-4 px-4">
                      {getStatusBadge(adv.status)}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenDetail(adv)}
                          className="p-1.5 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-lg transition"
                          title="ดูรายละเอียด"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {adv.status === AdvanceStatus.PENDING_APPROVAL ? (
                          <>
                            <button
                              onClick={() => handleApprove(adv)}
                              className="p-1.5 bg-stone-950 text-white hover:bg-stone-850 rounded-lg transition"
                              title="อนุมัติ"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleReject(adv)}
                              className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg transition"
                              title="ปฏิเสธ"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setSelectedAdv(adv)}
                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                          >
                            <Upload className="w-3 h-3" /> สลิป
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Comprehensive Detail View Modal with Tabs */}
      {detailModalAdv && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center p-0 z-50 overflow-y-auto sm:p-4">
          <div className="bg-white border border-stone-200 rounded-none sm:rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl animate-scale-in min-h-screen sm:min-h-0 flex flex-col">
            <div className="bg-stone-950 text-stone-100 p-6 flex items-center justify-between sticky top-0 z-10">
              <div>
                <h3 className="font-bold text-white text-base">รายละเอียดใบเบิกเงิน {detailModalAdv.advId}</h3>
                <p className="text-[10px] text-stone-400 font-mono">{detailModalAdv.projectId}</p>
              </div>
              <button onClick={() => setDetailModalAdv(null)} className="text-stone-400 hover:text-white p-2">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-stone-200 bg-white sticky top-[80px] sm:top-0 z-10">
              <button
                onClick={() => setActiveDetailTab("info")}
                className={`flex-1 py-3 text-xs font-bold transition-all border-b-2 ${
                  activeDetailTab === "info" ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400"
                }`}
              >
                ข้อมูลทั่วไป
              </button>
              <button
                onClick={() => setActiveDetailTab("docs")}
                className={`flex-1 py-3 text-xs font-bold transition-all border-b-2 ${
                  activeDetailTab === "docs" ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400"
                }`}
              >
                หลักฐาน/เอกสาร
              </button>
              <button
                onClick={() => setActiveDetailTab("timeline")}
                className={`flex-1 py-3 text-xs font-bold transition-all border-b-2 ${
                  activeDetailTab === "timeline" ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400"
                }`}
              >
                ประวัติสถานะ
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto max-h-[60vh] sm:max-h-[500px]">
              {activeDetailTab === "info" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-stone-400 uppercase">ผู้ขอเบิก</span>
                      <p className="text-sm font-bold text-stone-900">{detailModalAdv.employeeName}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-stone-400 uppercase">วันที่สร้าง</span>
                      <p className="text-sm font-bold text-stone-900">{detailModalAdv.createdAt.split("T")[0]}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-stone-400 uppercase">หมวดหมู่</span>
                      <p className="text-sm font-bold text-stone-900">{detailModalAdv.category}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-stone-400 uppercase">ยอดเงิน</span>
                      <p className="text-base font-mono font-bold text-stone-900">{formatCurrency(detailModalAdv.requestAmount)}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-stone-400 uppercase">โครงการ</span>
                    <p className="text-sm font-bold text-stone-900">{detailModalAdv.projectId}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-stone-400 uppercase">รายละเอียด</span>
                    <p className="text-sm text-stone-600 bg-stone-50 p-3 rounded-xl border border-stone-100 italic leading-relaxed">
                      "{detailModalAdv.details}"
                    </p>
                  </div>

                  {/* Bank Info Section */}
                  <div className="pt-4 border-t border-stone-100">
                    <h4 className="text-xs font-bold text-stone-900 mb-3 flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-stone-500" /> ข้อมูลบัญชีธนาคาร
                    </h4>
                    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-stone-400 font-bold">ธนาคาร:</span>
                        <span className="font-bold text-stone-900">{employeeBankInfos[detailModalAdv.employeeId]?.bankName || "-"}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-stone-400 font-bold">ชื่อบัญชี:</span>
                        <span className="font-bold text-stone-900">{employeeBankInfos[detailModalAdv.employeeId]?.bankAccountName || "-"}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-stone-400 font-bold">เลขบัญชี:</span>
                        <span className="font-mono font-bold text-stone-900">{employeeBankInfos[detailModalAdv.employeeId]?.bankNo || "-"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeDetailTab === "docs" && (
                <div className="space-y-6">
                  {detailModalAdv.attachmentUrl ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-stone-900">เอกสารประกอบการเบิก:</p>
                      <img
                        src={detailModalAdv.attachmentUrl}
                        alt="Attachment"
                        className="w-full rounded-2xl border border-stone-200 shadow-sm"
                      />
                    </div>
                  ) : (
                    <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center gap-2">
                      <ImageIcon className="w-8 h-8 text-stone-200" />
                      ไม่มีเอกสารแนบประกอบ
                    </div>
                  )}

                  {detailModalAdv.transferSlipUrl && (
                    <div className="pt-6 border-t border-stone-100 space-y-3">
                      <p className="text-xs font-bold text-stone-900">หลักฐานการโอนเงิน (Slip):</p>
                      <img
                        src={detailModalAdv.transferSlipUrl}
                        alt="Transfer Slip"
                        className="w-full rounded-2xl border border-stone-200 shadow-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              {activeDetailTab === "timeline" && (
                <div className="space-y-4">
                  {loadingTimeline ? (
                    <div className="py-10 text-center text-xs text-stone-400">กำลังโหลดประวัติ...</div>
                  ) : advTimeline.length === 0 ? (
                    <div className="py-10 text-center text-xs text-stone-400">ไม่พบประวัติการทำรายการ</div>
                  ) : (
                    <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-stone-200">
                      {advTimeline.map((log, idx) => (
                        <div key={idx} className="relative pl-8 space-y-1">
                          <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm ${
                            idx === 0 ? "bg-stone-900 scale-125 z-10" : "bg-stone-200"
                          }`} />
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-stone-900">{log.actionType}</p>
                            <span className="text-[10px] font-mono text-stone-400">{log.timestamp.split("T")[0]} {log.timestamp.split("T")[1].substring(0, 5)}</span>
                          </div>
                          <p className="text-[11px] text-stone-500 leading-relaxed">{log.note}</p>
                          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">โดย: {log.actionBy} ({log.role})</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-stone-100 bg-stone-50 flex gap-3 mt-auto sticky bottom-0">
              {detailModalAdv.status === AdvanceStatus.PENDING_APPROVAL ? (
                <>
                  <button
                    onClick={() => { handleReject(detailModalAdv); setDetailModalAdv(null); }}
                    className="flex-1 py-3 bg-white border border-red-200 text-red-600 font-bold text-xs rounded-2xl transition"
                  >
                    ไม่อนุมัติ
                  </button>
                  <button
                    onClick={() => { handleApprove(detailModalAdv); setDetailModalAdv(null); }}
                    className="flex-1 py-3 bg-stone-900 text-white font-bold text-xs rounded-2xl transition"
                  >
                    อนุมัติรายการ
                  </button>
                </>
              ) : detailModalAdv.status === AdvanceStatus.WAITING_TRANSFER ? (
                <button
                  onClick={() => { setSelectedAdv(detailModalAdv); setDetailModalAdv(null); }}
                  className="w-full py-3 bg-blue-600 text-white font-bold text-xs rounded-2xl transition"
                >
                  อัปโหลดหลักฐานการโอน (Slip)
                </button>
              ) : (
                <button
                  onClick={() => setDetailModalAdv(null)}
                  className="w-full py-3 bg-stone-100 text-stone-600 font-bold text-xs rounded-2xl transition"
                >
                  ปิดหน้าต่าง
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slip upload interactive modal dialogue */}
      {selectedAdv && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 z-50 overflow-y-auto md:items-center">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full overflow-hidden shadow-xl animate-scale-in my-8 md:my-auto">
            <div className="bg-stone-950 text-stone-100 p-6 flex items-center justify-between">
              <h3 className="font-bold text-white text-base">บันทึกสลิปโอนเงินประกอบคำขอ {selectedAdv.advId}</h3>
              <button onClick={() => setSelectedAdv(null)} className="text-stone-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-stone-600">
                เมื่อโอนเงินสดสำเร็จแล้ว กรุณากรอก URL หลักฐานหรืออัปโหลดรูปภาพสลิปเพื่อยืนยันการโอนเงินสด ยอดโอน:{" "}
                <span className="font-bold text-stone-900">{formatCurrency(selectedAdv.requestAmount)}</span>
              </p>

              {/* Bank Transfer Guide Info */}
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 text-xs space-y-1 relative">
                <p className="font-bold text-stone-700">บัญชีปลายทางพนักงาน:</p>
                <p>ธนาคาร: {employeeBankInfos[selectedAdv.employeeId]?.bankName || "-"}</p>
                <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-xl border border-stone-100 mt-1">
                  <div>
                    <span className="text-[10px] text-stone-400 block font-semibold uppercase">เลขบัญชี</span>
                    <span className="font-mono text-sm font-semibold text-stone-900">
                      {employeeBankInfos[selectedAdv.employeeId]?.bankNo || "-"}
                    </span>
                  </div>
                  {employeeBankInfos[selectedAdv.employeeId]?.bankNo && employeeBankInfos[selectedAdv.employeeId]?.bankNo !== "-" && (
                    <button
                      type="button"
                      onClick={() => handleCopyText(employeeBankInfos[selectedAdv.employeeId]!.bankNo, "modal-copy")}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-[10px] font-bold transition flex items-center gap-1 shadow-sm"
                    >
                      {copiedId === "modal-copy" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" /> คัดลอกสำเร็จ
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-stone-500" /> คัดลอกเลขบัญชี
                        </>
                      )}
                    </button>
                  )}
                </div>
                <p className="mt-1">ชื่อบัญชี: {employeeBankInfos[selectedAdv.employeeId]?.bankAccountName || "-"}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                  หลักฐานการชำระเงิน / รูปภาพสลิปโอนเงิน (Attached Bank Slip) *แนบรูปโดยตรง*
                </label>
                
                {slipUrl ? (
                  <div className="relative border border-stone-200 rounded-2xl p-4 bg-stone-50 flex flex-col items-center justify-center">
                    <img
                      src={slipUrl}
                      alt="Selected Slip"
                      className="max-h-48 object-contain rounded-xl border border-stone-200 shadow-sm"
                    />
                    <div className="flex items-center gap-2 mt-3 w-full">
                      <button
                        type="button"
                        onClick={() => setSlipUrl("")}
                        className="flex-1 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> ลบรูปภาพที่แนบ
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-stone-200 hover:border-stone-400 bg-stone-50/50 rounded-2xl p-6 transition flex flex-col items-center justify-center text-center relative group cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            if (typeof reader.result === "string") {
                              const img = document.createElement('img');
                              img.onload = () => {
                                const canvas = document.createElement('canvas');
                                const MAX_WIDTH = 400; // Reduced from 800
                                const MAX_HEIGHT = 400; // Reduced from 800
                                let width = img.width;
                                let height = img.height;

                                if (width > height) {
                                  if (width > MAX_WIDTH) {
                                    height *= MAX_WIDTH / width;
                                    width = MAX_WIDTH;
                                  }
                                } else {
                                  if (height > MAX_HEIGHT) {
                                    width *= MAX_HEIGHT / height;
                                    height = MAX_HEIGHT;
                                  }
                                }
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                ctx?.drawImage(img, 0, 0, width, height);
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.4); // Reduced quality from 0.7 to 0.4
                                setSlipUrl(dataUrl);
                              };
                              img.src = reader.result;
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="w-8 h-8 text-stone-400 group-hover:text-stone-600 mb-2 transition" />
                    <p className="text-xs font-bold text-stone-700">คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่</p>
                    <p className="text-[10px] text-stone-400 mt-1">รองรับไฟล์รูปภาพสลิปโอนเงิน (PNG, JPG)</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end gap-2">
              <button
                onClick={() => setSelectedAdv(null)}
                className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-bold transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleUploadSlip(selectedAdv)}
                className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> บันทึกและแจ้งโอน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
