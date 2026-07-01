/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import ProfileImage from "./components/ProfileImage";
import PinLogin from "./components/PinLogin";
import Dashboard from "./components/Dashboard";
import AdvanceRequestForm from "./components/AdvanceRequestForm";
import ManagerApproval from "./components/ManagerApproval";
import EmployeeClearance from "./components/EmployeeClearance";
import AccountingReview from "./components/AccountingReview";
import SecureVault from "./components/SecureVault";
import AuditTrailLogs from "./components/AuditTrailLogs";
import AdminSettings from "./components/AdminSettings";
import DBDView from "./components/DBDView";
import ProjectCostsView from "./components/ProjectCostsView";
import PrinceAdvanceChat from "./components/PrinceAdvanceChat";
import OriginalDocTracking from "./components/OriginalDocTracking";
import CloseAccount from "./components/CloseAccount";
import AccountingReports from "./components/AccountingReports";
import ProfileSettings from "./components/ProfileSettings";
import UploadSlipLiff from "./components/UploadSlipLiff";
import { Employee, UserRole } from "./types";
import { db } from "./lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { LogOut, LayoutDashboard, Send, CheckSquare, Receipt, HardDrive, History, FileCheck2, User, ChevronRight, Settings, Plus, X as CloseIcon, BarChart3, TrendingUp, FileCheck, Lock, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => {
    const saved = localStorage.getItem("currentEmployee");
    return saved ? JSON.parse(saved) : null;
  });
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [editingDraftAdvance, setEditingDraftAdvance] = useState<any>(null);
  const [editingDraftClearingId, setEditingDraftClearingId] = useState<string | null>(null);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  React.useEffect(() => {
    if (currentEmployee) {
      // Create a clean object to save to localStorage to avoid cyclic structures
      // or complex Firestore types that cannot be serialized.
      const sanitizedEmployee = {
        ...currentEmployee,
        profilePhotoUpdatedAt: currentEmployee.profilePhotoUpdatedAt && typeof currentEmployee.profilePhotoUpdatedAt.toMillis === 'function' 
          ? { seconds: currentEmployee.profilePhotoUpdatedAt.toMillis() / 1000 }
          : currentEmployee.profilePhotoUpdatedAt
      };
      localStorage.setItem("currentEmployee", JSON.stringify(sanitizedEmployee));
    } else {
      localStorage.removeItem("currentEmployee");
    }
  }, [currentEmployee]);

  React.useEffect(() => {
    if (!currentEmployee?.id) return;

    const unsubscribe = onSnapshot(doc(db, "employees", currentEmployee.id), (snap) => {
      if (!snap.exists()) return;
      const latestEmployee = { id: snap.id, ...snap.data() } as Employee;
      setCurrentEmployee((prev) => {
        if (!prev || prev.id !== latestEmployee.id) return prev;
        return { ...prev, ...latestEmployee };
      });
    }, (err) => {
      console.warn("Could not refresh current employee profile:", err);
    });

    return () => unsubscribe();
  }, [currentEmployee?.id]);

  // Get mobile navigation items based on role
  const getMobileNavItems = () => {
    if (!currentEmployee) return [];
    
    const items = [
      { id: "dashboard", label: "หน้าแรก", icon: LayoutDashboard },
    ];

    if (currentEmployee.role === UserRole.EMPLOYEE) {
      items.push({ id: "request", label: "ขอเบิก", icon: Send });
      items.push({ id: "clearance", label: "เคลียร์ใบเสร็จ", icon: Receipt });
      items.push({ id: "vault", label: "ตู้นิรภัย", icon: HardDrive });
    } else if (currentEmployee.role === UserRole.MANAGER) {
      items.push({ id: "approval", label: "อนุมัติ", icon: CheckSquare });
      items.push({ id: "dbd", label: "DBD เบิกจ่าย", icon: BarChart3 });
      items.push({ id: "project_costs", label: "ต้นทุนโครงการ", icon: TrendingUp });
    } else if (currentEmployee.role === UserRole.ACCOUNTANT) {
      items.push({ id: "accounting", label: "ตรวจบัญชี", icon: FileCheck2 });
      items.push({ id: "doc_tracking", label: "ติดตามเอกสาร", icon: FileCheck });
      items.push({ id: "dbd", label: "DBD เบิกจ่าย", icon: BarChart3 });
    } else if (currentEmployee.role === UserRole.ADMIN) {
      items.push({ id: "approval", label: "อนุมัติ", icon: CheckSquare });
      items.push({ id: "accounting", label: "ตรวจบัญชี", icon: FileCheck2 });
      items.push({ id: "dbd", label: "DBD เบิกจ่าย", icon: BarChart3 });
    }

    // Always append "More" button at the end
    items.push({ id: "more", label: "เพิ่มเติม", icon: Settings });
    return items;
  };

  const handleLoginSuccess = (employee: Employee) => {
    setCurrentEmployee(employee);
    // Always default to dashboard for all roles
    setActiveTab("dashboard");
  };

  const handleSignOut = () => {
    setCurrentEmployee(null);
    setActiveTab("dashboard");
  };

  const isUploadSlipRoute = window.location.pathname.includes("/liff/upload-slip") || window.location.search.includes("adv_id=");

  if (isUploadSlipRoute) {
    return <UploadSlipLiff />;
  }

  if (!currentEmployee) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center" style={{ paddingTop: '0px', paddingBottom: '0px', paddingRight: '0px', paddingLeft: '0px' }}>
        <PinLogin onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col font-sans" id="app_frame">
      {/* Sleek Top Navigation Banner */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-stone-950 text-stone-50 rounded-full flex items-center justify-center font-bold text-base tracking-wider shadow">
                CA
              </div>
              <div>
                <span className="font-bold text-stone-900 tracking-tight text-sm sm:text-base">ClearAdvance PRO</span>
                <span className="text-[10px] bg-amber-500 text-stone-950 px-1.5 py-0.5 rounded font-extrabold ml-1.5 uppercase font-mono tracking-widest hidden sm:inline">
                  Enterprise
                </span>
              </div>
            </div>

            {/* Zoom Controls & Profile Sign-out controls */}
            <div className="flex items-center gap-4">
              <div className="flex items-center bg-stone-900/5 backdrop-blur-md border border-stone-900/10 rounded-full p-0.5 select-none shadow-xs">
                <button
                  onClick={() => document.documentElement.style.zoom = String(parseFloat(document.documentElement.style.zoom || "1") - 0.1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 hover:bg-stone-900/10 hover:text-stone-950 transition"
                  title="ย่อขนาด (Zoom Out)"
                >
                  <span className="font-bold">-</span>
                </button>
                <div className="w-px h-3 bg-stone-300 mx-0.5"></div>
                <button
                  onClick={() => document.documentElement.style.zoom = String(parseFloat(document.documentElement.style.zoom || "1") + 0.1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 hover:bg-stone-900/10 hover:text-stone-950 transition"
                  title="ขยายขนาด (Zoom In)"
                >
                  <span className="font-bold">+</span>
                </button>
              </div>

              {/* Glass button for Prince AI */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("toggle-prince-chat"))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900/5 backdrop-blur-md hover:bg-stone-900/10 border border-stone-900/10 hover:border-stone-900/25 rounded-full text-stone-850 text-[11px] font-black shadow-xs hover:shadow-sm active:scale-95 transition-all duration-200 select-none cursor-pointer"
                title="เรียก iClear Bot"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span>iClear Bot 🔮</span>
              </button>

              <div className="hidden md:flex items-center gap-2.5">
                {(currentEmployee.profilePhotoURL || currentEmployee.profileImage) ? (
                  <img
                    src={currentEmployee.profilePhotoURL ? `${currentEmployee.profilePhotoURL}${currentEmployee.profilePhotoURL.includes('?') ? '&' : '?'}v=${currentEmployee.profilePhotoUpdatedAt?.seconds || ''}` : currentEmployee.profileImage}
                    alt="profile"
                    className="w-8 h-8 rounded-full object-cover border border-stone-200"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center text-xs font-bold font-mono">
                    {currentEmployee.name.charAt(0)}
                  </div>
                )}
                <div className="flex flex-col items-start text-left">
                  <span className="font-bold text-xs text-stone-900 leading-tight">
                    {currentEmployee.nickname || currentEmployee.name}
                  </span>
                  <span className="text-[9px] text-stone-500 font-mono font-bold uppercase tracking-wider">
                    {currentEmployee.role}
                  </span>
                </div>
              </div>

              <div className="w-px h-6 bg-stone-200 hidden md:block" />

              <button
                onClick={handleSignOut}
                className="flex items-center justify-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 hover:text-stone-950 rounded-lg text-xs font-semibold transition"
                title="ออกจากระบบ"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Core View Area with Left Sidebar Navigation */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex flex-col lg:flex-row gap-6 p-4 sm:p-6 lg:p-8">
        
        {/* Navigation Sidebar Drawer */}
        <aside className="hidden lg:flex lg:w-64 shrink-0 flex-col gap-2.5">
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm space-y-1">
            <p className="text-[10px] font-extrabold text-stone-400 uppercase tracking-widest px-3 mb-2.5">เมนูนำทาง</p>

            {/* Tab 1: Dashboard */}
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === "dashboard"
                  ? "bg-stone-950 text-stone-50 shadow-sm"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <LayoutDashboard className="w-4 h-4" />
                <span>แผงควบคุมหลัก</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            {/* Tab 1.5: Profile Settings (ALL ROLES) */}
            <button
              onClick={() => setActiveTab("profile_settings")}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === "profile_settings"
                  ? "bg-stone-950 text-stone-50 shadow-sm"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4" />
                <span>ตั้งค่าโปรไฟล์ส่วนตัว</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            {/* Tab 2: Create Request Form (EMPLOYEE) */}
            {currentEmployee.role === UserRole.EMPLOYEE && (
              <button
                onClick={() => setActiveTab("request")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "request"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Send className="w-4 h-4" />
                  <span>ยื่นขอเบิกเงินทดรอง</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 3: Approval for Managers (MANAGER) */}
            {(currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("approval")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "approval"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare className="w-4 h-4" />
                  <span>อนุมัติ & โอนเงิน</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 4: Employee Clearance Bill (EMPLOYEE) */}
            {currentEmployee.role === UserRole.EMPLOYEE && (
              <button
                onClick={() => setActiveTab("clearance")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "clearance"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Receipt className="w-4 h-4" />
                  <span>เคลียร์ใบเสร็จ (AI OCR)</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5: Accounting review (ACCOUNTANT / ADMIN) */}
            {(currentEmployee.role === UserRole.ACCOUNTANT || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("accounting")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "accounting"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <FileCheck2 className="w-4 h-4" />
                  <span>ตรวจสอบบัญชี</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5.5: DBD Disbursement Reports (MANAGER / ACCOUNTANT / ADMIN) */}
            {(currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ACCOUNTANT || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("dbd")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "dbd"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4" />
                  <span>DBD รายงานเบิกทั้งหมด</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5.6: Project Cost Budgets (MANAGER / ADMIN) */}
            {(currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("project_costs")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "project_costs"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <TrendingUp className="w-4 h-4" />
                  <span>ต้นทุนโครงการ & งบประมาณ</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5.1: Original Document Tracking (ACCOUNTANT / ADMIN) */}
            {(currentEmployee.role === UserRole.ACCOUNTANT || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("doc_tracking")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "doc_tracking"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <FileCheck className="w-4 h-4" />
                  <span>ติดตามเอกสารตัวจริง</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5.2: Close Account & Settlements (ACCOUNTANT / ADMIN) */}
            {(currentEmployee.role === UserRole.ACCOUNTANT || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("close_account")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "close_account"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4" />
                  <span>ปิดบัญชีรายงวด</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* Tab 5.3: Reports (ACCOUNTANT / ADMIN) */}
            {(currentEmployee.role === UserRole.ACCOUNTANT || currentEmployee.role === UserRole.ADMIN) && (
              <button
                onClick={() => setActiveTab("reports")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "reports"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4" />
                  <span>รายงานบัญชีและภาษี</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}

            {/* General Vault & Audit Tab for Employees */}
            {currentEmployee.role === UserRole.EMPLOYEE && (
              <>
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                    activeTab === "vault"
                      ? "bg-stone-950 text-stone-50 shadow-sm"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="w-4 h-4" />
                    <span>ตู้เก็บเอกสารนิรภัย</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>

                <button
                  onClick={() => setActiveTab("audit")}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                    activeTab === "audit"
                      ? "bg-stone-950 text-stone-50 shadow-sm"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <History className="w-4 h-4" />
                    <span>บันทึกธุรกรรมทั้งหมด</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
              </>
            )}

            {/* Expandable/Dedicated "เพิ่มเติม" section for Executives & Accountants (Manager, Accountant & Admin) */}
            {(currentEmployee.role === UserRole.MANAGER || currentEmployee.role === UserRole.ADMIN || currentEmployee.role === UserRole.ACCOUNTANT) && (
              <div className="pt-2.5 mt-2 border-t border-stone-150/60 space-y-1">
                <p className="text-[10px] font-extrabold text-stone-400 uppercase tracking-widest px-3.5 mb-1.5">เพิ่มเติม (Additional)</p>
                
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                    activeTab === "vault"
                      ? "bg-stone-950 text-stone-50 shadow-sm"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="w-4 h-4" />
                    <span>ตู้เก็บเอกสารนิรภัย</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>

                <button
                  onClick={() => setActiveTab("audit")}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                    activeTab === "audit"
                      ? "bg-stone-950 text-stone-50 shadow-sm"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <History className="w-4 h-4" />
                    <span>บันทึกธุรกรรมทั้งหมด</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
              </div>
            )}

            {/* Tab 8: Admin Settings & Configurations (ADMIN ONLY) */}
            {currentEmployee.role === UserRole.ADMIN && (
              <button
                onClick={() => setActiveTab("admin")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === "admin"
                    ? "bg-stone-950 text-stone-50 shadow-sm"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4" />
                  <span>จัดการระบบ & อนุมัติสิทธิ์</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            )}
          </div>

          {/* User Mini status card on sidebar bottom */}
          <button 
            onClick={() => setActiveTab("profile_settings")}
            className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex items-center gap-3 hover:bg-stone-50 transition w-full text-left group"
          >
            <ProfileImage
              photoURL={currentEmployee.profilePhotoURL}
              image={currentEmployee.profileImage}
              name={currentEmployee.name}
              updatedAt={currentEmployee.profilePhotoUpdatedAt}
              className="w-8 h-8 rounded-full object-cover border border-stone-200"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-stone-900 text-xs truncate group-hover:text-stone-950">
                {currentEmployee.nickname || currentEmployee.name}
              </p>
              <p className="text-[10px] text-stone-400 font-mono font-bold uppercase">
                {currentEmployee.role}
              </p>
            </div>
          </button>
        </aside>

        {/* Content Panel Frame Area */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-0">
          {activeTab === "dashboard" && (
            <Dashboard 
              currentEmployee={currentEmployee} 
              onNavigate={(tab) => {
                if (tab !== "request") setEditingDraftAdvance(null);
                if (tab !== "clearance") setEditingDraftClearingId(null);
                setActiveTab(tab);
              }}
              onEditDraftAdvance={(adv) => {
                setEditingDraftAdvance(adv);
                setActiveTab("request");
              }}
              onEditDraftClearing={(logId) => {
                setEditingDraftClearingId(logId);
                setActiveTab("clearance");
              }}
              onProfileUpdate={(updated) => {
                setCurrentEmployee(updated);
              }}
            />
          )}

          {activeTab === "request" && (
            <AdvanceRequestForm
              currentEmployee={currentEmployee}
              onSuccess={() => {
                setEditingDraftAdvance(null);
                setActiveTab("dashboard");
              }}
              editingDraft={editingDraftAdvance}
            />
          )}

          {activeTab === "approval" && (
            <ManagerApproval currentEmployee={currentEmployee} />
          )}

          {activeTab === "clearance" && (
            <EmployeeClearance
              currentEmployee={currentEmployee}
              onSuccess={() => {
                setEditingDraftClearingId(null);
                setActiveTab("dashboard");
              }}
              editingDraftClearingId={editingDraftClearingId}
            />
          )}

          {activeTab === "accounting" && (
            <AccountingReview currentEmployee={currentEmployee} />
          )}

          {activeTab === "vault" && (
            <SecureVault currentEmployee={currentEmployee} />
          )}

          {activeTab === "audit" && (
            <AuditTrailLogs />
          )}

          {activeTab === "dbd" && (
            <DBDView />
          )}

          {activeTab === "project_costs" && (
            <ProjectCostsView />
          )}

          {activeTab === "doc_tracking" && (
            <OriginalDocTracking currentEmployee={currentEmployee} />
          )}

          {activeTab === "close_account" && (
            <CloseAccount currentEmployee={currentEmployee} />
          )}

          {activeTab === "reports" && (
            <AccountingReports />
          )}

          {activeTab === "profile_settings" && (
            <ProfileSettings currentEmployee={currentEmployee} onProfileUpdate={(updated) => setCurrentEmployee(updated)} />
          )}

          {activeTab === "admin" && (
            <AdminSettings currentEmployee={currentEmployee} />
          )}
        </main>
      </div>

      {/* Floating Action Button (FAB) - Removed per User Request */}

      {/* Mobile Bottom Navigation Bar */}
      {currentEmployee && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200/80 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] lg:hidden px-2 py-2.5 flex justify-around items-center pb-safe">
          {getMobileNavItems().map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id || (item.id === "more" && isMoreMenuOpen);
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "more") {
                    setIsMoreMenuOpen(true);
                  } else {
                    setActiveTab(item.id);
                    setIsMoreMenuOpen(false);
                  }
                }}
                className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all duration-200 relative min-h-[44px] flex-1 ${
                  isActive
                    ? "text-stone-950 font-semibold"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                <Icon className={`w-5 h-5 mb-0.5 transition-transform duration-200 ${isActive ? "scale-110 text-stone-950" : ""}`} />
                <span className="text-[10px] tracking-tight">{item.label}</span>
                {isActive && item.id !== "more" && (
                  <motion.div
                    layoutId="activeIndicator"
                    className="absolute bottom-0.5 w-6 h-0.5 bg-stone-950 rounded-full"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* "More" Bottom Sheet Overlay */}
      {currentEmployee && (
        <AnimatePresence>
          {isMoreMenuOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.4 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMoreMenuOpen(false)}
                className="fixed inset-0 bg-stone-950 z-45 lg:hidden"
              />

              {/* Bottom Sheet Card */}
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 220 }}
                className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 rounded-t-3xl z-50 lg:hidden shadow-2xl overflow-hidden pb-8 max-h-[85vh] flex flex-col"
              >
                {/* Drag Handle Bar */}
                <div className="w-12 h-1 bg-stone-200 rounded-full mx-auto my-3 shrink-0" />

                <div className="px-5 pb-6 overflow-y-auto flex-1">
                  {/* Profile Section inside Bottom Sheet */}
                  <div className="flex items-center gap-3.5 p-3.5 bg-stone-50 border border-stone-200/60 rounded-2xl mb-4">
                    {(currentEmployee.profilePhotoURL || currentEmployee.profileImage) ? (
                      <img
                        src={currentEmployee.profilePhotoURL ? `${currentEmployee.profilePhotoURL}${currentEmployee.profilePhotoURL.includes('?') ? '&' : '?'}v=${currentEmployee.profilePhotoUpdatedAt?.seconds || ''}` : currentEmployee.profileImage}
                        alt="profile"
                        className="w-11 h-11 rounded-full object-cover border border-stone-200 shadow-sm"
                      />
                    ) : (
                      <div className="w-11 h-11 bg-stone-950 text-stone-50 rounded-xl flex items-center justify-center font-bold shadow-sm text-base">
                        {currentEmployee.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <h4 className="font-bold text-stone-900 text-sm">{currentEmployee.nickname || currentEmployee.name}</h4>
                      <p className="text-[10px] text-stone-500 font-mono font-bold uppercase tracking-wider">{currentEmployee.role}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-extrabold text-stone-400 uppercase tracking-widest px-2 mb-2">เมนูอื่นๆ ของระบบ</p>

                    {/* Show Profile settings for everyone inside More panel */}
                    <button
                      onClick={() => {
                        setActiveTab("profile_settings");
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                        activeTab === "profile_settings" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                      }`}
                    >
                      <User className="w-4 h-4 text-stone-500" />
                      <span>ตั้งค่าโปรไฟล์ส่วนตัว (My Profile)</span>
                    </button>

                    {/* Show Audit logs for Employees inside More panel */}
                    {currentEmployee.role === UserRole.EMPLOYEE && (
                      <button
                        onClick={() => {
                          setActiveTab("audit");
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                          activeTab === "audit" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                        }`}
                      >
                        <History className="w-4 h-4 text-stone-500" />
                        <span>บันทึกธุรกรรมทั้งหมด (ประวัติ)</span>
                      </button>
                    )}

                    {/* Show extra tools for Accountant inside More panel */}
                    {currentEmployee.role === UserRole.ACCOUNTANT && (
                      <>
                        <button
                          onClick={() => {
                            setActiveTab("vault");
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            activeTab === "vault" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          <HardDrive className="w-4 h-4 text-stone-500" />
                          <span>ตู้เก็บเอกสารนิรภัย</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveTab("audit");
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            activeTab === "audit" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          <History className="w-4 h-4 text-stone-500" />
                          <span>บันทึกธุรกรรมทั้งหมด (ประวัติ)</span>
                        </button>
                      </>
                    )}

                    {/* Show Admin Settings or extra tools for Admin inside More panel */}
                    {currentEmployee.role === UserRole.ADMIN && (
                      <>
                        <button
                          onClick={() => {
                            setActiveTab("audit");
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            activeTab === "audit" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          <History className="w-4 h-4 text-stone-500" />
                          <span>บันทึกธุรกรรมทั้งหมด (ประวัติ)</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveTab("admin");
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            activeTab === "admin" ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          <Settings className="w-4 h-4 text-stone-500" />
                          <span>จัดการระบบ & อนุมัติสิทธิ์ (Admin)</span>
                        </button>
                      </>
                    )}

                    <hr className="border-stone-100 my-2" />

                    {/* Logout Action inside sheet */}
                    <button
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        handleSignOut();
                      }}
                      className="w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 text-red-600 hover:bg-red-50 transition"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>ออกจากระบบ</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Render Prince Advance AI Chatbot for Executives (Manager, Accountant, Admin) */}
      {currentEmployee && currentEmployee.role !== UserRole.EMPLOYEE && (
        <PrinceAdvanceChat currentEmployee={currentEmployee} />
      )}
    </div>
  );
}
