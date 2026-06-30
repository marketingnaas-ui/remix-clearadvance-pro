/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../lib/firebase";
import { AuditLog, ActionType } from "../types";
import { exportToExcel } from "../lib/excelExport";
import { Activity, ShieldCheck, Search, Filter, Calendar, RefreshCw, User, Tag, Grid, List, FileSpreadsheet } from "lucide-react";

export default function AuditTrailLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [logsViewMode, setLogsViewMode] = useState<"table" | "card">("table");

  useEffect(() => {
    const q = query(collection(db, "auditLogs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: AuditLog[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as AuditLog);
      });
      // Sort logs by newest timestamp
      list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setLogs(list);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getActionTypeLabel = (action: ActionType) => {
    switch (action) {
      case ActionType.CREATE_ADVANCE:
        return <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-mono font-bold rounded">ยื่นขอเงินทดรอง</span>;
      case ActionType.APPROVE_ADVANCE:
        return <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono font-bold rounded">อนุมัติใบเบิก</span>;
      case ActionType.REJECT_ADVANCE:
        return <span className="px-2 py-0.5 bg-stone-100 text-stone-800 border border-stone-200 text-[10px] font-mono font-bold rounded">ปฏิเสธใบเบิก</span>;
      case ActionType.UPLOAD_TRANSFER_SLIP:
        return <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-mono font-bold rounded">โอนเงิน/อัปสลิป</span>;
      case ActionType.SUBMIT_CLEARING:
        return <span className="px-2 py-0.5 bg-yellow-50 text-yellow-800 border border-yellow-200 text-[10px] font-mono font-bold rounded">พนักงานส่งบิลเคลียร์</span>;
      case ActionType.ACCOUNTING_APPROVE:
        return <span className="px-2 py-0.5 bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-mono font-bold rounded">บัญชีปิดสรุปยอด</span>;
      case ActionType.PARTIAL_CLEAR:
        return <span className="px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-mono font-bold rounded">บัญชีอนุมัติบางส่วน</span>;
      case ActionType.RETURN_CLEARING:
        return <span className="px-2 py-0.5 bg-red-50 text-red-800 border border-red-200 text-[10px] font-mono font-bold rounded">บัญชีตีกลับบิล</span>;
      default:
        return <span className="px-2 py-0.5 bg-stone-50 text-stone-800 border border-stone-200 text-[10px] font-mono font-bold rounded">อื่นๆ</span>;
    }
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.advId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actionBy.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.note.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = filterAction === "ALL" || log.actionType === filterAction;

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6 animate-fade-in" id="audit_logs_tab">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900">บันทึกธุรกรรมโปร่งใส (Audit Trail Logs)</h2>
          <p className="text-xs text-stone-500">ติดตามทุกประวัติความเคลื่อนไหวทางกฎหมายและระเบียบการเงินย้อนหลังแบบเรียลไทม์</p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex bg-stone-100 border border-stone-200 rounded-lg p-0.5">
            <button
              onClick={() => exportToExcel(filteredLogs, `Audit_Logs_${new Date().toISOString().split('T')[0]}`)}
              className="px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 text-emerald-700 hover:bg-emerald-50 transition"
              title="ส่งออกไฟล์ Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> <span>Excel</span>
            </button>
            <div className="w-[1px] bg-stone-200 mx-0.5 my-1" />
            <button
              onClick={() => setLogsViewMode("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                logsViewMode === "table" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              <List className="w-3.5 h-3.5" /> ตาราง
            </button>
            <button
              onClick={() => setLogsViewMode("card")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                logsViewMode === "card" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              <Grid className="w-3.5 h-3.5" /> การ์ด
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>บันทึกความปลอดภัยเปิดใช้งาน</span>
          </div>
        </div>
      </div>

      {/* Filter and search parameters */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="ค้นหาตาม ADV-ID, ผู้ทำรายการ หรือรายละเอียดเหตุการณ์..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none"
          />
          <Search className="absolute inset-y-0 left-3.5 w-4 h-4 text-stone-400 self-center" />
        </div>

        <div className="sm:w-64">
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none"
          >
            <option value="ALL">ตัวกรองธุรกรรมการเงินทั้งหมด</option>
            <option value={ActionType.CREATE_ADVANCE}>ยื่นขอเงินทดรองจ่าย</option>
            <option value={ActionType.APPROVE_ADVANCE}>อนุมัติใบเบิกเงิน</option>
            <option value={ActionType.UPLOAD_TRANSFER_SLIP}>บันทึกสลิปและโอนเงิน</option>
            <option value={ActionType.SUBMIT_CLEARING}>ยื่นบิลเคลียร์ตัดยอด</option>
            <option value={ActionType.ACCOUNTING_APPROVE}>ปิดดุลและสรุปยอดบัญชี</option>
            <option value={ActionType.PARTIAL_CLEAR}>อนุมัติเคลียร์จ่ายบางส่วน</option>
            <option value={ActionType.RETURN_CLEARING}>ตีกลับบิลให้พนักงาน</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-stone-500 text-xs">กำลังสืบค้นบันทึกข้อมูลธุรกรรมทางการเงิน...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-20 bg-white border border-stone-200 rounded-2xl text-stone-500 space-y-2">
          <Activity className="w-10 h-10 mx-auto text-stone-300" />
          <p className="text-sm">ไม่พบประวัติบันทึกธุรกรรมตามเงื่อนไขที่ค้นหา</p>
        </div>
      ) : logsViewMode === "table" ? (
        /* Bulletproof styled Audit ledger flow list */
        <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                  <th className="py-3.5 px-6 font-sans">วันเวลาทำธุรกรรม</th>
                  <th className="py-3.5 px-4 font-sans">เอกสารอ้างอิง</th>
                  <th className="py-3.5 px-4 font-sans">ประเภทเหตุการณ์</th>
                  <th className="py-3.5 px-4 font-sans">ผู้ดูแล / พนักงาน</th>
                  <th className="py-3.5 px-6 font-sans">บันทึกรายละเอียดประวัติ</th>
                  <th className="py-3.5 px-6 font-sans text-right">การส่งต่อระบบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-stone-50/70 transition duration-150 text-stone-700">
                    <td className="py-4 px-6 font-medium text-stone-500 font-sans">
                      {log.timestamp.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="py-4 px-4 font-bold text-stone-900 tracking-wider">
                      {log.advId}
                    </td>
                    <td className="py-4 px-4 font-sans">
                      {getActionTypeLabel(log.actionType)}
                    </td>
                    <td className="py-4 px-4 font-sans">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-stone-400" />
                        <span className="font-semibold text-stone-800">{log.actionBy}</span>
                        <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded uppercase">{log.role}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 max-w-sm truncate text-stone-600 font-sans leading-relaxed">
                      {log.note}
                    </td>
                    <td className="py-4 px-6 text-right font-sans">
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-800 font-semibold px-2 py-0.5 rounded-full border border-emerald-100">
                        🔒 บันทึกเข้าระบบแล้ว
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Bulletproof styled Audit ledger Card view layout */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
          {filteredLogs.map((log) => (
            <div key={log.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-stone-400 block font-bold font-sans">วันเวลาประทับตรา</span>
                    <span className="text-xs text-stone-500 font-mono">{log.timestamp.replace("T", " ").slice(0, 19)}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] bg-stone-100 text-stone-500 font-mono font-bold px-2 py-0.5 rounded">
                    {log.advId}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {getActionTypeLabel(log.actionType)}
                </div>

                <div className="bg-stone-50 rounded-xl p-2.5 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-stone-600 text-[10px] font-black uppercase">
                    {log.actionBy.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-stone-800 text-xs truncate">{log.actionBy}</p>
                    <p className="text-[9px] text-stone-400 uppercase font-semibold">{log.role}</p>
                  </div>
                </div>

                <p className="text-xs text-stone-600 leading-relaxed font-sans line-clamp-3">
                  {log.note}
                </p>
              </div>

              <div className="pt-3 border-t border-stone-100 flex justify-between items-center text-[10px]">
                <span className="text-stone-400">สถานะบันทึกระบบ</span>
                <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full border border-emerald-100">
                  🔒 สำเร็จ
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
