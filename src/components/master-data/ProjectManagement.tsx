import React, { useState, useEffect, useMemo } from "react";
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Project } from "../../types";
import { 
  Search, 
  Plus, 
  Filter, 
  Download, 
  Upload, 
  Briefcase, 
  Calendar,
  Building2,
  Trash2,
  Edit2,
  X,
  RefreshCw,
  MoreVertical,
  ChevronRight,
  DollarSign
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";

export default function ProjectManagement() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedCostProject, setSelectedCostProject] = useState<Project | null>(null);

  useEffect(() => {
    const q = query(collection(db, "projects"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Project));
      setProjects(projs);
      setLoading(false);
    }, (err) => {
      console.error("Error subscribing to projects:", err);
      setLoading(false);
    });

    const qAdvs = query(collection(db, "advances"));
    const unsubscribeAdvs = onSnapshot(qAdvs, (snapshot) => {
      const advs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setAdvances(advs);
    }, (err) => {
      console.error("Error subscribing to advances:", err);
    });

    return () => {
      unsubscribe();
      unsubscribeAdvs();
    };
  }, []);

  const getProjectCostStats = (proj: Project) => {
    const key = proj.projectId || proj.projectCode || proj.id;
    const projectAdvances = advances.filter((advance) => {
      const advProjectKey = advance.projectId || advance.projectName || "ไม่ระบุโครงการ";
      return advProjectKey === key || advProjectKey === proj.projectName || advProjectKey === proj.projectCode;
    });

    const totalAdvanceRequested = projectAdvances.reduce((sum, item) => sum + Number(item.requestAmount || 0), 0);
    const totalAdvanceApproved = projectAdvances
      .filter((item) => !["Draft", "Rejected", "REJECTED", "DRAFT"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.approvedAmount || item.requestAmount || 0), 0);
    const totalClearingApproved = projectAdvances.reduce((sum, item) => sum + Number(item.approvedClearingAmountTotal || 0), 0);
    const outstandingAmount = projectAdvances.reduce((sum, item) => sum + Number(item.outstandingAmount || 0), 0);
    const budget = Number(proj.budget || proj.contractAmount || 0);

    return {
      totalAdvanceRequested,
      totalAdvanceApproved,
      totalClearingApproved,
      outstandingAmount,
      budget,
      remaining: budget - totalClearingApproved,
      advancesCount: projectAdvances.length,
    };
  };

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchesSearch = 
        p.projectName?.toLowerCase().includes(search.toLowerCase()) || 
        p.projectCode?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      const matchesCompany = companyFilter === "all" || p.companyName === companyFilter;
      return matchesSearch && matchesStatus && matchesCompany;
    });
  }, [projects, search, statusFilter, companyFilter]);

  const companies = useMemo(() => {
    const set = new Set(projects.map(p => p.companyName).filter(Boolean));
    return Array.from(set);
  }, [projects]);

  const handleExport = (format: "xlsx" | "csv" | "json") => {
    const data = filteredProjects.map(({ id, ...rest }) => rest);
    if (format === "json") {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `projects_${new Date().toISOString()}.json`;
      a.click();
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Projects");
      XLSX.writeFile(wb, `projects_${new Date().toISOString()}.${format === "xlsx" ? "xlsx" : "csv"}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("คุณแน่ใจหรือไม่ที่จะลบโครงการนี้?")) {
      try {
        await deleteDoc(doc(db, "projects", id));
        setSelectedIds(prev => prev.filter(item => item !== id));
      } catch (error) {
        console.error("Error deleting project:", error);
      }
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const validIds = selectedIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
    if (validIds.length === 0) {
      alert("ไม่มีโครงการที่เลือกที่ถูกต้องเพื่อลบ");
      return;
    }
    if (window.confirm(`คุณแน่ใจหรือไม่ที่จะลบโครงการที่เลือกทั้งหมด ${validIds.length} รายการอย่างถาวร?`)) {
      try {
        const batch = writeBatch(db);
        validIds.forEach((id) => {
          batch.delete(doc(db, "projects", id));
        });
        await batch.commit();
        setSelectedIds([]);
      } catch (error) {
        console.error("Error bulk deleting projects:", error);
        alert("เกิดข้อผิดพลาดในการลบโครงการแบบกลุ่ม");
      }
    }
  };

  const handleBulkUpdateStatus = async (status: string) => {
    if (selectedIds.length === 0) return;
    const validIds = selectedIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
    if (validIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      validIds.forEach((id) => {
        batch.update(doc(db, "projects", id), { 
          status,
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
      setSelectedIds([]);
    } catch (error) {
      console.error("Error bulk updating project status:", error);
      alert("เกิดข้อผิดพลาดในการอัปเดตสถานะแบบกลุ่ม");
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Mobile Sticky Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">จัดการโครงการ</h2>
          <p className="text-[10px] text-stone-500 font-medium">จัดการงบประมาณและข้อมูลโครงการ</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => handleExport("xlsx")}
            className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text"
            placeholder="ค้นหาชื่อโครงการ, รหัส..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
          />
        </div>
        
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select 
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกบริษัท</option>
            {companies.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Selection Control */}
      {!loading && filteredProjects.length > 0 && (
        <div className="px-4 py-3 flex items-center justify-between border-b border-stone-200 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <input 
              type="checkbox"
              checked={filteredProjects.length > 0 && selectedIds.length === filteredProjects.length}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedIds(filteredProjects.map(proj => proj.id));
                } else {
                  setSelectedIds([]);
                }
              }}
              className="w-4 h-4 accent-stone-900 rounded cursor-pointer"
              id="select-all-projects"
            />
            <label htmlFor="select-all-projects" className="text-xs text-stone-500 font-bold select-none cursor-pointer">
              เลือกทั้งหมด ({selectedIds.length}/{filteredProjects.length})
            </label>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkUpdateStatus(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="px-2.5 py-1 bg-white border border-stone-200 rounded-xl text-[10px] font-bold text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-900 cursor-pointer"
              >
                <option value="">เปลี่ยนสถานะแบบกลุ่ม...</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
                <option value="Suspended">Suspended</option>
              </select>
              <button 
                type="button"
                onClick={handleBulkDelete}
                className="px-3 py-1 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[10px] font-bold hover:bg-red-100 transition flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> ลบที่เลือก
              </button>
            </div>
          )}
        </div>
      )}

      {/* Project List */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-3 pt-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
            <span className="text-xs text-stone-400 font-medium">กำลังโหลดข้อมูลโครงการ...</span>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
            <Briefcase className="w-12 h-12 text-stone-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-stone-500">ไม่พบโครงการ</p>
          </div>
        ) : (
          filteredProjects.map(proj => (
            <motion.div 
              layout
              key={proj.id}
              className={`bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4 flex flex-col relative overflow-hidden group transition-all ${
                selectedIds.includes(proj.id) ? "border-stone-400 bg-stone-50/50 ring-1 ring-stone-900/5" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center pt-1">
                  <input 
                    type="checkbox"
                    checked={selectedIds.includes(proj.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(prev => [...prev, proj.id]);
                      } else {
                        setSelectedIds(prev => prev.filter(id => id !== proj.id));
                      }
                    }}
                    className="w-4 h-4 accent-stone-900 rounded cursor-pointer shrink-0"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black text-stone-400 font-mono uppercase">{proj.projectCode}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                      proj.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-700"
                    }`}>
                      {proj.status}
                    </span>
                  </div>
                  <h4 className="font-bold text-stone-900 truncate leading-tight">{proj.projectName}</h4>
                  <p className="text-[10px] text-stone-500 font-medium mt-1">{proj.companyName} | {proj.clientName}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingProject(proj)} className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-xl transition">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(proj.id)} className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {(() => {
                const stats = getProjectCostStats(proj);
                const percentCleared = stats.budget > 0 ? (stats.totalClearingApproved / stats.budget) * 100 : 0;
                return (
                  <div className="space-y-3 pt-3 border-t border-stone-100">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block">งบประมาณโครงการ</span>
                        <span className="font-extrabold text-stone-950 text-[13px] font-mono">฿{stats.budget.toLocaleString("th-TH")}</span>
                      </div>
                      <div className="space-y-0.5 text-right">
                        <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block">เงินคงเหลือจริง</span>
                        <span className={`font-extrabold text-[13px] font-mono ${stats.remaining < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          ฿{stats.remaining.toLocaleString("th-TH")}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block">ยอดเบิกที่อนุมัติ</span>
                        <span className="font-bold text-stone-700 font-mono">฿{stats.totalAdvanceApproved.toLocaleString("th-TH")}</span>
                      </div>
                      <div className="space-y-0.5 text-right">
                        <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block">เคลียร์เสร็จสิ้น (Cleared)</span>
                        <span className="font-bold text-indigo-600 font-mono">฿{stats.totalClearingApproved.toLocaleString("th-TH")}</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-stone-500 font-semibold">ความคืบหน้าการเบิกจ่ายจริง (Cleared / Budget)</span>
                        <span className="font-bold text-stone-900">{percentCleared.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${percentCleared > 100 ? "bg-rose-500" : percentCleared > 80 ? "bg-amber-500" : "bg-indigo-600"}`}
                          style={{ width: `${Math.min(100, percentCleared)}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick Link/Detail View Button */}
                    <div className="flex items-center justify-between pt-2">
                      <div className="text-[10px] text-stone-500 font-medium">
                        รายการ ADV: <span className="font-bold text-stone-800">{stats.advancesCount} รายการ</span> | PM: <span className="font-bold text-stone-700">{proj.pmName || "-"}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCostProject(proj)}
                        className="text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <DollarSign className="w-3 h-3" /> ดูสรุปต้นทุนละเอียด
                      </button>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          ))
        )}
      </div>

      {/* FAB */}
      <button 
        onClick={() => setIsAddModalOpen(true)}
        className="fixed right-6 bottom-6 w-14 h-14 bg-stone-950 text-white rounded-2xl shadow-xl flex items-center justify-center active:scale-95 transition-transform z-30"
      >
        <Plus className="w-7 h-7" />
      </button>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(isAddModalOpen || editingProject) && (
          <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            className="fixed inset-0 z-50 bg-white flex flex-col"
          >
            <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-4 flex items-center justify-between">
              <button onClick={() => { setIsAddModalOpen(false); setEditingProject(null); }} className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl">
                <X className="w-6 h-6" />
              </button>
              <h3 className="font-bold text-stone-900">{editingProject ? "แก้ไขโครงการ" : "เพิ่มโครงการใหม่"}</h3>
              <button form="project-form" type="submit" className="px-5 py-2 bg-stone-950 text-white rounded-xl font-bold text-sm">บันทึก</button>
            </div>
            
            <form 
              id="project-form"
              className="flex-1 overflow-y-auto p-6 space-y-6"
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const projectId = String(formData.get("projectId") || formData.get("projectCode") || editingProject?.projectId || editingProject?.id || "").trim();
                const data: Partial<Project> = {
                  projectId,
                  projectCode: formData.get("projectCode") as string,
                  projectName: formData.get("projectName") as string,
                  companyName: formData.get("companyName") as string,
                  clientName: formData.get("clientName") as string,
                  pmName: formData.get("pmName") as string,
                  pmId: formData.get("pmId") as string,
                  contractAmount: Number(formData.get("contractAmount")) || 0,
                  budget: Number(formData.get("budget")),
                  pettyCashBudget: Number(formData.get("pettyCashBudget")),
                  location: formData.get("location") as string,
                  startDate: formData.get("startDate") as string,
                  endDate: formData.get("endDate") as string,
                  status: formData.get("status") as any,
                  updatedAt: new Date().toISOString(),
                };

                try {
                  if (editingProject) {
                    await updateDoc(doc(db, "projects", editingProject.id), data);
                  } else {
                    const newId = projectId || doc(collection(db, "projects")).id;
                    await setDoc(doc(db, "projects", newId), {
                      ...data,
                      id: newId,
                      createdAt: new Date().toISOString(),
                    });
                  }
                  setIsAddModalOpen(false);
                  setEditingProject(null);
                } catch (err) {
                  console.error("Save error:", err);
                }
              }}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">Project ID</label>
                  <input name="projectId" defaultValue={editingProject?.projectId || editingProject?.id || editingProject?.projectCode} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">รหัสโครงการ</label>
                    <input name="projectCode" defaultValue={editingProject?.projectCode} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">สถานะ</label>
                    <select name="status" defaultValue={editingProject?.status || "Active"} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold">
                      <option value="Active">Active</option>
                      <option value="Completed">Completed</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อโครงการ</label>
                  <input name="projectName" defaultValue={editingProject?.projectName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" required />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">มูลค่าสัญญา</label>
                  <input name="contractAmount" type="number" defaultValue={editingProject?.contractAmount || editingProject?.budget || 0} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">บริษัทเจ้าของ</label>
                    <input name="companyName" defaultValue={editingProject?.companyName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">ลูกค้า</label>
                    <input name="clientName" defaultValue={editingProject?.clientName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">งบประมาณโครงการ</label>
                    <input name="budget" type="number" defaultValue={editingProject?.budget} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">งบสำรองจ่าย (Petty Cash)</label>
                    <input name="pettyCashBudget" type="number" defaultValue={editingProject?.pettyCashBudget} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อ PM</label>
                    <input name="pmName" defaultValue={editingProject?.pmName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">รหัส PM</label>
                    <input name="pmId" defaultValue={editingProject?.pmId} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">วันที่เริ่ม</label>
                    <input name="startDate" type="date" defaultValue={editingProject?.startDate} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">วันที่สิ้นสุด</label>
                    <input name="endDate" type="date" defaultValue={editingProject?.endDate} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        )}

        {/* Detailed Cost Summary Modal */}
        {selectedCostProject && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-stone-900">สรุปต้นทุนและการเบิกจ่าย (Project Cost Control)</h3>
                    <p className="text-[11px] text-stone-500">โครงการ: {selectedCostProject.projectName} ({selectedCostProject.projectCode})</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedCostProject(null)}
                  className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Financial Overview Cards */}
                {(() => {
                  const stats = getProjectCostStats(selectedCostProject);
                  const projectAdvances = advances.filter((advance) => {
                    const advProjectKey = advance.projectId || advance.projectName || "ไม่ระบุโครงการ";
                    const key = selectedCostProject.projectId || selectedCostProject.projectCode || selectedCostProject.id;
                    return advProjectKey === key || advProjectKey === selectedCostProject.projectName || advProjectKey === selectedCostProject.projectCode;
                  });

                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-stone-50 border border-stone-150 p-4 rounded-2xl">
                          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-1">งบประมาณรวม</p>
                          <p className="text-sm font-black text-stone-900 font-mono">฿{stats.budget.toLocaleString("th-TH")}</p>
                        </div>
                        <div className="bg-indigo-50/40 border border-indigo-100 p-4 rounded-2xl">
                          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider mb-1">ยอดอนุมัติเบิก</p>
                          <p className="text-sm font-black text-indigo-700 font-mono">฿{stats.totalAdvanceApproved.toLocaleString("th-TH")}</p>
                        </div>
                        <div className="bg-emerald-50/40 border border-emerald-100 p-4 rounded-2xl">
                          <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-1">เคลียร์แล้ว</p>
                          <p className="text-sm font-black text-emerald-700 font-mono">฿{stats.totalClearingApproved.toLocaleString("th-TH")}</p>
                        </div>
                        <div className="bg-amber-50/40 border border-amber-100 p-4 rounded-2xl">
                          <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mb-1">เงินค้างเคลียร์</p>
                          <p className="text-sm font-black text-amber-700 font-mono">฿{stats.outstandingAmount.toLocaleString("th-TH")}</p>
                        </div>
                        <div className={`col-span-2 md:col-span-1 p-4 rounded-2xl border ${stats.remaining < 0 ? "bg-rose-50 border-rose-100 text-rose-700" : "bg-stone-900 text-stone-100 border-transparent"}`}>
                          <p className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-75">งบคงเหลือจริง</p>
                          <p className="text-sm font-black font-mono">฿{stats.remaining.toLocaleString("th-TH")}</p>
                        </div>
                      </div>

                      {/* Advance List for this project */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-black text-stone-900 uppercase tracking-wider">ประวัติการขอเงินทดรองจ่ายในโครงการ ({projectAdvances.length} รายการ)</h4>
                        
                        {projectAdvances.length === 0 ? (
                          <div className="py-12 text-center text-xs text-stone-400 bg-stone-50 rounded-2xl border border-dashed border-stone-200 italic">
                            ไม่มีรายการเบิกจ่ายค้างข้อมูลสำหรับโครงการนี้
                          </div>
                        ) : (
                          <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-sm overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                              <thead>
                                <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                  <th className="py-3 px-4">เลขที่ใบงาน (ADV ID)</th>
                                  <th className="py-3 px-4">วันที่ขอเบิก</th>
                                  <th className="py-3 px-4">ผู้ขอเบิก</th>
                                  <th className="py-3 px-4 text-right">ยอดเบิก</th>
                                  <th className="py-3 px-4 text-right">ยอดเคลียร์</th>
                                  <th className="py-3 px-4 text-right">ค้างเคลียร์</th>
                                  <th className="py-3 px-4 text-center">สถานะ</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-100 font-medium">
                                {projectAdvances.map((adv) => (
                                  <tr key={adv.id} className="hover:bg-stone-50/40">
                                    <td className="py-3 px-4 font-bold text-stone-900 font-mono">
                                      {adv.advanceNo || adv.id?.substring(0, 8).toUpperCase() || "ADV-TEMP"}
                                    </td>
                                    <td className="py-3 px-4 text-stone-500 font-mono">
                                      {adv.requestDate || adv.createdAt?.split("T")[0] || "-"}
                                    </td>
                                    <td className="py-3 px-4 font-bold text-stone-700">
                                      {adv.employeeName || adv.username || "-"}
                                    </td>
                                    <td className="py-3 px-4 text-right font-black font-mono text-stone-900">
                                      ฿{Number(adv.approvedAmount || adv.requestAmount || 0).toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right font-bold font-mono text-emerald-600">
                                      ฿{Number(adv.approvedClearingAmountTotal || 0).toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right font-bold font-mono text-amber-600">
                                      ฿{Number(adv.outstandingAmount || 0).toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                        adv.status === "Approved" || adv.status === "APPROVED" || adv.status === "TransferSuccess"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : adv.status === "Pending" || adv.status === "PENDING" || adv.status === "PendingApproval"
                                          ? "bg-amber-100 text-amber-700"
                                          : "bg-stone-100 text-stone-600"
                                      }`}>
                                        {adv.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-stone-50 border-t border-stone-100 flex justify-end">
                <button 
                  onClick={() => setSelectedCostProject(null)}
                  className="bg-stone-900 hover:bg-stone-850 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg transition-all"
                >
                  ปิดหน้านี้
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
