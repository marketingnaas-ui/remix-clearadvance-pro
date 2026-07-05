import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Square, XCircle } from "lucide-react";
import { db } from "../lib/firebase";
import { Advance, Employee, RolePermissionsConfig, ApprovalWorkflowConfig } from "../types";
import { canApproveAdvance, canRejectAdvance, getEmployeeEffectiveRole, mergeRolePermissions, normalizeApprovalWorkflow } from "../lib/permissionEngine";

const money = (value: number) => `฿${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const amountOf = (advance: any) => Number(advance.requestAmount || advance.amount || advance.totalAmount || advance.advanceAmount || 0);

export default function LiffDailyReport() {
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const reportDate = queryParams.get("date") || new Date().toISOString().slice(0, 10);
  const lineUserIdFromQuery = queryParams.get("lineUserId") || "";
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [settings, setSettings] = useState<{ rolePermissions: RolePermissionsConfig; approvalWorkflow: ApprovalWorkflowConfig } | null>(null);
  const [report, setReport] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [batchResult, setBatchResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const allAdvances = useMemo(() => (report?.projectGroups || []).flatMap((group: any) => group.advances || []), [report]);

  const permissionsByAdvId = useMemo(() => {
    const map = new Map<string, any>();
    if (!employee || !settings) return map;
    for (const advance of allAdvances) {
      const approveResult = canApproveAdvance(employee, { ...advance, status: advance.status || "PENDING_APPROVAL" } as Advance, settings, "LINE_LIFF");
      const batchAllowed = Boolean(approveResult.allowed && approveResult.matchedRole?.permissions.batchApproveAdvance && approveResult.matchedRule?.allowBatchApproval);
      map.set(advance.advId, {
        allowed: batchAllowed,
        reason: batchAllowed ? "allowed" : (approveResult.allowed ? "batch approval is disabled for this role/rule" : approveResult.reason),
        matchedRule: approveResult.matchedRule,
      });
    }
    return map;
  }, [employee, settings, allAdvances]);

  const selectedAdvances = allAdvances.filter((advance: any) => selectedIds.has(advance.advId));
  const selectedAllowed = selectedAdvances.filter((advance: any) => permissionsByAdvId.get(advance.advId)?.allowed);
  const selectedDenied = selectedAdvances.filter((advance: any) => !permissionsByAdvId.get(advance.advId)?.allowed);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const settingsSnap = await getDoc(doc(db, "settings", "global"));
      const rawSettings = settingsSnap.exists() ? settingsSnap.data() : {};
      const rolePermissions = mergeRolePermissions(rawSettings.rolePermissions as RolePermissionsConfig | undefined);
      const approvalWorkflow = normalizeApprovalWorkflow(rawSettings.approvalWorkflow as ApprovalWorkflowConfig | undefined);
      setSettings({ rolePermissions, approvalWorkflow });
      const liffId = rawSettings?.lineMessagingConfig?.liffId || rawSettings?.lineConfig?.liffId || import.meta.env.VITE_LIFF_UPLOAD_SLIP_ID;
      let resolvedProfile: any = null;
      if (liffId) {
        await liff.init({ liffId });
        if (liff.isLoggedIn()) resolvedProfile = await liff.getProfile();
      }
      setProfile(resolvedProfile);
      const resolvedLineUserId = resolvedProfile?.userId || lineUserIdFromQuery;
      if (!resolvedLineUserId) throw new Error("บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้งานในระบบ");
      const empSnap = await getDocs(query(collection(db, "employees"), where("lineUserId", "==", resolvedLineUserId), limit(1)));
      if (empSnap.empty) throw new Error("บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้งานในระบบ");
      const currentEmployee = { id: empSnap.docs[0].id, ...empSnap.docs[0].data() } as Employee;
      const role = getEmployeeEffectiveRole(currentEmployee, { rolePermissions });
      if (!role?.permissions.viewExecutiveReport) throw new Error("บัญชีนี้ไม่มีสิทธิ์ดูรายงานผู้บริหาร");
      setEmployee(currentEmployee);

      let payload: any = null;
      try {
        const pendingRes = await fetch(`/api/google-workspace/report/pending-approval?date=${encodeURIComponent(reportDate)}`);
        if (pendingRes.ok) payload = await pendingRes.json();
        if (!payload?.report) {
          const dailyRes = await fetch(`/api/google-workspace/report/daily?date=${encodeURIComponent(reportDate)}`);
          if (dailyRes.ok) payload = await dailyRes.json();
        }
      } catch {
        payload = null;
      }
      if (!payload?.report) {
        const fallbackSnap = await getDocs(query(collection(db, "advances"), where("status", "==", "PENDING_APPROVAL")));
        const rows = fallbackSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
        payload = { report: groupReportRows(rows, reportDate) };
      }
      setReport(payload.report);
    } catch (err: any) {
      setError(err?.message || "โหลดรายงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [reportDate]);

  const toggle = (advId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(advId) ? next.delete(advId) : next.add(advId);
      return next;
    });
  };

  const selectAllAllowed = () => setSelectedIds(new Set(allAdvances.filter((advance: any) => permissionsByAdvId.get(advance.advId)?.allowed).map((advance: any) => advance.advId)));
  const selectProject = (projectName: string) => setSelectedIds(new Set(allAdvances.filter((advance: any) => advance.projectName === projectName && permissionsByAdvId.get(advance.advId)?.allowed).map((advance: any) => advance.advId)));

  const runBatch = async () => {
    if (!confirmAction || !profile?.userId && !lineUserIdFromQuery) return;
    const response = await fetch("/api/line/liff-batch-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: confirmAction,
        advIds: selectedAdvances.map((advance: any) => advance.advId),
        lineUserId: profile?.userId || lineUserIdFromQuery,
        reason,
        source: "LINE_LIFF_DAILY_REPORT",
      }),
    });
    const payload = await response.json();
    setBatchResult(payload);
    setConfirmAction(null);
    setSelectedIds(new Set());
    await loadReport();
  };

  if (loading) return <div className="min-h-screen bg-stone-50 grid place-items-center"><Loader2 className="w-8 h-8 animate-spin text-stone-500" /></div>;
  if (error) return <div className="min-h-screen bg-stone-50 p-5 grid place-items-center"><div className="bg-white border border-red-200 rounded-2xl p-5 text-red-700 font-bold">{error}</div></div>;

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-stone-950 text-white p-5">
        <p className="text-[10px] uppercase tracking-widest text-stone-400 font-black">Daily Executive Report</p>
        <h1 className="text-2xl font-black mt-1">{report?.date || reportDate}</h1>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Metric label="รออนุมัติ" value={String(report?.pendingCount || 0)} />
          <Metric label="ยอดรวม" value={money(report?.totalPendingAmount || 0)} />
        </div>
        <div className="mt-3 rounded-xl bg-amber-400/10 border border-amber-300/30 p-3 text-xs text-amber-100 font-bold">
          Batch approval เปิดแล้วหลังตรวจ permission/audit สำเร็จ ระบบจะแสดงรายการที่ไม่มีสิทธิ์ก่อนยืนยัน
        </div>
      </header>

      {batchResult && (
        <div className="m-4 rounded-2xl bg-white border border-stone-200 p-4 text-sm">
          <div className="font-black text-stone-950">ผลการทำรายการ</div>
          <p className="mt-1 text-stone-600">สำเร็จ {batchResult.summary?.approved || 0}, denied {batchResult.summary?.denied || 0}, failed {batchResult.summary?.failed || 0}</p>
          <pre className="mt-3 max-h-48 overflow-auto bg-stone-950 text-white rounded-xl p-3 text-[11px]">{JSON.stringify(batchResult.results || [], null, 2)}</pre>
        </div>
      )}

      <main className="p-4 space-y-4">
        {(report?.projectGroups || []).map((group: any) => (
          <section key={group.projectName} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <button onClick={() => selectProject(group.projectName)} className="w-full p-4 flex items-center justify-between text-left">
              <div>
                <h2 className="font-black text-stone-950">{group.projectName}</h2>
                <p className="text-xs text-stone-500">{group.pendingCount} รายการ / {money(group.projectTotalAmount)}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-stone-400" />
            </button>
            <div className="divide-y divide-stone-100">
              {(group.advances || []).map((advance: any) => {
                const permission = permissionsByAdvId.get(advance.advId);
                return (
                  <div key={advance.advId} className="p-4">
                    <div className="flex gap-3">
                      <button onClick={() => toggle(advance.advId)} className={`w-6 h-6 rounded-md border grid place-items-center ${selectedIds.has(advance.advId) ? "bg-stone-950 text-white border-stone-950" : "bg-white border-stone-300"}`}>
                        {selectedIds.has(advance.advId) ? <CheckCircle2 className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-0" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2">
                          <h3 className="font-black text-sm text-stone-950">{advance.advId}</h3>
                          <span className="font-black text-sm">{money(advance.amount)}</span>
                        </div>
                        <p className="text-xs text-stone-600 mt-1">{advance.employeeName} / {advance.category}</p>
                        <p className="text-[11px] text-stone-400 mt-1">submitted: {advance.submittedAt || "-"} · needed: {advance.neededDate || "-"}</p>
                        <p className={`text-[11px] font-bold mt-2 ${permission?.allowed ? "text-emerald-700" : "text-red-700"}`}>{permission?.allowed ? "allowed for batch" : permission?.reason}</p>
                        <button onClick={() => setDetail(advance)} className="mt-3 px-3 py-2 rounded-xl bg-stone-100 text-xs font-bold">ดูรายละเอียด</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 p-3 flex gap-2">
        <button onClick={selectAllAllowed} className="px-3 py-2 rounded-xl bg-stone-100 text-xs font-bold">Select all allowed</button>
        <button disabled={!selectedIds.size} onClick={() => setConfirmAction("approve")} className="flex-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">Approve selected</button>
        <button disabled={!selectedIds.size} onClick={() => setConfirmAction("reject")} className="flex-1 px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold disabled:opacity-50">Reject selected</button>
        <button onClick={loadReport} className="px-3 py-2 rounded-xl bg-stone-950 text-white"><RefreshCw className="w-4 h-4" /></button>
      </footer>

      {detail && <Modal title={detail.advId} onClose={() => setDetail(null)}>
        <Info label="requester" value={detail.employeeName} />
        <Info label="project" value={detail.projectName} />
        <Info label="category" value={detail.category} />
        <Info label="amount" value={money(detail.amount)} />
        <Info label="reason/details" value={detail.details || "-"} />
        <Info label="attachment" value={detail.attachmentName || detail.attachmentUrl || "-"} />
        <Info label="current status" value={detail.status} />
        <pre className="mt-3 text-[11px] bg-stone-100 rounded-xl p-3 overflow-auto">{JSON.stringify(detail.approvalHistory || [], null, 2)}</pre>
      </Modal>}

      {confirmAction && <Modal title={`Confirm ${confirmAction}`} onClose={() => setConfirmAction(null)}>
        <div className="space-y-2 text-sm">
          <Info label="จำนวนรายการ" value={String(selectedAdvances.length)} />
          <Info label="ยอดรวม" value={money(selectedAdvances.reduce((sum: number, advance: any) => sum + amountOf(advance), 0))} />
          <Info label="มีสิทธิ์" value={String(selectedAllowed.length)} />
          <Info label="ไม่มีสิทธิ์" value={String(selectedDenied.length)} />
          {selectedDenied.length > 0 && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">{selectedDenied.map((advance: any) => `${advance.advId}: ${permissionsByAdvId.get(advance.advId)?.reason}`).join("\n")}</div>}
          {confirmAction === "reject" && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลการปฏิเสธ" className="w-full rounded-xl border border-stone-200 p-3 text-sm" />}
          <button onClick={runBatch} className="w-full px-4 py-3 rounded-xl bg-stone-950 text-white font-bold">ยืนยันทำรายการ</button>
        </div>
      </Modal>}
    </div>
  );
}

function groupReportRows(rows: any[], date: string) {
  const groups = new Map<string, any>();
  rows.forEach((row) => {
    const projectName = row.projectName || row.project || row.projectId || "ไม่ระบุโครงการ";
    const current = groups.get(projectName) || { projectName, pendingCount: 0, projectTotalAmount: 0, advances: [] };
    const amount = amountOf(row);
    current.pendingCount += 1;
    current.projectTotalAmount += amount;
    current.advances.push({ ...row, advId: row.advId || row.advanceNo || row.documentNo || row.id, amount, projectName, submittedAt: row.createdAt || row.submittedAt || "", neededDate: row.neededDate || "", status: row.status || "" });
    groups.set(projectName, current);
  });
  const projectGroups = Array.from(groups.values());
  return { date, pendingCount: rows.length, totalPendingAmount: projectGroups.reduce((sum, group) => sum + group.projectTotalAmount, 0), projectGroups };
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white/10 p-3"><div className="text-[10px] text-stone-300 font-bold">{label}</div><div className="text-lg font-black">{value}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[110px_1fr] gap-2 text-xs"><span className="font-bold text-stone-400">{label}</span><span className="font-bold text-stone-800 break-words">{value}</span></div>;
}

function Modal({ title, children, onClose }: { title: string; children: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-stone-950">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl bg-stone-100"><XCircle className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
