import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, query, where, getDocs, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Advance, ClearingItem, Employee, AdvanceStatus } from "../types";
import { 
  FileText, CheckSquare, Square, Table, LayoutGrid, Search, 
  Check, Eye, RefreshCw, AlertCircle, Calendar, User, DollarSign,
  FileCheck, ShieldAlert, Download
} from "lucide-react";
import { exportToExcel } from "../lib/excelExport";

interface OriginalDocTrackingProps {
  currentEmployee: Employee;
}

export default function OriginalDocTracking({ currentEmployee }: OriginalDocTrackingProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [clearingItems, setClearingItems] = useState<ClearingItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Controls
  const [viewMode, setViewMode] = useState<"card" | "table">("table");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "COMPLETED">("ALL");
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  useEffect(() => {
    // 1. Fetch Advances
    const unsubAdvances = onSnapshot(collection(db, "advances"), (snap) => {
      const list: Advance[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Advance));
      setAdvances(list);
    }, (err) => {
      console.error("Error in onSnapshot on advances inside OriginalDocTracking:", err);
    });

    // 2. Fetch Clearing Items
    const unsubItems = onSnapshot(collection(db, "clearingItems"), (snap) => {
      const list: ClearingItem[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ClearingItem));
      setClearingItems(list);
      setLoading(false);
    }, (err) => {
      console.error("Error in onSnapshot on clearingItems inside OriginalDocTracking:", err);
      setLoading(false);
    });

    // 3. Fetch Employees (to map names/departments if needed)
    const unsubEmployees = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
    }, (err) => {
      console.error("Error in onSnapshot on employees inside OriginalDocTracking:", err);
    });

    return () => {
      unsubAdvances();
      unsubItems();
      unsubEmployees();
    };
  }, []);

  // Update check status of the physical original document in Firestore
  const handleToggleOriginalReceived = async (itemId: string, currentStatus: boolean) => {
    setUpdatingItemId(itemId);
    try {
      const itemRef = doc(db, "clearingItems", itemId);
      const isNowReceived = !currentStatus;
      
      await updateDoc(itemRef, {
        originalDocReceived: isNowReceived,
        originalDocReceivedAt: isNowReceived ? new Date().toISOString() : null,
        originalDocReceivedBy: isNowReceived ? currentEmployee.name : null
      });

      // Check if all items in this advance are now received
      const item = clearingItems.find(i => i.id === itemId);
      if (item && isNowReceived) {
        const siblingItems = clearingItems.filter(i => i.advId === item.advId);
        // Map the updated status into the local calculation
        const allReceived = siblingItems.every(i => i.id === itemId ? true : i.originalDocReceived);
        
        if (allReceived) {
          const parentAdv = advances.find(a => a.advId === item.advId);
          if (parentAdv && parentAdv.status === AdvanceStatus.WAITING_ORIGINAL_DOC) {
            const advRef = doc(db, "advances", parentAdv.id);
            await updateDoc(advRef, {
              status: AdvanceStatus.CLOSED,
              closedAt: new Date().toISOString()
            });

            // Save Settlement Summary to vault
            const vaultId = `file-${Date.now()}-settle`;
            await setDoc(doc(db, "vaultFiles", vaultId), {
              id: vaultId,
              advId: parentAdv.advId,
              fileType: "SETTLEMENT",
              fileUrl: "https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=600",
              fileName: `settlement-summary-final-${parentAdv.advId}.txt`,
              uploadedBy: "SYSTEM",
              uploadedAt: new Date().toISOString(),
            });

            // Write Audit Log
            const auditId = `audit-${Date.now()}`;
            await setDoc(doc(db, "auditLogs", auditId), {
              id: auditId,
              advId: parentAdv.advId,
              actionType: "CLOSE_ACCOUNT",
              actionBy: "SYSTEM",
              role: "System (Original Doc Verified)",
              timestamp: new Date().toISOString(),
              beforeStatus: parentAdv.status,
              afterStatus: AdvanceStatus.CLOSED,
              note: `ปิดบัญชีอัตโนมัติเนื่องจากได้รับเอกสารตัวจริงครบถ้วนสำหรับใบเบิก ${parentAdv.advId}`
            });
          }
        }
      }
    } catch (error) {
      console.error("Error updating original document status:", error);
    } finally {
      setUpdatingItemId(null);
    }
  };

  // Group clearing items by Advance ID (advId)
  const getGroupedData = () => {
    // Filter items first
    let filteredItems = clearingItems;

    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();
      filteredItems = clearingItems.filter(
        (item) =>
          item.advId.toLowerCase().includes(term) ||
          item.vendorName.toLowerCase().includes(term) ||
          (item.invoiceNo && item.invoiceNo.toLowerCase().includes(term)) ||
          item.itemName.toLowerCase().includes(term)
      );
    }

    // Group items by advId
    const groups: { [advId: string]: ClearingItem[] } = {};
    filteredItems.forEach((item) => {
      if (!groups[item.advId]) {
        groups[item.advId] = [];
      }
      groups[item.advId].push(item);
    });

    // Build the final array matching group properties
    const result = Object.keys(groups).map((advId) => {
      const parentAdv = advances.find((a) => a.advId === advId);
      const items = groups[advId];
      const totalItemsCount = items.length;
      const receivedCount = items.filter((i) => i.originalDocReceived).length;
      const isGroupCompleted = receivedCount === totalItemsCount && totalItemsCount > 0;

      return {
        advId,
        advance: parentAdv,
        items,
        totalItemsCount,
        receivedCount,
        isGroupCompleted,
      };
    });

    // Apply status filter on groups
    if (statusFilter === "PENDING") {
      return result.filter((g) => !g.isGroupCompleted);
    } else if (statusFilter === "COMPLETED") {
      return result.filter((g) => g.isGroupCompleted);
    }

    return result;
  };

  const groupedData = getGroupedData();

  // Simple statistics
  const totalClearanceDocs = clearingItems.length;
  const totalOriginalDocsReceived = clearingItems.filter((i) => i.originalDocReceived).length;
  const receivedPercentage = totalClearanceDocs > 0 
    ? Math.round((totalOriginalDocsReceived / totalClearanceDocs) * 100) 
    : 0;

  return (
    <div className="space-y-6" id="original_doc_tracking_tab">
      {/* Tab Header Banner */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-stone-900 text-stone-50 rounded-lg">
                <FileCheck className="w-5 h-5" />
              </span>
              <h2 className="font-extrabold text-stone-950 text-lg tracking-tight">
                Original Document Tracking (ติดตามเอกสารตัวจริง)
              </h2>
            </div>
            <p className="text-xs text-stone-500 mt-1 font-medium">
              ตรวจสอบความครบถ้วนของเอกสารตัวจริงทางกายภาพ (เช่น ใบกำกับภาษีต้นฉบับ ใบเสร็จรับเงิน) เพื่อใช้ยืนยันในการปิดบัญชี
            </p>
          </div>
          
          {/* Quick stats badges */}
          <div className="flex items-center gap-3">
            <div className="bg-stone-50 border border-stone-150 rounded-xl px-4 py-2 text-right">
              <span className="text-[10px] font-extrabold text-stone-400 uppercase font-mono">รับตัวจริงแล้ว</span>
              <p className="text-sm font-black text-stone-900 mt-0.5">
                {totalOriginalDocsReceived} / {totalClearanceDocs} ใบ
              </p>
            </div>
            <div className="bg-stone-950 text-white rounded-xl px-4 py-2 text-right">
              <span className="text-[10px] font-extrabold text-stone-400 uppercase font-mono">ความคืบหน้า</span>
              <p className="text-sm font-black text-amber-400 mt-0.5">
                {receivedPercentage}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls & Filters Panel */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="ค้นหาเลขรายการเบิก, ผู้รับเงิน, ชื่องานเบิก..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 text-stone-800 font-medium"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 self-stretch md:self-auto overflow-x-auto whitespace-nowrap">
          {/* Status buttons */}
          <div className="bg-stone-100 rounded-xl p-1 flex gap-1">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-all ${
                statusFilter === "ALL"
                  ? "bg-white text-stone-950 shadow-xs"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              ทั้งหมด
            </button>
            <button
              onClick={() => setStatusFilter("PENDING")}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-all ${
                statusFilter === "PENDING"
                  ? "bg-amber-50 text-amber-700 shadow-xs"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              ยังไม่ครบ
            </button>
            <button
              onClick={() => setStatusFilter("COMPLETED")}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-all ${
                statusFilter === "COMPLETED"
                  ? "bg-emerald-50 text-emerald-700 shadow-xs"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              ครบถ้วนแล้ว
            </button>
          </div>

          <div className="w-px h-6 bg-stone-200 hidden md:block" />

          {/* View toggle */}
          <div className="bg-stone-100 rounded-xl p-1 flex gap-1">
            <button
              onClick={() => {
                const dataToExport = groupedData.flatMap(g => g.items.map(item => ({
                  "เลขที่รายการเบิก": item.advId,
                  "เลขใบเคลียร์": item.invoiceNo || "-",
                  "ร้านค้า/ผู้รับเงิน": item.vendorName || "-",
                  "รายการ": item.itemName || "-",
                  "ประเภทเอกสาร": item.documentType || "RECEIPT",
                  "จำนวนเงิน (สุทธิ)": item.netAmount || 0,
                  "วันที่ได้รับในระบบ": item.createdAt ? new Date(item.createdAt).toLocaleDateString("th-TH") : "-",
                  "ได้รับเอกสารตัวจริง": item.originalDocReceived ? "ได้รับแล้ว" : "ยังไม่ได้รับ",
                  "วันที่ได้รับตัวจริง": item.originalDocReceivedAt ? new Date(item.originalDocReceivedAt).toLocaleDateString("th-TH") : "-",
                  "ผู้ตรวจรับตัวจริง": item.originalDocReceivedBy || "-"
                })));
                exportToExcel(dataToExport, "Original_Doc_Tracking");
              }}
              className="p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 hover:bg-white transition-all"
              title="ส่งออกไฟล์ Excel"
            >
              <Download className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-stone-200 self-center mx-0.5" />
            <button
              onClick={() => setViewMode("card")}
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === "card" ? "bg-white text-stone-950 shadow-xs" : "text-stone-400 hover:text-stone-700"
              }`}
              title="แสดงแบบการ์ด"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === "table" ? "bg-white text-stone-950 shadow-xs" : "text-stone-400 hover:text-stone-700"
              }`}
              title="แสดงแบบตาราง"
            >
              <Table className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center shadow-xs">
          <RefreshCw className="w-8 h-8 text-stone-400 animate-spin mx-auto" />
          <p className="text-xs text-stone-500 mt-3 font-semibold">กำลังดึงข้อมูลใบเสร็จ/หลักฐานเคลียร์ยอด...</p>
        </div>
      ) : groupedData.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center shadow-xs">
          <AlertCircle className="w-8 h-8 text-stone-300 mx-auto" />
          <p className="text-xs text-stone-500 mt-2 font-bold">ไม่พบข้อมูลเอกสารในส่วนนี้</p>
          <p className="text-[10px] text-stone-400 mt-1">รายการเคลียร์ยอดที่ระบุใบเสร็จจะมาแสดงที่นี่</p>
        </div>
      ) : viewMode === "card" ? (
        /* CARD VIEW: grouped by advId */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {groupedData.map((group) => {
            const adv = group.advance;
            return (
              <div 
                key={group.advId}
                className={`bg-white border rounded-2xl overflow-hidden shadow-xs transition hover:shadow-md flex flex-col ${
                  group.isGroupCompleted 
                    ? "border-emerald-250 bg-emerald-50/5" 
                    : "border-stone-200"
                }`}
              >
                {/* Card Header */}
                <div className="p-4 bg-stone-50 border-b border-stone-150 flex justify-between items-start gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-stone-400 uppercase font-mono tracking-wider">
                      เลขที่รายการเบิก
                    </span>
                    <h4 className="font-extrabold text-sm text-stone-900 mt-0.5 flex items-center gap-1.5">
                      {group.advId}
                      {group.isGroupCompleted ? (
                        <span className="px-2 py-0.5 text-[9px] font-extrabold bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> ตัวจริงครบแล้ว
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-150 rounded-md">
                          ยังค้างเอกสาร ({group.totalItemsCount - group.receivedCount} ใบ)
                        </span>
                      )}
                    </h4>
                    
                    {adv && (
                      <p className="text-[11px] text-stone-500 mt-1 font-semibold flex items-center gap-1">
                        <User className="w-3 h-3 text-stone-400" /> {adv.employeeName} 
                        <span className="text-stone-300">|</span> 
                        <span className="font-bold text-stone-600">{adv.projectId}</span>
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-bold text-stone-400 uppercase font-mono">
                      วงเงินเบิก
                    </span>
                    <p className="text-xs font-extrabold text-stone-900 mt-0.5">
                      {adv ? adv.requestAmount.toLocaleString("th-TH") : "N/A"} ฿
                    </p>
                    {adv && (
                      <span className="text-[10px] text-stone-400 block font-medium">
                        เคลียร์แล้ว {adv.approvedClearingAmountTotal?.toLocaleString("th-TH") || 0} ฿
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Body - Checklist of Documents */}
                <div className="p-4 flex-1 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-stone-100">
                    <span className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider">
                      รายการใบเสร็จ / บิลยื่นตรวจสอบ ({group.items.length} ใบ)
                    </span>
                    <span className="text-[10px] font-mono font-bold text-stone-400">
                      ได้รับ {group.receivedCount} / {group.totalItemsCount}
                    </span>
                  </div>

                  <div className="divide-y divide-stone-100 max-h-[220px] overflow-y-auto pr-1 space-y-2 scrollbar-thin">
                    {group.items.map((item) => (
                      <div key={item.id} className="pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex-1 min-w-0">
                          {/* Receipt identity info */}
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 text-[9px] font-black bg-stone-100 text-stone-700 rounded-sm font-mono shrink-0">
                              {item.documentType || "RECEIPT"}
                            </span>
                            <span className="text-xs font-extrabold text-stone-850 truncate">
                              {item.vendorName || "ไม่ระบุร้านค้า"}
                            </span>
                          </div>
                          
                          {/* Description & Invoice ID */}
                          <p className="text-[10px] text-stone-500 mt-0.5 truncate">
                            รายการ: {item.itemName || "ไม่ระบุชื่องานเบิก"} 
                          </p>

                          {/* Invoice clearance number (เลขที่ใบเสร็จ / ใบเคลียร์ยอด) */}
                          <p className="text-[10px] text-amber-600 font-bold font-mono mt-0.5">
                            เลขใบเคลียร์: {item.invoiceNo || "ไม่มีเลขที่ใบเสร็จ/ไม่มีใบกำกับ"}
                          </p>
                        </div>

                        {/* Document source and check action */}
                        <div className="flex items-center gap-3 shrink-0 self-end sm:self-center bg-stone-50 rounded-xl px-2 py-1.5 border border-stone-100">
                          
                          {/* Attached files (digital receipt link) */}
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] font-extrabold text-stone-400 uppercase tracking-widest leading-none">รูปแนบ</span>
                            {item.imageUrl ? (
                              <a 
                                href={item.imageUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="p-1 text-stone-600 hover:text-stone-900 hover:bg-stone-150 rounded transition mt-0.5 flex items-center justify-center"
                                title="คลิกเปิดดูเอกสารที่พนักงานแนบในระบบ"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </a>
                            ) : (
                              <span className="text-[9px] text-stone-300 font-bold mt-1">ไม่มี</span>
                            )}
                          </div>

                          <div className="w-px h-6 bg-stone-200" />

                          {/* Physical original document receive check (ตัวจริง) */}
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] font-extrabold text-stone-400 uppercase tracking-widest leading-none">เอกสารตัวจริง</span>
                            <button
                              disabled={updatingItemId === item.id}
                              onClick={() => handleToggleOriginalReceived(item.id, !!item.originalDocReceived)}
                              className={`p-1 mt-0.5 rounded transition-all duration-250 flex items-center justify-center ${
                                item.originalDocReceived 
                                  ? "text-emerald-600 hover:text-emerald-700" 
                                  : "text-stone-300 hover:text-stone-500 hover:bg-stone-150"
                              }`}
                              title={item.originalDocReceived ? "ติ๊กออกหากต้องการยกเลิก" : "ติ๊กเพื่อยืนยันว่าได้รับเอกสารตัวจริงแล้ว"}
                            >
                              {item.originalDocReceived ? (
                                <CheckSquare className="w-4 h-4 fill-emerald-50 text-emerald-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer details */}
                <div className="px-4 py-2 bg-stone-50/50 border-t border-stone-100 text-[10px] text-stone-400 font-medium flex justify-between items-center">
                  <span>ผู้ตรวจสอบล่าสุด: </span>
                  <span className="font-bold text-stone-600">
                    {group.items.some(i => i.originalDocReceivedBy) 
                      ? group.items.find(i => i.originalDocReceivedBy)?.originalDocReceivedBy 
                      : "-"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-150 text-[10px] font-extrabold text-stone-400 uppercase tracking-wider">
                  <th className="px-4 py-3">เลขที่รายการเบิก</th>
                  <th className="px-4 py-3">งานที่เบิก/ผู้รับเงิน</th>
                  <th className="px-4 py-3 text-center">วันที่ได้รับเอกสารแนบในระบบ</th>
                  <th className="px-4 py-3 text-center">มีเอกสารแนบในระบบ</th>
                  <th className="px-4 py-3 text-center">ได้รับเอกสารตัวจริงแล้ว</th>
                  <th className="px-4 py-3 text-center">วันที่ได้รับเอกสารตัวจริง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-xs">
                {groupedData.flatMap((g) => g.items).map((item) => {
                  const parentAdv = advances.find((a) => a.advId === item.advId);
                  const createdAtLocal = item.createdAt ? new Date(item.createdAt).toLocaleDateString("th-TH") : "-";
                  const receivedAtLocal = item.originalDocReceivedAt ? new Date(item.originalDocReceivedAt).toLocaleDateString("th-TH") : "-";

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-stone-50/50 transition ${
                        item.originalDocReceived ? "bg-emerald-50/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-stone-900">
                        {item.advId}
                        <div className="text-[9px] text-stone-400 font-medium">ใบเคลียร์: {item.invoiceNo || "-"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-stone-900">{item.itemName || item.vendorName}</div>
                        {parentAdv && (
                          <div className="text-[9px] text-stone-400">ผู้เบิก: {parentAdv.employeeName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-stone-600">
                        {createdAtLocal}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center justify-center">
                           {item.imageUrl ? (
                             <CheckSquare className="w-5 h-5 text-emerald-500" />
                           ) : (
                             <Square className="w-5 h-5 text-stone-300" />
                           )}
                        </div>
                        {item.imageUrl && (
                          <div className="mt-1">
                            <a href={item.imageUrl} target="_blank" rel="noreferrer" className="text-[9px] font-bold text-stone-500 hover:text-stone-800 underline">เปิดดูบิล</a>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                         <button
                          disabled={updatingItemId === item.id}
                          onClick={() => handleToggleOriginalReceived(item.id, !!item.originalDocReceived)}
                          className="inline-flex items-center justify-center focus:outline-none"
                         >
                           {item.originalDocReceived ? (
                             <CheckSquare className="w-6 h-6 text-emerald-600" />
                           ) : (
                             <Square className="w-6 h-6 text-stone-300 hover:text-stone-400" />
                           )}
                         </button>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-stone-600">
                        {receivedAtLocal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
