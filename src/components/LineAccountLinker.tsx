import React, { useState, useEffect } from "react";
import { UserPlus, ArrowRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Employee } from "../types";
import { db, hashPIN } from "../lib/firebase";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";

interface LineAccountLinkerProps {
  liffProfile: any;
  onLinked: (emp: Employee) => void;
}

export default function LineAccountLinker({ liffProfile, onLinked }: LineAccountLinkerProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"notice" | "verify">("notice");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const snap = await getDocs(collection(db, "employees"));
        const emps: Employee[] = [];
        snap.forEach(doc => {
          emps.push({ id: doc.id, ...doc.data() } as Employee);
        });
        const filtered = emps.filter(e => e.isActive !== false && e.status !== "Suspended" && e.status !== "Disabled");
        setEmployees(filtered);

        const params = new URLSearchParams(window.location.search);
        const urlEmpId = params.get("emp_id") || params.get("empId");
        if (urlEmpId) {
          const match = filtered.find(e => e.id === urlEmpId);
          if (match) {
            setSelectedEmpId(urlEmpId);
            setStep("verify");
          }
        }
      } catch (err) {
        console.error("Failed to load employees", err);
      }
    };
    fetchEmployees();
  }, []);

  const handleLink = async () => {
    setError(null);
    if (!selectedEmpId) {
      setError("กรุณาเลือกชื่อพนักงาน");
      return;
    }
    const emp = employees.find(e => e.id === selectedEmpId);
    if (!emp) return;

    if (!pin) {
      setError("กรุณากรอก PIN");
      return;
    }

    setLoading(true);
    try {
      // Check PIN
      let isPinValid = false;
      const expectedPinLength = emp.username ? 4 : 6;
      if (emp.pinHash) {
        const inputHash = await hashPIN(pin);
        isPinValid = (inputHash === emp.pinHash);
      } else if (emp.plainPin) {
        isPinValid = (pin === emp.plainPin);
      }

      if (!isPinValid) {
        throw new Error("รหัส PIN ไม่ถูกต้อง");
      }

      if (!liffProfile || !liffProfile.userId) {
        throw new Error("ไม่พบ LINE Profile, กรุณาลองเปิดใหม่อีกครั้ง");
      }

      const nowIso = new Date().toISOString();
      await setDoc(doc(db, "employees", emp.id), {
        lineUserId: liffProfile.userId,
        lineDisplayName: liffProfile.displayName || "",
        linePictureUrl: liffProfile.pictureUrl || "",
        lineLinked: true,
        lineLinkedAt: nowIso
      }, { merge: true });

      emp.lineUserId = liffProfile.userId;
      emp.lineDisplayName = liffProfile.displayName || "";
      emp.linePictureUrl = liffProfile.pictureUrl || "";
      emp.lineLinked = true;
      emp.lineLinkedAt = nowIso;

      onLinked(emp);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "เกิดข้อผิดพลาดในการเชื่อมบัญชี");
    } finally {
      setLoading(false);
    }
  };

  if (step === "notice") {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-lg border border-stone-100 text-center space-y-6">
          <div className="w-20 h-20 bg-stone-100 rounded-full mx-auto flex items-center justify-center">
            {liffProfile?.pictureUrl ? (
              <img src={liffProfile.pictureUrl} alt="profile" className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <UserPlus className="w-10 h-10 text-stone-400" />
            )}
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-stone-900">บัญชี LINE นี้ยังไม่ได้เชื่อม</h2>
            <p className="text-sm text-stone-500">
              พบว่าบัญชี LINE ของคุณยังไม่ได้เชื่อมต่อกับระบบพนักงาน กรุณาเชื่อมบัญชีในครั้งแรก
            </p>
          </div>
          <button 
            onClick={() => setStep("verify")}
            className="w-full py-4 bg-stone-950 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-stone-900 transition"
          >
            เชื่อมบัญชี <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-lg border border-stone-100 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-stone-900">ยืนยันตัวตน</h2>
          <p className="text-sm text-stone-500">เลือกชื่อของคุณและกรอก PIN เพื่อเชื่อมบัญชี</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm flex items-start gap-2 border border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-500">พนักงาน (Employee)</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
            >
              <option value="">-- เลือกชื่อพนักงาน --</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name} ({e.position || e.role})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-500">PIN (รหัสผ่าน)</label>
            <input
              type="password"
              pattern="[0-9]*"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="กรอกรหัส PIN"
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 tracking-widest"
            />
          </div>

          <button 
            onClick={handleLink}
            disabled={loading || !selectedEmpId || !pin}
            className="w-full py-4 bg-emerald-600 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            ยืนยันเชื่อมบัญชี
          </button>
        </div>
      </div>
    </div>
  );
}
