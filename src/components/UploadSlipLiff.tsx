import { useEffect, useState } from "react";
import liff from "@line/liff";
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { CheckCircle2, Copy, Loader2, UploadCloud, X } from "lucide-react";
import { db, storage } from "../lib/firebase";

interface BankInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

interface AdvanceInfo {
  docId: string;
  amount: number;
  status: string;
  requesterName: string;
  bankInfo: BankInfo;
}

const emptyBankInfo: BankInfo = {
  bankName: "ยังไม่ได้ตั้งค่าธนาคาร",
  accountName: "ยังไม่ได้ตั้งค่าชื่อบัญชี",
  accountNumber: "-",
};

const money = (value: number) =>
  `฿${Number(value || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getAdvanceByCode = async (advCode: string) => {
  const byId = await getDoc(doc(db, "advances", advCode));
  if (byId.exists()) return { docId: byId.id, data: byId.data() };

  const byAdvId = await getDocs(query(collection(db, "advances"), where("advId", "==", advCode), limit(1)));
  if (!byAdvId.empty) {
    const advDoc = byAdvId.docs[0];
    return { docId: advDoc.id, data: advDoc.data() };
  }

  const byAdvanceNo = await getDocs(query(collection(db, "advances"), where("advanceNo", "==", advCode), limit(1)));
  if (!byAdvanceNo.empty) {
    const advDoc = byAdvanceNo.docs[0];
    return { docId: advDoc.id, data: advDoc.data() };
  }

  return null;
};

const getEmployeeById = async (employeeId?: string) => {
  if (!employeeId) return null;
  const byId = await getDoc(doc(db, "employees", employeeId));
  if (byId.exists()) return byId.data();

  const byEmployeeId = await getDocs(query(collection(db, "employees"), where("employeeId", "==", employeeId), limit(1)));
  return byEmployeeId.empty ? null : byEmployeeId.docs[0].data();
};

const getBankInfo = (advance: any, employee: any, settings: any): BankInfo => {
  const custom = advance?.customTransferAccount || {};
  const bank = settings?.bankInfo || settings?.companyBankInfo || settings?.transferBankInfo || {};
  return {
    bankName: custom.bankName || advance?.bankName || employee?.bankName || bank.bankName || bank.name || emptyBankInfo.bankName,
    accountName:
      custom.accountName ||
      advance?.bankAccountName ||
      employee?.bankAccountName ||
      employee?.name ||
      bank.accountName ||
      bank.bankAccountName ||
      emptyBankInfo.accountName,
    accountNumber:
      custom.accountNo ||
      custom.accountNumber ||
      advance?.bankNo ||
      employee?.bankNo ||
      employee?.bankAccountNo ||
      employee?.bankAccountNumber ||
      bank.accountNumber ||
      bank.bankNo ||
      bank.bankAccountNo ||
      emptyBankInfo.accountNumber,
  };
};

const copyToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
};

export default function UploadSlipLiff() {
  const [advId, setAdvId] = useState<string | null>(null);
  const [advanceInfo, setAdvanceInfo] = useState<AdvanceInfo | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [liffErrorNotice, setLiffErrorNotice] = useState<string | null>(null);
  const [debugConfig, setDebugConfig] = useState<{
    liffIdExists: boolean;
    appBaseUrl: string;
  }>({ liffIdExists: false, appBaseUrl: "" });

  const isDev = import.meta.env.DEV || window.location.hostname === "localhost" || window.location.hostname.includes("aistudio") || window.location.hostname.includes("run.app");
  const urlParams = new URLSearchParams(window.location.search);

  useEffect(() => {
    const initApp = async () => {
      try {
        const getQueryParam = (key: string): string => {
          let val = urlParams.get(key);
          if (val) return val;

          const liffState = urlParams.get("liff.state");
          if (liffState) {
            try {
              const decoded = decodeURIComponent(liffState);
              if (!decoded.includes("=") && !decoded.includes("/") && decoded.length > 3) {
                if (key === "adv_id" || key === "advId" || key === "id" || key === "docId" || key === "documentId" || key === "advanceId") {
                  return decoded;
                }
              }
              const qIndex = decoded.indexOf("?");
              const queryStr = qIndex !== -1 ? decoded.substring(qIndex) : decoded;
              const innerParams = new URLSearchParams(queryStr);
              val = innerParams.get(key);
              if (val) return val;
            } catch (e) {
              console.error("Error parsing liff.state query param in UploadSlipLiff:", e);
            }
          }
          return "";
        };

        const currentAdvId = String(
          getQueryParam("adv_id") ||
          getQueryParam("advId") ||
          getQueryParam("id") ||
          getQueryParam("docId") ||
          getQueryParam("documentId") ||
          getQueryParam("advanceId") || ""
        ).trim();
        if (!currentAdvId) throw new Error("ไม่พบเลขที่ ADV จากลิงก์ (Missing adv_id)");

        setAdvId(currentAdvId);
        
        // Parallelize fetching settings and advance data
        const [settingsSnapshot, advanceRecord] = await Promise.all([
          getDoc(doc(db, "settings", "global")),
          getAdvanceByCode(currentAdvId)
        ]);

        if (!advanceRecord) throw new Error("ไม่พบข้อมูลรายการเบิกนี้ในระบบ (Advance Not Found)");

        const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
        const config = settings?.lineMessagingConfig || {};
        
        const adv = advanceRecord.data;
        const employeeId = adv.employeeId || adv.requesterId || adv.userId;
        
        // Fetch employee details in parallel if needed (though we can continue with what we have)
        const employeePromise = getEmployeeById(employeeId);
        
        const configuredLiffId = String(
          config.liffId ||
          import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID || ""
        ).trim();
        const employee = await employeePromise;
        const requesterName = adv.employeeName || adv.requesterName || employee?.name || employee?.fullName || "-";

        setAdvanceInfo({
          docId: advanceRecord.docId,
          amount: Number(adv.requestAmount || adv.amount || adv.totalAmount || adv.advanceAmount || 0),
          status: String(adv.status || ""),
          requesterName: String(requesterName),
          bankInfo: getBankInfo(adv, employee, settings),
        });

        const liffIdPattern = /^[0-9]+-[A-Za-z0-9_-]+$/;
        const isValidLiffId = liffIdPattern.test(configuredLiffId);

        const appBaseUrl = config.appBaseUrl || window.location.origin;
        setDebugConfig({
          liffIdExists: !!configuredLiffId,
          appBaseUrl: appBaseUrl,
        });

        if (configuredLiffId) {
          if (!isValidLiffId || configuredLiffId === "123456-abcde" || configuredLiffId === "{LIFF_ID}") {
            console.warn("Invalid or Mock LIFF ID detected:", configuredLiffId);
            setLiffErrorNotice(
              !isValidLiffId 
                ? "รูปแบบ LIFF ID ในระบบไม่ถูกต้อง เข้าสู่โหมดจำลองสถานะการเปิดจาก LINE"
                : "ระบบกำลังใช้ LIFF ID ตัวอย่าง (Mock) เข้าสู่โหมดจำลอง"
            );
          } else {
            try {
              if (!liff.id) {
                console.log("Initializing LIFF with ID:", configuredLiffId);
                await liff.init({ liffId: configuredLiffId });
              }
              if (!liff.isLoggedIn()) {
                const isInIframe = window.self !== window.top;
                if (!isInIframe) {
                  liff.login();
                  return;
                }
              }
            } catch (liffInitErr: any) {
              console.error("LIFF SDK init failed:", liffInitErr);
              const errMsg = String(liffInitErr?.message || liffInitErr || "");
              if (errMsg.includes("expected pattern")) {
                throw new Error(`LIFF ID (${configuredLiffId}) มีรูปแบบไม่ถูกต้อง: The string did not match the expected pattern`);
              }
              setLiffErrorNotice(`ไม่สามารถเชื่อมต่อ LIFF SDK จริงได้ (${errMsg}) เข้าสู่โหมดจำลอง`);
            }
          }
        } else {
          setLiffErrorNotice("ยังไม่ได้รับการตั้งค่า LIFF ID เข้าสู่โหมดทดลองในเบราว์เซอร์");
        }
      } catch (err: any) {
        console.error("LIFF slip upload initialization failed:", err);
        setError(err?.message || "ไม่สามารถเปิดหน้าแนบสลิปได้");
      } finally {
        setIsInitializing(false);
      }
    };

    initApp();
  }, []);

  const closePage = () => {
    try {
      if (liff.isInClient()) {
        liff.closeWindow();
        return;
      }
    } catch (e) {
      console.warn("liff.closeWindow failed:", e);
    }
    window.history.back();
  };

  const handleCopyAccount = async () => {
    const account = advanceInfo?.bankInfo.accountNumber || "";
    if (!account || account === "-") return;
    await copyToClipboard(account);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    if (selectedFile.size > 8 * 1024 * 1024) {
      alert("ขนาดไฟล์ต้องไม่เกิน 8MB");
      return;
    }
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const handleClearFile = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const uploadViaServer = async (selectedFile: File) => {
    const form = new FormData();
    form.append("advId", advId || "");
    form.append("slip", selectedFile);
    const response = await fetch("/api/line/upload-slip", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "อัปโหลดผ่าน server ไม่สำเร็จ");
    return payload.url as string;
  };

  const uploadViaClientFallback = async (selectedFile: File) => {
    if (!advId || !advanceInfo) throw new Error("ข้อมูลใบเบิกไม่ครบถ้วน");
    const fileExtension = selectedFile.name.split(".").pop() || "jpg";
    const fileName = `slip_${advId}_${Date.now()}.${fileExtension}`;
    const storageRef = ref(storage, `slips/${advId}/${fileName}`);
    const uploadResult = await uploadBytes(storageRef, selectedFile);
    const downloadUrl = await getDownloadURL(uploadResult.ref);
    await updateDoc(doc(db, "advances", advanceInfo.docId), {
      status: "WAITING_CLEARANCE",
      slipUrl: downloadUrl,
      transferSlipUrl: downloadUrl,
      transferCompletedAt: serverTimestamp(),
      transferUpdatedFrom: "line_liff",
    });
    return downloadUrl;
  };

  const [showConfirm, setShowConfirm] = useState(false);

  const requestConfirm = () => {
    if (!file || !advId || !advanceInfo) return;
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    setShowConfirm(false);
    if (!file || !advId || !advanceInfo) return;
    setIsUploading(true);
    setError(null);

    try {
      try {
        await uploadViaServer(file);
      } catch (serverError: any) {
        console.warn("Server slip upload failed, using client fallback:", serverError);
        // If it's a 404 or specific error, fallback to client upload
        try {
          await uploadViaClientFallback(file);
        } catch (clientError: any) {
          console.error("Client fallback upload also failed:", clientError);
          throw new Error(`ไม่สามารถอัปโหลดได้ทั้งทาง Server (${serverError.message}) และ Client (${clientError.message})`);
        }
      }

      try {
        if (liff.isInClient()) {
          liff.closeWindow();
        } else {
          alert("อัปโหลดสลิปและบันทึกข้อมูลเรียบร้อยแล้ว");
          window.history.back();
        }
      } catch (closeErr: any) {
        console.warn("UploadSlipLiff liff.closeWindow failed:", closeErr);
        alert("อัปโหลดสลิปและบันทึกข้อมูลเรียบร้อยแล้ว");
        window.history.back();
      }
    } catch (err: any) {
      console.error("Upload slip failed:", err);
      setError(err?.message || "เกิดข้อผิดพลาดในการอัปโหลดสลิป กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsUploading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="animate-spin text-stone-400 w-8 h-8" />
      </div>
    );
  }

  if (error || !advId || !advanceInfo) {
    const isDev = import.meta.env.DEV || window.location.hostname.includes("run.app") || window.location.hostname.includes("localhost");
    const urlParams = new URLSearchParams(window.location.search);
    
    // Determine if it's a "Not Found" error or a general error
    const isNotFound = !advId || !advanceInfo || (error && (error.includes("Not Found") || error.includes("ไม่พบ")));
    
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4 text-center">
        <X className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-bold text-stone-900">{isNotFound ? "ไม่พบข้อมูลรายการ" : "เกิดข้อผิดพลาด"}</h2>
        <p className="text-stone-500 text-sm mt-2">{error || "โปรดตรวจสอบลิงก์จาก LINE อีกครั้ง"}</p>
        
        {isDev && (
          <div className="mt-6 p-4 bg-stone-100 border border-stone-300 rounded-xl text-left font-mono text-[11px] text-stone-600 max-w-sm space-y-1">
            <p className="font-bold text-stone-800 border-b border-stone-200 pb-1 mb-1">🛠️ Dev Debug Panel</p>
            <p><strong>Current URL:</strong> <span className="break-all">{window.location.href}</span></p>
            <p><strong>Detected advId:</strong> {advId || "None"}</p>
            <p><strong>Route:</strong> {urlParams.get("route") || "None"}</p>
            <p><strong>LIFF ID Exists:</strong> {debugConfig.liffIdExists ? "Yes" : "No"}</p>
            <p><strong>App Base URL:</strong> {debugConfig.appBaseUrl || "None"}</p>
          </div>
        )}

        <button onClick={closePage} className="mt-6 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-bold">
          ปิดหน้านี้
        </button>
      </div>
    );
  }

  const bankInfo = advanceInfo.bankInfo;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 font-sans pb-10">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-200 px-4 py-4 flex items-center justify-between shadow-sm">
        <h1 className="text-lg font-semibold">แนบสลิปโอนเงิน</h1>
        <button onClick={closePage} className="text-stone-500 hover:bg-stone-100 p-1 rounded-full transition">
          <X size={24} />
        </button>
      </header>

      <main className="p-4 space-y-6 max-w-md mx-auto">
        {liffErrorNotice && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1 shadow-sm">
            <p className="font-bold flex items-center gap-1.5 text-amber-900">
              ⚠️ โหมดจำลองสถานะ LINE LIFF (Simulation Mode)
            </p>
            <p className="leading-relaxed opacity-90">{liffErrorNotice}</p>
          </div>
        )}

        <div className="text-center space-y-1">
          <p className="text-sm text-stone-500">ยอดเงินที่ต้องโอน ({advId})</p>
          <h2 className="text-3xl font-bold text-stone-900">{money(advanceInfo.amount)}</h2>
          <p className="text-xs text-stone-400">ผู้ขอเบิก: {advanceInfo.requesterName}</p>
          {advanceInfo.status && <p className="text-[11px] text-stone-400">สถานะปัจจุบัน: {advanceInfo.status}</p>}
        </div>

        <section className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 space-y-3">
          <div className="flex justify-between items-center border-b border-stone-100 pb-3 gap-4">
            <span className="text-sm text-stone-500">ธนาคาร</span>
            <span className="font-medium text-sm text-right">{bankInfo.bankName}</span>
          </div>
          <div className="flex justify-between items-center border-b border-stone-100 pb-3 gap-4">
            <span className="text-sm text-stone-500">ชื่อบัญชี</span>
            <span className="font-medium text-sm text-right">{bankInfo.accountName}</span>
          </div>
          <div className="flex justify-between items-center pt-1 gap-4">
            <div className="min-w-0">
              <p className="text-sm text-stone-500">เลขที่บัญชี</p>
              <p className="text-lg font-bold text-stone-900 mt-1 break-all">{bankInfo.accountNumber}</p>
            </div>
            <button
              onClick={handleCopyAccount}
              disabled={!bankInfo.accountNumber || bankInfo.accountNumber === "-"}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isCopied ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600 active:scale-95"
              }`}
            >
              {isCopied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
              {isCopied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-sm font-medium text-stone-700 px-1">รูปภาพสลิปโอนเงิน</p>

          {!previewUrl ? (
            <label className="flex flex-col items-center justify-center w-full h-48 bg-white border-2 border-dashed border-stone-200 rounded-2xl cursor-pointer hover:bg-stone-50 transition active:scale-[0.98]">
              <UploadCloud className="w-10 h-10 text-stone-400 mb-3" />
              <p className="text-sm text-stone-500 font-medium">กดเพื่อเลือกรูปภาพ</p>
              <p className="text-xs text-stone-400 mt-1">รองรับ JPG, PNG ขนาดไม่เกิน 8MB</p>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          ) : (
            <div className="relative w-full rounded-2xl overflow-hidden border border-stone-200 shadow-sm bg-white p-2">
              <img src={previewUrl} alt="Slip Preview" className="w-full h-auto max-h-96 object-contain rounded-xl" />
              <button onClick={handleClearFile} className="absolute top-4 right-4 bg-black/50 p-2 rounded-full text-white shadow-sm hover:bg-black/70 transition">
                <X size={20} />
              </button>
            </div>
          )}
        </section>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>}

        <button
          onClick={requestConfirm}
          disabled={!file || isUploading}
          className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-base font-semibold transition-all ${
            !file || isUploading ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-stone-950 text-white shadow-lg active:scale-[0.98]"
          }`}
        >
          {isUploading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
          {isUploading ? "กำลังอัปโหลด..." : "ยืนยันการโอนเงิน"}
        </button>
      </main>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-stone-100 space-y-4 animate-fade-in">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-green-50 text-green-600">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="font-extrabold text-stone-900 text-base font-sans">ยืนยันการโอนเงิน</h4>
              <p className="text-xs text-stone-500 leading-relaxed font-sans">
                คุณแน่ใจหรือไม่ว่าได้โอนเงินสำเร็จแล้ว และต้องการแนบสลิปนี้สำหรับใบเบิก <b>{advId}</b>?
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-stone-150 hover:bg-stone-200 text-stone-700 font-bold py-3 px-4 rounded-xl text-xs transition border border-stone-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={handleSubmit}
                className="flex-1 font-bold py-3 px-4 rounded-xl text-xs text-white transition bg-stone-950 hover:bg-stone-900 shadow-md shadow-stone-200"
              >
                ยืนยันการโอน
              </button>
            </div>
          </div>
        </div>
      )}

      {isDev && (
        <div className="max-w-md mx-auto mt-8 p-4 bg-stone-950 text-stone-300 rounded-2xl font-mono text-[10px] space-y-2 border border-stone-800 shadow-inner">
          <p className="font-extrabold text-stone-400 border-b border-stone-800 pb-1 text-xs flex items-center gap-1.5">
            🛠️ DEV DEBUG BOX (LINE LIFF Upload Slip Document Resolver)
          </p>
          <div>
            <span className="text-amber-400 font-bold">detected advId:</span> <span className="text-white select-all">{advId || "null"}</span>
          </div>
          <div>
            <span className="text-amber-400 font-bold">current URL:</span> <span className="break-all text-stone-400 select-all">{window.location.href}</span>
          </div>
          <div>
            <span className="text-amber-400 font-bold">liff.state:</span> <span className="break-all text-stone-400 select-all">{urlParams.get("liff.state") || "null"}</span>
          </div>
          <div>
            <p className="text-amber-400 font-bold mt-1">query params:</p>
            <ul className="list-disc list-inside pl-2 space-y-0.5 text-stone-400">
              {Array.from(urlParams.entries()).map(([k, v]) => (
                <li key={k} className="break-all">
                  <span className="text-stone-300 font-semibold">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
