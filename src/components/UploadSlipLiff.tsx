import { useEffect, useState } from "react";
import { motion } from "motion/react";
import liff from "@line/liff";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { CheckCircle2, Copy, Loader2, UploadCloud, X } from "lucide-react";
import { db, storage } from "../lib/firebase";

interface BankInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

interface AdvanceInfo {
  amount: number;
  status: string;
  requesterName: string;
}

const DEFAULT_BANK_INFO: BankInfo = {
  bankName: "ธนาคารกสิกรไทย",
  accountName: "บจก. ClearAdvance",
  accountNumber: "123-4-56789-0",
};

export default function UploadSlipLiff() {
  const [advId, setAdvId] = useState<string | null>(null);
  const [advanceInfo, setAdvanceInfo] = useState<AdvanceInfo | null>(null);
  const [bankInfo, setBankInfo] = useState<BankInfo | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initApp = async () => {
      try {
        const liffId = import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID;
        if (liffId) {
          await liff.init({ liffId });
        }

        const urlParams = new URLSearchParams(window.location.search);
        const currentAdvId = urlParams.get("adv_id");
        if (!currentAdvId) throw new Error("ไม่พบเลขที่ ADV จากลิงก์");

        setAdvId(currentAdvId);
        const [advSnapshot, settingsSnapshot] = await Promise.all([
          getDoc(doc(db, "advances", currentAdvId)),
          getDoc(doc(db, "settings", "global")),
        ]);

        if (!advSnapshot.exists()) {
          throw new Error("ไม่พบข้อมูลรายการเบิกนี้ในระบบ");
        }

        const adv = advSnapshot.data();
        setAdvanceInfo({
          amount: Number(adv.requestAmount || adv.amount || 0),
          status: String(adv.status || ""),
          requesterName: String(adv.employeeName || adv.requesterName || "-"),
        });

        const configuredBank = settingsSnapshot.exists() ? settingsSnapshot.data().bankInfo : null;
        setBankInfo({
          bankName: configuredBank?.bankName || DEFAULT_BANK_INFO.bankName,
          accountName: configuredBank?.accountName || DEFAULT_BANK_INFO.accountName,
          accountNumber: configuredBank?.accountNumber || DEFAULT_BANK_INFO.accountNumber,
        });
      } catch (err: any) {
        console.error("LIFF slip upload initialization failed:", err);
        setError(err?.message || "ไม่สามารถเปิดหน้าส่งสลิปได้");
      } finally {
        setIsInitializing(false);
      }
    };

    initApp();
  }, []);

  const closePage = () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.history.back();
    }
  };

  const handleCopyAccount = async () => {
    if (!bankInfo) return;
    await navigator.clipboard.writeText(bankInfo.accountNumber);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > 5 * 1024 * 1024) {
      alert("ขนาดไฟล์ต้องไม่เกิน 5MB");
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

  const handleSubmit = async () => {
    if (!file || !advId) return;
    setIsUploading(true);
    setError(null);

    try {
      const fileExtension = file.name.split(".").pop() || "jpg";
      const fileName = `slip_${advId}_${Date.now()}.${fileExtension}`;
      const storageRef = ref(storage, `slips/${advId}/${fileName}`);
      const uploadResult = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

      await updateDoc(doc(db, "advances", advId), {
        status: "WAITING_CLEARANCE",
        slipUrl: downloadUrl,
        transferSlipUrl: downloadUrl,
        transferCompletedAt: serverTimestamp(),
      });

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

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 font-sans pb-10">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-4 flex items-center justify-between shadow-sm">
        <h1 className="text-lg font-semibold">แนบหลักฐานการโอนเงิน</h1>
        <button onClick={closePage} className="text-stone-500 hover:bg-stone-100 p-1 rounded-full transition">
          <X size={24} />
        </button>
      </header>

      <main className="p-4 space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-stone-500">ยอดเงินที่ต้องโอน ({advId})</p>
          <h2 className="text-3xl font-bold text-stone-900">
            ฿{advanceInfo.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          </h2>
          <p className="text-xs text-stone-400">ผู้ขอเบิก: {advanceInfo.requesterName}</p>
        </div>

        {bankInfo && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 space-y-3"
          >
            <div className="flex justify-between items-center border-b border-stone-100 pb-3">
              <span className="text-sm text-stone-500">ธนาคาร</span>
              <span className="font-medium text-sm">{bankInfo.bankName}</span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-100 pb-3">
              <span className="text-sm text-stone-500">ชื่อบัญชี</span>
              <span className="font-medium text-sm">{bankInfo.accountName}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <div>
                <p className="text-sm text-stone-500">เลขที่บัญชี</p>
                <p className="text-lg font-bold text-stone-900 mt-1">{bankInfo.accountNumber}</p>
              </div>
              <button
                onClick={handleCopyAccount}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isCopied ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600 active:scale-95"
                }`}
              >
                {isCopied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                {isCopied ? "คัดลอกแล้ว" : "คัดลอก"}
              </button>
            </div>
          </motion.section>
        )}

        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3">
          <p className="text-sm font-medium text-stone-700 px-1">รูปภาพสลิปโอนเงิน</p>

          {!previewUrl ? (
            <label className="flex flex-col items-center justify-center w-full h-48 bg-white border-2 border-dashed border-stone-200 rounded-2xl cursor-pointer hover:bg-stone-50 transition active:scale-[0.98]">
              <UploadCloud className="w-10 h-10 text-stone-400 mb-3" />
              <p className="text-sm text-stone-500 font-medium">กดเพื่อเลือกรูปภาพ</p>
              <p className="text-xs text-stone-400 mt-1">รองรับ JPG, PNG ขนาดไม่เกิน 5MB</p>
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
        </motion.section>

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
