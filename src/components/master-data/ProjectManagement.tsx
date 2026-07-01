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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  useEffect(() => {
    const q = query(collection(db, "projects"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(projs);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
      } catch (error) {
        console.error("Error deleting project:", error);
      }
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

      {/* Project List */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-3">
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
              className="bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4"
            >
              <div className="flex items-start justify-between">
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

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stone-100">
                <div className="space-y-1">
                  <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">งบโครงการ</p>
                  <p className="text-xs font-black text-stone-900">฿{proj.budget?.toLocaleString()}</p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">PM</p>
                  <p className="text-xs font-bold text-stone-700">{proj.pmName}</p>
                </div>
              </div>
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
      </AnimatePresence>
    </div>
  );
}
