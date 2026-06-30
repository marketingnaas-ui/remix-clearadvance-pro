import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Advance, AdvanceStatus } from "../types";
import { Grid, List, Briefcase, TrendingUp, AlertTriangle, CheckCircle2, ShieldCheck, Coins, ArrowRight, BarChart3, Download } from "lucide-react";
import { exportToExcel } from "../lib/excelExport";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ProjectCostData {
  projectName: string;
  budget: number;
  totalAdvancesRequested: number; // sum of requestAmount for PENDING/APPROVED/TRANSFERRED etc.
  totalAdvancesApproved: number; // sum of requestAmount for APPROVED/TRANSFERRED/PENDING_CLEARANCE/CLOSED
  totalClearedAmount: number; // sum of approvedClearingAmountTotal (actual receipt-based expenses!)
  usagePercentage: number;
  topCategories: { category: string; amount: number }[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-4 border border-stone-200 rounded-2xl shadow-xl text-xs space-y-2">
        <p className="font-bold text-stone-900 text-sm border-b pb-2">{label}</p>
        <div className="space-y-1">
          <p className="text-stone-500 flex justify-between gap-4">งบประมาณ: <span className="font-mono font-bold text-stone-900">฿{data.budget.toLocaleString("th-TH")}</span></p>
          <p className="text-stone-500 flex justify-between gap-4">ยอดเบิกจ่าย: <span className="font-mono font-bold text-amber-600">฿{data.totalAdvancesApproved.toLocaleString("th-TH")}</span></p>
        </div>
        <div className="mt-3 border-t pt-2">
          <p className="font-bold text-stone-800 mb-1.5 text-[11px]">Top 3 ประเภทการใช้จ่าย:</p>
          {data.topCategories.length > 0 ? (
            <ul className="space-y-1">
              {data.topCategories.map((c: any, idx: number) => (
                <li key={idx} className="flex justify-between gap-4 text-stone-600">
                  <span className="truncate">{c.category}</span>
                  <span className="font-mono font-bold">฿{c.amount.toLocaleString("th-TH")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-stone-400 italic">ไม่มีข้อมูลการใช้จ่าย</p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export default function ProjectCostsView() {
  const [projectBudgets, setProjectBudgets] = useState<{ [projectName: string]: number }>({});
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");

  useEffect(() => {
    // 1. Fetch Budgets
    const settingsRef = doc(db, "settings", "global");
    getDoc(settingsRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setProjectBudgets(data.projectBudgets || {});
      }
    }).catch(err => console.error("Error loading budgets: ", err));

    // 2. Fetch Advances
    const unsubscribe = onSnapshot(collection(db, "advances"), (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Advance);
      });
      setAdvances(list);
      setLoading(false);
    }, (err) => {
      console.error("Error in onSnapshot for advances inside ProjectCostsView:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Compute Project statistics
  const getProjectCostData = (): ProjectCostData[] => {
    // Map projects
    const projectsSet = new Set<string>();
    
    // Add all defined projects in budgets
    Object.keys(projectBudgets).forEach((p) => projectsSet.add(p));
    // Add any projects found in advances
    advances.forEach((a) => {
      if (a.projectId) projectsSet.add(a.projectId);
    });

    const list: ProjectCostData[] = [];

    projectsSet.forEach((projName) => {
      const projAdvances = advances.filter((a) => a.projectId === projName);
      
      const budget = projectBudgets[projName] || 0;

      const totalAdvancesRequested = projAdvances.reduce((sum, a) => {
        if (a.status !== AdvanceStatus.REJECTED) {
          return sum + (a.requestAmount || 0);
        }
        return sum;
      }, 0);

      const totalAdvancesApproved = projAdvances.reduce((sum, a) => {
        const isApproved = [
          AdvanceStatus.WAITING_TRANSFER,
          AdvanceStatus.WAITING_CLEARANCE,
          AdvanceStatus.PENDING_AUDIT,
          AdvanceStatus.PARTIALLY_CLEARED,
          AdvanceStatus.CLOSED
        ].includes(a.status);
        if (isApproved) {
          return sum + (a.requestAmount || 0);
        }
        return sum;
      }, 0);

      const totalClearedAmount = projAdvances.reduce((sum, a) => {
        return sum + (a.approvedClearingAmountTotal || 0);
      }, 0);

      const categorySpending: { [category: string]: number } = {};
      projAdvances.forEach(a => {
        const cat = a.category || "ไม่ระบุ";
        categorySpending[cat] = (categorySpending[cat] || 0) + (a.approvedClearingAmountTotal || 0);
      });
      const topCategories = Object.entries(categorySpending)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3);

      const usagePercentage = budget > 0 ? (totalAdvancesApproved / budget) * 100 : 0;

      list.push({
        projectName: projName,
        budget,
        totalAdvancesRequested,
        totalAdvancesApproved,
        totalClearedAmount,
        usagePercentage,
        topCategories
      });
    });

    return list.sort((a, b) => b.usagePercentage - a.usagePercentage);
  };

  const projectCosts = getProjectCostData();

  // Summary figures
  const totalBudget = (Object.values(projectBudgets) as number[]).reduce((sum, val) => sum + Number(val || 0), 0);
  const totalApprovedAllProjects = projectCosts.reduce((sum, p) => sum + p.totalAdvancesApproved, 0);
  const totalClearedAllProjects = projectCosts.reduce((sum, p) => sum + p.totalClearedAmount, 0);
  const overBudgetProjectsCount = projectCosts.filter((p) => p.budget > 0 && p.totalAdvancesApproved > p.budget).length;

  return (
    <div className="space-y-6" id="project_costs_manager_menu">
      
      {/* Header Block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 border border-stone-200 rounded-3xl shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">ควบคุมต้นทุนและงบประมาณ (Project Cost Control)</h2>
          <p className="text-xs text-stone-500 mt-1">
            รายงานวิเคราะห์ค่าใช้จ่ายของพนักงานเปรียบเทียบกับกรอบงบประมาณของแต่ละโครงการ เพื่อควบคุมความเสี่ยง
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-xl border border-stone-200 shrink-0">
          <button
            onClick={() => {
              const dataToExport = projectCosts.map(proj => ({
                "ชื่อโครงการ": proj.projectName,
                "งบประมาณ (บาท)": proj.budget,
                "ยอดอนุมัติเบิกทั้งหมด (บาท)": proj.totalAdvancesApproved,
                "ยอดเคลียร์ค่าใช้จ่ายจริง (บาท)": proj.totalClearedAmount,
                "เปอร์เซ็นต์การใช้งาน (%)": proj.usagePercentage.toFixed(2),
                "สถานะความเสี่ยง": proj.budget === 0 ? "ยังไม่ตั้งงบ" : 
                                 (proj.totalAdvancesApproved > proj.budget) ? "เกินงบประมาณ (วิกฤต)" :
                                 (proj.usagePercentage > 75) ? "ใกล้เต็ม (เฝ้าระวัง)" : "ปลอดภัย"
              }));
              exportToExcel(dataToExport, "Project_Costs_Control");
            }}
            className="p-2 rounded-lg text-stone-500 hover:text-emerald-600 hover:bg-white transition-all"
            title="ส่งออกไฟล์ Excel"
          >
            <Download className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-stone-200 self-center mx-0.5" />
          <button
            onClick={() => setViewMode("table")}
            className={`p-2 rounded-lg transition-all ${
              viewMode === "table" ? "bg-white text-stone-950 shadow-xs font-bold" : "text-stone-500 hover:text-stone-900"
            }`}
            title="มุมมองตาราง"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("card")}
            className={`p-2 rounded-lg transition-all ${
              viewMode === "card" ? "bg-white text-stone-950 shadow-xs font-bold" : "text-stone-500 hover:text-stone-900"
            }`}
            title="มุมมองการ์ด"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-xs">
        <h3 className="text-sm font-bold text-stone-900 mb-6">ภาพรวมเปรียบเทียบงบประมาณ vs การเบิกจ่าย</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projectCosts.filter(p => p.budget > 0)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="projectName" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="budget" name="งบประมาณ" fill="#a8a29e" />
              <Bar dataKey="totalAdvancesApproved" name="ยอดเบิกจ่าย" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bento Grid Analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Budget */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4.5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-stone-400 font-extrabold uppercase tracking-widest block">งบประมาณรวมทุกโครงการ</span>
            <span className="font-mono text-xl font-extrabold text-stone-900">
              ฿{totalBudget.toLocaleString("th-TH")}
            </span>
            <span className="text-[10px] text-stone-400 block font-medium">กรอบงบประมาณจากหน้าตั้งค่า</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-center text-stone-600">
            <Coins className="w-5 h-5" />
          </div>
        </div>

        {/* Total Advances Approved */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4.5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-stone-400 font-extrabold uppercase tracking-widest block">อนุมัติเบิกสะสมแล้ว</span>
            <span className="font-mono text-xl font-extrabold text-amber-600">
              ฿{totalApprovedAllProjects.toLocaleString("th-TH")}
            </span>
            <span className="text-[10px] text-stone-400 block font-medium">
              คิดเป็น {totalBudget > 0 ? ((totalApprovedAllProjects / totalBudget) * 100).toFixed(1) : 0}% ของงบรวม
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Total Cleared Expenditures */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4.5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-stone-400 font-extrabold uppercase tracking-widest block">ค่าใช้จ่ายจริง (ใบเสร็จ)</span>
            <span className="font-mono text-xl font-extrabold text-emerald-600">
              ฿{totalClearedAllProjects.toLocaleString("th-TH")}
            </span>
            <span className="text-[10px] text-stone-400 block font-medium">
              หักล้างแล้ว {totalApprovedAllProjects > 0 ? ((totalClearedAllProjects / totalApprovedAllProjects) * 100).toFixed(1) : 0}%
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-600">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Danger warning */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4.5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-stone-400 font-extrabold uppercase tracking-widest block">โครงการเกินงบประมาณ</span>
            <span className={`font-mono text-xl font-extrabold ${overBudgetProjectsCount > 0 ? "text-red-500 animate-pulse" : "text-stone-900"}`}>
              {overBudgetProjectsCount} โครงการ
            </span>
            <span className="text-[10px] text-stone-400 block font-medium">
              {overBudgetProjectsCount > 0 ? "⚠️ มีโครงการความเสี่ยงสูง!" : "✅ ทุกโครงการอยู่ในเกณฑ์ปลอดภัย"}
            </span>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
            overBudgetProjectsCount > 0 ? "bg-red-50 border-red-200 text-red-600" : "bg-stone-50 border-stone-200 text-stone-600"
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Content Render */}
      {loading ? (
        <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-xs">
          <div className="animate-pulse space-y-4 max-w-md mx-auto">
            <div className="h-4 bg-stone-200 rounded w-1/3 mx-auto"></div>
            <div className="h-8 bg-stone-200 rounded"></div>
            <div className="h-4 bg-stone-200 rounded w-2/3 mx-auto"></div>
          </div>
        </div>
      ) : projectCosts.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-xs space-y-3">
          <BarChart3 className="w-10 h-10 text-stone-300 mx-auto" />
          <h3 className="font-bold text-stone-800 text-sm">ไม่พบข้อมูลโครงการใด ๆ ในระบบ</h3>
          <p className="text-xs text-stone-400 max-w-sm mx-auto">
            กรุณาตั้งค่าโครงการก่อสร้างก่อน เพื่อใช้วิเคราะห์เปรียบเทียบต้นทุนโครงการที่นี่
          </p>
        </div>
      ) : viewMode === "table" ? (
        
        /* TABLE VIEW */
        <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                  <th className="py-3.5 px-5">ชื่อโครงการก่อสร้าง</th>
                  <th className="py-3.5 px-5 text-right">งบประมาณโครงการ</th>
                  <th className="py-3.5 px-5 text-right">ยอดอนุมัติเบิกทั้งหมด</th>
                  <th className="py-3.5 px-5 text-right">ยอดเคลียร์ค่าใช้จ่ายจริง (ใบเสร็จ)</th>
                  <th className="py-3.5 px-5 text-right">การใช้งานงบประมาณ</th>
                  <th className="py-3.5 px-5 text-right">ความเสี่ยงงบประมาณ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 font-medium text-stone-700">
                {projectCosts.map((proj) => {
                  const isOver = proj.budget > 0 && proj.totalAdvancesApproved > proj.budget;
                  return (
                    <tr key={proj.projectName} className="hover:bg-stone-50/40 transition">
                      <td className="py-4 px-5 font-bold text-stone-900">
                        <div className="flex items-center gap-2">
                          <Briefcase className="w-4 h-4 text-stone-400 shrink-0" />
                          <span>{proj.projectName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-right font-mono font-bold text-stone-800">
                        {proj.budget > 0 ? `฿${proj.budget.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "ไม่มีงบประมาณ"}
                      </td>
                      <td className="py-4 px-5 text-right font-mono font-bold text-amber-600">
                        ฿{proj.totalAdvancesApproved.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-5 text-right font-mono font-bold text-emerald-600">
                        ฿{proj.totalClearedAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-5 text-right font-mono">
                        <span className={`font-bold ${isOver ? "text-red-600 font-extrabold" : proj.usagePercentage > 75 ? "text-amber-600" : "text-stone-600"}`}>
                          {proj.usagePercentage.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-4 px-5 text-right">
                        {proj.budget === 0 ? (
                          <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-100 text-stone-500 rounded-full">ยังไม่ตั้งงบ</span>
                        ) : isOver ? (
                          <span className="px-2.5 py-1 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-full">เกินงบประมาณ (วิกฤต)</span>
                        ) : proj.usagePercentage > 75 ? (
                          <span className="px-2.5 py-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full">ใกล้เต็ม (เฝ้าระวัง)</span>
                        ) : (
                          <span className="px-2.5 py-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">ปลอดภัย</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        
        /* CARD VIEW (BENTO CHART CARDS) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projectCosts.map((proj) => {
            const isOver = proj.budget > 0 && proj.totalAdvancesApproved > proj.budget;
            const remaining = proj.budget - proj.totalAdvancesApproved;
            return (
              <div
                key={proj.projectName}
                className={`bg-white border rounded-2xl p-5 shadow-xs flex flex-col justify-between gap-4 transition hover:shadow-sm ${
                  isOver ? "border-red-200 ring-1 ring-red-100/50" : "border-stone-200"
                }`}
              >
                <div className="space-y-3.5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-stone-900 text-sm truncate">{proj.projectName}</h4>
                      <p className="text-[10px] text-stone-400 font-mono mt-0.5">Budget Target Center</p>
                    </div>
                    {proj.budget === 0 ? (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-500 rounded-md">ยังไม่กำหนดงบ</span>
                    ) : isOver ? (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-md">เกินงบประมาณ</span>
                    ) : (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-stone-950 text-stone-50 rounded-md">ปกติ</span>
                    )}
                  </div>

                  {/* Budget usage visual meter */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span className="text-stone-500">อัตราการใช้งบ:</span>
                      <span className={isOver ? "text-red-600 font-extrabold" : proj.usagePercentage > 75 ? "text-amber-600" : "text-stone-800"}>
                        {proj.usagePercentage.toFixed(1)}%
                      </span>
                    </div>
                    
                    <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden border border-stone-200/40">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isOver ? "bg-red-500" : proj.usagePercentage > 75 ? "bg-amber-500" : "bg-stone-900"
                        }`}
                        style={{ width: `${Math.min(proj.usagePercentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Detailed metrics inside card */}
                  <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-stone-100 text-xs">
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold block">กรอบงบประมาณ</span>
                      <span className="font-mono font-bold text-stone-900">
                        {proj.budget > 0 ? `฿${proj.budget.toLocaleString("th-TH")}` : "ไม่จำกัด"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold block">อนุมัติเบิกจริง</span>
                      <span className="font-mono font-bold text-amber-600">
                        ฿{proj.totalAdvancesApproved.toLocaleString("th-TH")}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold block">หักล้างจริง (ใบเสร็จ)</span>
                      <span className="font-mono font-bold text-emerald-600">
                        ฿{proj.totalClearedAmount.toLocaleString("th-TH")}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold block">
                        {remaining >= 0 ? "งบประมาณคงเหลือ" : "ใช้เกินงบประมาณ"}
                      </span>
                      <span className={`font-mono font-bold ${remaining >= 0 ? "text-stone-700" : "text-red-600 font-extrabold"}`}>
                        ฿{Math.abs(remaining).toLocaleString("th-TH")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
