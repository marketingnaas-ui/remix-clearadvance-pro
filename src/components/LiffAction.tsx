import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { doc, getDoc } from "firebase/firestore";
import { CheckCircle2, Copy, Loader2, Send, ShieldCheck, UploadCloud, XCircle } from "lucide-react";
import { db } from "../lib/firebase";

interface LiffAdvance {
  id: string;
  advId: string;
  employeeName: string;
  projectName?: string;
  category?: string;
  details?: string;
  requestAmount: number;
  status: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
}

const money = (value: number) =>
  `฿${Number(value || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
  document.body.removeChild(area);
};

export default function LiffAction() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const advId = query.get("adv_id") || query.get("advId") || query.get("id") || "";
  const action = query.get("action") === "reject" ? "reject" : "approve";
  const isReject = action === "reject";

  const [profile, setProfile] = useState<any>(null);
  const [advance, setAdvance] = useState<LiffAdvance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        if (!advId) throw new Error("ไม่พบเลขที่ใบเบิกจากลิงก์ LINE");

        const settingsSnapshot = await getDoc(doc(db, "settings", "global"));
        const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
        const configuredLiffId =
          settings?.lineMessagingConfig?.liffId ||
          settings?.lineConfig?.liffId ||
          import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID;

        if (configuredLiffId) {
          await liff.init({ liffId: configuredLiffId });
          if (liff.isLoggedIn()) {
            try {
              setProfile(await liff.getProfile());
            } catch (profileError) {
              console.warn("Cannot read LIFF profile:", profileError);
            }
          }
        }

        const response = await fetch(`/api/line/liff-advance/${encodeURIComponent(advId)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "โหลดข้อมูลใบเบิกไม่สำเร็จ");
        setAdvance(payload.advance);
      } catch (err: any) {
        console.error("LIFF action initialization failed:", err);
        setError(err?.message || "ไม่สามารถเปิดหน้าดำเนินการผ่าน LINE ได้");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [advId]);

  const handleConfirm = async () => {
    if (!advance) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/line/liff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advId,
          action,
          userId: profile?.userId || "",
          displayName: profile?.displayName || "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "บันทึกผลผ่าน LINE ไม่สำเร็จ");
      setAdvance(payload.advance);
      setDone(true);
    } catch (err: any) {
      console.error("LIFF action save failed:", err);
      setError(err?.message || "บันทึกผลผ่าน LINE ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const account = advance?.bankAccountNumber || "";
    if (!account) return;
    await copyToClipboard(account);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const goUploadSlip = () => {
    window.location.href = `/liff/upload-slip?adv_id=${encodeURIComponent(advId)}`;
  };

  const closePage = () => {
    if (liff.isInClient()) liff.closeWindow();
    else window.history.back();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-500" />
      </div>
    );
  }

  if (error || !advance) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-5">
        <div className="w-full max-w-md bg-white border border-red-100 rounded-2xl p-6 text-center shadow-sm">
          <XCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="mt-4 text-lg font-bold text-stone-900">เปิดรายการไม่สำเร็จ</h1>
          <p className="mt-2 text-sm text-stone-500">{error || "ไม่พบข้อมูลใบเบิก"}</p>
          <button onClick={closePage} className="mt-6 w-full rounded-xl bg-stone-900 text-white py-3 text-sm font-bold">
            ปิดหน้านี้
          </button>
        </div>
      </div>
    );
  }

  const bankReady = Boolean(advance.bankAccountNumber);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 font-sans">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-stone-200 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-stone-500">LINE LIFF</p>
            <h1 className="text-lg font-bold">{isReject ? "ไม่อนุมัติรายการ" : "อนุมัติรายการ"}</h1>
          </div>
          <button onClick={closePage} className="p-2 rounded-full hover:bg-stone-100 text-stone-500">
            <XCircle size={22} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center ${isReject ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
              {isReject ? <XCircle size={24} /> : <ShieldCheck size={24} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-stone-500">เลขที่ใบเบิก</p>
              <h2 className="font-mono text-xl font-bold text-stone-900 truncate">{advance.advId}</h2>
              <p className="text-sm text-stone-500 mt-1">ผู้ขอเบิก: {advance.employeeName}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">ยอดเงิน</p>
              <p className="font-bold text-stone-900">{money(advance.requestAmount)}</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">สถานะ</p>
              <p className="font-bold text-stone-900">{advance.status || "-"}</p>
            </div>
          </div>

          {(advance.projectName || advance.category || advance.details) && (
            <div className="mt-4 space-y-2 text-sm">
              {advance.projectName && <Info label="โครงการ" value={advance.projectName} />}
              {advance.category && <Info label="หมวดหมู่" value={advance.category} />}
              {advance.details && <Info label="รายละเอียด" value={advance.details} />}
            </div>
          )}
        </section>

        {!done ? (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-sm text-stone-600">
              {isReject
                ? "ยืนยันไม่อนุมัติรายการนี้ ระบบจะอัปเดตสถานะกลับเข้า Firestore ทันที"
                : "ยืนยันอนุมัติรายการนี้ ระบบจะแสดงเลขบัญชีสำหรับโอนและปุ่มแนบสลิปต่อใน LINE"}
            </p>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className={`w-full rounded-2xl py-4 font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 ${isReject ? "bg-red-600" : "bg-stone-950"}`}
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : isReject ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
              {saving ? "กำลังบันทึก..." : isReject ? "ยืนยันไม่อนุมัติ" : "ยืนยันอนุมัติ"}
            </button>
          </section>
        ) : (
          <section className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 size={24} />
              <p className="font-bold">{isReject ? "บันทึกผลไม่อนุมัติแล้ว" : "อนุมัติแล้ว"}</p>
            </div>

            {!isReject && (
              <>
                <div className="rounded-2xl bg-stone-50 p-4 space-y-3">
                  <Info label="ธนาคาร" value={advance.bankName || "-"} />
                  <Info label="ชื่อบัญชี" value={advance.bankAccountName || "-"} />
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-stone-500">เลขที่บัญชี</p>
                      <p className="font-mono text-lg font-bold text-stone-900 break-all">{advance.bankAccountNumber || "-"}</p>
                    </div>
                    <button
                      onClick={handleCopy}
                      disabled={!bankReady}
                      className="shrink-0 rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-40 flex items-center gap-2"
                    >
                      {copied ? <CheckCircle2 size={17} /> : <Copy size={17} />}
                      {copied ? "คัดลอกแล้ว" : "คัดลอก"}
                    </button>
                  </div>
                </div>

                <button onClick={goUploadSlip} className="w-full rounded-2xl bg-stone-950 py-4 font-bold text-white flex items-center justify-center gap-2">
                  <UploadCloud size={20} />
                  แนบสลิปผ่าน LINE
                </button>
              </>
            )}

            <button onClick={closePage} className="w-full rounded-2xl bg-stone-100 py-3 font-bold text-stone-700 flex items-center justify-center gap-2">
              <Send size={18} />
              ปิดหน้านี้
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-stone-500">{label}</span>
      <span className="text-right font-semibold text-stone-900 break-words">{value || "-"}</span>
    </div>
  );
}
