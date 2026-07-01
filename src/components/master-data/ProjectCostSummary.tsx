import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Advance, AdvanceStatus, Project } from "../../types";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Download, DollarSign, RefreshCw, Search } from "lucide-react";
import { motion } from "motion/react";
import * as XLSX from "xlsx";

interface ProjectCostRow {
  id: string;
  projectId: string;
  projectName: string;
  companyName: string;
  contractBudget: number;
  pettyCashBudget: number;
  totalAdvanceRequested: number;
  totalAdvanceApproved: number;
  totalClearingApproved: number;
  outstandingAmount: number;
  remainingPettyCashBudget: number;
  waitingApprovalAmount: number;
  waitingTransferAmount: number;
  waitingClearanceAmount: number;
  clearanceRate: number;
  riskScore: number;
}

const currency = (value: number) => `฿${Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

export default function ProjectCostSummary() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let projectsLoaded = false;
    let advancesLoaded = false;
    const markLoaded = () => {
      if (projectsLoaded && advancesLoaded) setLoading(false);
    };

    const unsubProjects = onSnapshot(query(collection(db, "projects")), (snapshot) => {
      setProjects(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Project)));
      projectsLoaded = true;
      markLoaded();
    });

    const unsubAdvances = onSnapshot(query(collection(db, "advances")), (snapshot) => {
      setAdvances(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Advance)));
      advancesLoaded = true;
      markLoaded();
    });

    return () => {
      unsubProjects();
      unsubAdvances();
    };
  }, []);

  const rows = useMemo<ProjectCostRow[]>(() => {
    const projectMap = new Map<string, Project>();
    projects.forEach((project) => {
      const key = project.projectId || project.projectCode || project.id;
      projectMap.set(key, project);
    });

    advances.forEach((advance) => {
      const key = advance.projectId || advance.projectName || "ไม่ระบุโครงการ";
      if (!projectMap.has(key)) {
        projectMap.set(key, {
          id: key,
          projectId: key,
          projectCode: key,
          projectName: advance.projectName || key,
          companyName: "",
          clientName: "",
          pmId: "",
          pmName: "",
          contractAmount: 0,
          budget: 0,
          pettyCashBudget: 0,
          location: "",
          startDate: "",
          endDate: "",
          status: "Active",
          createdAt: "",
          updatedAt: "",
        });
      }
    });

    return Array.from(projectMap.entries()).map(([projectId, project]) => {
      const projectAdvances = advances.filter((advance) => {
        const advProjectKey = advance.projectId || advance.projectName || "ไม่ระบุโครงการ";
        return advProjectKey === projectId || advProjectKey === project.projectName || advProjectKey === project.projectCode;
      });
      const totalAdvanceRequested = projectAdvances.reduce((sum, item) => sum + Number(item.requestAmount || 0), 0);
      const totalAdvanceApproved = projectAdvances
        .filter((item) => ![AdvanceStatus.DRAFT, AdvanceStatus.REJECTED].includes(item.status))
        .reduce((sum, item) => sum + Number(item.approvedAmount || item.requestAmount || 0), 0);
      const totalClearingApproved = projectAdvances.reduce((sum, item) => sum + Number(item.approvedClearingAmountTotal || 0), 0);
      const outstandingAmount = projectAdvances.reduce((sum, item) => sum + Number(item.outstandingAmount || 0), 0);
      const waitingApprovalAmount = projectAdvances
        .filter((item) => item.status === AdvanceStatus.PENDING_APPROVAL)
        .reduce((sum, item) => sum + Number(item.requestAmount || 0), 0);
      const waitingTransferAmount = projectAdvances
        .filter((item) => item.status === AdvanceStatus.WAITING_TRANSFER)
        .reduce((sum, item) => sum + Number(item.requestAmount || 0), 0);
      const waitingClearanceAmount = projectAdvances
        .filter((item) => item.status === AdvanceStatus.WAITING_CLEARANCE || item.status === AdvanceStatus.PARTIALLY_CLEARED)
        .reduce((sum, item) => sum + Number(item.outstandingAmount || 0), 0);
      const pettyCashBudget = Number(project.pettyCashBudget || project.budget || 0);
      const contractBudget = Number(project.contractAmount || project.budget || 0);
      const clearanceRate = totalAdvanceRequested > 0 ? (totalClearingApproved / totalAdvanceRequested) * 100 : 0;
      const riskScore = Math.min(10, Math.round(((outstandingAmount / Math.max(pettyCashBudget, 1)) * 7 + (waitingApprovalAmount > 0 ? 1.5 : 0)) * 10) / 10);

      return {
        id: project.id || projectId,
        projectId,
        projectName: project.projectName || projectId,
        companyName: project.companyName || "",
        contractBudget,
        pettyCashBudget,
        totalAdvanceRequested,
        totalAdvanceApproved,
        totalClearingApproved,
        outstandingAmount,
        remainingPettyCashBudget: pettyCashBudget - totalClearingApproved,
        waitingApprovalAmount,
        waitingTransferAmount,
        waitingClearanceAmount,
        clearanceRate,
        riskScore,
      };
    });
  }, [advances, projects]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.projectId, row.projectName, row.companyName].some((value) => String(value || "").toLowerCase().includes(keyword))
    );
  }, [rows, search]);

  const kpis = useMemo(() => {
    const totalBudget = filteredRows.reduce((sum, row) => sum + row.contractBudget, 0);
    const totalCleared = filteredRows.reduce((sum, row) => sum + row.totalClearingApproved, 0);
    const totalOutstanding = filteredRows.reduce((sum, row) => sum + row.outstandingAmount, 0);
    const avgRisk = filteredRows.length ? filteredRows.reduce((sum, row) => sum + row.riskScore, 0) / filteredRows.length : 0;
    return [
      { label: "งบสัญญารวม", value: currency(totalBudget), icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50" },
      { label: "เคลียร์แล้ว", value: currency(totalCleared), icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
      { label: "ค้างเคลียร์", value: currency(totalOutstanding), icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
      { label: "ความเสี่ยงเฉลี่ย", value: avgRisk.toFixed(1), icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    ];
  }, [filteredRows]);

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(filteredRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ProjectCosts");
    XLSX.writeFile(wb, `project_costs_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">สรุปต้นทุนโครงการ</h2>
          <p className="text-[10px] text-stone-500 font-medium">คำนวณสดจากทะเบียนโครงการและใบเบิกจริง</p>
        </div>
        <button onClick={handleExport} className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition">
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi, idx) => (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }} key={kpi.label} className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm space-y-1">
              <div className={`w-8 h-8 ${kpi.bg} ${kpi.color} rounded-xl flex items-center justify-center mb-1`}>
                <kpi.icon className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">{kpi.label}</p>
              <p className="text-lg font-black text-stone-900 leading-tight">{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="ค้นหาโครงการ..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
          />
        </div>

        <div className="space-y-3 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
              <span className="text-xs text-stone-400 font-medium">กำลังคำนวณข้อมูลต้นทุน...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-stone-200">
              <BarChart3 className="w-12 h-12 text-stone-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-stone-500">ไม่พบข้อมูลต้นทุน</p>
            </div>
          ) : (
            filteredRows.map((row) => (
              <motion.div layout key={row.id} className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-stone-900 truncate">{row.projectName}</h4>
                    <p className="text-[10px] text-stone-500 font-medium">ID: {row.projectId}</p>
                  </div>
                  <div className={`px-2 py-1 rounded-lg text-[10px] font-bold ${row.riskScore > 7 ? "bg-red-100 text-red-700" : row.riskScore > 4 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    Risk: {row.riskScore.toFixed(1)}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Metric label="งบสัญญา" value={currency(row.contractBudget)} />
                  <Metric label="งบเงินทดรอง" value={currency(row.pettyCashBudget)} />
                  <Metric label="เบิกสะสม" value={currency(row.totalAdvanceRequested)} />
                  <Metric label="ค้างเคลียร์" value={currency(row.outstandingAmount)} tone="amber" />
                  <Metric label="เคลียร์แล้ว" value={currency(row.totalClearingApproved)} tone="emerald" />
                  <Metric label="คงเหลืองบเงินทดรอง" value={currency(row.remainingPettyCashBudget)} tone={row.remainingPettyCashBudget < 0 ? "red" : "emerald"} />
                  <Metric label="รอโอน" value={currency(row.waitingTransferAmount)} />
                  <Metric label="รออนุมัติ" value={currency(row.waitingApprovalAmount)} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-stone-400">
                    <span>อัตราเคลียร์เทียบยอดเบิก</span>
                    <span>{row.clearanceRate.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, row.clearanceRate)}%` }} className="h-full bg-stone-900 rounded-full" />
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

function Metric({ label, value, tone = "stone" }: { label: string; value: string; tone?: "stone" | "amber" | "emerald" | "red" }) {
  const toneClass = tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-stone-900";
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-black ${toneClass}`}>{value}</p>
    </div>
  );
}
