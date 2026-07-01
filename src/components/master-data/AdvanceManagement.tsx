import React, { useState, useEffect, useMemo } from "react";
import { collection, query, onSnapshot, doc, getDocs, orderBy } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Advance, AdvanceStatus } from "../../types";
import { 
  Search, 
  Filter, 
  Download, 
  FileText, 
  Calendar, 
  User, 
  Briefcase,
  ChevronRight,
  RefreshCw,
  Tag,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle
} from "lucide-react";
import { motion } from "motion/react";
import * as XLSX from "xlsx";

export default function AdvanceManagement() {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const q = query(collection(db, "advances"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Advance));
      setAdvances(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredAdvances = useMemo(() => {
    return advances.filter(adv => {
      const matchesSearch = 
        adv.advId?.toLowerCase().includes(search.toLowerCase()) || 
        adv.employeeName?.toLowerCase().includes(search.toLowerCase()) ||
        adv.projectName?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || adv.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [advances, search, statusFilter]);

  const handleExport = () => {
    const data = filteredAdvances.map(({ id, ...rest }) => rest);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Advances");
    XLSX.writeFile(wb, `advances_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "APPROVED":
      case "TRANSFERRED":
      case "CLOSED":
        return "bg-emerald-100 text-emerald-700";
      case "REJECTED":
      case "RETURNED":
        return "bg-red-100 text-red-700";
      case "WAITING_TRANSFER":
      case "WAITING_CLEARANCE":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-stone-100 text-stone-600";
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">จัดการใบขอเบิกเงิน</h2>
          <p className="text-[10px] text-stone-500 font-medium">รายการเบิกเงินทดรองจ่ายทั้งหมดในระบบ</p>
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
            placeholder="ค้นหารหัสใบเบิก, พนักงาน, โครงการ..."
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
            {Object.values(AdvanceStatus).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
              <span className="text-xs text-stone-400 font-medium">กำลังโหลดรายการใบเบิก...</span>
            </div>
          ) : filteredAdvances.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
              <FileText className="w-12 h-12 text-stone-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-stone-500">ไม่พบรายการใบเบิก</p>
            </div>
          ) : (
            filteredAdvances.map(adv => (
              <motion.div 
                layout
                key={adv.id}
                className="bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4 relative overflow-hidden"
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-black text-stone-400 font-mono uppercase tracking-widest">{adv.advId}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${getStatusColor(adv.status)}`}>
                        {adv.status}
                      </span>
                    </div>
                    <h4 className="font-bold text-stone-900 truncate">{adv.employeeName}</h4>
                    <p className="text-[10px] text-stone-500 font-medium mt-1 flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> {adv.projectName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">ยอดขอเบิก</p>
                    <p className="text-lg font-black text-stone-900">฿{adv.requestAmount?.toLocaleString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-stone-100">
                  <div className="space-y-1">
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">หมวดหมู่</p>
                    <p className="text-xs font-bold text-stone-700 flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-stone-400" /> {adv.category}
                    </p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">วันที่ส่ง</p>
                    <p className="text-xs font-bold text-stone-700">{new Date(adv.createdAt).toLocaleDateString("th-TH")}</p>
                  </div>
                </div>

                {adv.status === "WAITING_TRANSFER" && (
                  <div className="mt-2 p-3 bg-emerald-50 rounded-2xl flex items-center justify-between border border-emerald-100">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="text-[10px] font-bold text-emerald-700">อนุมัติแล้วโดย {adv.approvedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-stone-400 font-mono">{new Date(adv.approvedAt!).toLocaleDateString()}</span>
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
