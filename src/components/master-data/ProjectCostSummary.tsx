import React, { useState, useEffect, useMemo } from "react";
import { collection, query, onSnapshot, doc, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ProjectCost } from "../../types";
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Filter, 
  Search, 
  Download,
  Building2,
  ChevronRight,
  RefreshCw,
  PieChart,
  BarChart3,
  DollarSign
} from "lucide-react";
import { motion } from "motion/react";
import * as XLSX from "xlsx";

export default function ProjectCostSummary() {
  const [costs, setCosts] = useState<ProjectCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");

  useEffect(() => {
    const q = query(collection(db, "project_costs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectCost));
      setCosts(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredCosts = useMemo(() => {
    return costs.filter(c => {
      const matchesSearch = c.projectName?.toLowerCase().includes(search.toLowerCase());
      // Company filter might need project reference if companyName is not in project_costs
      // For now assume projectName or search handles it
      return matchesSearch;
    });
  }, [costs, search]);

  const kpis = useMemo(() => {
    const totalBudget = costs.reduce((sum, c) => sum + (c.contractBudget || 0), 0);
    const totalCleared = costs.reduce((sum, c) => sum + (c.totalClearingApproved || 0), 0);
    const totalOutstanding = costs.reduce((sum, c) => sum + (c.outstandingAmount || 0), 0);
    const avgRisk = costs.length ? costs.reduce((sum, c) => sum + (c.riskScore || 0), 0) / costs.length : 0;
    
    return [
      { label: "งบประมาณรวม", value: `฿${(totalBudget / 1000000).toFixed(1)}M`, icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50" },
      { label: "เคลียร์แล้ว", value: `฿${(totalCleared / 1000000).toFixed(1)}M`, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
      { label: "ค้างเคลียร์", value: `฿${(totalOutstanding / 1000000).toFixed(1)}M`, icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
      { label: "คะแนนความเสี่ยง", value: avgRisk.toFixed(1), icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    ];
  }, [costs]);

  const handleExport = () => {
    const data = filteredCosts.map(({ id, ...rest }) => rest);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ProjectCosts");
    XLSX.writeFile(wb, `project_costs_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">สรุปต้นทุนโครงการ</h2>
          <p className="text-[10px] text-stone-500 font-medium">ภาพรวมงบประมาณและการเคลียร์เงิน</p>
        </div>
        <button onClick={handleExport} className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition">
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi, idx) => (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              key={idx} 
              className="bg-white p-4 rounded-3xl border border-stone-200 shadow-sm space-y-1"
            >
              <div className={`w-8 h-8 ${kpi.bg} ${kpi.color} rounded-xl flex items-center justify-center mb-1`}>
                <kpi.icon className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">{kpi.label}</p>
              <p className="text-lg font-black text-stone-900 leading-tight">{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text"
              placeholder="ค้นหาโครงการ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
            />
          </div>
        </div>

        {/* Cost Table/Cards */}
        <div className="space-y-3 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
              <span className="text-xs text-stone-400 font-medium">กำลังวิเคราะห์ข้อมูลต้นทุน...</span>
            </div>
          ) : filteredCosts.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
              <BarChart3 className="w-12 h-12 text-stone-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-stone-500">ไม่พบข้อมูลต้นทุน</p>
            </div>
          ) : (
            filteredCosts.map(cost => (
              <motion.div 
                layout
                key={cost.id}
                className="bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-stone-900 truncate">{cost.projectName}</h4>
                    <p className="text-[10px] text-stone-500 font-medium">ID: {cost.projectId}</p>
                  </div>
                  <div className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                    (cost.riskScore || 0) > 7 ? "bg-red-100 text-red-700" : (cost.riskScore || 0) > 4 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    Risk: {cost.riskScore?.toFixed(1) || "0.0"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">งบเบิกสำรอง</p>
                      <p className="text-sm font-black text-stone-900">฿{cost.pettyCashBudget?.toLocaleString()}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">คงเหลือ</p>
                      <p className="text-sm font-black text-emerald-600">฿{cost.remainingPettyCashBudget?.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="space-y-3 text-right">
                    <div className="space-y-1">
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">ค้างเคลียร์</p>
                      <p className="text-sm font-black text-amber-600">฿{cost.outstandingAmount?.toLocaleString()}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">อัตราการเคลียร์</p>
                      <p className="text-sm font-black text-stone-900">{(cost.clearanceRate || 0).toFixed(1)}%</p>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-stone-400">
                    <span>ความก้าวหน้าการใช้เงิน</span>
                    <span>{((cost.totalClearingApproved || 0) / (cost.contractBudget || 1) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, ((cost.totalClearingApproved || 0) / (cost.contractBudget || 1) * 100))}%` }}
                      className="h-full bg-stone-900 rounded-full"
                    />
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
