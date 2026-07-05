import React, { useState, useEffect, useMemo } from "react";
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  writeBatch,
  getDocs,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Employee, RolePermissionsConfig, UserRole } from "../../types";
import { mergeRolePermissions, resolvePositionId } from "../../lib/permissionEngine";
import { sendLineBindInvite } from "../../lib/lineNotify";
import { 
  Search, 
  Plus, 
  Filter, 
  MoreVertical, 
  Download, 
  Upload, 
  User, 
  Building2, 
  Mail, 
  Phone,
  Trash2,
  Edit2,
  X,
  Check,
  ChevronDown,
  RefreshCw,
  FileSpreadsheet,
  AlertCircle,
  Link2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";

export default function EmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleConfig, setRoleConfig] = useState<RolePermissionsConfig | undefined>(undefined);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [bindingInviteIds, setBindingInviteIds] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [importSummary, setImportSummary] = useState({ success: 0, failed: 0, errors: [] as string[] });

  // Pagination (Server-side simplified with local slice for small sets, or full Firestore pagination for large)
  // For Sprint 1, we will use onSnapshot but with a limit or basic search filter
  useEffect(() => {
    const q = query(collection(db, "employees"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(emps);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "settings", "global"), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setRoleConfig(mergeRolePermissions(data.rolePermissions as RolePermissionsConfig | undefined));
    });
    return () => unsubscribe();
  }, []);

  const handleSendLineBindInvite = async (employeeId: string) => {
    setBindingInviteIds((prev) => new Set(prev).add(employeeId));
    try {
      const result = await sendLineBindInvite(employeeId);
      if (result?.status === "skipped") {
        console.warn(result.message || "LINE bind invite skipped.");
      }
    } finally {
      setBindingInviteIds((prev) => {
        const next = new Set(prev);
        next.delete(employeeId);
        return next;
      });
    }
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const matchesSearch = 
        emp.name?.toLowerCase().includes(search.toLowerCase()) || 
        emp.employeeCode?.toLowerCase().includes(search.toLowerCase()) ||
        emp.username?.toLowerCase().includes(search.toLowerCase()) ||
        emp.department?.toLowerCase().includes(search.toLowerCase()) ||
        emp.positionName?.toLowerCase().includes(search.toLowerCase()) ||
        emp.lineUserId?.toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter === "all" || emp.role === roleFilter;
      const matchesPosition = positionFilter === "all" || resolvePositionId(emp) === positionFilter;
      const matchesStatus = statusFilter === "all" || emp.status === statusFilter;
      return matchesSearch && matchesRole && matchesPosition && matchesStatus;
    });
  }, [employees, search, roleFilter, positionFilter, statusFilter]);

  const handleExport = (format: "xlsx" | "csv" | "json") => {
    const data = filteredEmployees.map(({ id, pinHash, ...rest }) => rest);
    if (format === "json") {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees_${new Date().toISOString()}.json`;
      a.click();
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Employees");
      XLSX.writeFile(wb, `employees_${new Date().toISOString()}.${format === "xlsx" ? "xlsx" : "csv"}`);
    }
  };

  const handleBulkImport = async (file: File) => {
    setImportStatus("processing");
    setImportProgress(0);
    setImportSummary({ success: 0, failed: 0, errors: [] });

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const total = jsonData.length;
        let successCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        // Batch processing (Firestore limit is 500 per batch)
        const batchSize = 500;
        for (let i = 0; i < total; i += batchSize) {
          const batch = writeBatch(db);
          const chunk = jsonData.slice(i, i + batchSize);

          chunk.forEach((item, index) => {
            const employeeId = item.employeeId || item.id || doc(collection(db, "employees")).id;
            const empData: Partial<Employee> = {
              employeeCode: item.employeeCode || "",
              name: item.name || "",
              nickname: item.nickname || "",
              username: item.username || item.employeeCode || "",
              email: item.email || "",
              phone: item.phone || "",
              role: (item.role as UserRole) || UserRole.EMPLOYEE,
              status: item.status || "Active",
              department: item.department || "",
              position: item.position || "",
              company: item.company || "",
              bankName: item.bankName || "",
              bankNo: item.bankNo || "",
              bankAccountName: item.bankAccountName || "",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            const docRef = doc(db, "employees", employeeId);
            batch.set(docRef, empData, { merge: true });
            successCount++;
          });

          await batch.commit();
          setImportProgress(Math.round(((i + chunk.length) / total) * 100));
        }

        setImportStatus("success");
        setImportSummary({ success: successCount, failed: failedCount, errors });
      };
      reader.readAsArrayBuffer(file);
    } catch (error: any) {
      setImportStatus("error");
      setImportSummary(prev => ({ ...prev, errors: [error.message] }));
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("คุณแน่ใจหรือไม่ที่จะลบพนักงานคนนี้?")) {
      try {
        await deleteDoc(doc(db, "employees", id));
      } catch (error) {
        console.error("Error deleting employee:", error);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Mobile Sticky Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">จัดการพนักงาน</h2>
          <p className="text-[10px] text-stone-500 font-medium">จัดการรายชื่อ บทบาท และสถานะ</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition"
          >
            <Upload className="w-5 h-5" />
          </button>
          <button 
            onClick={() => handleExport("xlsx")}
            className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text"
            placeholder="ค้นหาชื่อ, รหัสพนักงาน, ยูเซอร์เนม..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
          />
        </div>
        
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select 
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกบทบาท</option>
            {Object.values(UserRole).map(role => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกตำแหน่ง</option>
            {(roleConfig?.roles || []).map((role) => (
              <option key={role.id} value={role.id}>{role.displayName}</option>
            ))}
          </select>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-[11px] font-bold text-stone-600 shrink-0"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="Active">Active</option>
            <option value="Disabled">Disabled</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Employee List (Mobile Cards / Desktop Table) */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
            <span className="text-xs text-stone-400 font-medium">กำลังดึงข้อมูลพนักงาน...</span>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
            <User className="w-12 h-12 text-stone-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-stone-500">ไม่พบรายชื่อพนักงาน</p>
            <p className="text-xs text-stone-400 mt-1">ลองค้นหาด้วยคำค้นอื่น</p>
          </div>
        ) : (
          filteredEmployees.map(emp => (
            <motion.div 
              layout
              key={emp.id}
              className="bg-white p-4 rounded-3xl border border-stone-200 shadow-sm flex items-center gap-4 relative overflow-hidden group"
            >
              <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0 border border-stone-100 overflow-hidden">
                {emp.profileImage ? (
                  <img src={emp.profileImage} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-6 h-6 text-stone-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-stone-900 truncate">{emp.name}</h4>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                    emp.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}>
                    {emp.status || "Active"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  <p className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {emp.employeeCode || "N/A"}
                  </p>
                  <p className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> {emp.role}
                  </p>
                  <p className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                    <Filter className="w-3 h-3" /> {roleConfig?.roles.find((role) => role.id === resolvePositionId(emp))?.displayName || resolvePositionId(emp)}
                  </p>
                  {emp.department && (
                    <p className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> {emp.department}
                    </p>
                  )}
                  <p className={`text-[10px] font-bold flex items-center gap-1 ${emp.lineUserId ? "text-emerald-600" : "text-amber-600"}`}>
                    <Link2 className="w-3 h-3" /> {emp.lineUserId ? "LINE linked" : "LINE not linked"}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {!emp.lineUserId && (
                  <button
                    onClick={() => handleSendLineBindInvite(emp.id)}
                    disabled={bindingInviteIds.has(emp.id)}
                    className="p-2 text-stone-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition disabled:opacity-50"
                    title="ส่งปุ่มผูก LINE ไปที่กลุ่ม"
                  >
                    {bindingInviteIds.has(emp.id) ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  </button>
                )}
                <button 
                  onClick={() => setEditingEmployee(emp)}
                  className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-xl transition"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(emp.id)}
                  className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <button 
        onClick={() => setIsAddModalOpen(true)}
        className="fixed right-6 bottom-6 w-14 h-14 bg-stone-950 text-white rounded-2xl shadow-xl flex items-center justify-center active:scale-95 transition-transform z-30"
      >
        <Plus className="w-7 h-7" />
      </button>

      {/* Add/Edit Modal (Full Screen for Mobile) */}
      <AnimatePresence>
        {(isAddModalOpen || editingEmployee) && (
          <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-50 bg-white flex flex-col"
          >
            <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-4 flex items-center justify-between">
              <button 
                onClick={() => { setIsAddModalOpen(false); setEditingEmployee(null); }}
                className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl"
              >
                <X className="w-6 h-6" />
              </button>
              <h3 className="font-bold text-stone-900">
                {editingEmployee ? "แก้ไขพนักงาน" : "เพิ่มพนักงานใหม่"}
              </h3>
              <button 
                form="employee-form"
                type="submit"
                className="px-5 py-2 bg-stone-950 text-white rounded-xl font-bold text-sm"
              >
                บันทึก
              </button>
            </div>
            
            <form 
              id="employee-form"
              className="flex-1 overflow-y-auto p-6 space-y-6"
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data: Partial<Employee> = {
                  employeeCode: formData.get("employeeCode") as string,
                  name: formData.get("name") as string,
                  nickname: formData.get("nickname") as string,
                  username: formData.get("username") as string,
                  email: formData.get("email") as string,
                  phone: formData.get("phone") as string,
                  role: formData.get("role") as UserRole,
                  roleId: formData.get("positionId") as string,
                  positionId: formData.get("positionId") as string,
                  positionName: roleConfig?.roles.find((role) => role.id === formData.get("positionId"))?.displayName || "",
                  department: formData.get("department") as string,
                  position: formData.get("position") as string,
                  managedProjectIds: String(formData.get("managedProjectIds") || "").split(",").map((item) => item.trim()).filter(Boolean),
                  projectIds: String(formData.get("projectIds") || "").split(",").map((item) => item.trim()).filter(Boolean),
                  lineUserId: formData.get("lineUserId") as string,
                  lineDisplayName: formData.get("lineDisplayName") as string,
                  linePictureUrl: formData.get("linePictureUrl") as string,
                  company: formData.get("company") as string,
                  bankName: formData.get("bankName") as string,
                  bankNo: formData.get("bankNo") as string,
                  bankAccountName: formData.get("bankAccountName") as string,
                  status: formData.get("status") as any,
                  updatedAt: new Date().toISOString(),
                };

                try {
                  if (editingEmployee) {
                    await updateDoc(doc(db, "employees", editingEmployee.id), data);
                  } else {
                    const newId = doc(collection(db, "employees")).id;
                    await setDoc(doc(db, "employees", newId), {
                      ...data,
                      id: newId,
                      createdAt: new Date().toISOString(),
                      pinHash: "default", // Should handle PIN securely
                    });
                    await handleSendLineBindInvite(newId);
                  }
                  setIsAddModalOpen(false);
                  setEditingEmployee(null);
                } catch (err) {
                  console.error("Save error:", err);
                }
              }}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">รหัสพนักงาน</label>
                    <input name="employeeCode" defaultValue={editingEmployee?.employeeCode} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">สถานะ</label>
                    <select name="status" defaultValue={editingEmployee?.status || "Active"} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold">
                      <option value="Active">Active</option>
                      <option value="Disabled">Disabled</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อ-นามสกุล</label>
                  <input name="name" defaultValue={editingEmployee?.name} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" required />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อเล่น</label>
                    <input name="nickname" defaultValue={editingEmployee?.nickname} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">บทบาท</label>
                    <select name="role" defaultValue={editingEmployee?.role || UserRole.EMPLOYEE} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold">
                      {Object.values(UserRole).map(role => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">อีเมล</label>
                  <input name="email" type="email" defaultValue={editingEmployee?.email} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">แผนก</label>
                    <input name="department" defaultValue={editingEmployee?.department} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">ตำแหน่ง</label>
                    <input name="position" defaultValue={editingEmployee?.position} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-500 uppercase">Position จาก settings/global</label>
                  <select name="positionId" defaultValue={resolvePositionId(editingEmployee || undefined)} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold">
                    {(roleConfig?.roles || []).map((role) => (
                      <option key={role.id} value={role.id}>{role.displayName} ({role.id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Managed Project IDs</label>
                    <input name="managedProjectIds" defaultValue={(editingEmployee?.managedProjectIds || []).join(", ")} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Project IDs</label>
                    <input name="projectIds" defaultValue={(editingEmployee?.projectIds || []).join(", ")} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-stone-100">
                  <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest">LINE Profile</h4>
                  <input name="lineUserId" placeholder="LINE User ID ต้องขึ้นต้น U" defaultValue={editingEmployee?.lineUserId} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  <input name="lineDisplayName" placeholder="LINE Display Name" defaultValue={editingEmployee?.lineDisplayName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  <input name="linePictureUrl" placeholder="LINE Picture URL" defaultValue={editingEmployee?.linePictureUrl} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                </div>

                <div className="space-y-4 pt-4 border-t border-stone-100">
                  <h4 className="text-xs font-bold text-stone-400 flex items-center gap-2 uppercase tracking-widest">
                    ข้อมูลบัญชีธนาคาร
                  </h4>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อธนาคาร</label>
                    <input name="bankName" defaultValue={editingEmployee?.bankName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-stone-500 uppercase">เลขที่บัญชี</label>
                      <input name="bankNo" defaultValue={editingEmployee?.bankNo} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-stone-500 uppercase">ชื่อบัญชี</label>
                      <input name="bankAccountName" defaultValue={editingEmployee?.bankAccountName} className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold" />
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-stone-900">นำเข้าข้อมูลพนักงาน</h3>
                  <button onClick={() => setIsImportModalOpen(false)} className="p-1 text-stone-400 hover:text-stone-900">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                {importStatus === "idle" ? (
                  <div className="space-y-4">
                    <div 
                      className="border-2 border-dashed border-stone-200 rounded-3xl p-10 flex flex-col items-center justify-center gap-3 bg-stone-50 hover:bg-stone-100/50 transition cursor-pointer relative"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) handleBulkImport(file);
                      }}
                    >
                      <input 
                        type="file" 
                        accept=".xlsx,.csv" 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleBulkImport(file);
                        }}
                      />
                      <div className="w-12 h-12 bg-stone-200 text-stone-500 rounded-2xl flex items-center justify-center">
                        <Upload className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-bold text-stone-900">ลากไฟล์วางที่นี่ หรือคลิกเพื่อเลือก</p>
                      <p className="text-xs text-stone-400">รองรับไฟล์ .xlsx และ .csv</p>
                    </div>
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                      <p className="text-[10px] text-blue-700 leading-relaxed">
                        <span className="font-bold">คำแนะนำ:</span> ไฟล์ต้องมีหัวตาราง (Header) ตรงกับชื่อฟิลด์ เช่น name, employeeCode, email, role เป็นต้น
                      </p>
                    </div>
                  </div>
                ) : importStatus === "processing" ? (
                  <div className="py-10 flex flex-col items-center justify-center gap-6">
                    <div className="relative w-24 h-24">
                      <svg className="w-full h-full" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#f5f5f4" strokeWidth="8" />
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#0c0a09" strokeWidth="8" strokeDasharray={283} strokeDashoffset={283 - (283 * importProgress) / 100} strokeLinecap="round" className="transition-all duration-300" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xl font-black text-stone-900">{importProgress}%</span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-stone-900 italic animate-pulse">กำลังประมวลผลข้อมูลขนาดใหญ่...</p>
                      <p className="text-xs text-stone-400 mt-1">ห้ามปิดหน้านี้จนกว่าจะเสร็จสิ้น</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className={`p-4 rounded-2xl border ${importStatus === "success" ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                      <div className="flex items-center gap-3">
                        {importStatus === "success" ? (
                          <Check className="w-6 h-6 text-emerald-600" />
                        ) : (
                          <AlertCircle className="w-6 h-6 text-red-600" />
                        )}
                        <div>
                          <p className={`text-sm font-bold ${importStatus === "success" ? "text-emerald-900" : "text-red-900"}`}>
                            {importStatus === "success" ? "นำเข้าสำเร็จ!" : "เกิดข้อผิดพลาดในการนำเข้า"}
                          </p>
                          <p className="text-xs text-emerald-600">สำเร็จ {importSummary.success} รายการ</p>
                        </div>
                      </div>
                    </div>
                    {importSummary.errors.length > 0 && (
                      <div className="max-h-32 overflow-y-auto bg-stone-50 p-3 rounded-xl border border-stone-200 space-y-1">
                        {importSummary.errors.map((err, idx) => (
                          <p key={idx} className="text-[10px] text-red-500 font-medium">Row {idx + 1}: {err}</p>
                        ))}
                      </div>
                    )}
                    <button 
                      onClick={() => setIsImportModalOpen(false)}
                      className="w-full py-3 bg-stone-950 text-white rounded-2xl font-bold text-sm"
                    >
                      ตกลง
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
