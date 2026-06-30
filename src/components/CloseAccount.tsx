import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, addDoc, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Advance, ClearingItem, Employee, AdvanceStatus } from "../types";
import { 
  FileCheck, ShieldAlert, AlertTriangle, Check, X, ShieldCheck, 
  Lock, Unlock, HelpCircle, FileText, Download, Calendar, RefreshCw, 
  BarChart, Layers, ListTodo, AlertCircle, FileDown
} from "lucide-react";
import { exportToExcel } from "../lib/excelExport";

interface CloseAccountProps {
  currentEmployee: Employee;
}

export default function CloseAccount({ currentEmployee }: CloseAccountProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [clearingItems, setClearingItems] = useState<ClearingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdv, setSelectedAdv] = useState<Advance | null>(null);
  
  // Status messages
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // Daily/Weekly report modal / output state
  const [reportType, setReportType] = useState<"daily" | "weekly" | null>(null);
  const [reportData, setReportData] = useState<any[]>([]);

  useEffect(() => {
    // Listen to Advances
    const unsubAdvances = onSnapshot(collection(db, "advances"), (snap) => {
      const list: Advance[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Advance));
      setAdvances(list);
    }, (err) => {
      console.error("Error in onSnapshot on advances inside CloseAccount:", err);
    });

    // Listen to Clearing Items
    const unsubItems = onSnapshot(collection(db, "clearingItems"), (snap) => {
      const list: ClearingItem[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ClearingItem));
      setClearingItems(list);
      setLoading(false);
    }, (err) => {
      console.error("Error in onSnapshot on clearingItems inside CloseAccount:", err);
      setLoading(false);
    });

    return () => {
      unsubAdvances();
      unsubItems();
    };
  }, []);

  // Filter items for currently selected advance
  const currentItems = selectedAdv 
    ? clearingItems.filter((item) => item.advId === selectedAdv.advId) 
    : [];

  // 4 Guards Calculation for selected Advance
  const calculateGuards = (adv: Advance) => {
    const items = clearingItems.filter((i) => i.advId === adv.advId);
    
    // Guard 1: Document Checklist (digital file attached)
    const hasItems = items.length > 0;
    const docChecklistPassed = hasItems && items.every((i) => i.imageUrl && i.imageUrl.trim() !== "");
    const missingDocsCount = items.filter((i) => !i.imageUrl || i.imageUrl.trim() === "").length;

    // Guard 2: Original Documents (physical verified in system)
    const originalDocsPassed = hasItems && items.every((i) => i.originalDocReceived);
    const missingOriginalCount = items.filter((i) => !i.originalDocReceived).length;

    // Guard 3: Accounting Review (reviewed and approved)
    const accountingReviewPassed = hasItems && items.every((i) => i.accountantApproved);
    const unapprovedCount = items.filter((i) => !i.accountantApproved).length;

    // Guard 4: Cost Allocation (100% of cost distributed into splits)
    // Every item must have projectSplits sum up to its total amount, or sum up to 100%
    const costAllocationPassed = hasItems && items.every((i) => {
      if (!i.projectSplits || i.projectSplits.length === 0) return false;
      const totalAllocated = i.projectSplits.reduce((sum, s) => sum + s.amount, 0);
      // Splits should equal netAmount or close to it
      return Math.abs(totalAllocated - i.netAmount) < 1; 
    });
    const unallocatedCount = items.filter((i) => {
      if (!i.projectSplits || i.projectSplits.length === 0) return true;
      const totalAllocated = i.projectSplits.reduce((sum, s) => sum + s.amount, 0);
      return Math.abs(totalAllocated - i.netAmount) >= 1;
    }).length;

    const allPassed = docChecklistPassed && originalDocsPassed && accountingReviewPassed && costAllocationPassed;

    return {
      docChecklistPassed,
      missingDocsCount,
      originalDocsPassed,
      missingOriginalCount,
      accountingReviewPassed,
      unapprovedCount,
      costAllocationPassed,
      unallocatedCount,
      allPassed,
      itemsCount: items.length
    };
  };

  // Process close account for the selected advance
  const handleCloseAccount = async () => {
    if (!selectedAdv) return;
    const guards = calculateGuards(selectedAdv);
    
    if (!guards.allPassed) {
      setErrorMsg("ขออภัย! ไม่สามารถปิดบัญชีได้ เนื่องจากไม่ผ่านเงื่อนไขการตรวจสอบความถูกต้องแบบครบถ้วน");
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Update Advance Status to CLOSED and add account closed fields
      const advRef = doc(db, "advances", selectedAdv.id);
      await updateDoc(advRef, {
        status: AdvanceStatus.CLOSED,
        accountClosed: true,
        accountClosedAt: new Date().toISOString(),
        accountClosedBy: currentEmployee.name,
      });

      // 2. Automatically generate and push a settlement file to the Secure Vault
      const vaultFilesRef = collection(db, "vaultFiles");
      await addDoc(vaultFilesRef, {
        advId: selectedAdv.advId,
        fileType: "SETTLEMENT",
        fileUrl: "#", // Marks as digital internal settlement summary
        fileName: ` settlement_report_${selectedAdv.advId}.pdf`,
        uploadedBy: currentEmployee.name,
        uploadedAt: new Date().toISOString(),
        isSystemGenerated: true
      });

      // 3. Write log to Audit Logs
      const auditLogsRef = collection(db, "auditLogs");
      await addDoc(auditLogsRef, {
        advId: selectedAdv.advId,
        actionType: "CLOSE_ACCOUNT",
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: AdvanceStatus.CLOSED,
        details: `บัญชีปิดการตรวจสอบ (Close Account & Settlement) สำหรับใบเบิกเลขที่ ${selectedAdv.advId} เรียบร้อยแล้ว`
      });

      setSuccessMsg(`สลักลายเซ็นและปิดบัญชีเสร็จสมบูรณ์! รายงานสรุปผลต่างได้รับการบันทึกลงตู้นิรภัย (Secure Vault) สำหรับใบเบิก ${selectedAdv.advId} แล้ว`);
      setSelectedAdv(null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`เกิดข้อผิดพลาด: ${err.message || "ไม่สามารถทำการปิดบัญชีได้"}`);
    } finally {
      setProcessing(false);
    }
  };

  // Generate Daily or Weekly report mock exporter
  const generatePeriodicReport = (type: "daily" | "weekly") => {
    setReportType(type);
    
    // Daily: Advances closed/approved today
    // Weekly: Advances in the last 7 days
    const now = new Date();
    const filtered = advances.filter((adv) => {
      const advDate = new Date(adv.createdAt);
      const diffTime = Math.abs(now.getTime() - advDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (type === "daily") {
        return diffDays <= 1; // within 24h
      } else {
        return diffDays <= 7; // within week
      }
    });

    setReportData(filtered);
  };

  return (
    <div className="space-y-6" id="close_account_tab">
      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-stone-950 text-stone-50 rounded-lg">
                <Lock className="w-5 h-5" />
              </span>
              <h2 className="font-extrabold text-stone-950 text-lg tracking-tight">
                Close Account & Settlements (ปิดบัญชีเงินทดรองจ่ายรายงวด)
              </h2>
            </div>
            <p className="text-xs text-stone-500 mt-1 font-medium">
              โมดูลล็อคและปิดบัญชีเงินยืมทดรองจ่ายเมื่อเคลียร์บิลครบถ้วน พร้อมระบบตรวจสอบความปลอดภัย (Checklist Guard)
            </p>
          </div>

          {/* Quick report actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => generatePeriodicReport("daily")}
              className="px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-850 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              รายงานประจำวัน
            </button>
            <button
              onClick={() => generatePeriodicReport("weekly")}
              className="px-3.5 py-1.5 bg-stone-950 hover:bg-stone-900 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              รายงานประจำสัปดาห์
            </button>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-250 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-250 text-red-800 rounded-2xl text-xs font-semibold flex items-center gap-2.5">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Report results modal/box */}
      {reportType && (
        <div className="bg-stone-900 text-stone-50 rounded-2xl p-5 border border-stone-850 shadow-xl space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-stone-850">
            <div>
              <h3 className="font-black text-sm tracking-tight flex items-center gap-2 text-white">
                <BarChart className="w-4 h-4 text-amber-400" />
                {reportType === "daily" ? "รายงานสรุปการเบิกเงินทดรองจ่ายประจำวัน" : "รายงานวิเคราะห์สรุปผลเบิกรายสัปดาห์"}
              </h3>
              <p className="text-[10px] text-stone-400">ดึงข้อมูล ณ เวลา {new Date().toLocaleString("th-TH")}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const dataToExport = reportData.map(item => ({
                    "เลขที่ใบเบิก": item.advId,
                    "ผู้เบิก": item.employeeName,
                    "โครงการ": item.projectId,
                    "วงเงินขอยืม (฿)": item.requestAmount,
                    "เคลียร์แล้ว (฿)": item.approvedClearingAmountTotal || 0,
                    "คงเหลือค้าง (฿)": item.outstandingAmount || 0,
                    "สถานะ": item.status === AdvanceStatus.CLOSED ? "ปิดดุลแล้ว" : "รอดำเนินการ"
                  }));
                  exportToExcel(dataToExport, `Account_Report_${reportType}`);
                }}
                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1"
              >
                <FileDown className="w-3 h-3" /> Excel
              </button>
              <button 
                onClick={() => setReportType(null)}
                className="px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-[10px] font-bold"
              >
                ปิดรายงาน
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-300">
              <thead>
                <tr className="border-b border-stone-800 text-[10px] font-extrabold text-stone-500 uppercase tracking-wider">
                  <th className="py-2 px-3">เลขที่</th>
                  <th className="py-2 px-3">ผู้เบิก / โครงการ</th>
                  <th className="py-2 px-3 text-right">วงเงินขอยืม</th>
                  <th className="py-2 px-3 text-right">เคลียร์แล้ว</th>
                  <th className="py-2 px-3 text-right">คงเหลือค้าง</th>
                  <th className="py-2 px-3 text-center">สถานะบัญชี</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-850">
                {reportData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-stone-500">
                      ไม่พบข้อมูลรายงานความเคลื่อนไหวในช่วงเวลาดังกล่าว
                    </td>
                  </tr>
                ) : (
                  reportData.map((item) => (
                    <tr key={item.id} className="hover:bg-stone-850/50">
                      <td className="py-2 px-3 font-mono font-bold text-white">{item.advId}</td>
                      <td className="py-2 px-3">
                        <div className="font-bold text-stone-200">{item.employeeName}</div>
                        <div className="text-[9px] text-stone-500">{item.projectId}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-bold">{item.requestAmount.toLocaleString()} ฿</td>
                      <td className="py-2 px-3 text-right text-emerald-400">{(item.approvedClearingAmountTotal || 0).toLocaleString()} ฿</td>
                      <td className="py-2 px-3 text-right text-amber-400">{(item.outstandingAmount || 0).toLocaleString()} ฿</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          item.status === AdvanceStatus.CLOSED 
                            ? "bg-stone-800 text-stone-300 border border-stone-700" 
                            : "bg-amber-400/10 text-amber-400 border border-amber-400/20"
                        }`}>
                          {item.status === AdvanceStatus.CLOSED ? "ปิดดุลแล้ว" : "รอดำเนินการ"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main layout split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: List of Advances awaiting closure */}
        <div className="lg:col-span-1 bg-white border border-stone-200 rounded-2xl p-4 flex flex-col shadow-xs">
          <div className="pb-3 border-b border-stone-100 flex justify-between items-center">
            <span className="text-xs font-extrabold text-stone-900 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-stone-400" />
              ใบเบิกเงินรอปิดบัญชี ({advances.filter(a => a.status !== AdvanceStatus.CLOSED).length})
            </span>
          </div>

          <div className="divide-y divide-stone-100 overflow-y-auto max-h-[480px] space-y-2.5 pt-3 pr-1 scrollbar-thin">
            {advances.filter(a => a.status !== AdvanceStatus.CLOSED).map((adv) => {
              const guards = calculateGuards(adv);
              const isSelected = selectedAdv?.advId === adv.advId;
              return (
                <button
                  key={adv.id}
                  onClick={() => {
                    setSelectedAdv(adv);
                    setSuccessMsg(null);
                    setErrorMsg(null);
                  }}
                  className={`w-full text-left p-3 rounded-xl transition-all border ${
                    isSelected 
                      ? "bg-stone-950 text-white border-stone-950 shadow-md" 
                      : "bg-stone-50 border-stone-200 hover:bg-stone-100/50"
                  }`}
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className={`font-mono text-xs font-extrabold ${isSelected ? "text-amber-400" : "text-stone-900"}`}>
                      {adv.advId}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      guards.allPassed 
                        ? "bg-emerald-100 text-emerald-800" 
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {guards.allPassed ? "พร้อมปิดดุล" : "เอกสารค้าง"}
                    </span>
                  </div>

                  <div className="mt-1.5">
                    <p className={`text-xs font-extrabold ${isSelected ? "text-stone-200" : "text-stone-700"}`}>
                      {adv.employeeName}
                    </p>
                    <p className="text-[10px] text-stone-400 font-medium">โครงการ: {adv.projectId}</p>
                  </div>

                  <div className="mt-2.5 flex justify-between items-center text-[10px]">
                    <span className="text-stone-400 font-medium">ยอดเงินยืม:</span>
                    <span className={`font-bold ${isSelected ? "text-white" : "text-stone-950"}`}>
                      {adv.requestAmount.toLocaleString()} ฿
                    </span>
                  </div>
                </button>
              );
            })}

            {advances.filter(a => a.status !== AdvanceStatus.CLOSED).length === 0 && (
              <div className="p-8 text-center text-stone-400 text-xs">
                ไม่มีเงินยืมที่ยังเปิดอยู่ ดำเนินการสมบูรณ์ทุกรายการแล้ว 💎
              </div>
            )}
          </div>
        </div>

        {/* Right column: Selected Advance checklist and locks */}
        <div className="lg:col-span-2 space-y-5">
          {selectedAdv ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-6">
              
              {/* Selected summary */}
              <div className="pb-4 border-b border-stone-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <span className="text-[10px] font-extrabold text-stone-400 uppercase tracking-widest font-mono">กำลังตรวจสอบใบเบิก</span>
                  <h3 className="font-extrabold text-base text-stone-900 mt-0.5">{selectedAdv.advId}</h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    ผู้กู้ยืม: <span className="font-bold text-stone-700">{selectedAdv.employeeName}</span> | โครงการ: <span className="font-bold text-stone-700">{selectedAdv.projectId}</span>
                  </p>
                </div>
                
                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-extrabold text-stone-400 uppercase tracking-widest font-mono">เงินยืมทั้งหมด</span>
                  <p className="font-black text-lg text-stone-950">{selectedAdv.requestAmount.toLocaleString()} ฿</p>
                  <p className="text-[11px] text-emerald-600 font-bold">เคลียร์บิลแล้ว {(selectedAdv.approvedClearingAmountTotal || 0).toLocaleString()} ฿</p>
                </div>
              </div>

              {/* CHECKLIST GUARDS */}
              <div>
                <h4 className="text-xs font-black text-stone-900 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                  <ListTodo className="w-4 h-4 text-stone-500" />
                  เกณฑ์ความปลอดภัยเพื่อการปิดดุลบัญชี (Close Account Checklist Guard)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Guard 1: Document Checklist */}
                  <div className={`p-4 border rounded-xl flex items-start gap-3 ${
                    calculateGuards(selectedAdv).docChecklistPassed 
                      ? "bg-emerald-50/20 border-emerald-200 text-emerald-900" 
                      : "bg-red-50/10 border-stone-200 text-stone-900"
                  }`}>
                    <div className="p-1.5 rounded-lg bg-white border shrink-0 mt-0.5">
                      {calculateGuards(selectedAdv).docChecklistPassed ? (
                        <Check className="w-4 h-4 text-emerald-600 font-bold" />
                      ) : (
                        <X className="w-4 h-4 text-red-500 font-bold" />
                      )}
                    </div>
                    <div>
                      <h5 className="font-extrabold text-xs">1. Document Checklist</h5>
                      <p className="text-[10px] text-stone-500 mt-1">
                        ไฟล์สแกนหลักฐาน/รูปภาพแนบในระบบจะต้องครบถ้วนทุกใบเสร็จ
                      </p>
                      <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-bold ${
                        calculateGuards(selectedAdv).docChecklistPassed 
                          ? "bg-emerald-100 text-emerald-800" 
                          : "bg-red-100 text-red-800"
                      }`}>
                        {calculateGuards(selectedAdv).docChecklistPassed 
                          ? "แนบรูปบิลครบถ้วน" 
                          : `ยังขาดไฟล์รูปภาพใบเสร็จอยู่ ${calculateGuards(selectedAdv).missingDocsCount} ใบ`}
                      </span>
                    </div>
                  </div>

                  {/* Guard 2: Original Documents */}
                  <div className={`p-4 border rounded-xl flex items-start gap-3 ${
                    calculateGuards(selectedAdv).originalDocsPassed 
                      ? "bg-emerald-50/20 border-emerald-200 text-emerald-900" 
                      : "bg-red-50/10 border-stone-200 text-stone-900"
                  }`}>
                    <div className="p-1.5 rounded-lg bg-white border shrink-0 mt-0.5">
                      {calculateGuards(selectedAdv).originalDocsPassed ? (
                        <Check className="w-4 h-4 text-emerald-600 font-bold" />
                      ) : (
                        <X className="w-4 h-4 text-red-500 font-bold" />
                      )}
                    </div>
                    <div>
                      <h5 className="font-extrabold text-xs">2. Original Documents Physical</h5>
                      <p className="text-[10px] text-stone-500 mt-1">
                        ฝ่ายบัญชีต้องได้รับการยืนยันรับเอกสารตัวจริงเข้าระบบแล้วทุกใบเสร็จ
                      </p>
                      <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-bold ${
                        calculateGuards(selectedAdv).originalDocsPassed 
                          ? "bg-emerald-100 text-emerald-800" 
                          : "bg-red-100 text-red-800"
                      }`}>
                        {calculateGuards(selectedAdv).originalDocsPassed 
                          ? "ได้รับตัวจริงแล้วทุกใบ" 
                          : `ค้างส่งตัวจริงทางกายภาพ ${calculateGuards(selectedAdv).missingOriginalCount} ใบ`}
                      </span>
                    </div>
                  </div>

                  {/* Guard 3: Accounting Review */}
                  <div className={`p-4 border rounded-xl flex items-start gap-3 ${
                    calculateGuards(selectedAdv).accountingReviewPassed 
                      ? "bg-emerald-50/20 border-emerald-200 text-emerald-900" 
                      : "bg-red-50/10 border-stone-200 text-stone-900"
                  }`}>
                    <div className="p-1.5 rounded-lg bg-white border shrink-0 mt-0.5">
                      {calculateGuards(selectedAdv).accountingReviewPassed ? (
                        <Check className="w-4 h-4 text-emerald-600 font-bold" />
                      ) : (
                        <X className="w-4 h-4 text-red-500 font-bold" />
                      )}
                    </div>
                    <div>
                      <h5 className="font-extrabold text-xs">3. Accountant Review & Audit</h5>
                      <p className="text-[10px] text-stone-500 mt-1">
                        ใบเบิก/บิลทั้งหมดผ่านขั้นตอนตรวจสอบภาษี (VAT, WHT) โดยฝ่ายบัญชีแล้ว
                      </p>
                      <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-bold ${
                        calculateGuards(selectedAdv).accountingReviewPassed 
                          ? "bg-emerald-100 text-emerald-800" 
                          : "bg-red-100 text-red-800"
                      }`}>
                        {calculateGuards(selectedAdv).accountingReviewPassed 
                          ? "ผ่านการตรวจสอบแล้ว" 
                          : `ยังรอตรวจสอบประเด็นทางบัญชี ${calculateGuards(selectedAdv).unapprovedCount} ใบ`}
                      </span>
                    </div>
                  </div>

                  {/* Guard 4: Cost Allocation */}
                  <div className={`p-4 border rounded-xl flex items-start gap-3 ${
                    calculateGuards(selectedAdv).costAllocationPassed 
                      ? "bg-emerald-50/20 border-emerald-200 text-emerald-900" 
                      : "bg-red-50/10 border-stone-200 text-stone-900"
                  }`}>
                    <div className="p-1.5 rounded-lg bg-white border shrink-0 mt-0.5">
                      {calculateGuards(selectedAdv).costAllocationPassed ? (
                        <Check className="w-4 h-4 text-emerald-600 font-bold" />
                      ) : (
                        <X className="w-4 h-4 text-red-500 font-bold" />
                      )}
                    </div>
                    <div>
                      <h5 className="font-extrabold text-xs">4. Cost Allocation (100%)</h5>
                      <p className="text-[10px] text-stone-500 mt-1">
                        บิลทุกใบต้องถูกกระจายปันส่วนต้นทุนลงโครงการ/แผนก ครบ 100%
                      </p>
                      <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-bold ${
                        calculateGuards(selectedAdv).costAllocationPassed 
                          ? "bg-emerald-100 text-emerald-800" 
                          : "bg-red-100 text-red-800"
                      }`}>
                        {calculateGuards(selectedAdv).costAllocationPassed 
                          ? "ปันส่วนครบ 100%" 
                          : `มีบิลที่ไม่ได้ปันส่วน / ปันส่วนไม่ครบ 100% จำนวน ${calculateGuards(selectedAdv).unallocatedCount} ใบ`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Settlement Locking Console Action */}
              <div className="p-5 bg-stone-50 rounded-2xl border border-stone-150 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="font-black text-xs text-stone-900 flex items-center gap-1.5">
                    {calculateGuards(selectedAdv).allPassed ? (
                      <span className="flex items-center gap-1.5 text-emerald-600">
                        <Unlock className="w-4 h-4" />
                        ระบบปลดล็อคการปิดสรุปบัญชีแล้ว
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-stone-400">
                        <Lock className="w-4 h-4 text-stone-400" />
                        ระบบล็อคการปิดสรุปบัญชี
                      </span>
                    )}
                  </h4>
                  <p className="text-[10px] text-stone-500">
                    {calculateGuards(selectedAdv).allPassed 
                      ? "ท่านสามารถกดปิดบัญชีและประมวลผลดุลการเงินเพื่อลงลายมือชื่อดิจิทัลได้ทันที" 
                      : "กรุณาดำเนินการสแกนรับเอกสารตัวจริง, ตรวจรับบัญชี หรือจัดแจงต้นทุนให้เสร็จก่อนปุ่มจะปลดล็อค"}
                  </p>
                </div>

                <button
                  onClick={handleCloseAccount}
                  disabled={processing || !calculateGuards(selectedAdv).allPassed}
                  className={`px-5 py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                    calculateGuards(selectedAdv).allPassed
                      ? "bg-stone-950 text-white hover:bg-stone-900 shadow-md scale-100 active:scale-95"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  }`}
                >
                  {processing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileCheck className="w-4 h-4 text-amber-400" />
                  )}
                  ปิดบัญชีอย่างสมบูรณ์ (Close Account)
                </button>
              </div>

            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center shadow-xs">
              <AlertCircle className="w-10 h-10 text-stone-300 mx-auto" />
              <p className="text-xs text-stone-500 font-bold mt-3">กรุณาเลือกใบเบิกด้านซ้ายเพื่อดูความพร้อมในการปิดบัญชี</p>
              <p className="text-[10px] text-stone-400 mt-1">
                ระบบจะตรวจสอบเอกสาร, รายละเอียดการแนบรูปภาพบิลต้นฉบับ และปันส่วนต้นทุนตามหลักการทางบัญชีที่ถูกต้อง
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
