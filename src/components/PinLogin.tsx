/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { collection, getDocs, setDoc, doc, getDoc } from "firebase/firestore";
import { db, hashPIN } from "../lib/firebase";
import { Employee, UserRole } from "../types";
import { getDocumentFormats, generateFormattedId } from "../lib/idGenerator";
import { triggerAutoSyncSheetsIfEnabled } from "../lib/workspaceSync";
import { 
  Shield, 
  Key, 
  Eye, 
  EyeOff, 
  Check, 
  User, 
  AlertCircle, 
  RefreshCw, 
  Upload, 
  Camera, 
  Landmark, 
  UserPlus, 
  ArrowLeft 
} from "lucide-react";

interface PinLoginProps {
  onLoginSuccess: (employee: Employee) => void;
}

const THAI_BANKS = [
  { id: "KBANK", name: "ธนาคารกสิกรไทย (KBANK)" },
  { id: "SCB", name: "ธนาคารไทยพาณิชย์ (SCB)" },
  { id: "BBL", name: "ธนาคารกรุงเทพ (BBL)" },
  { id: "KTB", name: "ธนาคารกรุงไทย (KTB)" },
  { id: "BAY", name: "ธนาคารกรุงศรีอยุธยา (BAY)" },
  { id: "TTB", name: "ธนาคารทหารไทยธนชาต (TTB)" },
  { id: "GSB", name: "ธนาคารออมสิน (GSB)" },
  { id: "OTHER", name: "ธนาคารอื่นๆ" }
];

export default function PinLogin({ onLoginSuccess }: PinLoginProps) {
  const [activeMode, setActiveMode] = useState<"login" | "register">("login");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [showPin, setShowPin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [seeding, setSeeding] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // LINE LIFF states
  const [liffId, setLiffId] = useState("");
  const [liffProfile, setLiffProfile] = useState<any>(null);
  const [liffError, setLiffError] = useState<string | null>(null);
  const [autoLogining, setAutoLogining] = useState<boolean>(false);

  // Registration states
  const [regUsername, setRegUsername] = useState("");
  const [regPin, setRegPin] = useState("");
  const [regBank, setRegBank] = useState(THAI_BANKS[0].name);
  const [regBankAccount, setRegBankAccount] = useState("");
  const [regAccountName, setRegAccountName] = useState("");
  const [regProfileImage, setRegProfileImage] = useState<string>(""); // cropped 150x150 base64
  const [regImageName, setRegImageName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // System Seeder for testing (Admin, Manager, Accountant, Employee)
  async function handleSeedEmployees() {
    setSeeding(true);
    setError(null);
    try {
      // 1. Admin User (PIN: 999999)
      const adminPinHash = await hashPIN("999999");
      const adminEmp: Employee = {
        id: "emp-admin",
        username: "admin",
        name: "วิชัย สมาร์ทแอดมิน (Admin)",
        role: UserRole.ADMIN,
        pinHash: adminPinHash,
        plainPin: "999999",
        bankName: "ธนาคารกสิกรไทย (KBANK)",
        bankNo: "012-3-45678-9",
        bankAccountName: "วิชัย สมาร์ทแอดมิน",
        isActive: true,
        isApprovedByAdmin: true,
        status: "Active"
      };

      // 2. Manager User (PIN: 111111)
      const managerPinHash = await hashPIN("111111");
      const managerEmp: Employee = {
        id: "emp-manager",
        username: "manager",
        name: "สมศักดิ์ รักองค์กร (Manager)",
        role: UserRole.MANAGER,
        pinHash: managerPinHash,
        plainPin: "111111",
        bankName: "ธนาคารไทยพาณิชย์ (SCB)",
        bankNo: "111-2-22333-4",
        bankAccountName: "สมศักดิ์ รักองค์กร",
        isActive: true,
        isApprovedByAdmin: true,
        status: "Active"
      };

      // 3. Accountant User (PIN: 222222)
      const acctPinHash = await hashPIN("222222");
      const acctEmp: Employee = {
        id: "emp-accountant",
        username: "accountant",
        name: "เพ็ญศรี บัญชีละเอียด (Accountant)",
        role: UserRole.ACCOUNTANT,
        pinHash: acctPinHash,
        plainPin: "222222",
        bankName: "ธนาคารกรุงเทพ (BBL)",
        bankNo: "222-4-55667-8",
        bankAccountName: "เพ็ญศรี บัญชีละเอียด",
        isActive: true,
        isApprovedByAdmin: true,
        status: "Active"
      };

      // 4. Standard Employee (PIN: 333333)
      const staffPinHash = await hashPIN("333333");
      const staffEmp: Employee = {
        id: "emp-staff",
        username: "employee",
        name: "สมยศ ทำงานดี (Employee)",
        role: UserRole.EMPLOYEE,
        pinHash: staffPinHash,
        plainPin: "333333",
        bankName: "ธนาคารกรุงไทย (KTB)",
        bankNo: "333-1-44556-7",
        bankAccountName: "สมยศ ทำงานดี",
        isActive: true,
        isApprovedByAdmin: true,
        status: "Active"
      };

      // Seed in Firestore
      await setDoc(doc(db, "employees", adminEmp.id), adminEmp);
      await setDoc(doc(db, "employees", managerEmp.id), managerEmp);
      await setDoc(doc(db, "employees", acctEmp.id), acctEmp);
      await setDoc(doc(db, "employees", staffEmp.id), staffEmp);

      // Seed running numbers & settings if not present
      const settingsRef = doc(db, "settings", "global");
      await setDoc(settingsRef, {
        projects: ["Project Alpha (โรงงานบางปู)", "Project Beta (สายการผลิตพระประแดง)", "Corporate Operations (สำนักงานใหญ่)", "Marketing Campaign 2026"],
        categories: ["Travel & Lodging (ค่าเดินทาง/ที่พัก)", "Meals & Entertainment (ค่ารับรอง/อาหาร)", "Office Supplies (เครื่องเขียน/อุปกรณ์สำนักงาน)", "Vendor Payments (จ่ายซัพพลายเออร์)", "Equipment Rental (ค่าเช่าเครื่องมือ)", "Others (อื่นๆ)"],
        documentTypes: ["Receipt (ใบเสร็จรับเงิน)", "Tax Invoice (ใบกำกับภาษี)", "Invoice (ใบแจ้งหนี้)", "Slip (สลิปโอนเงิน)", "Billing Statement", "Others"],
        lineConfig: {
          notifyToken: "MOCKED_LINE_NOTIFY_TOKEN",
          liffId: "123456-abcde"
        },
        runningNumbers: {
          yearMonth: "2606",
          lastSequence: 0
        }
      });

      await fetchEmployees(false);
    } catch (err: any) {
      console.error(err);
      setError("ไม่สามารถลงทะเบียนข้อมูลทดสอบเริ่มต้นได้: " + (err.message || err));
    } finally {
      setSeeding(false);
    }
  }

  // Fetch employees list
  async function fetchEmployees(autoSeedIfEmpty = true) {
    // Only set loading if we don't have cached data yet
    if (employees.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const snap = await getDocs(collection(db, "employees"));
      const list: Employee[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Employee);
      });

      if (list.length === 0 && autoSeedIfEmpty) {
        await handleSeedEmployees();
        return;
      }

      setEmployees(list);
      
      // Cache to localStorage for faster subsequent logins
      try {
        localStorage.setItem("cached_employees", JSON.stringify(list));
      } catch (e) {
        console.warn("Failed to cache employees to localStorage", e);
      }
      
      // Filter active employees for default selection
      const activeList = list.filter(emp => emp.isActive !== false);
      if (activeList.length > 0) {
        setSelectedEmpId(activeList[0].id);
      } else if (list.length > 0) {
        setSelectedEmpId(list[0].id);
      }
    } catch (err: any) {
      console.error(err);
      // Only show error if we have no data at all
      if (employees.length === 0) {
        setError("ไม่สามารถโหลดรายชื่อพนักงานได้: " + (err.message || err));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // 1. Try to load from cache first for immediate UI response
    const cached = localStorage.getItem("cached_employees");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setEmployees(parsed);
          const activeList = parsed.filter((emp: Employee) => emp.isActive !== false);
          if (activeList.length > 0) {
            setSelectedEmpId(activeList[0].id);
          } else {
            setSelectedEmpId(parsed[0].id);
          }
        }
      } catch (e) {
        console.error("Cache parse error", e);
      }
    }

    // 2. Always fetch fresh data from Firestore in background
    fetchEmployees(true);
  }, []);

  // 3. Initialize LINE LIFF if configured
  useEffect(() => {
    const initLiff = async () => {
      try {
        const settingsRef = doc(db, "settings", "global");
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          const lId = data.lineMessagingConfig?.liffId || data.lineConfig?.liffId;
          if (lId && lId !== "123456-abcde") {
            setLiffId(lId);
            if ((window as any).liff) {
              const liff = (window as any).liff;
              await liff.init({ liffId: lId });
              console.log("LIFF initialized successfully");
              if (liff.isLoggedIn()) {
                const profile = await liff.getProfile();
                setLiffProfile(profile);
              }
            }
          }
        }
      } catch (err: any) {
        console.error("LIFF initialization error:", err);
        setLiffError(err?.message || String(err));
      }
    };
    initLiff();
  }, []);

  // 4. Auto-login watcher when employees list and liff profile are both loaded
  useEffect(() => {
    if (employees.length > 0 && liffProfile && !autoLogining) {
      const matchedEmp = employees.find(emp => emp.lineUserId === liffProfile.userId);
      if (matchedEmp) {
        if (matchedEmp.isActive === false || matchedEmp.status === "Suspended" || matchedEmp.status === "Disabled") {
          console.warn("Auto-login found matched account, but it is suspended/inactive.");
          return;
        }
        setAutoLogining(true);
        setSuccessMsg(`ตรวจพบ LINE Account เชื่อมโยงกับพนักงาน "${matchedEmp.name}" กำลังเข้าสู่ระบบอัตโนมัติ...`);
        setTimeout(() => {
          onLoginSuccess({
            ...matchedEmp,
            uid: matchedEmp.id
          });
        }, 1500);
      }
    }
  }, [employees, liffProfile]);

  // Determine dynamic expected PIN length based on whether user is newly registered (username exists)
  const selectedEmp = employees.find((emp) => emp.id === selectedEmpId);
  const expectedPinLength = selectedEmp?.username ? 4 : 6;

  // Sync PIN typing
  const handleKeypadPress = (val: string) => {
    setError(null);
    if (pin.length < expectedPinLength) {
      setPin((prev) => prev + val);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin("");
  };

  // Handle typing from physical keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeMode !== "login") return;
      if (e.key >= "0" && e.key <= "9") {
        handleKeypadPress(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Escape" || e.key === "Delete") {
        handleClear();
      } else if (e.key === "Enter") {
        if (pin.length === expectedPinLength) {
          handleSubmit();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, expectedPinLength, activeMode]);

  // Submit login
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedEmpId || pin.length !== expectedPinLength) {
      setError(`กรุณากรอก PIN ให้ครบ ${expectedPinLength} หลัก`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const emp = employees.find((item) => item.id === selectedEmpId);
      if (!emp) {
        setError("ไม่พบรายชื่อพนักงานที่เลือก");
        setLoading(false);
        return;
      }

      // Check if user is active (Admin Approved)
      if (emp.isActive === false || emp.status === "Suspended" || emp.status === "Disabled") {
        setError("บัญชีนี้ยังไม่ได้รับการอนุมัติการลงทะเบียนหรือถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่ออนุมัติและกำหนดบทบาท");
        setLoading(false);
        return;
      }

      // Validate PIN
      const enteredHash = await hashPIN(pin);
      if (enteredHash !== emp.pinHash && pin !== emp.pinHash) {
        setError("PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง");
        setPin("");
        setLoading(false);
        return;
      }

      // Successful login
      if (liffProfile && !emp.lineUserId) {
        try {
          await setDoc(doc(db, "employees", emp.id), {
            lineUserId: liffProfile.userId,
            lineDisplayName: liffProfile.displayName,
            linePictureUrl: liffProfile.pictureUrl || ""
          }, { merge: true });
          emp.lineUserId = liffProfile.userId;
          emp.lineDisplayName = liffProfile.displayName;
          emp.linePictureUrl = liffProfile.pictureUrl || "";
          console.log("Associated LINE Profile to Employee account successfully!");
        } catch (linkErr) {
          console.error("Failed to associate LINE profile:", linkErr);
        }
      }

      onLoginSuccess({
        ...emp,
        uid: emp.id
      });
    } catch (err) {
      console.error(err);
      setError("ระบบขัดข้องกรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
    } finally {
      setLoading(false);
    }
  };

  // Profile Image Selection & Auto-Crop to 1:1, scale to 150x150
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size <= 5MB
    if (file.size > 5 * 1024 * 1024) {
      setError("ขนาดรูปภาพต้องไม่เกิน 5MB");
      return;
    }

    // Check file type
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setError("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG และ WEBP เท่านั้น");
      return;
    }

    setRegImageName(file.name);

    // Crop & Resize using HTML Canvas
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = document.createElement("img");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 150;
        canvas.height = 150;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setError("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ");
          return;
        }

        // Calculate source crop area (1:1 square centered)
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;

        // Draw and scale to 150x150
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 150, 150);

        // Export to base64 jpeg thumbnail
        const base64 = canvas.toDataURL("image/jpeg", 0.85);
        setRegProfileImage(base64);
      };
      img.onerror = () => {
        setError("ไม่สามารถโหลดไฟล์รูปภาพได้");
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      setError("ไม่สามารถอ่านไฟล์รูปภาพได้");
    };
    reader.readAsDataURL(file);
  };

  // Submit Registration form
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // Validations based on SRS 2.2
    const trimmedUsername = regUsername.trim();
    const alphanumericRegex = /^[A-Za-z0-9]+$/;
    
    if (trimmedUsername.length < 4 || trimmedUsername.length > 20) {
      setError("ชื่อผู้ใช้ต้องมีความยาวระหว่าง 4 ถึง 20 ตัวอักษร");
      return;
    }
    if (!alphanumericRegex.test(trimmedUsername)) {
      setError("ชื่อผู้ใช้ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลขเท่านั้น (ห้ามเว้นวรรคและอักขระพิเศษ)");
      return;
    }

    const pinRegex = /^[A-Za-z0-9]{4}$/;
    if (!pinRegex.test(regPin)) {
      setError("รหัส PIN ต้องมีความยาว 4 หลัก และประกอบด้วย A-Z, a-z, 0-9 เท่านั้น (ห้ามใช้อักขระพิเศษ)");
      return;
    }

    if (!regAccountName.trim()) {
      setError("กรุณากรอกชื่อบัญชีธนาคาร (ตรงกับชื่อจริง)");
      return;
    }

    const cleanBankAccount = regBankAccount.replace(/\D/g, "");
    if (cleanBankAccount.length < 10 || cleanBankAccount.length > 12) {
      setError("เลขที่บัญชีธนาคารต้องเป็นตัวเลขความยาว 10 ถึง 12 หลัก");
      return;
    }

    if (!regProfileImage) {
      setError("กรุณาอัปโหลดรูปโปรไฟล์ที่ชัดเจน");
      return;
    }

    setLoading(true);

    try {
      // Check username uniqueness
      const lowercaseUsername = trimmedUsername.toLowerCase();
      const existingUser = employees.find(
        (emp) => emp.username?.toLowerCase() === lowercaseUsername
      );

      if (existingUser) {
        setError("ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาใช้ชื่อผู้ใช้อื่น");
        setLoading(false);
        return;
      }

      // Hash PIN using standard operational helper
      const regPinHash = await hashPIN(regPin);
      const newEmpId = `emp-${lowercaseUsername}`;

      // Fetch dynamic format configuration and generate dynamic employee code
      const formats = await getDocumentFormats();
      const formatPattern = formats.employee || "EMP-{seq:4}";
      const nextSequence = employees.length + 1;
      const formattedEmpCode = generateFormattedId(formatPattern, nextSequence);

      const newEmployee: Employee = {
        id: newEmpId,
        username: trimmedUsername,
        employeeCode: formattedEmpCode,
        name: regAccountName.trim(),
        role: UserRole.EMPLOYEE, // Force Role to always be Employee initially (as per SRS 2.1)
        pinHash: regPinHash,
        plainPin: regPin, // Save plain text PIN for Admin accessibility
        bankName: regBank,
        bankNo: cleanBankAccount,
        bankAccountName: regAccountName.trim(),
        isActive: false, // Forces Admin Approval (as per SRS 2.1)
        isApprovedByAdmin: false,
        status: "Suspended", // Starts as suspended pending approval (as per 3.1 schema specs)
        profileImage: regProfileImage,
      };

      // Write to Firestore
      await setDoc(doc(db, "employees", newEmpId), newEmployee);

      // Trigger automatic background sheet sync
      triggerAutoSyncSheetsIfEnabled().catch(console.error);

      // Trigger successful registration UX
      setSuccessMsg(
        `ลงทะเบียนบัญชี @${trimmedUsername} สำเร็จเรียบร้อยแล้ว! ข้อมูลของท่านได้ถูกส่งเข้าระบบเพื่อให้ผู้ดูแลระบบ (Admin) ตรวจสอบและยกระดับสิทธิ์เข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานบัญชี`
      );

      // Reset Form fields
      setRegUsername("");
      setRegPin("");
      setRegBankAccount("");
      setRegAccountName("");
      setRegProfileImage("");
      setRegImageName("");
      
      // Refresh employees list
      await fetchEmployees();
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการลงทะเบียน กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden transition-all">
        
        {/* Upper Header Brand Banner */}
        <div className="bg-stone-900 text-stone-100 p-8 flex items-center gap-4 relative">
          {/* Logo 'CA' on the left */}
          <div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-black text-base tracking-wider shadow border border-stone-800 shrink-0">
            CA
          </div>
          
          {/* Brand Titles */}
          <div className="text-left flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">ClearAdvance PRO</h1>
            <p className="text-stone-400 mt-0.5 font-mono tracking-wider text-[9px]">
              CONSTRUCTECH FINANCIAL OPERATIONS & VAULT
            </p>
          </div>

          {/* Secure / Audit Label with integrated Shield on the right */}
          <div className="absolute top-4 right-4 flex items-center gap-1.5">
            <div className="p-1 bg-stone-800 rounded border border-stone-700">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <span className="font-mono px-2 py-0.5 rounded border border-stone-700 text-[9px] font-black tracking-wider" style={{ color: '#000000', backgroundColor: '#eca900' }}>
              SECURE ACCESS
            </span>
          </div>
        </div>

        {/* Tab Switch Buttons (SRS: Security-First Registration Integration) */}
        <div className="flex border-b border-stone-200 bg-stone-50">
          <button
            type="button"
            onClick={() => {
              setActiveMode("login");
              setError(null);
              setSuccessMsg(null);
              setPin("");
            }}
            className={`flex-1 py-3.5 text-center font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
              activeMode === "login"
                ? "bg-white text-stone-950 border-b-2 border-stone-950"
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            เข้าสู่ระบบ (PIN Login)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode("register");
              setError(null);
              setSuccessMsg(null);
            }}
            className={`flex-1 py-3.5 text-center font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
              activeMode === "register"
                ? "bg-white text-stone-950 border-b-2 border-stone-950"
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            ลงทะเบียนใหม่ (Register)
          </button>
        </div>

        {/* Error & Success Alerts Container */}
        <div className="px-8 pt-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-start gap-3 animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold">เกิดข้อผิดพลาด</span>
                <p className="leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-start gap-3 animate-fade-in">
              <Check className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold">ลงทะเบียนสำเร็จ</span>
                <p className="leading-relaxed font-medium">{successMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Content Panel Area */}
        <div className="p-8" style={{ paddingTop: '3px', paddingBottom: '32px', backgroundColor: '#ffffff' }}>
          {activeMode === "login" ? (
            /* --- LOGIN MODE VIEWS --- */
            employees.length === 0 ? (
              <div className="text-center py-8 flex flex-col items-center justify-center gap-4">
                {error ? (
                  <>
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <p className="text-xs text-stone-600 font-medium max-w-sm">
                      {error}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fetchEmployees(true)}
                        className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] rounded-xl transition shadow-sm"
                      >
                        ลองใหม่อีกครั้ง
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSeedEmployees()}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-stone-950 font-semibold text-[11px] rounded-xl transition shadow-sm"
                      >
                        ติดตั้งข้อมูลพนักงานเริ่มต้น
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-8 h-8 animate-spin text-stone-400" />
                    <p className="text-xs text-stone-500 font-medium">
                      {seeding 
                        ? "กำลังเปิดระบบและติดตั้งฐานข้อมูลทดสอบเริ่มต้น..." 
                        : "กำลังเชื่อมต่อฐานข้อมูลและดึงข้อมูลพื้นฐาน..."}
                    </p>
                    {!seeding && (
                      <button
                        type="button"
                        onClick={() => handleSeedEmployees()}
                        className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] rounded-xl transition shadow-sm"
                      >
                        ติดตั้งข้อมูลพนักงานทดสอบด้วยตนเอง
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                
                {/* User Dropdown Selector */}
                <div style={{ fontSize: '0px' }}>
                  <label className="block font-extrabold text-stone-400 uppercase tracking-widest mb-2" style={{ fontSize: '14px' }}>
                    เลือกผู้ใช้งานทดสอบระบบ
                  </label>
                  <div className="relative">
                    <select
                      id="employee_select"
                      value={selectedEmpId}
                      onChange={(e) => {
                        setSelectedEmpId(e.target.value);
                        setPin("");
                        setError(null);
                      }}
                      className="w-full pl-4 pr-10 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-stone-900 appearance-none cursor-pointer"
                    >
                      {employees.map((emp) => {
                        const isPending = emp.isActive === false || emp.status === "Suspended" || emp.status === "Disabled";
                        const displayCode = emp.employeeCode ? `[${emp.employeeCode}] ` : "";
                        return (
                          <option key={emp.id} value={emp.id} className="text-stone-900 font-sans">
                            {displayCode}{emp.name} ({emp.role}) {isPending ? "⚠️ (รอ Admin อนุมัติ)" : ""}
                          </option>
                        );
                      })}
                    </select>
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-stone-500">
                      <User className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* PIN dot progress screen */}
                <div>
                  <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-2 text-center">
                    กรอกรหัส PIN ({expectedPinLength} หลัก)
                  </label>
                  
                  {/* Active Dots Indicator */}
                  <div className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded-2xl p-4 relative">
                    <div className="flex justify-center gap-3.5 w-full">
                      {[...Array(expectedPinLength)].map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-3.5 h-3.5 rounded-full border border-stone-300 transition-all duration-100 ${
                            pin.length > idx
                              ? "bg-stone-950 border-stone-950 scale-110"
                              : "bg-white"
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-4 text-stone-400 hover:text-stone-700 focus:outline-none"
                      title={showPin ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Keyboard plain representation text if toggled */}
                  {showPin && pin && (
                    <div className="text-center mt-2 text-xs font-mono font-bold text-stone-500 tracking-widest bg-stone-100 py-1.5 rounded-lg border border-stone-200/60 animate-fade-in">
                      {pin}
                    </div>
                  )}
                </div>

                {/* Interactive Numeric & Alphanumeric hybrid guide */}
                <div className="space-y-4">
                  
                  {/* Numeric Keypad Grid */}
                  <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleKeypadPress(num)}
                        className="w-14 h-14 rounded-full bg-stone-50 hover:bg-stone-200 active:bg-stone-300 text-lg font-bold text-stone-900 flex items-center justify-center border border-stone-200/60 focus:outline-none transition-colors duration-100"
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleClear}
                      className="w-14 h-14 rounded-full text-xs font-bold text-red-600 hover:bg-red-50 active:bg-red-100 flex items-center justify-center focus:outline-none transition-colors duration-100"
                    >
                      ล้าง
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKeypadPress("0")}
                      className="w-14 h-14 rounded-full bg-stone-50 hover:bg-stone-200 active:bg-stone-300 text-lg font-bold text-stone-900 flex items-center justify-center border border-stone-200/60 focus:outline-none transition-colors duration-100"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={handleBackspace}
                      className="w-14 h-14 rounded-full text-xs font-bold text-stone-600 hover:bg-stone-100 active:bg-stone-200 flex items-center justify-center focus:outline-none transition-colors duration-100"
                    >
                      ลบ
                    </button>
                  </div>

                  {/* Physical typing support note for Alphanumeric users */}
                  {selectedEmp?.username && (
                    <p className="text-[10px] text-stone-400 text-center bg-amber-50/50 border border-amber-200/40 rounded-lg p-2 font-medium">
                      💡 เนื่องจากบัญชีของท่านมีรหัสผ่านแบบตัวอักษรผสมตัวเลข (Alphanumeric)<br />
                      สามารถพิมพ์รหัสผ่านผ่านแป้นคีย์บอร์ดจริงของท่านได้โดยตรงเพื่อความสะดวก!
                    </p>
                  )}
                </div>

                {/* Submit Trigger */}
                <button
                  type="submit"
                  disabled={pin.length !== expectedPinLength || loading}
                  className="w-full mt-4 py-3.5 bg-stone-950 hover:bg-stone-900 text-stone-50 font-semibold rounded-2xl text-xs transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4" /> เข้าสู่ระบบอย่างปลอดภัย
                    </>
                  )}
                </button>
              </form>
            )
          ) : (
            /* --- REGISTRATION MODE VIEWS (SRS 2.2 Form Spec) --- */
            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-xs">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Username Input (Alphanumeric 4-20) */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-stone-700">
                    ชื่อผู้ใช้งาน (Username) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    placeholder="ภาษาอังกฤษหรือตัวเลข (4-20 ตัว)"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:border-stone-950 text-xs"
                  />
                  <span className="text-[10px] text-stone-400 block">
                    ตัวอักษร A-Z, a-z, 0-9 ความยาว 4-20 ตัว
                  </span>
                </div>

                {/* PIN Input (4 Chars Alphanumeric) */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-stone-700">
                    รหัสผ่านย่อย (PIN) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="ความยาว 4 หลัก"
                    value={regPin}
                    onChange={(e) => setRegPin(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-stone-900 text-xs"
                  />
                  <span className="text-[10px] text-stone-400 block">
                    ตัวอักษร/ตัวเลข 4 ตัว (ห้ามอักขระพิเศษ)
                  </span>
                </div>

              </div>

              {/* Bank Select & Account Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                <div className="space-y-1.5">
                  <label className="block font-bold text-stone-700">
                    ธนาคารผู้รับเงิน (Bank Name) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={regBank}
                    onChange={(e) => setRegBank(e.target.value)}
                    className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 font-semibold focus:outline-none focus:ring-2 focus:ring-stone-900 text-xs cursor-pointer"
                  >
                    {THAI_BANKS.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-bold text-stone-700">
                    เลขที่บัญชีธนาคาร <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    placeholder="ตัวเลขความยาว 10-12 หลัก"
                    value={regBankAccount}
                    onChange={(e) => setRegBankAccount(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 text-xs"
                  />
                  <span className="text-[10px] text-stone-400 block">
                    เฉพาะตัวเลขความยาว 10 ถึง 12 หลัก
                  </span>
                </div>

              </div>

              {/* Bank Account Holder Name (Thai/Eng matching real name) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-stone-700">
                  ชื่อบัญชี / ชื่อจริงพนักงาน (Account/Real Name) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ชื่อ-นามสกุลจริง ภาษาไทยหรืออังกฤษ"
                  value={regAccountName}
                  onChange={(e) => setRegAccountName(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 text-xs"
                />
              </div>

              {/* Profile Image File Upload Area with Auto-crop (SRS 2.2 Spec) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-stone-700">
                  อัปโหลดรูปโปรไฟล์พนักงาน <span className="text-red-500">*</span>
                </label>
                
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-stone-50 border border-stone-200 rounded-2xl">
                  
                  {/* Photo crop output preview frame */}
                  <div className="w-20 h-20 rounded-full border border-stone-300 bg-stone-200 overflow-hidden flex items-center justify-center shrink-0 shadow-sm relative group">
                    {regProfileImage ? (
                      <img
                        src={regProfileImage}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Camera className="w-7 h-7 text-stone-400" />
                    )}
                    {regProfileImage && (
                      <span className="absolute bottom-0 inset-x-0 bg-stone-900/60 text-[8px] text-center text-white py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        150 x 150
                      </span>
                    )}
                  </div>

                  <div className="flex-1 space-y-2 w-full">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2 px-3 border border-stone-300 rounded-xl hover:bg-stone-100 transition text-stone-700 font-semibold flex items-center justify-center gap-2 text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" /> เลือกไฟล์ภาพโปรไฟล์
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageFileChange}
                    />
                    
                    {regImageName ? (
                      <p className="text-[10px] text-emerald-600 font-medium truncate max-w-xs">
                        ✓ โหลดรูปภาพและประมวลผลครอป 1:1 เรียบร้อย: {regImageName}
                      </p>
                    ) : (
                      <p className="text-[10px] text-stone-400">
                        ขนาดสูงสุด 5MB รูปภาพจะถูกตัดสัดส่วนเป็น 1:1 และย่อเป็น 150x150 px โดยอัตโนมัติ
                      </p>
                    )}
                  </div>

                </div>

              </div>

              {/* Safe Register Submit trigger */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-3.5 bg-stone-950 hover:bg-stone-900 text-stone-50 font-semibold rounded-2xl text-xs transition-all focus:outline-none disabled:opacity-50 flex items-center justify-center gap-2 shadow"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" /> ลงทะเบียนพนักงานใหม่เพื่อส่งตรวจอนุมัติ
                  </>
                )}
              </button>

            </form>
          )}
        </div>

        {/* Demo Guide Footer Section */}
        <div className="bg-stone-50 border-t border-stone-200 px-8 py-5 text-[10px] text-stone-500">
          <p className="font-semibold text-stone-700 mb-2 flex items-center gap-1 text-xs">
            <Key className="w-3.5 h-3.5 text-amber-500" /> ข้อมูลทดสอบสิทธิ์ของระบบ (Seeded Roles):
          </p>
          <div className="grid grid-cols-2 gap-y-1 font-mono text-[10px]">
            <div>• Admin (สิทธิ์สูงสุด):</div>
            <div>PIN: <span className="text-amber-600 font-bold">999999</span></div>
            <div>• Manager (อนุมัติ/โอน):</div>
            <div>PIN: <span className="text-amber-600 font-bold">111111</span></div>
            <div>• Accountant (ตรวจสอบการเงิน):</div>
            <div>PIN: <span className="text-amber-600 font-bold">222222</span></div>
            <div>• Employee (ขอเบิก/เคลียร์ใบเสร็จ):</div>
            <div>PIN: <span className="text-amber-600 font-bold">333333</span></div>
          </div>
        </div>

      </div>
    </div>
  );
}
