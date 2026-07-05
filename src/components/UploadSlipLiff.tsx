import { useEffect, useState } from "react";
import liff from "@line/liff";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { CheckCircle2, Copy, Loader2, UploadCloud, X } from "lucide-react";
import { db } from "../lib/firebase";

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

  for (const field of ["documentNo", "id", "requestNo"]) {
    const snap = await getDocs(query(collection(db, "advances"), where(field, "==", advCode), limit(1)));
    if (!snap.empty) {
      const advDoc = snap.docs[0];
      return { docId: advDoc.id, data: advDoc.data() };
    }
  }

  return null;
};

const resolveDocumentId = (urlParams: URLSearchParams) =>
  urlParams.get("adv_id") ||
  urlParams.get("advId") ||
  urlParams.get("id") ||
  urlParams.get("docId") ||
  urlParams.get("documentId") ||
  urlParams.get("advanceId") ||
  urlParams.get("advanceNo") ||
  urlParams.get("documentNo") ||
  "";

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

  useEffect(() => {
    const initApp = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const currentAdvId = resolveDocumentId(urlParams);
        if (!currentAdvId) throw new Error("ไม่พบเลขที่ ADV จากลิงก์");

        setAdvId(currentAdvId);
        const settingsSnapshot = await getDoc(doc(db, "settings", "global"));
        const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
        const configuredLiffId =
          settings?.lineMessagingConfig?.liffId ||
          settings?.lineConfig?.liffId ||
          import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID;
        if (configuredLiffId) await liff.init({ liffId: configuredLiffId });

        const advanceRecord = await getAdvanceByCode(currentAdvId);
        if (!advanceRecord) throw new Error("ไม่พบข้อมูลรายการเบิกนี้ในระบบ");

        const adv = advanceRecord.data;
        const employeeId = adv.employeeId || adv.requesterId || adv.userId;
        const employee = await getEmployeeById(employeeId);
        const requesterName = adv.employeeName || adv.requesterName || employee?.name || employee?.fullName || "-";

        setAdvanceInfo({
          docId: advanceRecord.docId,
          amount: Number(adv.requestAmount || adv.amount || adv.totalAmount || adv.advanceAmount || 0),
          status: String(adv.status || ""),
          requesterName: String(requesterName),
          bankInfo: getBankInfo(adv, employee, settings),
        });
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
    if (liff.isInClient()) liff.closeWindow();
    else window.history.back();
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

  const parseServerUploadResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {
        error: text || `Server returned HTTP ${response.status}`,
        raw: text,
      };
    }
  };

  const uploadViaServer = async (selectedFile: File) => {
    const form = new FormData();
    form.append("advId", advId || "");
    form.append("slip", selectedFile);
    const response = await fetch("/api/line/upload-slip", { method: "POST", body: form });
    const payload = await parseServerUploadResponse(response);
    if (!response.ok) throw new Error(payload?.error || "อัปโหลดผ่าน server ไม่สำเร็จ");
    if (!payload?.url) throw new Error("Server upload succeeded but did not return slip URL.");
    return payload.url as string;
  };

  const handleSubmit = async () => {
    if (!file || !advId || !advanceInfo) return;
    setIsUploading(true);
    setError(null);

    try {
      await uploadViaServer(file);

      if (liff.isInClient()) {
        liff.closeWindow();
      } else {
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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4 text-center">
        <X className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-bold text-stone-900">ไม่พบข้อมูลรายการ</h2>
        <p className="text-stone-500 text-sm mt-2">{error || "โปรดตรวจสอบลิงก์จาก LINE อีกครั้ง"}</p>
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
          onClick={handleSubmit}
          disabled={!file || isUploading}
          className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-base font-semibold transition-all ${
            !file || isUploading ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-stone-950 text-white shadow-lg active:scale-[0.98]"
          }`}
        >
          {isUploading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
          {isUploading ? "กำลังอัปโหลด..." : "ยืนยันการโอนเงิน"}
        </button>
      </main>
    </div>
  );
}
