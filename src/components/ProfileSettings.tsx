import React, { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db, hashPIN } from "../lib/firebase";
import { Employee, UserRole } from "../types";
import { 
  User, CreditCard, Lock, Sparkles, Upload, RefreshCw, CheckCircle2, 
  AlertCircle, ShieldCheck, Eye, EyeOff, Hash, Smile, BookOpen
} from "lucide-react";

interface ProfileSettingsProps {
  currentEmployee: Employee;
  onProfileUpdate: (updatedEmployee: Employee) => void;
}

const POPULAR_BANKS = [
  "ธนาคารกสิกรไทย (KBank)",
  "ธนาคารไทยพาณิชย์ (SCB)",
  "ธนาคารกรุงเทพ (BBL)",
  "ธนาคารกรุงไทย (KTB)",
  "ธนาคารทหารไทยธนชาต (TTB)",
  "ธนาคารกรุงศรีอยุธยา (BAY)",
  "ธนาคารออมสิน (GSB)",
  "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)",
  "ธนาคารอาคารสงเคราะห์ (ธอส.)",
  "ธนาคารเกียรตินาคินภัทร (KKP)",
  "ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)",
  "ธนาคารยูโอบี (UOB)"
];

export default function ProfileSettings({ currentEmployee, onProfileUpdate }: ProfileSettingsProps) {
  const [empData, setEmpData] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit fields
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [bankName, setBankName] = useState("");
  const [customBankName, setCustomBankName] = useState("");
  const [isCustomBank, setIsCustomBank] = useState(false);
  const [bankNo, setBankNo] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [username, setUsername] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [profileImage, setProfileImage] = useState("");
  const [signatureImage, setSignatureImage] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);
  const signatureFileInputRef = useRef<HTMLInputElement>(null);

  // Change PIN fields
  const [changePin, setChangePin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to employee data in real-time
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "employees", currentEmployee.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Employee;
        setEmpData({ ...data, id: snap.id });
        setName(data.name || "");
        setNickname(data.nickname || "");
        setBankNo(data.bankNo || "");
        setBankAccountName(data.bankAccountName || "");
        setUsername(data.username || "");
        setLineUserId(data.lineUserId || "");
        setProfileImage(data.profilePhotoURL || data.profileImage || "");
        // @ts-ignore
        setSignatureImage(data.signatureImage || "");

        // Determine if current bank is in popular list
        const currentBank = data.bankName || "";
        if (POPULAR_BANKS.includes(currentBank)) {
          setBankName(currentBank);
          setIsCustomBank(false);
        } else if (currentBank) {
          setBankName("OTHER");
          setCustomBankName(currentBank);
          setIsCustomBank(true);
        } else {
          setBankName("");
          setIsCustomBank(false);
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Error subscribing to employee profile: ", err);
      setError("ไม่สามารถดึงข้อมูลโปรไฟล์ล่าสุดได้");
      setLoading(false);
    });

    return () => unsub();
  }, [currentEmployee.id]);

  const handleBankChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setBankName(val);
    if (val === "OTHER") {
      setIsCustomBank(true);
    } else {
      setIsCustomBank(false);
    }
  };

  // Helper to upload profile photo directly to server storage
  const uploadAndSetImage = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = document.createElement("img");
      img.onload = () => {
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;
        
        if (Math.max(width, height) > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setError("เกิดข้อผิดพลาดในการสร้าง Canvas ประมวลผลรูปภาพ");
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              setError("ไม่สามารถแปลงรูปภาพได้");
              return;
            }
            
            const formData = new FormData();
            formData.append("image", blob, file.name);
            formData.append("employeeId", currentEmployee.id);
            
            setSaving(true);
            try {
              const response = await fetch("/api/upload-profile-image", {
                method: "POST",
                body: formData
              });
              
              const result = await response.json();
              setSaving(false);
              if (result.status === "success") {
                setProfileImage(result.downloadURL);
                setSuccess("อัปโหลดรูปภาพโปรไฟล์สำเร็จ");
              } else {
                throw new Error(result.error);
              }
            } catch (error) {
              console.error("Error uploading profile image:", error);
              setSaving(false);
              setError("ไม่สามารถอัปโหลดรูปภาพไปยังเซิร์ฟเวอร์ได้");
            }
          },
          "image/jpeg",
          0.9
        );
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Profile Image Selection & Auto Crop / Upload
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.match("image.*")) {
      setError("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG และ WEBP เท่านั้น");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("ไฟล์รูปภาพมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 8MB)");
      return;
    }

    uploadAndSetImage(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.match("image.*")) {
      setError("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG และ WEBP เท่านั้น");
      return;
    }

    uploadAndSetImage(file);
  };

  const performSave = async (silent = false) => {
    setError(null);
    if (!silent) setSuccess(null);

    if (!name.trim()) {
      if (!silent) setError("กรุณากรอกชื่อ-นามสกุลจริง");
      return;
    }

    if (!username.trim()) {
      if (!silent) setError("กรุณากรอกยูเซอร์เนม");
      return;
    }

    // Alphanumeric username validation
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      if (!silent) setError("ยูเซอร์เนมต้องประกอบด้วยภาษาอังกฤษ ตัวเลข หรือขีดล่าง (_) ความยาว 3-20 ตัวอักษรเท่านั้น");
      return;
    }

    setSaving(true);

    try {
      // 1. Check if username is already taken by another employee
      if (username.toLowerCase() !== currentEmployee.username?.toLowerCase()) {
        const qUser = query(collection(db, "employees"), where("username", "==", username));
        const userSnap = await getDocs(qUser);
        let taken = false;
        userSnap.forEach((doc) => {
          if (doc.id !== currentEmployee.id) {
            taken = true;
          }
        });

        if (taken) {
          if (!silent) setError("ยูเซอร์เนมนี้มีผู้ใช้งานแล้ว กรุณาใช้ยูเซอร์เนมอื่น");
          setSaving(false);
          return;
        }
      }

      // 2. Prepare update data
      const finalBankName = isCustomBank ? customBankName.trim() : bankName;

      const updateData: any = {
        name: name.trim(),
        nickname: nickname.trim(),
        bankName: finalBankName,
        bankNo: bankNo.trim(),
        bankAccountName: bankAccountName.trim(),
        username: username.trim(),
        lineUserId: lineUserId.trim(),
        signatureImage: signatureImage,
      };

      if (profileImage.startsWith("http") || profileImage.startsWith("/api/profiles/")) {
        updateData.profilePhotoURL = profileImage;
        updateData.profileImage = ""; // Clear legacy base64
      } else if (profileImage) {
        updateData.profileImage = profileImage;
      }

      // 3. Update PIN if requested
      if (changePin) {
        if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
          if (!silent) setError("รหัสผ่าน PIN ใหม่ ต้องประกอบด้วยตัวเลข 6 หลักเท่านั้น");
          setSaving(false);
          return;
        }
        if (newPin !== confirmPin) {
          if (!silent) setError("รหัสผ่าน PIN ใหม่ กับรหัสยืนยันไม่ตรงกัน");
          setSaving(false);
          return;
        }

        const hashed = await hashPIN(newPin);
        updateData.pinHash = hashed;
      }

      // 4. Update in Firestore
      const employeeRef = doc(db, "employees", currentEmployee.id);
      await updateDoc(employeeRef, updateData);

      // 5. Update local state in Parent component
      const updatedEmployee: Employee = {
        ...currentEmployee,
        ...updateData,
      };
      onProfileUpdate(updatedEmployee);

      // Reset change PIN form
      if (changePin) {
        setChangePin(false);
        setNewPin("");
        setConfirmPin("");
      }

      if (!silent) {
        setSuccess("บันทึกการเปลี่ยนแปลงข้อมูลโปรไฟล์เรียบร้อยแล้ว ✨");
        setTimeout(() => setSuccess(null), 5000);
      }

    } catch (err: any) {
      console.error("Error updating profile:", err);
      if (!silent) setError(`เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSave();
  };

  // Auto-save logic (inactivity)
  useEffect(() => {
    const handler = setTimeout(() => {
      performSave(true).catch(err => console.error("Auto-save failed:", err));
    }, 3000);

    return () => clearTimeout(handler);
  }, [name, nickname, bankName, bankNo, bankAccountName, username, lineUserId, profileImage, signatureImage]);

  // Save on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const container = document.getElementById("profile_settings_container");
      // Check if clicking outside the container
      if (container && !container.contains(e.target as Node)) {
        performSave(true).catch(err => console.error("Save on click outside failed:", err));
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [name, nickname, bankName, bankNo, bankAccountName, username, lineUserId, profileImage, signatureImage]);


  // Drawing Pad Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    lastX.current = clientX - rect.left;
    lastY.current = clientY - rect.top;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastX.current, lastY.current);
    ctx.lineTo(currentX, currentY);
    ctx.strokeStyle = "#1c1917"; // deep stone-900 color for signature ink
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    lastX.current = currentX;
    lastY.current = currentY;
  };

  const stopDrawing = () => {
    if (isDrawing.current) {
      isDrawing.current = false;
      saveCanvasSignature();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureImage("");
  };

  const saveCanvasSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setSignatureImage(dataUrl);
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 8 * 1024 * 1024) {
      setError("ขนาดไฟล์ใหญ่เกินไป (จำกัดไม่เกิน 8MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawResult = event.target?.result as string;
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.5);
          setSignatureImage(compressedBase64);
        };
        img.onerror = () => {
          setSignatureImage(rawResult);
        };
        img.src = rawResult;
      } else {
        setSignatureImage(rawResult);
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white border rounded-2xl">
        <RefreshCw className="w-8 h-8 text-stone-400 animate-spin" />
        <p className="text-xs text-stone-500 mt-3 font-semibold">กำลังโหลดข้อมูลโปรไฟล์ส่วนตัว...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6" id="profile_settings_container">
      {/* Header Banner */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-stone-900 text-stone-50 rounded-lg">
              <User className="w-5 h-5" />
            </span>
            <h2 className="font-extrabold text-stone-950 text-lg tracking-tight">
              การตั้งค่าโปรไฟล์ส่วนตัว (My Profile Settings)
            </h2>
          </div>
          <p className="text-xs text-stone-500 mt-1 font-medium">
            จัดการข้อมูลผู้ใช้งาน ชื่อเล่น รูปภาพ บัญชีธนาคารรับเงินโอน และรหัสความปลอดภัย PIN ของคุณ
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border rounded-xl text-[10px] text-stone-600 font-bold self-start">
          <ShieldCheck className="w-3.5 h-3.5 text-stone-800" />
          <span>เชื่อมข้อมูลส่วนกลาง (แอดมิน)</span>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-xs font-semibold flex items-start gap-2.5 animate-pulse">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-xs font-bold flex items-start gap-2.5 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">{success}</div>
        </div>
      )}

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Core Profile Card: Photo and Basic Info */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-6">
          <h3 className="text-xs font-black text-stone-950 uppercase tracking-widest border-b pb-2 flex items-center gap-1.5">
            <Smile className="w-4 h-4 text-stone-700" /> ข้อมูลทั่วไป & รูปภาพโปรไฟล์
          </h3>

          <div className="flex flex-col md:flex-row gap-6 items-center">
            {/* Image Upload Zone */}
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="flex flex-col items-center gap-3 shrink-0"
            >
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                {profileImage ? (
                  <img 
                    src={profileImage} 
                    alt="Profile Preview" 
                    className="w-28 h-28 rounded-full object-cover border-4 border-stone-100 shadow-md group-hover:opacity-85 transition" 
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-stone-100 border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-400 group-hover:bg-stone-50 transition">
                    <User className="w-10 h-10 stroke-1" />
                    <span className="text-[9px] font-bold mt-1 text-center px-1">อัปโหลดรูป</span>
                  </div>
                )}
                
                <div className="absolute bottom-1 right-1 bg-stone-950 text-white p-1.5 rounded-full shadow-md hover:scale-105 active:scale-95 transition">
                  <Upload className="w-3 h-3" />
                </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageChange} 
                accept="image/*" 
                className="hidden" 
              />
              <p className="text-[10px] text-stone-400 font-medium text-center">
                ลากรูปวางที่นี่ หรือคลิกเพื่ออัปโหลด<br/>
                (สัดส่วนจะถูกจัดเรียงเป็น 1:1 โดยอัตโนมัติ)
              </p>
            </div>

            {/* Basic Info text fields */}
            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                  ชื่อ-นามสกุลจริง (Full Name) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                  ชื่อเล่น (Nickname)
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="เช่น มาร์ค, แอน"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                  ยูเซอร์เนมใช้งาน (Username) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ใช้สำหรับแสดงตนและล็อกอิน เช่น somchai_j"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                  LINE User ID (สำหรับการอนุมัติผ่าน LINE)
                </label>
                <input
                  type="text"
                  value={lineUserId}
                  onChange={(e) => setLineUserId(e.target.value)}
                  placeholder="เช่น U123456789abcdef..."
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                  ระดับตำแหน่งพนักงาน (Role)
                </label>
                <div className="w-full bg-stone-100 border border-stone-150 rounded-xl px-3 py-2 text-xs font-bold text-stone-500 font-mono select-none">
                  {currentEmployee.role}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bank Account Settings Card */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-6">
          <h3 className="text-xs font-black text-stone-950 uppercase tracking-widest border-b pb-2 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-stone-700" /> ข้อมูลบัญชีธนาคารสำหรับโอนเงินค่าเบิกเงินทดรองจ่าย
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                ธนาคารพื้นฐาน
              </label>
              <select
                value={bankName}
                onChange={handleBankChange}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850"
              >
                <option value="">-- เลือกธนาคาร --</option>
                {POPULAR_BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="OTHER">ธนาคารอื่นๆ (ระบุเอง)</option>
              </select>

              {isCustomBank && (
                <input
                  type="text"
                  value={customBankName}
                  onChange={(e) => setCustomBankName(e.target.value)}
                  placeholder="ระบุชื่อธนาคารของคุณ"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 mt-2"
                />
              )}
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                เลขที่บัญชีธนาคาร (Bank Account Number)
              </label>
              <input
                type="text"
                value={bankNo}
                onChange={(e) => setBankNo(e.target.value)}
                placeholder="เช่น 123-4-56789-0"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                ชื่อบัญชีธนาคาร (Bank Account Name)
              </label>
              <input
                type="text"
                value={bankAccountName}
                onChange={(e) => setBankAccountName(e.target.value)}
                placeholder="ชื่อบัญชี (ควรตรงกับชื่อ-นามสกุลคุณ)"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850"
              />
              <p className="text-[10px] text-stone-400 mt-1 font-medium">
                * บัญชีนี้จะถูกใช้เป็นบัญชีเริ่มต้นให้บริษัทฯ โอนเงินเข้าสู่บัญชีคุณโดยตรงเมื่อได้รับอนุมัติการเบิกเงินทดรองจ่าย (Advance)
              </p>
            </div>
          </div>
        </div>

        {/* Electronic Signature Settings Card */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4" id="signature_settings_card">
          <div className="border-b pb-2">
            <h3 className="text-xs font-black text-stone-950 uppercase tracking-widest flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-stone-700" /> ลายเซ็นอิเล็กทรอนิกส์สำหรับเอกสารอัตโนมัติ (Electronic Signature)
            </h3>
            <p className="text-[10px] text-stone-500 mt-0.5 font-medium">
              วาดลายเซ็นหรือแนบไฟล์รูปภาพลายเซ็นของคุณ เพื่อประทับลงในเอกสารรายงานใบเบิกและใบเคลียร์แบบอัตโนมัติ
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Drawing Pad Area */}
            <div className="space-y-2">
              <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                ช่องสำหรับวาดลายเซ็น (Draw Signature Pad)
              </label>
              <div className="border border-stone-200 bg-stone-50 rounded-xl overflow-hidden relative">
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={150}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-[150px] bg-stone-50 cursor-crosshair touch-none"
                  title="วาดลายเซ็นของคุณตรงนี้"
                />
                <div className="absolute bottom-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="px-2 py-1 bg-white hover:bg-stone-100 text-[9px] font-bold text-red-600 border border-stone-200 rounded-md shadow-xs transition"
                  >
                    ล้างกระดาน
                  </button>
                </div>
              </div>
              <p className="text-[9px] text-stone-400 italic font-medium">
                * ลากนิ้วหรือเมาส์เพื่อเขียนลายเซ็น ระบบจะประมวลผลเซฟเข้ารูปภาพลายเซ็นทันทีหลังจากเขียนเสร็จ
              </p>
            </div>

            {/* Signature Preview & Image Upload Area */}
            <div className="flex flex-col justify-between gap-3 bg-stone-50/50 p-4 rounded-xl border border-dashed border-stone-200">
              <div className="space-y-2">
                <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest">
                  ลายเซ็นปัจจุบันของคุณ (Signature Preview)
                </label>
                <div className="h-[90px] border border-stone-200 bg-white rounded-lg flex items-center justify-center overflow-hidden p-2">
                  {signatureImage ? (
                    <img
                      src={signatureImage}
                      alt="Signature Preview"
                      className="max-h-full max-w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-[10px] text-stone-400 font-bold italic">ไม่มีลายเซ็นในระบบ</span>
                  )}
                </div>
              </div>

              <div>
                <input
                  type="file"
                  ref={signatureFileInputRef}
                  onChange={handleSignatureUpload}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => signatureFileInputRef.current?.click()}
                  className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold rounded-lg text-[10px] transition-all flex items-center justify-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" /> แนบรูปภาพลายเซ็น (PNG/JPG)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Change Security PIN Card */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h3 className="text-xs font-black text-stone-950 uppercase tracking-widest flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-stone-700" /> รหัสผ่านความปลอดภัย PIN
            </h3>
            
            <button
              type="button"
              onClick={() => setChangePin(!changePin)}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all border ${
                changePin 
                  ? "bg-stone-100 border-stone-300 text-stone-800" 
                  : "bg-stone-900 border-stone-800 text-white hover:bg-stone-850"
              }`}
            >
              {changePin ? "ยกเลิกการเปลี่ยน PIN" : "ต้องการเปลี่ยน PIN 6 หลัก"}
            </button>
          </div>

          {!changePin ? (
            <p className="text-xs text-stone-500 font-medium leading-relaxed">
              คุณสามารถใช้รหัสผ่านความปลอดภัย PIN ปัจจุบันในการลงชื่อเข้าใช้งานแอปพลิเคชันได้ หากต้องการเปลี่ยนกรุณากดปุ่มด้านบน
            </p>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1 flex items-center justify-between">
                    <span>รหัส PIN ใหม่ (ตัวเลข 6 หลัก)</span>
                    <button 
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="text-stone-500 hover:text-stone-850 text-[10px] font-bold flex items-center gap-0.5"
                    >
                      {showPin ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showPin ? "ซ่อน" : "แสดง"}</span>
                    </button>
                  </label>
                  <div className="relative">
                    <input
                      type={showPin ? "text" : "password"}
                      value={newPin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        if (val.length <= 6) setNewPin(val);
                      }}
                      placeholder="ป้อนตัวเลข 6 หลัก"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 tracking-widest font-mono"
                      maxLength={6}
                    />
                    <div className="absolute right-3 top-2.5 text-stone-400 text-[10px] font-mono font-bold">
                      {newPin.length}/6
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-stone-400 uppercase tracking-widest mb-1">
                    ยืนยันรหัส PIN ใหม่อีกครั้ง
                  </label>
                  <input
                    type={showPin ? "text" : "password"}
                    value={confirmPin}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val.length <= 6) setConfirmPin(val);
                    }}
                    placeholder="ยืนยันตัวเลข 6 หลักอีกครั้ง"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 font-bold text-stone-850 tracking-widest font-mono"
                    maxLength={6}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-stone-950 text-stone-50 hover:bg-stone-900 border border-stone-800 shadow-sm text-xs font-black rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-55 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังบันทึกข้อมูล...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>กดบันทึกการตั้งค่าโปรไฟล์ ✨</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
