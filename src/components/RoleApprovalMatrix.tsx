import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { Check, Plus, Save, ShieldCheck, SlidersHorizontal, TestTube2, Trash2, X } from "lucide-react";
import { db } from "../lib/firebase";
import { Advance, ApprovalWorkflowConfig, ApprovalWorkflowRule, DashboardActionConfig, Employee, PermissionAction, RolePermission, RolePermissionsConfig } from "../types";
import {
  allPermissionKeys,
  canPerformAdvanceAction,
  defaultApprovalWorkflow,
  defaultRolePermissions,
  makeActions,
  mergeRolePermissions,
  normalizeApprovalWorkflow,
  positionDisplayNames,
  resolvePositionId,
} from "../lib/permissionEngine";

const permissionLabels: Record<PermissionAction, string> = {
  viewDashboard: "Dashboard",
  createAdvance: "Create Advance",
  approveAdvance: "Approve",
  rejectAdvance: "Reject",
  batchApproveAdvance: "Batch Approve",
  uploadTransferSlip: "Transfer Slip",
  submitClearance: "Submit Clearance",
  reviewClearance: "Review Clearance",
  closeAdvance: "Close Advance",
  viewExecutiveReport: "Executive Report",
  manageSettings: "Settings",
  manageUsers: "Users",
  manageProjects: "Projects",
  manageRoles: "Roles",
};

const emptyRole = (): RolePermission => ({
  ...defaultRolePermissions.roles[0],
  id: `position-${Date.now()}`,
  name: `position-${Date.now()}`,
  displayName: "New Position",
  description: "",
  level: 40,
  permissions: Object.fromEntries(allPermissionKeys.map((key) => [key, false])) as Record<PermissionAction, boolean>,
  dashboard: {
    heroType: "profile",
    menuVariant: "custom",
    kpiPreset: "custom",
    quickActions: makeActions([["action1", "Action 1", "dashboard"], ["action2", "Action 2", "dashboard"], ["action3", "Action 3", "dashboard"], ["action4", "Action 4", "dashboard"]]),
    bottomNav: makeActions([["home", "หน้าหลัก", "dashboard"], ["more", "เพิ่มเติม", "more"]]),
    kpis: ["myOpenItems", "myOutstandingAmount", "myMonthlyItems", "myDraftItems", "myMoneyToClear", "myClosedAmount"],
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function RoleApprovalMatrix() {
  const [activeTab, setActiveTab] = useState<"roles" | "rules" | "test">("roles");
  const [roleConfig, setRoleConfig] = useState<RolePermissionsConfig>(defaultRolePermissions);
  const [workflow, setWorkflow] = useState<ApprovalWorkflowConfig>(defaultApprovalWorkflow);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("employee");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testEmployeeId, setTestEmployeeId] = useState("");
  const [testAdvanceId, setTestAdvanceId] = useState("");
  const [testAction, setTestAction] = useState<PermissionAction>("approveAdvance");
  const [testSource, setTestSource] = useState<"WEB" | "LINE_LIFF">("WEB");

  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(doc(db, "settings", "global"));
      const data = snap.exists() ? snap.data() : {};
      const nextRoles = mergeRolePermissions(data.rolePermissions as RolePermissionsConfig | undefined);
      const nextWorkflow = normalizeApprovalWorkflow(data.approvalWorkflow as ApprovalWorkflowConfig | undefined);
      setRoleConfig(nextRoles);
      setWorkflow(nextWorkflow);
      setSelectedRoleId(nextRoles.roles[0]?.id || "employee");
      if (!data.rolePermissions || !data.approvalWorkflow?.rules?.length) {
        await setDoc(doc(db, "settings", "global"), { rolePermissions: nextRoles, approvalWorkflow: nextWorkflow }, { merge: true });
      }
    };
    load().catch((err) => setMessage(`Load failed: ${err?.message || err}`));
  }, []);

  useEffect(() => {
    const unsubEmployees = onSnapshot(collection(db, "employees"), (snap) => {
      const list = snap.docs.map((item) => ({ id: item.id, ...item.data() } as Employee));
      setEmployees(list);
      setTestEmployeeId((prev) => prev || list[0]?.id || "");
    });
    const unsubAdvances = onSnapshot(collection(db, "advances"), (snap) => {
      const list = snap.docs.map((item) => ({ id: item.id, ...item.data() } as Advance));
      setAdvances(list);
      setTestAdvanceId((prev) => prev || list[0]?.id || "");
    });
    return () => {
      unsubEmployees();
      unsubAdvances();
    };
  }, []);

  const selectedRole = roleConfig.roles.find((role) => role.id === selectedRoleId) || roleConfig.roles[0] || defaultRolePermissions.roles[0];
  const selectedPermissions = selectedRole.permissions || defaultRolePermissions.roles[0].permissions;
  const testResult = useMemo(() => {
    const employee = employees.find((item) => item.id === testEmployeeId);
    if (!employee) return null;
    return canPerformAdvanceAction({
      employee,
      advance: advances.find((item) => item.id === testAdvanceId) || null,
      action: testAction,
      source: testSource,
      rolePermissions: roleConfig,
      approvalWorkflow: workflow,
    });
  }, [employees, advances, testEmployeeId, testAdvanceId, testAction, testSource, roleConfig, workflow]);

  const updateRole = (id: string, patch: Partial<RolePermission>) => {
    setRoleConfig((prev) => ({
      roles: prev.roles.map((role) => role.id === id ? { ...role, ...patch, updatedAt: new Date().toISOString() } : role),
    }));
  };

  const updateAction = (kind: "quickActions" | "bottomNav", index: number, patch: Partial<DashboardActionConfig>) => {
    if (!selectedRole) return;
    const list = [...(selectedRole.dashboard[kind] || [])];
    list[index] = { ...list[index], ...patch };
    updateRole(selectedRole.id, { dashboard: { ...selectedRole.dashboard, [kind]: list } });
  };

  const updateRule = (id: string, patch: Partial<ApprovalWorkflowRule>) => {
    setWorkflow((prev) => ({
      ...prev,
    rules: prev.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const nextWorkflow = normalizeApprovalWorkflow(workflow);
      await setDoc(doc(db, "settings", "global"), { rolePermissions: roleConfig, approvalWorkflow: nextWorkflow }, { merge: true });
      setWorkflow(nextWorkflow);
      setMessage("Saved to settings/global");
    } catch (err: any) {
      setMessage(`Save failed: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-stone-200 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-stone-950 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Role & Approval Matrix</h3>
          <p className="text-[11px] text-stone-500 mt-1">Single source of truth: settings/global.rolePermissions and settings/global.approvalWorkflow</p>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-stone-950 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {message && <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 p-3 text-xs font-bold">{message}</div>}

      <div className="flex flex-wrap gap-2 bg-white border border-stone-200 rounded-2xl p-2">
        {[
          ["roles", "Roles / Positions", ShieldCheck],
          ["rules", "Approval Rules", SlidersHorizontal],
          ["test", "Permission Test", TestTube2],
        ].map(([id, label, Icon]) => (
          <button key={id as string} onClick={() => setActiveTab(id as any)} className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${activeTab === id ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
            {React.createElement(Icon as any, { className: "w-4 h-4" })} {label as string}
          </button>
        ))}
      </div>

      {activeTab === "roles" && selectedRole && (
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
          <aside className="bg-white border border-stone-200 rounded-2xl p-3 space-y-2 h-fit">
            {roleConfig.roles.map((role) => (
              <button key={role.id} onClick={() => setSelectedRoleId(role.id)} className={`w-full text-left rounded-xl px-3 py-2 text-xs font-bold ${selectedRoleId === role.id ? "bg-stone-950 text-white" : "hover:bg-stone-100 text-stone-700"}`}>
                <span className="block">{role.displayName}</span>
                <span className="text-[10px] opacity-70">{role.id}</span>
              </button>
            ))}
            <button onClick={() => setRoleConfig((prev) => ({ roles: [...prev.roles, emptyRole()] }))} className="w-full rounded-xl px-3 py-2 text-xs font-bold bg-stone-100 hover:bg-stone-200 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Position
            </button>
          </aside>

          <section className="space-y-4">
            <div className="bg-white border border-stone-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={selectedRole.id} onChange={(event) => updateRole(selectedRole.id, { id: event.target.value, name: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold" />
              <input value={selectedRole.displayName} onChange={(event) => updateRole(selectedRole.id, { displayName: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold" />
              <input type="number" value={selectedRole.level} onChange={(event) => updateRole(selectedRole.id, { level: Number(event.target.value) || 0 })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold" />
              <textarea value={selectedRole.description} onChange={(event) => updateRole(selectedRole.id, { description: event.target.value })} className="md:col-span-3 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <select value={selectedRole.approvalScope.projectScope} onChange={(event) => updateRole(selectedRole.id, { approvalScope: { ...selectedRole.approvalScope, projectScope: event.target.value as any } })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold">
                <option value="own">own</option>
                <option value="own_project">own_project</option>
                <option value="all_projects">all_projects</option>
                <option value="selected_projects">selected_projects</option>
              </select>
              <input type="number" placeholder="Max amount/item" value={selectedRole.approvalScope.maxAmountPerItem ?? ""} onChange={(event) => updateRole(selectedRole.id, { approvalScope: { ...selectedRole.approvalScope, maxAmountPerItem: event.target.value ? Number(event.target.value) : null } })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={selectedRole.isActive} onChange={(event) => updateRole(selectedRole.id, { isActive: event.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={selectedRole.approvalScope.allowLineLiffApproval} onChange={(event) => updateRole(selectedRole.id, { approvalScope: { ...selectedRole.approvalScope, allowLineLiffApproval: event.target.checked } })} /> LINE approval</label>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={selectedRole.approvalScope.canApproveOwnRequest} onChange={(event) => updateRole(selectedRole.id, { approvalScope: { ...selectedRole.approvalScope, canApproveOwnRequest: event.target.checked } })} /> Own request</label>
            </div>

            <div className="bg-white border border-stone-200 rounded-2xl p-4">
              <h4 className="text-xs font-black text-stone-900 mb-3">Permissions</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {allPermissionKeys.map((key) => (
                  <label key={key} className={`rounded-xl border px-3 py-2 text-[11px] font-bold flex items-center gap-2 ${selectedPermissions[key] ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-stone-50 border-stone-200 text-stone-500"}`}>
                    <input type="checkbox" checked={selectedPermissions[key]} onChange={(event) => updateRole(selectedRole.id, { permissions: { ...selectedPermissions, [key]: event.target.checked } })} />
                    {permissionLabels[key]}
                  </label>
                ))}
              </div>
            </div>

            <DashboardConfigEditor title="Quick Actions" items={selectedRole.dashboard.quickActions || []} onChange={(index, patch) => updateAction("quickActions", index, patch)} onAdd={() => updateRole(selectedRole.id, { dashboard: { ...selectedRole.dashboard, quickActions: [...(selectedRole.dashboard.quickActions || []), { id: `action-${Date.now()}`, label: "New Action", targetTab: "dashboard", isActive: true, sortOrder: (selectedRole.dashboard.quickActions || []).length + 1 }] } })} />
            <DashboardConfigEditor title="Bottom Navigation" items={selectedRole.dashboard.bottomNav || []} onChange={(index, patch) => updateAction("bottomNav", index, patch)} onAdd={() => updateRole(selectedRole.id, { dashboard: { ...selectedRole.dashboard, bottomNav: [...(selectedRole.dashboard.bottomNav || []), { id: `nav-${Date.now()}`, label: "New Nav", targetTab: "dashboard", isActive: true, sortOrder: (selectedRole.dashboard.bottomNav || []).length + 1 }] } })} />

            <div className="bg-white border border-stone-200 rounded-2xl p-4">
              <h4 className="text-xs font-black text-stone-900 mb-3">KPI Keys (6 recommended)</h4>
              <textarea value={(selectedRole.dashboard.kpis || []).join("\n")} onChange={(event) => updateRole(selectedRole.id, { dashboard: { ...selectedRole.dashboard, kpis: event.target.value.split("\n").filter(Boolean) } })} className="w-full min-h-28 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
            </div>

            <div className="bg-stone-950 text-white rounded-2xl p-4">
              <h4 className="text-xs font-black mb-3">Preview</h4>
              <p className="text-sm font-bold">{selectedRole.displayName}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                {(selectedRole.dashboard.quickActions || []).filter((item) => item.isActive).map((item) => <div key={item.id} className="rounded-xl bg-white/10 p-3 text-xs font-bold">{item.label}</div>)}
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "rules" && (
        <div className="space-y-3">
          <button onClick={() => setWorkflow((prev) => ({ ...prev, rules: [...prev.rules, { ...defaultApprovalWorkflow.rules[0], id: `rule-${Date.now()}`, name: "New approval rule" }] }))} className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Rule
          </button>
          {workflow.rules.map((rule) => (
            <div key={rule.id} className="bg-white border border-stone-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} className="md:col-span-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold" />
              <select value={rule.documentType} onChange={(event) => updateRule(rule.id, { documentType: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
                <option value="ADVANCE">ADVANCE</option>
                <option value="CLEARANCE">CLEARANCE</option>
              </select>
              <input type="number" value={rule.minAmount} onChange={(event) => updateRule(rule.id, { minAmount: Number(event.target.value) || 0 })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <input type="number" placeholder="Max" value={rule.maxAmount ?? ""} onChange={(event) => updateRule(rule.id, { maxAmount: event.target.value ? Number(event.target.value) : null })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <select value={rule.projectScope} onChange={(event) => updateRule(rule.id, { projectScope: event.target.value as any })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
                <option value="own_project">own_project</option>
                <option value="all_projects">all_projects</option>
                <option value="selected_projects">selected_projects</option>
              </select>
              <input placeholder="Selected project IDs" value={(rule.selectedProjectIds || []).join(", ")} onChange={(event) => updateRule(rule.id, { selectedProjectIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <select multiple value={rule.approverPositionIds} onChange={(event) => updateRule(rule.id, { approverPositionIds: Array.from(event.target.selectedOptions).map((item) => item.value) })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
                {roleConfig.roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}
              </select>
              <input type="number" min={1} value={rule.requiredApprovalCount} onChange={(event) => updateRule(rule.id, { requiredApprovalCount: Number(event.target.value) || 1 })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
              <select value={rule.approvalOrder} onChange={(event) => updateRule(rule.id, { approvalOrder: event.target.value as any })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
                <option value="any">any</option>
                <option value="sequential">sequential</option>
              </select>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={rule.isActive} onChange={(event) => updateRule(rule.id, { isActive: event.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={rule.allowLineLiffApproval} onChange={(event) => updateRule(rule.id, { allowLineLiffApproval: event.target.checked })} /> LINE</label>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={rule.allowBatchApproval} onChange={(event) => updateRule(rule.id, { allowBatchApproval: event.target.checked })} /> Batch</label>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={rule.canApproveOwnRequest} onChange={(event) => updateRule(rule.id, { canApproveOwnRequest: event.target.checked })} /> Own request</label>
              <button onClick={() => setWorkflow((prev) => ({ ...prev, rules: prev.rules.filter((item) => item.id !== rule.id) }))} className="text-red-600 text-xs font-bold flex items-center gap-1"><Trash2 className="w-4 h-4" /> Delete</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === "test" && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select value={testEmployeeId} onChange={(event) => setTestEmployeeId(event.target.value)} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name} ({positionDisplayNames[resolvePositionId(emp)] || resolvePositionId(emp)})</option>)}
            </select>
            <select value={testAdvanceId} onChange={(event) => setTestAdvanceId(event.target.value)} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="">No advance</option>
              {advances.map((adv) => <option key={adv.id} value={adv.id}>{adv.advId} - {adv.employeeName}</option>)}
            </select>
            <select value={testAction} onChange={(event) => setTestAction(event.target.value as PermissionAction)} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              {allPermissionKeys.map((key) => <option key={key} value={key}>{permissionLabels[key]}</option>)}
            </select>
            <select value={testSource} onChange={(event) => setTestSource(event.target.value as "WEB" | "LINE_LIFF")} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="WEB">WEB</option>
              <option value="LINE_LIFF">LINE_LIFF</option>
            </select>
          </div>
          {testResult && (
            <div className={`rounded-2xl border p-4 text-xs ${testResult.allowed ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
              <div className="font-black flex items-center gap-2">{testResult.allowed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />} {testResult.allowed ? "ALLOWED" : "DENIED"}</div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                <span>reason: {testResult.reason}</span>
                <span>matched role: {testResult.matchedRole?.displayName || "-"}</span>
                <span>matched rule: {testResult.matchedRule?.name || "-"}</span>
                <span>valid lineUserId: {String(testResult.validLineUserId)}</span>
                <span>LINE approval: {String(testResult.canApproveViaLine)}</span>
                <span>project scope: {String(testResult.projectPass)}</span>
                <span>amount: {String(testResult.amountPass)}</span>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function DashboardConfigEditor({ title, items, onChange, onAdd }: {
  title: string;
  items: DashboardActionConfig[];
  onChange: (index: number, patch: Partial<DashboardActionConfig>) => void;
  onAdd: () => void;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-black text-stone-900">{title}</h4>
        <button onClick={onAdd} className="text-xs font-bold flex items-center gap-1"><Plus className="w-4 h-4" /> Add</button>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item.id}-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_80px_80px] gap-2">
            <input value={item.id} onChange={(event) => onChange(index, { id: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
            <input value={item.label} onChange={(event) => onChange(index, { label: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
            <input value={item.targetTab} onChange={(event) => onChange(index, { targetTab: event.target.value })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
            <input type="number" value={item.sortOrder} onChange={(event) => onChange(index, { sortOrder: Number(event.target.value) || 0 })} className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={item.isActive} onChange={(event) => onChange(index, { isActive: event.target.checked })} /> Active</label>
          </div>
        ))}
      </div>
    </div>
  );
}
