import { useEffect, useMemo, useState, useRef } from "react";
import liff from "@line/liff";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { CheckCircle2, Copy, Loader2, Send, ShieldCheck, UploadCloud, XCircle, FileText, Eye } from "lucide-react";
import { db } from "../lib/firebase";
import { Employee } from "../types";

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
  area.remove();
};

interface LiffActionProps {
  resolvedAction?: string;
  liffProfile?: any;
  currentEmployee?: Employee | null;
  globalSettings?: any;
}

function buildUploadSlipUrl(advId: string, lineConfig: any) {
  const cleanAdvId = encodeURIComponent(advId || "");
  const liffId = String(lineConfig?.liffId || "").trim();
  const productionBaseUrl = "https://let-s-me-clear-599121738708.asia-southeast1.run.app";
  const appBaseUrl = String(lineConfig?.appBaseUrl || window.location.origin || productionBaseUrl).replace(/\/$/, "");

  if (lineConfig?.uploadSlipUrlTemplate) {
    return lineConfig.uploadSlipUrlTemplate
      .replace(/{advId}/g, cleanAdvId)
      .replace(/{id}/g, cleanAdvId)
      .replace(/{docId}/g, cleanAdvId)
      .replace(/{documentId}/g, cleanAdvId);
  }

  if (liffId && !liffId.startsWith("http") && !/\s/.test(liffId) && liffId !== "123456-abcde" && liffId !== "{LIFF_ID}") {
    return `https://liff.line.me/${liffId}?route=upload-slip&adv_id=${cleanAdvId}`;
  }

  return `${appBaseUrl}/liff/upload-slip?route=upload-slip&adv_id=${cleanAdvId}`;
}

const safeLiffSendMessages = async (messages: any[]) => {
  try {
    if (typeof window === "undefined" || !(window as any).liff) return { ok: false, skipped: true, reason: "LIFF_NOT_AVAILABLE" };
    if (!liff.isInClient()) return { ok: false, skipped: true, reason: "NOT_IN_LINE_CLIENT" };
    await liff.sendMessages(messages);
    return { ok: true };
  } catch (error: any) {
    console.warn("LIFF_SEND_MESSAGES_FAILED_NON_BLOCKING", error);
    return { ok: false, skipped: false, reason: String(error?.message || error) };
  }
};

export default function LiffAction({ resolvedAction, liffProfile, currentEmployee, globalSettings }: LiffActionProps) {
  const queryParamHelper = useMemo(() => new URLSearchParams(window.location.search), []);

  const getQueryParam = (key: string): string => {
    let val = queryParamHelper.get(key);
    if (val) {
      sessionStorage.setItem(`liff_param_${key}`, val);
      return val;
    }

    const liffState = queryParamHelper.get("liff.state");
    if (liffState) {
      try {
        const decoded = decodeURIComponent(liffState);
        if (!decoded.includes("=") && !decoded.includes("/") && decoded.length > 3) {
          if (key === "adv_id" || key === "advId" || key === "id" || key === "docId" || key === "documentId") {
            sessionStorage.setItem(`liff_param_${key}`, decoded);
            return decoded;
          }
        }
        const qIndex = decoded.indexOf("?");
        const queryStr = qIndex !== -1 ? decoded.substring(qIndex) : decoded;
        const innerParams = new URLSearchParams(queryStr);
        val = innerParams.get(key);
        if (val) {
          sessionStorage.setItem(`liff_param_${key}`, val);
          return val;
        }
      } catch (e) {
        console.error("Error parsing liff.state query param in LiffAction:", e);
      }
    }

    // Fallback to sessionStorage ONLY if in LINE user agent or /liff path
    const isLineUserAgent = /Line/i.test(navigator.userAgent) || window.location.pathname.startsWith("/liff");
    if (isLineUserAgent) {
      const savedVal = sessionStorage.getItem(`liff_param_${key}`);
      return savedVal || "";
    }
    return "";
  };

  const resolveAdvanceFromFirestore = async (docId: string) => {
    if (!docId) return null;
    try {
      const directDoc = await getDoc(doc(db, "advances", docId));
      if (directDoc.exists()) {
        return { id: directDoc.id, ...directDoc.data() } as LiffAdvance;
      }
    } catch (e) {
      console.warn("Direct getDoc failed, trying queries:", e);
    }

    try {
      const q1 = query(collection(db, "advances"), where("advId", "==", docId));
      const snap1 = await getDocs(q1);
      if (!snap1.empty) {
        return { id: snap1.docs[0].id, ...snap1.docs[0].data() } as LiffAdvance;
      }
    } catch (e) {
      console.warn("Query by advId failed:", e);
    }

    try {
      const q2 = query(collection(db, "advances"), where("advanceNo", "==", docId));
      const snap2 = await getDocs(q2);
      if (!snap2.empty) {
        return { id: snap2.docs[0].id, ...snap2.docs[0].data() } as LiffAdvance;
      }
    } catch (e) {
      console.warn("Query by advanceNo failed:", e);
    }
    return null;
  };

  const currentAdvId = String(
    getQueryParam("adv_id") || 
    getQueryParam("advId") || 
    getQueryParam("id") || 
    getQueryParam("docId") || 
    getQueryParam("documentId") || 
    ""
  ).trim();
  const initialAction = resolvedAction || getQueryParam("action") || "";

  const [action, setAction] = useState<string>(initialAction);
  const [profile, setProfile] = useState<any>(null);
  const [advance, setAdvance] = useState<LiffAdvance | null>(null);
  const [clearingItems, setClearingItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [liffErrorNotice, setLiffErrorNotice] = useState<string | null>(null);
  const [lineConfig, setLineConfig] = useState<any>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isDev = useMemo(() => {
    return import.meta.env.DEV || window.location.hostname === "localhost" || window.location.hostname.includes("aistudio") || window.location.hostname.includes("run.app");
  }, []);

  const isClearance = useMemo(() => {
    return action === "clearance" || action === "clear" || action === "approve_clearance" || action === "reject_clearance" || ["WAITING_CLEARANCE", "PENDING_AUDIT", "PARTIALLY_CLEARED", "ACCOUNTING_REVIEW"].includes(advance?.status || "");
  }, [action, advance]);

  const isReject = useMemo(() => {
    if (advance) {
      if (!["SUBMITTED", "PENDING_APPROVAL", "DRAFT"].includes(advance.status)) {
        return advance.status === "REJECTED" || advance.status === "RETURNED";
      }
    }
    return action === "reject" || action === "reject_clearance";
  }, [advance, action]);

  const initStarted = useRef(false);

  useEffect(() => {
    if (initStarted.current) return;
    const init = async () => {
      initStarted.current = true;
      try {
        if (!currentAdvId) throw new Error("ไม่พบเลขที่ใบเบิกจากลิงก์ LINE (Missing adv_id)");

        // 1. Parallelize Advance data and Clearing items fetching immediately
        const advancePromise = (async () => {
          try {
            const response = await fetch(`/api/line/liff-advance/${encodeURIComponent(currentAdvId)}`);
            if (response.ok) {
              const payload = await response.json();
              return payload.advance;
            }
          } catch (e) {
            console.warn("API liff-advance fetch failed, trying Firestore fallback:", e);
          }
          return await resolveAdvanceFromFirestore(currentAdvId);
        })();

        const clearingPromise = (async () => {
          try {
            const q = query(collection(db, "clearingItems"), where("advId", "==", currentAdvId));
            const snap = await getDocs(q);
            const items: any[] = [];
            snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
            return items;
          } catch (e) {
            console.warn("Failed to fetch clearing items:", e);
            return [];
          }
        })();

        // 2. Handle Settings/Config
        let config = lineConfig || globalSettings?.lineMessagingConfig || globalSettings?.lineConfig;
        if (!config) {
          const settingsSnapshot = await getDoc(doc(db, "settings", "global"));
          const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
          config = settings?.lineMessagingConfig || settings?.lineConfig || {};
        }
        setLineConfig(config);

        // 3. Handle LIFF Initialization and Profile
        if (liffProfile) {
          setProfile(liffProfile);
        }

        const configuredLiffId = String(
          config.liffId ||
          import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID || ""
        ).trim();

        const liffIdPattern = /^[0-9]+-[A-Za-z0-9_-]+$/;
        const isValidLiffId = liffIdPattern.test(configuredLiffId);

        if (configuredLiffId) {
          if (!isValidLiffId || configuredLiffId === "123456-abcde" || configuredLiffId === "{LIFF_ID}") {
            setLiffErrorNotice(
              !isValidLiffId 
                ? `รูปแบบ LIFF ID ไม่ถูกต้อง เข้าสู่โหมดจำลอง`
                : "ระบบกำลังใช้ LIFF ID ตัวอย่าง เข้าสู่โหมดจำลอง"
            );
          } else {
            try {
              if (!liff.id) {
                await liff.init({ liffId: configuredLiffId });
              }
              
              if (!liffProfile && liff.isLoggedIn()) {
                const userProfile = await liff.getProfile();
                setProfile(userProfile);
              } else if (!liffProfile && !liff.isLoggedIn()) {
                const isInIframe = window.self !== window.top;
                if (!isInIframe) {
                  liff.login();
                  return;
                } else {
                  setLiffErrorNotice("Preview Mode: จำลองการทำงาน");
                }
              }
            } catch (liffInitErr: any) {
              console.error("LIFF SDK init failed in LiffAction:", liffInitErr);
              setLiffErrorNotice(`ไม่สามารถเชื่อมต่อ LIFF SDK จริงได้ (${liffInitErr?.message || liffInitErr}) เข้าสู่โหมดจำลอง`);
            }
          }
        }

        // 4. Finalize Advance data
        const adv = await advancePromise;
        if (!adv) {
          throw new Error("ไม่พบข้อมูลใบเบิกในระบบ หรือรูปแบบของรหัสใบเบิกไม่ถูกต้อง");
        }
        setAdvance(adv);

        // 5. Finalize Clearing items if needed
        if (["WAITING_CLEARANCE", "PENDING_AUDIT", "PARTIALLY_CLEARED", "ACCOUNTING_REVIEW", "CLOSED", "RETURNED"].includes(adv.status)) {
          const items = await clearingPromise;
          setClearingItems(items);
        }

        if (adv && !["SUBMITTED", "PENDING_APPROVAL", "DRAFT"].includes(adv.status)) {
          if (!["WAITING_CLEARANCE", "PENDING_AUDIT", "PARTIALLY_CLEARED"].includes(adv.status)) {
            setDone(true);
          }
        }
      } catch (err: any) {
        console.error("LIFF action initialization failed:", err);
        setError("เปิดรายการไม่สำเร็จ");
        let errMsg = err?.message || String(err);
        if (errMsg.includes("expected pattern")) {
           errMsg = "Invalid LIFF API / Invalid LINE User ID / Invalid URL";
        }
        setErrorDetails(errMsg);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [currentAdvId, liffProfile, globalSettings]);

  const handleConfirm = async () => {
    if (!advance) return;
    setSaving(true);
    setError(null);
    try {
      const apiAction = isClearance 
        ? (isReject ? "reject_clearance" : "approve_clearance")
        : action;

      const response = await fetch("/api/line/liff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advId: currentAdvId,
          action: apiAction,
          userId: profile?.userId || "",
          displayName: profile?.displayName || "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload?.error === "LINE_ACCOUNT_NOT_LINKED" || payload?.message) {
          throw new Error(payload.message || "กรุณาเข้าสู่ระบบด้วย PIN หนึ่งครั้งเพื่อเชื่อมบัญชี LINE");
        }
        throw new Error(payload?.error || "บันทึกผลผ่าน LINE ไม่สำเร็จ");
      }
      
      // Step 6: LIFF sendMessages()
      // Non-blocking call to prevent UI disruption if LINE API fails
      safeLiffSendMessages([{
        type: "text",
        text: isReject ? `ไม่อนุมัติรายการ ${currentAdvId}` : `อนุมัติรายการ ${currentAdvId} สำเร็จ`
      }]);

      // Step 7: Router Refresh & Toast
      setToastMessage(isReject ? "ไม่อนุมัติสำเร็จ" : "อนุมัติสำเร็จ");
      setTimeout(() => setToastMessage(null), 3000);
      if (payload.advance) {
        setAdvance(payload.advance);
      }
      setDone(true);

      // Step 8: liff.closeWindow()
      try {
        if (liff.isInClient()) {
          setTimeout(() => liff.closeWindow(), 500); // slight delay to ensure UI updates
        }
      } catch (e: any) {
        console.warn("liff.closeWindow Error:", e);
      }

      console.log("Approval Success Flow Complete");

    } catch (err: any) {
      console.error("LIFF action save failed:", err);
      let errMsg = err?.message || "บันทึกผลผ่าน LINE ไม่สำเร็จ";
      if (errMsg.includes("expected pattern")) {
         errMsg = "Invalid LIFF API / Invalid LINE User ID";
      }
      setError(errMsg);
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
    const targetId = advance?.advId || currentAdvId;
    const url = buildUploadSlipUrl(targetId, lineConfig);
    console.log("Opening upload slip URL:", url);

    try {
      if (liff.isInClient()) {
        liff.openWindow({
          url,
          external: false
        });
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      console.error("liff.openWindow failed, fallback to location.assign:", err);
      window.location.assign(url);
    }
  };

  const closePage = () => {
    try {
      if (liff.isInClient()) liff.closeWindow();
      else window.history.back();
    } catch (e: any) {
      console.warn("closePage failed:", e);
    }
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
          <h1 className="mt-4 text-lg font-bold text-stone-900">{error || "เปิดรายการไม่สำเร็จ"}</h1>
          <p className="mt-2 text-sm text-stone-500">{errorDetails || "ไม่พบข้อมูลใบเบิก"}</p>
          {errorDetails?.includes("Invalid LIFF API") && (
            <div className="mt-4 p-3 bg-red-50 rounded-xl text-xs text-red-700 text-left">
              <p className="font-bold mb-1">สาเหตุที่เป็นไปได้:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>การตั้งค่า LIFF ID ในระบบไม่ถูกต้อง (Invalid LIFF API)</li>
                <li>เบราว์เซอร์ไม่รองรับ API บางอย่าง (Invalid Reply Token)</li>
                <li>ลิงก์จาก LINE มีรูปแบบผิดเพี้ยน (Invalid URL)</li>
              </ul>
              <p className="mt-2 font-bold">วิธีแก้ไข:</p>
              <p>กรุณาตรวจสอบ LIFF ID ในหน้า Admin Settings และบันทึกข้อมูลอีกครั้ง</p>
            </div>
          )}
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
            <h1 className="text-lg font-bold">
              {!action ? "รายละเอียดเอกสาร" : (isClearance ? "อนุมัติเคลียร์ยอด" : isReject ? "ไม่อนุมัติรายการ" : "อนุมัติรายการ")}
            </h1>
          </div>
          <button onClick={closePage} className="p-2 rounded-full hover:bg-stone-100 text-stone-500">
            <XCircle size={22} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {liffErrorNotice && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1 shadow-sm">
            <p className="font-bold flex items-center gap-1.5 text-amber-900">
              ⚠️ โหมดจำลองสถานะ LINE LIFF (Simulation Mode)
            </p>
            <p className="leading-relaxed opacity-90">{liffErrorNotice}</p>
          </div>
        )}

        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center ${!action ? "bg-blue-50 text-blue-600" : (isReject ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}`}>
              {!action ? <FileText size={24} /> : (isReject ? <XCircle size={24} /> : <ShieldCheck size={24} />)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-stone-500">เลขที่ใบเบิก</p>
              <h2 className="font-mono text-xl font-bold text-stone-900 truncate">{advance.advId}</h2>
              <p className="text-sm text-stone-500 mt-1">ผู้ขอเบิก: {advance.employeeName}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">ยอดเงินเบิก</p>
              <p className="font-bold text-stone-900">{money(advance.requestAmount)}</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">สถานะปัจจุบัน</p>
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

        {isClearance && clearingItems.length > 0 && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="font-bold text-sm text-stone-800 border-b border-stone-100 pb-2">
              รายการใบเสร็จส่งเคลียร์ ({clearingItems.length} รายการ)
            </h3>
            <div className="space-y-3 divide-y divide-stone-100 max-h-60 overflow-y-auto">
              {clearingItems.map((item) => (
                <div key={item.id} className="pt-2 text-xs flex justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900 truncate">{item.vendorName || "ใบเสร็จไม่มีชื่อร้าน"}</p>
                    <p className="text-stone-500 font-mono mt-0.5">{item.invoiceNo || "-"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-stone-900">{money(item.netAmount || item.amount || 0)}</p>
                    <p className="text-stone-500 mt-0.5">{item.expenseCategory || "-"}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-stone-100 flex justify-between items-center text-sm">
              <span className="font-semibold text-stone-600">รวมยอดใช้จริง</span>
              <span className="font-black text-stone-900 text-base">
                {money(clearingItems.reduce((acc, i) => acc + (i.netAmount || i.amount || 0), 0))}
              </span>
            </div>
          </section>
        )}

        {!done ? (
          !action ? (
            <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-sm text-stone-800 border-b border-stone-100 pb-2">
                เลือกการดำเนินการสำหรับเอกสารนี้
              </h3>
              <p className="text-xs text-stone-500 leading-relaxed">
                กรุณาเลือกดำเนินการสำหรับเอกสารใบเบิกเลขที่ <b>{advance.advId}</b> ของคุณ
              </p>
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAction(isClearance ? "approve_clearance" : "approve")}
                  className="w-full bg-stone-950 text-white font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 hover:bg-stone-900 transition shadow-sm"
                >
                  <ShieldCheck size={16} />
                  {isClearance ? "อนุมัติเคลียร์ยอด" : "อนุมัติรายการเบิก"}
                </button>
                <button
                  type="button"
                  onClick={() => setAction(isClearance ? "reject_clearance" : "reject")}
                  className="w-full bg-red-50 text-red-700 font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 hover:bg-red-100 transition"
                >
                  <XCircle size={16} />
                  {isClearance ? "ปฏิเสธ / ตีกลับแก้ไข" : "ไม่อนุมัติรายการ"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    alert("กำลังแสดงรายละเอียดเอกสารทั้งหมดบนหน้าจอนี้เรียบร้อยแล้ว คุณสามารถตรวจทานข้อมูลโครงการ ยอดเงินเบิก และรายการเคลียร์ยอดได้ทันที");
                  }}
                  className="w-full bg-stone-150 text-stone-700 font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 hover:bg-stone-200 transition border border-stone-200"
                >
                  <Eye size={16} />
                  ดูรายละเอียดเอกสาร
                </button>
              </div>
            </section>
          ) : (
            <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-4">
              <p className="text-sm text-stone-600">
                {isClearance ? (
                  isReject
                    ? "ยืนยันปฏิเสธและตีกลับรายการเคลียร์ยอดนี้เพื่อให้พนักงานแก้ไขในระบบ"
                    : "ยืนยันอนุมัติการเคลียร์ยอดของรายการนี้ ระบบจะบันทึกสถานะปิดยอด (CLOSED) ทันที"
                ) : (
                  isReject
                    ? "ยืนยันไม่อนุมัติรายการนี้ ระบบจะอัปเดตสถานะกลับเข้า Firestore ทันที"
                    : "ยืนยันอนุมัติรายการนี้ ระบบจะแสดงเลขบัญชีสำหรับโอนและปุ่มแนบสลิปต่อใน LINE"
                )}
              </p>

              {isClearance && (
                <div className="flex gap-2 p-1 bg-stone-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setAction("clearance")}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${!isReject ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-950"}`}
                  >
                    อนุมัติเคลียร์ยอด
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction("reject_clearance")}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${isReject ? "bg-white text-red-600 shadow-sm" : "text-stone-500 hover:text-stone-950"}`}
                  >
                    ปฏิเสธ/ตีกลับแก้ไข
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <button
                  onClick={() => setShowConfirmModal(true)}
                  disabled={saving}
                  className={`w-full rounded-2xl py-4 font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 ${isReject ? "bg-red-600" : "bg-stone-950"}`}
                >
                  {saving ? <Loader2 className="animate-spin" size={20} /> : isReject ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                  {saving ? "กำลังบันทึก..." : isClearance ? (isReject ? "ยืนยันตีกลับแก้ไข" : "ยืนยันอนุมัติเคลียร์ยอด") : (isReject ? "ยืนยันไม่อนุมัติ" : "ยืนยันอนุมัติ")}
                </button>
                
                <button
                  type="button"
                  onClick={() => setAction("")}
                  className="w-full text-xs text-stone-500 hover:text-stone-800 underline font-semibold py-1 block text-center"
                >
                  ย้อนกลับไปยังเมนูเลือกการดำเนินการ
                </button>
              </div>
            </section>
          )
        ) : (
          <section className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 size={24} />
              <p className="font-bold">
                {isClearance
                  ? (isReject ? "บันทึกผลตีกลับแก้ไขสำเร็จแล้ว" : "อนุมัติการเคลียร์ยอดสำเร็จแล้ว")
                  : (isReject ? "บันทึกผลไม่อนุมัติแล้ว" : "อนุมัติแล้ว")
                }
              </p>
            </div>

            {!isReject && !isClearance && (
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

      {isDev && (
        <div className="max-w-md mx-auto mt-8 p-4 bg-stone-950 text-stone-300 rounded-2xl font-mono text-[10px] space-y-2 border border-stone-800 shadow-inner">
          <p className="font-extrabold text-stone-400 border-b border-stone-800 pb-1 text-xs flex items-center gap-1.5">
            🛠️ DEV DEBUG BOX (LINE LIFF Document Resolver)
          </p>
          <div>
            <span className="text-amber-400 font-bold">detected advId:</span> <span className="text-white select-all">{currentAdvId || "null"}</span>
          </div>
          <div>
            <span className="text-amber-400 font-bold">route / action:</span> <span className="text-white">{action || "null"}</span>
          </div>
          <div>
            <span className="text-amber-400 font-bold">current URL:</span> <span className="break-all text-stone-400 select-all">{window.location.href}</span>
          </div>
          <div>
            <span className="text-amber-400 font-bold">liff.state:</span> <span className="break-all text-stone-400 select-all">{queryParamHelper.get("liff.state") || "null"}</span>
          </div>
          <div>
            <p className="text-amber-400 font-bold mt-1">query params:</p>
            <ul className="list-disc list-inside pl-2 space-y-0.5 text-stone-400">
              {Array.from(queryParamHelper.entries()).map(([k, v]) => (
                <li key={k} className="break-all">
                  <span className="text-stone-300 font-semibold">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-4" id="liff_confirm_modal">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-stone-100 space-y-4 animate-fade-in">
            <div className="text-center space-y-2">
              <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${isReject ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                {isReject ? <XCircle size={24} /> : <CheckCircle2 size={24} />}
              </div>
              <h4 className="font-extrabold text-stone-900 text-base font-sans">
                {isReject 
                  ? (isClearance ? "ยืนยันการตีกลับแก้ไข" : "ยืนยันการปฏิเสธรายการ") 
                  : (isClearance ? "ยืนยันการอนุมัติเคลียร์ยอด" : "ยืนยันการอนุมัติรายการ")
                }
              </h4>
              <p className="text-xs text-stone-500 leading-relaxed font-sans">
                คุณแน่ใจหรือไม่ว่าต้องการ<b>{isReject ? (isClearance ? "ตีกลับเพื่อแก้ไข" : "ปฏิเสธ") : (isClearance ? "อนุมัติเคลียร์ยอด" : "อนุมัติ")}</b>รายการใบเบิกเลขที่ <b>{advance?.advId || currentAdvId}</b>{advance?.employeeName ? <> ของ <b>{advance.employeeName}</b></> : null}{advance?.requestAmount ? <> ยอดเงิน <b>{money(advance.requestAmount)}</b></> : null}? โปรดตรวจสอบความถูกต้องเพื่อป้องกันการกดผิดพลาด
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 bg-stone-150 hover:bg-stone-200 text-stone-700 font-bold py-3 px-4 rounded-xl text-xs transition border border-stone-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setShowConfirmModal(false);
                  handleConfirm();
                }}
                className={`flex-1 font-bold py-3 px-4 rounded-xl text-xs text-white transition ${isReject ? "bg-red-600 hover:bg-red-700 shadow-md shadow-red-100" : "bg-stone-950 hover:bg-stone-900 shadow-md shadow-stone-200"}`}
              >
                {saving ? "กำลังบันทึก..." : "ยืนยันทำรายการ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-fade-in font-bold text-sm">
          <CheckCircle2 size={18} className="text-green-400" />
          {toastMessage}
        </div>
      )}
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
