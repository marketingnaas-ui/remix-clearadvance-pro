import React, { useState, useEffect, useMemo } from "react";
import { collection, query, onSnapshot, doc, orderBy } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ClearingLog } from "../../types";
import { 
  Search, 
  Filter, 
  Download, 
  History, 
  Calendar, 
  User, 
  FileCheck,
  RefreshCw,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Ban
} from "lucide-react";
import { motion } from "motion/react";
import * as XLSX from "xlsx";

export default function ClearingHistory() {
  const [logs, setLogs] = useState<ClearingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const q = query(collection(db, "clearingLogs"), orderBy("submittedAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClearingLog));
      setLogs(data);
      setLoading(false);
    }, (err) => {
      console.error("Error subscribing to clearing logs:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = 
        log.clearingLogId?.toLowerCase().includes(search.toLowerCase()) || 
        log.advId?.toLowerCase().includes(search.toLowerCase()) ||
        log.submittedBy?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || log.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [logs, search, statusFilter]);

  const handleExport = () => {
    const data = filteredLogs.map(({ id, ...rest }) => rest);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ClearingHistory");
    XLSX.writeFile(wb, `clearing_history_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "APPROVED": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "PENDING": return <Clock className="w-4 h-4 text-amber-500" />;
      case "RETURNED": return <Ban className="w-4 h-4 text-red-500" />;
      default: return <AlertCircle className="w-4 h-4 text-stone-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">ประวัติการเคลียร์เงิน</h2>
          <p className="text-[10px] text-stone-500 font-medium">ติดตามประวัติการส่งหลักฐานและรอบการเคลียร์</p>
        </div>
        <button onClick={handleExport} className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition">
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text"
            placeholder="ค้นหารหัสเคลียร์, ใบเบิก, ผู้ส่ง..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="DRAFT">DRAFT</option>
          </select>
        </div>

        <div className="space-y-3 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
              <span className="text-xs text-stone-400 font-medium">กำลังโหลดประวัติการเคลียร์...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
              <History className="w-12 h-12 text-stone-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-stone-500">ไม่พบประวัติการเคลียร์</p>
            </div>
          ) : (
            filteredLogs.map(log => (
              <motion.div 
                layout
                key={log.id}
                className="bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4"
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-black text-stone-400 font-mono uppercase tracking-widest">{log.clearingLogId || "LOG-ID"}</span>
                      <span className="text-[10px] font-bold text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-md">รอบที่ {log.roundNo}</span>
                    </div>
                    <h4 className="font-bold text-stone-900 truncate">{log.submittedBy}</h4>
                    <p className="text-[10px] text-stone-500 font-medium mt-1 flex items-center gap-1">
                      <FileCheck className="w-3 h-3" /> เชื่อมโยงใบเบิก: <span className="text-stone-900 font-bold">{log.advId}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1 mb-1">
                      {getStatusIcon(log.status)}
                      <span className="text-[10px] font-black text-stone-900">{log.status}</span>
                    </div>
                    <p className="text-xs font-bold text-stone-500 font-mono">{new Date(log.submittedAt).toLocaleDateString("th-TH")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-100">
                  <div className="space-y-1">
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">ยอดที่ส่งเคลียร์</p>
                    <p className="text-sm font-black text-stone-900">฿{log.totalSubmittedAmount?.toLocaleString()}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">ยอดที่อนุมัติจริง</p>
                    <p className={`text-sm font-black ${log.totalApprovedAmount > 0 ? "text-emerald-600" : "text-stone-400"}`}>
                      ฿{log.totalApprovedAmount?.toLocaleString() || "0"}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
