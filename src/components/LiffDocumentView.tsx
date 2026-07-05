import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CheckSquare, FileText, Loader2, UploadCloud, XCircle } from "lucide-react";

const money = (value: number) =>
  `฿${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const resolveDocumentId = (query: URLSearchParams) =>
  query.get("adv_id") ||
  query.get("advId") ||
  query.get("id") ||
  query.get("docId") ||
  query.get("documentId") ||
  query.get("advanceId") ||
  query.get("advanceNo") ||
  query.get("documentNo") ||
  "";

export default function LiffDocumentView() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const documentId = resolveDocumentId(query);
  const [advance, setAdvance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (!documentId) throw new Error("ไม่พบเลขเอกสารจากลิงก์ LINE");
        const response = await fetch(`/api/line/liff-advance/${encodeURIComponent(documentId)}`);
        const payload = await response.json();
        if (!response.ok) throw payload;
        setAdvance(payload.advance);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [documentId]);

  const openRoute = (route: string, extra = "") => {
    window.location.href = `/liff/${route}?adv_id=${encodeURIComponent(documentId)}${extra}`;
  };

  if (loading) {
    return <div className="min-h-screen bg-stone-50 grid place-items-center"><Loader2 className="w-8 h-8 animate-spin text-stone-500" /></div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 p-5 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-red-700 font-black"><AlertCircle className="w-5 h-5" /> ไม่พบข้อมูลใบนี้</div>
          <p className="text-xs text-stone-600 mt-3">searchedDocumentId: {error.searchedDocumentId || documentId || "-"}</p>
          <p className="text-xs text-stone-600 mt-1">searchedFields: {(error.searchedFields || []).join(", ") || "-"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 p-4">
      <div className="max-w-lg mx-auto bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-stone-100">
          <p className="text-[10px] uppercase tracking-widest text-stone-400 font-black">LIFF Document</p>
          <h1 className="text-xl font-black text-stone-950 mt-1">{advance?.advId || advance?.id}</h1>
          <p className="text-xs text-stone-500 mt-1">{advance?.status || "-"}</p>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Info label="Requester" value={advance?.employeeName || "-"} />
          <Info label="Project" value={advance?.projectName || "-"} />
          <Info label="Category" value={advance?.category || "-"} />
          <Info label="Amount" value={money(advance?.requestAmount || 0)} />
          <Info label="Details" value={advance?.details || "-"} />
        </div>
        <div className="p-5 grid grid-cols-1 gap-2 bg-stone-50">
          <button onClick={() => openRoute("action", "&action=approve")} className="px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-between">
            <span className="flex items-center gap-2"><CheckSquare className="w-4 h-4" /> อนุมัติ</span><ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={() => openRoute("action", "&action=reject")} className="px-4 py-3 rounded-xl bg-red-600 text-white text-sm font-bold flex items-center justify-between">
            <span className="flex items-center gap-2"><XCircle className="w-4 h-4" /> ไม่อนุมัติ</span><ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={() => openRoute("upload-slip")} className="px-4 py-3 rounded-xl bg-stone-950 text-white text-sm font-bold flex items-center justify-between">
            <span className="flex items-center gap-2"><UploadCloud className="w-4 h-4" /> แนบสลิป</span><ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-stone-400 font-bold text-xs">{label}</span>
      <span className="text-stone-900 font-semibold flex items-start gap-2"><FileText className="w-3.5 h-3.5 mt-0.5 text-stone-300" />{value}</span>
    </div>
  );
}
