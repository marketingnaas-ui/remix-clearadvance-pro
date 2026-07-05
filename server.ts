import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { performServerAIOCR } from "./src/server/gemini";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import multer from "multer";
import crypto from "crypto";
import {
  canApproveAdvance,
  canRejectAdvance,
  getEmployeeEffectiveRole,
  mergeRolePermissions,
  normalizeApprovalWorkflow,
  resolveEmployeeLineUserId,
  resolvePositionId,
} from "./src/lib/permissionEngine";

dotenv.config();

let bucket: any = null;
let firestoreDb: any = null;
let adminAppInstance: any = null;

let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.error("Failed to read firebase-applet-config.json in server.ts:", e);
}

// Initialize Firebase Admin gracefully
try {
  const hasAdminCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG);
  if (!hasAdminCredentials) {
    throw new Error("Firebase Admin credentials are not configured. Server-side admin APIs will be disabled.");
  }
  const apps = getApps();
  let adminApp: any;
  if (!apps.length) {
    adminApp = initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId || "gen-lang-client-0100804557",
      storageBucket: firebaseConfig.storageBucket || "gen-lang-client-0100804557.firebasestorage.app"
    });
  } else {
    adminApp = apps[0];
  }
  adminAppInstance = adminApp;
  bucket = getStorage(adminApp).bucket();
  
  const dbId = firebaseConfig.firestoreDatabaseId || "ai-studio-remixclearadvanc-17d5f5ae-d1c1-4457-bef4-365e55fd21aa";
  firestoreDb = getFirestore(adminApp, dbId);

  // Asynchronously verify connection and fallback to default database if named database does not exist
  (async () => {
    try {
      await firestoreDb.collection("test").doc("connection").get();
      console.log(`Firebase Admin successfully connected to database: ${dbId}`);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes("NOT_FOUND") || errMsg.includes("not found") || err?.code === 5) {
        console.warn(`Database ID "${dbId}" not found on server side. Falling back to default database "(default)".`);
        firestoreDb = getFirestore(adminApp);
      } else {
        console.warn("Firebase Admin connection check failed. Server-side admin APIs will be disabled:", errMsg);
        firestoreDb = null;
        bucket = null;
      }
    }
  })().catch((err) => {
    console.warn("Firebase Admin async initialization failed. Server-side admin APIs will be disabled:", err?.message || err);
    firestoreDb = null;
    bucket = null;
  });
} catch (e) {
  console.warn("Firebase Admin initialization skipped. Server will run without cloud storage uploads/admin Firestore APIs:", e);
  firestoreDb = null;
  bucket = null;
}

// Local directory for storing profile photos to bypass Cloud Storage permission issues
const PROFILES_DIR = path.join(process.cwd(), "profiles");
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}
const SLIPS_DIR = path.join(process.cwd(), "slips");
if (!fs.existsSync(SLIPS_DIR)) {
  fs.mkdirSync(SLIPS_DIR, { recursive: true });
}

const upload = multer({ storage: multer.memoryStorage() });

const formatThaiDate = (value?: any) => {
  if (!value) return new Date().toLocaleDateString("th-TH");
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("th-TH");
};

const formatMoney = (value?: any) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return String(value || "0");
  return `${amount.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
};

const shortMoney = (value?: any) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(amount) >= 1_000) return `${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return amount.toLocaleString("th-TH");
};

const getPublicBaseUrl = () => {
  const rawUrl = process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || process.env.VERCEL_URL || "http://localhost:3002";
  const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  return normalized.replace(/\/$/, "");
};

const absolutizeUrl = (url?: string) => {
  if (!url) return "";
  if (url.startsWith("data:")) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${getPublicBaseUrl()}${url}`;
  return url;
};

const buildDbProfileImageUrl = (employeeId?: string, updatedAt?: any) => {
  if (!employeeId) return "";
  const version = typeof updatedAt?.toMillis === "function"
    ? updatedAt.toMillis()
    : updatedAt?.seconds || updatedAt || "";
  const suffix = version ? `?v=${encodeURIComponent(String(version))}` : "";
  return `${getPublicBaseUrl()}/api/profile-image/${encodeURIComponent(employeeId)}${suffix}`;
};

const resolveProfileImageUrl = (employee?: any, preferredUrl?: string) => {
  const absolutePreferred = absolutizeUrl(preferredUrl);
  if (absolutePreferred) return absolutePreferred;
  const absolutePhotoUrl = absolutizeUrl(employee?.profilePhotoURL || employee?.photoURL || employee?.avatarUrl);
  if (absolutePhotoUrl) return absolutePhotoUrl;
  if (employee?.profileImage && (employee?.id || employee?.employeeId)) {
    return buildDbProfileImageUrl(employee.id || employee.employeeId, employee.profilePhotoUpdatedAt || employee.updatedAt);
  }
  return "";
};

const getDocByIdOrField = async (collectionName: string, idOrValue?: string, fieldName?: string) => {
  if (!firestoreDb || !idOrValue) return null;
  const byId = await firestoreDb.collection(collectionName).doc(idOrValue).get();
  if (byId.exists) return { id: byId.id, ...byId.data() };
  if (!fieldName) return null;
  const snap = await firestoreDb.collection(collectionName).where(fieldName, "==", idOrValue).limit(1).get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
};

const LIFF_ADVANCE_SEARCH_FIELDS = ["docId", "advId", "advanceNo", "documentNo", "id", "requestNo"];

const liffNotFoundPayload = (documentId?: string) => ({
  status: "ไม่พบ",
  error: "ไม่พบข้อมูลใบนี้",
  searchedDocumentId: documentId || "",
  searchedFields: LIFF_ADVANCE_SEARCH_FIELDS,
});

const findAdvanceForLiff = async (documentId?: string) => {
  const value = String(documentId || "").trim();
  if (!firestoreDb || !value) return null;

  const byDocId = await firestoreDb.collection("advances").doc(value).get();
  if (byDocId.exists) return { id: byDocId.id, ...byDocId.data(), _matchedField: "docId" };

  for (const field of LIFF_ADVANCE_SEARCH_FIELDS.filter((item) => item !== "docId")) {
    const snap = await firestoreDb.collection("advances").where(field, "==", value).limit(1).get();
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data(), _matchedField: field };
    }
  }

  return null;
};

const getGlobalSettings = async () => {
  const snap = await firestoreDb.collection("settings").doc("global").get();
  return snap.exists ? { id: snap.id, ...snap.data() } : {};
};

const findEmployeeByLineUserId = async (lineUserId?: string) => {
  if (!firestoreDb || !lineUserId) return null;
  const snap = await firestoreDb.collection("employees").where("lineUserId", "==", lineUserId).limit(1).get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
};

const isEmployeeEnabled = (employee: any) =>
  Boolean(employee) && employee.isActive !== false && !["Disabled", "Suspended", "DISABLED", "SUSPENDED"].includes(String(employee.status || ""));

const isPendingApprovalStatus = (status?: any) => String(status || "").toUpperCase() === "PENDING_APPROVAL";

const advanceAmount = (advance: any) => Number(advance?.requestAmount || advance?.amount || advance?.totalAmount || advance?.advanceAmount || 0);

const lineIdOf = (employee: any) => resolveEmployeeLineUserId(employee) || "";

const writeLineActionLog = async (payload: any) => {
  const id = payload.id || `line-action-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await firestoreDb.collection("lineActionLogs").doc(id).set({
    id,
    ...payload,
    createdAt: payload.createdAt || new Date().toISOString(),
  }, { merge: true });
  return id;
};

const writeLineNotificationLog = async (payload: any) => {
  const id = payload.id || `line-notification-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await firestoreDb.collection("lineNotificationLogs").doc(id).set({
    id,
    ...payload,
    createdAt: payload.createdAt || new Date().toISOString(),
  }, { merge: true });
  return id;
};

const mirrorCollections = [
  "employees",
  "projects",
  "project_costs",
  "advances",
  "clearingLogs",
  "clearingItems",
  "vaultFiles",
  "auditLogs",
  "lineActionLogs",
  "document_tracking",
  "settings",
  "aiUsageLogs",
];

const loadCollectionRows = async (collectionName: string) => {
  const snap = await firestoreDb.collection(collectionName).get();
  return snap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() }));
};

const writeMirrorSyncLog = async (payload: any) => {
  const id = payload.id || `mirror-sync-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await firestoreDb.collection("mirrorSyncLogs").doc(id).set({
    id,
    status: payload.status || "FAILED",
    createdAt: payload.createdAt || new Date().toISOString(),
    ...payload,
  }, { merge: true });
  return id;
};

const callAppsScript = async (action: string, payload: any = {}) => {
  const settings = await getGlobalSettings();
  const googleWorkspace = (settings as any).googleWorkspace || {};
  if (!googleWorkspace.appsScriptWebAppUrl) {
    throw new Error("settings/global.googleWorkspace.appsScriptWebAppUrl is not configured");
  }
  const response = await fetch(googleWorkspace.appsScriptWebAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: googleWorkspace.appsScriptApiKey || "",
      action,
      spreadsheetId: googleWorkspace.spreadsheetId || "",
      parentFolderId: googleWorkspace.parentFolderId || "",
      rootFolderId: googleWorkspace.rootFolderId || "",
      config: googleWorkspace,
      payload,
    }),
  });
  const text = await response.text();
  const parsed = (() => {
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  })();
  if (!response.ok) {
    const error: any = new Error(parsed?.error || text || `Apps Script ${action} failed`);
    error.status = response.status;
    error.responsePayload = parsed;
    throw error;
  }
  return parsed;
};

const runMirrorAction = async (action: string, payload: any, logMeta: any = {}) => {
  try {
    const responsePayload = await callAppsScript(action, payload);
    await writeMirrorSyncLog({ ...logMeta, action, status: "SUCCESS", requestPayload: payload, responsePayload });
    return { ok: true, responsePayload };
  } catch (err: any) {
    const responsePayload = err?.responsePayload || { error: err?.message || String(err) };
    await writeMirrorSyncLog({ ...logMeta, action, status: "FAILED", requestPayload: payload, responsePayload, errorMessage: err?.message || String(err) });
    return { ok: false, status: err?.status || 500, responsePayload };
  }
};

const buildPendingApprovalReport = async (date?: string) => {
  const snap = await firestoreDb.collection("advances").get();
  const advances: any[] = [];
  snap.forEach((docSnap: any) => {
    const data = { id: docSnap.id, ...docSnap.data() };
    if (isPendingApprovalStatus((data as any).status)) advances.push(data);
  });
  const groups = new Map<string, any>();
  for (const advance of advances) {
    const key = advance.projectName || advance.project || advance.projectId || "ไม่ระบุโครงการ";
    const current = groups.get(key) || { projectName: key, pendingCount: 0, projectTotalAmount: 0, advances: [] };
    const amount = advanceAmount(advance);
    current.pendingCount += 1;
    current.projectTotalAmount += amount;
    current.advances.push({
      id: advance.id,
      advId: advance.advId || advance.advanceNo || advance.documentNo || advance.id,
      employeeId: advance.employeeId || advance.requesterId || "",
      employeeName: advance.employeeName || advance.requesterName || "-",
      projectId: advance.projectId || "",
      projectName: key,
      category: advance.category || advance.expenseCategory || "-",
      amount,
      requestAmount: amount,
      submittedAt: advance.createdAt || advance.submittedAt || advance.requestedAt || "",
      neededDate: advance.neededDate || advance.dueDate || "",
      status: advance.status || "",
      details: advance.details || advance.remark || advance.reason || advance.description || "",
      attachmentUrl: advance.attachmentUrl || advance.fileUrl || "",
      attachmentName: advance.attachmentName || advance.fileName || "",
      approvalHistory: advance.approvalHistory || [],
    });
    groups.set(key, current);
  }
  const projectGroups = Array.from(groups.values()).sort((a, b) => b.projectTotalAmount - a.projectTotalAmount);
  const totalPendingAmount = projectGroups.reduce((sum, group) => sum + group.projectTotalAmount, 0);
  return {
    date: date || new Date().toISOString().slice(0, 10),
    pendingCount: advances.length,
    totalPendingAmount,
    projectGroups,
    topProjectsSummary: projectGroups.slice(0, 5).map((group) => `${group.projectName}: ${group.pendingCount} / ${formatMoney(group.projectTotalAmount)}`).join("\n"),
  };
};

const replaceVariables = (template: string, vars: Record<string, any>): string => {
  let result = template || "";
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{${key}}`, "g"), String(val ?? ""));
  }
  return result;
};

const replaceVariablesInObject = (obj: any, vars: Record<string, any>): any => {
  if (typeof obj === "string") return replaceVariables(obj, vars);
  if (Array.isArray(obj)) return obj.map((item) => replaceVariablesInObject(item, vars));
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, replaceVariablesInObject(value, vars)]));
  }
  return obj;
};

const normalizeLineLiffActions = (obj: any, vars: Record<string, any>): any => {
  if (Array.isArray(obj)) return obj.map((item) => normalizeLineLiffActions(item, vars));
  if (obj !== null && typeof obj === "object") {
    const action = obj.action;
    if (action?.type === "postback" && typeof action.data === "string") {
      const data = new URLSearchParams(action.data);
      const actionName = data.get("action");
      if (actionName === "approve" && vars.liffActionApproveUrl) {
        return { ...obj, action: { type: "uri", label: action.label || "อนุมัติ", uri: vars.liffActionApproveUrl } };
      }
      if (actionName === "reject" && vars.liffActionRejectUrl) {
        return { ...obj, action: { type: "uri", label: action.label || "ไม่อนุมัติ", uri: vars.liffActionRejectUrl } };
      }
    }
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, normalizeLineLiffActions(value, vars)]));
  }
  return obj;
};

const parseLineTemplate = (template: any) => {
  if (typeof template !== "string") return template;
  return JSON.parse(template);
};

const createLineMessagePayload = (trigger: any, variables: Record<string, any>) => {
  if (trigger.type === "flex") {
    const templateJson = parseLineTemplate(trigger.messageTemplate);
    const resolvedJson = normalizeLineLiffActions(replaceVariablesInObject(templateJson, variables), variables);
    const contents = resolvedJson?.type === "flex" && resolvedJson.contents
      ? resolvedJson.contents
      : resolvedJson?.contents || resolvedJson;
    const payload: any = {
      type: "flex",
      altText: replaceVariables(trigger.altText || "ClearAdvance แจ้งเตือน {advId}", variables),
      contents,
    };
    if (resolvedJson?.quickReply) payload.quickReply = resolvedJson.quickReply;
    return payload;
  }
  return {
    type: "text",
    text: replaceVariables(trigger.messageTemplate || "", variables),
  };
};

const getLineSettings = async () => {
  const settingsSnap = await firestoreDb.collection("settings").doc("global").get();
  if (!settingsSnap.exists) return null;
  return settingsSnap.data()?.lineMessagingConfig || null;
};

const getLineGroupId = (lineConfig: any): string => {
  return String(lineConfig?.groupId || lineConfig?.lineGroupId || "").trim();
};

const replyLineMessage = async (lineConfig: any, replyToken: string, messages: any[]) => {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}`
    },
    body: JSON.stringify({ replyToken, messages })
  });
};

const getLineProfile = async (lineConfig: any, source: any): Promise<any> => {
  const userId = source?.userId;
  if (!userId) return {};
  const endpoints = source?.groupId
    ? [`https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}`]
    : [];
  endpoints.push(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`);

  for (const endpoint of endpoints) {
    try {
      const profileRes = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}` }
      });
      if (profileRes.ok) return profileRes.json();
    } catch (err: any) {
      console.warn("Cannot fetch LINE profile:", err?.message || err);
    }
  }
  return {};
};

const createLineBindMessage = (employee: any, token: string) => {
  const displayName = employee.name || employee.fullName || employee.username || employee.employeeCode || "พนักงาน";
  const employeeCode = employee.employeeCode || employee.username || employee.id || "";
  return {
    type: "flex",
    altText: `เชื่อมบัญชี LINE สำหรับ ${displayName}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "เชื่อมบัญชี LINE", weight: "bold", size: "lg", color: "#111827" },
          { type: "text", text: displayName, weight: "bold", size: "md", color: "#374151", wrap: true },
          { type: "text", text: employeeCode ? `รหัส/ผู้ใช้: ${employeeCode}` : "กดปุ่มด้านล่างเพื่อผูก LINE กับบัญชีนี้", size: "sm", color: "#6B7280", wrap: true },
          { type: "text", text: "ให้เจ้าของบัญชีนี้เท่านั้นเป็นคนกด ระบบจะบันทึก LINE User ID อัตโนมัติ", size: "xs", color: "#9CA3AF", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#111111",
            action: {
              type: "postback",
              label: "ผูก LINE ของฉัน",
              data: `bindLine=1&employeeId=${encodeURIComponent(employee.id)}&token=${encodeURIComponent(token)}`,
              displayText: `ผูก LINE: ${displayName}`
            }
          }
        ]
      }
    }
  };
};

const buildLiffUrl = (lineConfig: any, advId?: string) => {
  const params = new URLSearchParams();
  params.set("route", "upload-slip");
  if (advId) params.set("adv_id", advId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  if (lineConfig?.liffId) return `https://liff.line.me/${lineConfig.liffId}${suffix}`;
  const baseUrl = process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || "http://localhost:3002";
  return `${baseUrl.replace(/\/$/, "")}/liff/upload-slip${suffix}`;
};

const buildLiffActionUrl = (lineConfig: any, advId?: string, action?: string) => {
  const params = new URLSearchParams();
  params.set("route", "action");
  if (action) params.set("action", action);
  if (advId) params.set("adv_id", advId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  if (lineConfig?.liffId) return `https://liff.line.me/${lineConfig.liffId}${suffix}`;
  return `${getPublicBaseUrl()}/liff/action${suffix}`;
};

const getEmployeeBankInfo = (advance: any, employee: any) => {
  const custom = advance?.customTransferAccount || {};
  return {
    bankName: custom.bankName || advance?.bankName || employee?.bankName || "",
    accountName: custom.accountName || advance?.bankAccountName || employee?.bankAccountName || employee?.name || advance?.employeeName || "",
    accountNumber: custom.accountNo || custom.accountNumber || advance?.bankNo || employee?.bankNo || employee?.bankAccountNo || employee?.bankAccountNumber || "",
  };
};

const getAdvanceForLine = async (advId: string) => {
  const advance: any = await findAdvanceForLiff(advId);
  if (!advance) return null;
  const employeeId = advance.employeeId || advance.requesterId || advance.userId;
  const employee: any = await getDocByIdOrField("employees", employeeId, "employeeId");
  const bankInfo = getEmployeeBankInfo(advance, employee);
  return {
    id: advance.id,
    advId: advance.advId || advance.advanceNo || advance.id,
    advanceNo: advance.advanceNo || "",
    documentNo: advance.documentNo || "",
    requestNo: advance.requestNo || "",
    matchedField: advance._matchedField || "",
    employeeId,
    employeeName: advance.employeeName || advance.requesterName || employee?.name || employee?.fullName || "-",
    projectId: advance.projectId || "",
    projectName: advance.projectName || advance.project || "",
    category: advance.category || advance.expenseCategory || advance.expenseType || "",
    details: advance.details || advance.remark || advance.reason || advance.description || "",
    requestAmount: Number(advance.requestAmount || advance.amount || advance.totalAmount || advance.advanceAmount || 0),
    status: advance.status || "",
    bankName: bankInfo.bankName,
    bankAccountName: bankInfo.accountName,
    bankAccountNumber: bankInfo.accountNumber,
    transferSlipUrl: advance.transferSlipUrl || advance.slipUrl || "",
  };
};

const enrichLineVariables = async (inputVariables: Record<string, any>, lineConfig: any) => {
  const variables: Record<string, any> = { ...(inputVariables || {}) };
  const advId = variables.advId || variables.advanceId || variables.id || variables.docId || variables.documentId || variables.advanceNo || variables.documentNo;
  const advance: any = await findAdvanceForLiff(advId);
  if (advance) {
    variables.advId = variables.advId || advance.advId || advance.advanceNo || advance.id;
    variables.employeeId = variables.employeeId || advance.employeeId || advance.requesterId || advance.userId;
    variables.projectId = variables.projectId || advance.projectId;
    variables.projectName = variables.projectName || advance.projectName || advance.project;
    variables.category = variables.category || advance.category || advance.expenseCategory || advance.expenseType;
    variables.status = variables.status || advance.status;
    variables.remark = variables.remark || advance.remark || advance.reason || advance.description;
    variables.amount = variables.amount || advance.amount || advance.totalAmount || advance.advanceAmount;
    variables.date = variables.date || formatThaiDate(advance.createdAt || advance.requestDate || advance.date);
    variables.neededDate = variables.neededDate || formatThaiDate(advance.neededDate || advance.dueDate || advance.clearanceDueDate);
    variables.profileImageUrl = resolveProfileImageUrl(null, variables.profileImageUrl || advance.profileImageUrl || advance.profilePhotoURL);
  }

  const employee: any = await getDocByIdOrField("employees", variables.employeeId || variables.targetEmployeeId, "employeeId");
  if (employee) {
    variables.employeeName = variables.employeeName || employee.name || employee.fullName || `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
    variables.employeeId = variables.employeeId || employee.id || employee.employeeId;
    variables.profileImageUrl = resolveProfileImageUrl(employee, variables.profileImageUrl);
    variables.bankAccountNo = variables.bankAccountNo || employee.bankNo || employee.bankAccountNo || employee.bankAccountNumber || employee.accountNumber;
    variables.bankName = variables.bankName || employee.bankName || employee.bank;
  }

  const project: any = await getDocByIdOrField("projects", variables.projectId, "projectId");
  if (project) variables.projectName = variables.projectName || project.name || project.projectName || project.title;

  const advSnap = await firestoreDb.collection("advances").get();
  let outstandingTotal = 0;
  let totalAdvance = 0;
  let closedTotal = 0;
  let waitingApprovalCount = 0;
  let waitingClearanceCount = 0;
  const employeeOutstanding = new Map<string, { employeeId: string; employeeName: string; amount: number; count: number }>();
  advSnap.forEach((docSnap: any) => {
    const adv = docSnap.data();
    const amount = Number(adv.amount || adv.totalAmount || adv.advanceAmount || 0);
    const outstandingAmount = Number(adv.outstandingAmount ?? amount);
    const status = String(adv.status || "").toLowerCase();
    totalAdvance += amount;
    if (["approved", "transferred", "pending_clearance", "waiting_clearance", "clearing"].some((s) => status.includes(s))) {
      outstandingTotal += outstandingAmount;
      const employeeId = String(adv.employeeId || adv.requesterId || adv.userId || "unknown");
      const employeeName = String(adv.employeeName || adv.requesterName || employeeId || "ไม่ระบุพนักงาน");
      const current = employeeOutstanding.get(employeeId) || { employeeId, employeeName, amount: 0, count: 0 };
      current.amount += outstandingAmount;
      current.count += 1;
      employeeOutstanding.set(employeeId, current);
    }
    if (["closed", "settled", "completed"].some((s) => status.includes(s))) closedTotal += amount;
    if (["pending", "submitted", "approval"].some((s) => status.includes(s)) && !status.includes("approved")) waitingApprovalCount += 1;
    if (["clearance", "transferred"].some((s) => status.includes(s)) && !["closed", "settled", "completed"].some((s) => status.includes(s))) waitingClearanceCount += 1;
  });

  variables.amount = typeof variables.amount === "number" ? formatMoney(variables.amount) : variables.amount || formatMoney(0);
  variables.clearingAmount = variables.clearingAmount || variables.clearanceAmount || formatMoney(variables.amountValue || 0);
  variables.settlementAmount = variables.settlementAmount || variables.settlementResult || formatMoney(0);
  variables.rejectReason = variables.rejectReason || variables.reason || variables.remark || "กรุณาตรวจสอบและแก้ไขข้อมูลก่อนส่งอนุมัติอีกครั้ง";
  variables.liffSlipUrl = variables.liffSlipUrl || buildLiffUrl(lineConfig, variables.advId);
  variables.liffActionApproveUrl = variables.liffActionApproveUrl || buildLiffActionUrl(lineConfig, variables.advId, "approve");
  variables.liffActionRejectUrl = variables.liffActionRejectUrl || buildLiffActionUrl(lineConfig, variables.advId, "reject");
  const reportDate = variables.reportDate || new Date().toISOString().slice(0, 10);
  variables.dailyReportUrl = variables.dailyReportUrl || (lineConfig?.liffId ? `https://liff.line.me/${lineConfig.liffId}?route=daily-report&date=${encodeURIComponent(reportDate)}` : `${getPublicBaseUrl()}/?route=daily-report&date=${encodeURIComponent(reportDate)}`);
  variables.profileImageUrl = resolveProfileImageUrl(null, variables.profileImageUrl) || "https://placehold.co/320x320/png?text=Profile";
  variables.outstandingShort = variables.outstandingShort || shortMoney(outstandingTotal);
  variables.totalAdvanceShort = variables.totalAdvanceShort || shortMoney(totalAdvance);
  variables.closedAmountShort = variables.closedAmountShort || shortMoney(closedTotal);
  variables.date = variables.date || formatThaiDate();
  variables.neededDate = variables.neededDate || "-";
  variables.dateRange = variables.dateRange || formatThaiDate();
  variables.outstandingAmount = variables.outstandingAmount || formatMoney(outstandingTotal);
  const outstandingRows = Array.from(employeeOutstanding.values()).sort((a, b) => b.amount - a.amount);
  variables.outstandingByEmployee = variables.outstandingByEmployee || (outstandingRows.length
    ? outstandingRows.map((row) => `${row.employeeName}: ${formatMoney(row.amount)} (${row.count} รายการ)`).join("\n")
    : "ไม่มีรายการคงค้าง");
  variables.topOutstandingEmployees = variables.topOutstandingEmployees || (outstandingRows.length
    ? outstandingRows.slice(0, 5).map((row, index) => `${index + 1}. ${row.employeeName} ${formatMoney(row.amount)}`).join("\n")
    : "ไม่มีรายการคงค้าง");
  const requesterOutstanding = outstandingRows.find((row) => row.employeeId === String(variables.employeeId || variables.targetEmployeeId || ""));
  variables.requesterOutstandingAmount = variables.requesterOutstandingAmount || formatMoney(requesterOutstanding?.amount || 0);
  variables.waitingApprovalCount = variables.waitingApprovalCount ?? String(waitingApprovalCount);
  variables.waitingClearanceCount = variables.waitingClearanceCount ?? String(waitingClearanceCount);
  variables.dailySummary = variables.dailySummary || `วันนี้มีรายการรออนุมัติ ${waitingApprovalCount} รายการ และรอเคลียร์ ${waitingClearanceCount} รายการ`;
  variables.weeklySummary = variables.weeklySummary || `สัปดาห์นี้ยอดเงินทดรองสะสม ${formatMoney(totalAdvance)} ปิดยอดแล้ว ${formatMoney(closedTotal)}`;
  variables.outstandingSummary = variables.outstandingSummary || `ยอดคงค้างรวม ${formatMoney(outstandingTotal)} จากรายการที่ยังไม่ปิดยอด`;
  return variables;
};

const resolveLineRecipients = async (allEmployees: any[], trigger: any, variables: Record<string, any>, targetEmployeeId?: string, lineConfig?: any) => {
  const recipients = new Map<string, any>();
  const mode = trigger.recipientMode || "target";
  const settings = await getGlobalSettings();
  const permissionSettings = {
    rolePermissions: mergeRolePermissions((settings as any).rolePermissions),
    approvalWorkflow: normalizeApprovalWorkflow((settings as any).approvalWorkflow),
  };
  const targetIds = new Set([targetEmployeeId, variables.targetEmployeeId, variables.employeeId, variables.requesterId].filter(Boolean).map(String));
  const triggerRoleIds = new Set([...(trigger.recipientRoleIds || []), ...(trigger.recipientRoles || [])].filter(Boolean).map((item: any) => String(item).toLowerCase()));
  const documentId = variables.advId || variables.advanceId || variables.id || variables.docId || variables.documentId || variables.advanceNo || variables.documentNo;
  const advance: any = documentId ? await findAdvanceForLiff(documentId) : null;

  const addEmployee = (emp: any, reason: string) => {
    const lineUserId = lineIdOf(emp);
    if (!lineUserId || !isEmployeeEnabled(emp)) return;
    recipients.set(`user:${lineUserId}`, {
      targetType: "user",
      targetId: lineUserId,
      employeeId: emp.id,
      employeeName: emp.name || emp.fullName || emp.username || "",
      reason,
    });
  };

  for (const emp of allEmployees) {
    const empIds = [emp.id, emp.employeeId, emp.uid, emp.userId].filter(Boolean).map(String);
    const isTarget = empIds.some((id) => targetIds.has(id));
    const role = getEmployeeEffectiveRole(emp, permissionSettings);
    const roleId = String(role?.id || emp.roleId || emp.positionId || emp.role || "").toLowerCase();

    if (mode === "all") addEmployee(emp, "all");
    if ((mode === "target" || mode === "requester") && isTarget) addEmployee(emp, mode);
    if (mode === "custom" && Array.isArray(trigger.sendToUsers) && trigger.sendToUsers.includes(lineIdOf(emp))) addEmployee(emp, "custom");
    if (mode === "accounting" && (roleId === "accountant" || roleId === "admin" || role?.permissions.reviewClearance || role?.permissions.closeAdvance)) addEmployee(emp, "accounting");
    if (mode === "approvers") {
      const roleMatch = triggerRoleIds.size ? triggerRoleIds.has(roleId) || triggerRoleIds.has(String(emp.role || "").toLowerCase()) : Boolean(role?.permissions.approveAdvance);
      const permissionMatch = advance && trigger.useApprovalWorkflowRules !== false
        ? canApproveAdvance(emp, advance, permissionSettings, "WEB").allowed
        : roleMatch;
      if (permissionMatch) addEmployee(emp, "approver");
    }
    if (trigger.alsoSendToRequester && isTarget) addEmployee(emp, "alsoRequester");
  }

  if (trigger.sendToGroup === true && lineConfig?.enableGroupNotification === true) {
    const groupId = String(lineConfig.groupId || lineConfig.lineGroupId || "").trim();
    if (groupId) {
      recipients.set(`group:${groupId}`, {
        targetType: "group",
        targetId: groupId,
        employeeId: "",
        employeeName: lineConfig.groupName || "LINE Group",
        reason: "group",
      });
    }
  }

  return Array.from(recipients.values());
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Use JSON middleware with 20MB limit for base64 file uploads
  app.use(express.json({ limit: "20mb" }));

  // API Route for profile image upload (Bypassing Firebase Storage 403 using local storage)
  app.post("/api/upload-profile-image", (req, res, next) => {
    console.log("POST /api/upload-profile-image route started");
    next();
  }, upload.single("image"), async (req, res) => {
    try {
      console.log("upload.single('image') executed");
      const { employeeId } = req.body;
      console.log("employeeId in body:", employeeId);
      console.log("req.file:", req.file ? { originalname: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : "undefined");
      
      if (!req.file || !employeeId) {
          return res.status(400).json({ error: "Missing file or employeeId" });
      }
      
      const file = req.file;
      const extension = path.extname(file.originalname) || ".jpg";
      const filename = `${Date.now()}${extension}`;
      const mimeType = file.mimetype || "image/jpeg";
      const profileImageDataUrl = `data:${mimeType};base64,${file.buffer.toString("base64")}`;
      
      // Ensure specific employee folder exists
      const empDir = path.join(PROFILES_DIR, employeeId);
      if (!fs.existsSync(empDir)) {
        fs.mkdirSync(empDir, { recursive: true });
      }
      
      // Save file to local directory
      const filePath = path.join(empDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      
      // Construct local relative download URL
      const downloadURL = `/api/profiles/${employeeId}/${filename}`;
      
      if (firestoreDb) {
        try {
          await firestoreDb.collection("employees").doc(employeeId).update({
              profilePhotoURL: downloadURL,
              profileImage: profileImageDataUrl,
              profilePhotoUpdatedAt: FieldValue.serverTimestamp()
          });
        } catch (fsErr: any) {
          console.warn("Skipping server-side Firestore update (falling back to client-side write):", fsErr.message);
        }
      }
      
      res.json({ status: "success", downloadURL, profileImage: profileImageDataUrl });
    } catch (err: any) {
      console.error("Local profile photo upload error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API Route to serve uploaded profile images
  app.get("/api/profiles/:employeeId/:filename", (req, res) => {
    try {
      const { employeeId, filename } = req.params;
      const filePath = path.resolve(PROFILES_DIR, employeeId, filename);
      
      // Security check to avoid path traversal vulnerabilities
      if (!filePath.startsWith(PROFILES_DIR)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filename).toLowerCase();
        let contentType = "image/jpeg";
        if (ext === ".png") contentType = "image/png";
        else if (ext === ".webp") contentType = "image/webp";
        else if (ext === ".gif") contentType = "image/gif";
        
        res.setHeader("Content-Type", contentType);
        res.sendFile(filePath);
      } else {
        res.status(404).send("Profile image not found");
      }
    } catch (err: any) {
      console.error("Error serving profile photo:", err);
      res.status(500).send("Internal server error");
    }
  });

  app.get("/api/slips/:advId/:filename", (req, res) => {
    try {
      const { advId, filename } = req.params;
      const filePath = path.resolve(SLIPS_DIR, advId, filename);
      if (!filePath.startsWith(SLIPS_DIR)) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).send("Slip image not found");
      }
      const ext = path.extname(filename).toLowerCase();
      let contentType = "image/jpeg";
      if (ext === ".png") contentType = "image/png";
      else if (ext === ".webp") contentType = "image/webp";
      else if (ext === ".gif") contentType = "image/gif";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=604800");
      return res.sendFile(filePath);
    } catch (err: any) {
      console.error("Error serving slip image:", err);
      return res.status(500).send("Internal server error");
    }
  });

  app.get("/api/profile-image/:employeeId", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(503).send("Firestore is not configured");
      const { employeeId } = req.params;
      const employee: any = await getDocByIdOrField("employees", employeeId, "employeeId");
      const dataUrl = employee?.profileImage;
      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        return res.status(404).send("Profile image not found in database");
      }

      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return res.status(400).send("Invalid profile image data");

      const [, contentType, base64Data] = match;
      const buffer = Buffer.from(base64Data, "base64");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return res.send(buffer);
    } catch (err: any) {
      console.error("Error serving database profile image:", err);
      return res.status(500).send("Internal server error");
    }
  });

  // API Route for Gemini OCR
  app.post("/api/gemini/ocr", async (req, res) => {
    try {
      const { base64Data, mimeType, user } = req.body;
      if (!base64Data || !mimeType) {
        return res.status(400).json({ error: "Missing base64Data or mimeType in request body." });
      }

      const result = await performServerAIOCR(base64Data, mimeType, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API OCR Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during OCR parsing." });
    }
  });

  // API Route for Prince Advance Chatbot
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { message, chatHistory, databaseContext, user } = req.body;
      if (!message || !chatHistory || !databaseContext) {
        return res.status(400).json({ error: "Missing message, chatHistory, or databaseContext." });
      }

      const { queryPrinceAdvanceAI } = await import("./src/server/gemini");
      const reply = await queryPrinceAdvanceAI({ message, chatHistory, databaseContext }, user);
      return res.json({ status: "success", reply });
    } catch (err: any) {
      console.error("Server API Chat Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during Chat processing." });
    }
  });

  // API Route for Project Petty Cash Budget Estimation
  app.post("/api/gemini/estimate-budget", async (req, res) => {
    try {
      const { totalContractBudget, user } = req.body;
      if (typeof totalContractBudget !== "number") {
        return res.status(400).json({ error: "Invalid or missing totalContractBudget." });
      }

      const { estimatePettyCashBudget } = await import("./src/server/gemini");
      const result = await estimatePettyCashBudget(totalContractBudget, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API Estimate Budget Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during budget estimation." });
    }
  });

  // API Route for AI Settings Document Import
  app.post("/api/gemini/import-settings", async (req, res) => {
    try {
      const { base64Data, mimeType, rawText, targetTab, user } = req.body;
      if (!base64Data && !rawText) {
        return res.status(400).json({ error: "Missing both base64Data and rawText." });
      }

      const { importSettingsFromDocument } = await import("./src/server/gemini");
      const result = await importSettingsFromDocument(base64Data, mimeType, rawText, targetTab, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API Import Settings Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during settings import." });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/debug/firebase-info", (req, res) => {
    res.json({
      backendProjectId: firebaseConfig.projectId || adminAppInstance?.options?.projectId || "",
      backendStorageBucket: firebaseConfig.storageBucket || adminAppInstance?.options?.storageBucket || "",
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || "(default)",
      hasFirestoreAdmin: Boolean(firestoreDb),
      hasBucket: Boolean(bucket),
    });
  });

  // API Route for LINE Notifications using real LINE Messaging API
  app.post("/api/line/send-notification", async (req, res) => {
    try {
      const { triggerId, variables = {}, targetEmployeeId } = req.body;
      if (!triggerId || !variables) {
        return res.status(400).json({ error: "Missing triggerId or variables in request body." });
      }

      console.log(`Sending LINE Notification for trigger "${triggerId}"...`);

      if (!firestoreDb) {
        return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      }

      // 1. Get LINE Messaging config from settings/global
      const lineConfig = await getLineSettings();
      if (!lineConfig) {
        return res.status(404).json({ error: "Global settings document not found." });
      }

      if (!lineConfig || !lineConfig.channelAccessToken) {
        console.warn("LINE Notifications are not configured yet (no Channel Access Token).");
        return res.json({ status: "skipped", message: "LINE Messaging is not configured. Config is empty." });
      }

      const channelAccessToken = lineConfig.channelAccessToken;
      const triggers = lineConfig.triggers || [];
      const trigger = triggers.find((t: any) => t.id === triggerId);

      if (!trigger) {
        console.warn(`No trigger found for ID: ${triggerId}`);
        return res.json({ status: "skipped", message: `No trigger found for ID: ${triggerId}` });
      }

      if (!trigger.isActive) {
        console.log(`Trigger "${triggerId}" is inactive. Skipping notification.`);
        return res.json({ status: "skipped", message: `Trigger "${triggerId}" is inactive.` });
      }

      const resolvedVariables = await enrichLineVariables({ ...variables, targetEmployeeId }, lineConfig);

      // 2. Fetch recipients (lineUserIds) from employees in memory (safest, no composite indices needed)
      const empSnap = await firestoreDb.collection("employees").get();
      const allEmployees: any[] = [];
      empSnap.forEach((docSnap: any) => {
        allEmployees.push({ id: docSnap.id, ...docSnap.data() });
      });

      const selectedRecipients = await resolveLineRecipients(allEmployees, trigger, resolvedVariables, targetEmployeeId, lineConfig);
      const recipients = selectedRecipients.map((recipient) => recipient.targetId);
      if (selectedRecipients.length === 0) {
        console.log("No recipients found with a registered LINE User ID.");
        await writeLineNotificationLog({
          triggerId,
          advId: resolvedVariables.advId || "",
          targetType: "none",
          targetId: "",
          recipientCount: 0,
          status: "skipped",
          lineApiResults: [],
          errorMessage: "No eligible LINE recipients.",
        });
        return res.json({ status: "skipped", message: "No employees have a registered LINE User ID." });
      }

      // 3. Format Message
      let messagePayload: any = null;

      try {
        messagePayload = createLineMessagePayload(trigger, resolvedVariables);
      } catch (jsonErr: any) {
        console.error("Failed to parse or resolve LINE message template:", jsonErr);
        messagePayload = {
          type: "text",
          text: `[Template Parse Error]\n${replaceVariables(trigger.messageTemplate || "", resolvedVariables)}`
        };
      }

      // 4. Send messages to LINE Messaging API
      const results: any[] = [];
      for (const recipient of selectedRecipients) {
        try {
          const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${channelAccessToken.trim()}`
            },
            body: JSON.stringify({
              to: recipient.targetId,
              messages: [messagePayload]
            })
          });

          const resText = await lineRes.text();
          console.log(`LINE API response for ${recipient.targetId}:`, lineRes.status, resText);
          results.push({ targetType: recipient.targetType, targetId: recipient.targetId, status: lineRes.status, response: resText });
        } catch (fetchErr: any) {
          console.error(`Fetch error sending to LINE recipient ${recipient.targetId}:`, fetchErr);
          results.push({ targetType: recipient.targetType, targetId: recipient.targetId, status: "error", error: fetchErr.message });
        }
      }

      await writeLineNotificationLog({
        triggerId,
        advId: resolvedVariables.advId || "",
        targetType: selectedRecipients.some((recipient) => recipient.targetType === "group") ? "mixed" : "user",
        targetId: selectedRecipients.map((recipient) => recipient.targetId).join(","),
        recipientCount: selectedRecipients.length,
        status: results.some((item) => Number(item.status) >= 400 || item.status === "error") ? "partial" : "success",
        lineApiResults: results,
        errorMessage: results.filter((item) => Number(item.status) >= 400 || item.status === "error").map((item) => item.error || item.response).join("\n"),
      });

      return res.json({ status: "success", recipientsSent: recipients.length, selectedRecipients, variables: resolvedVariables, results });
    } catch (err: any) {
      console.error("Send LINE Notification error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during notification dispatch." });
    }
  });

  app.post("/api/line/test-notification", async (req, res) => {
    const errors: string[] = [];
    const lineApiResults: any[] = [];
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const { triggerId = "onNewRequest", variables = {}, targetEmployeeId, send = false, forceMode } = req.body || {};
      const lineConfig = await getLineSettings();
      const triggers = lineConfig?.triggers || [];
      const trigger = triggers.find((item: any) => item.id === triggerId);
      const testTrigger = trigger ? { ...trigger } : null;
      if (testTrigger && forceMode) testTrigger.recipientMode = forceMode;
      if (testTrigger && forceMode === "group") {
        testTrigger.sendToGroup = true;
        testTrigger.recipientMode = "custom";
      }
      const empSnap = firestoreDb ? await firestoreDb.collection("employees").get() : null;
      const allEmployees: any[] = [];
      empSnap?.forEach((docSnap: any) => allEmployees.push({ id: docSnap.id, ...docSnap.data() }));
      const resolvedVariables = await enrichLineVariables({ ...variables, targetEmployeeId }, lineConfig || {});
      const selectedRecipients = testTrigger
        ? await resolveLineRecipients(allEmployees, testTrigger, resolvedVariables, targetEmployeeId, {
            ...lineConfig,
            enableGroupNotification: forceMode === "group" ? true : lineConfig?.enableGroupNotification,
          })
        : [];
      if (!lineConfig) errors.push("LINE config not found.");
      if (!lineConfig?.channelAccessToken) errors.push("Channel access token not found.");
      if (!trigger) errors.push(`Trigger not found: ${triggerId}`);
      if (trigger && !trigger.isActive) errors.push(`Trigger inactive: ${triggerId}`);

      if (send && lineConfig?.channelAccessToken && testTrigger && selectedRecipients.length) {
        const messagePayload = createLineMessagePayload(testTrigger, resolvedVariables);
        for (const recipient of selectedRecipients) {
          try {
            const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}`,
              },
              body: JSON.stringify({ to: recipient.targetId, messages: [messagePayload] }),
            });
            lineApiResults.push({ targetType: recipient.targetType, targetId: recipient.targetId, status: lineRes.status, response: await lineRes.text() });
          } catch (err: any) {
            lineApiResults.push({ targetType: recipient.targetType, targetId: recipient.targetId, status: "error", error: err?.message || String(err) });
          }
        }
        await writeLineNotificationLog({
          triggerId,
          advId: resolvedVariables.advId || "",
          targetType: selectedRecipients.some((recipient) => recipient.targetType === "group") ? "mixed" : "user",
          targetId: selectedRecipients.map((recipient) => recipient.targetId).join(","),
          recipientCount: selectedRecipients.length,
          status: lineApiResults.some((item) => Number(item.status) >= 400 || item.status === "error") ? "partial" : "success",
          lineApiResults,
          errorMessage: lineApiResults.filter((item) => Number(item.status) >= 400 || item.status === "error").map((item) => item.error || item.response).join("\n"),
        });
      }

      return res.json({
        configFound: Boolean(lineConfig),
        tokenFound: Boolean(lineConfig?.channelAccessToken),
        triggerFound: Boolean(trigger),
        triggerActive: Boolean(trigger?.isActive),
        selectedRecipients,
        groupId: String(lineConfig?.groupId || lineConfig?.lineGroupId || ""),
        lineApiResults,
        errors,
      });
    } catch (err: any) {
      errors.push(err?.message || String(err));
      return res.status(500).json({
        configFound: false,
        tokenFound: false,
        triggerFound: false,
        triggerActive: false,
        selectedRecipients: [],
        groupId: "",
        lineApiResults,
        errors,
      });
    }
  });

  app.post("/api/line/send-bind-invite", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const { employeeId } = req.body || {};
      if (!employeeId) return res.status(400).json({ error: "Missing employeeId." });

      const lineConfig = await getLineSettings();
      if (!lineConfig?.channelAccessToken) {
        return res.json({ status: "skipped", message: "LINE Messaging is not configured." });
      }
      const groupId = getLineGroupId(lineConfig);
      if (!groupId) {
        return res.json({ status: "skipped", message: "LINE groupId is not configured." });
      }

      const employeeSnap = await firestoreDb.collection("employees").doc(String(employeeId)).get();
      if (!employeeSnap.exists) return res.status(404).json({ error: "Employee not found." });
      const employee = { id: employeeSnap.id, ...employeeSnap.data() };
      const token = crypto.randomBytes(18).toString("hex");

      await firestoreDb.collection("employees").doc(employeeSnap.id).set({
        lineBindToken: token,
        lineBindTokenCreatedAt: FieldValue.serverTimestamp(),
        lineBindInviteSentAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const messagePayload = createLineBindMessage(employee, token);
      const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}`
        },
        body: JSON.stringify({
          to: groupId,
          messages: [messagePayload]
        })
      });

      const responseText = await lineRes.text();
      return res.json({
        status: lineRes.ok ? "success" : "error",
        lineStatus: lineRes.status,
        response: responseText,
        employeeId: employeeSnap.id,
        groupId,
      });
    } catch (err: any) {
      console.error("Send LINE bind invite error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during LINE bind invite." });
    }
  });

  app.get("/api/line/liff-advance/:advId", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const advId = req.params.advId;
      const advance = await getAdvanceForLine(advId);
      if (!advance) return res.status(404).json(liffNotFoundPayload(advId));
      if (!advance) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });
      return res.json({ status: "success", advance });
    } catch (err: any) {
      console.error("LINE LIFF advance fetch error:", err);
      return res.status(500).json({ error: err.message || "Cannot load advance for LIFF." });
    }
  });

  app.post("/api/line/liff-action", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const { advId, action, userId, lineUserId, displayName, rejectReason } = req.body || {};
      const resolvedLineUserId = String(lineUserId || userId || "").trim();
      if (!advId || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "Missing advId or invalid action." });
      }

      const advance: any = await findAdvanceForLiff(advId);
      if (!advance?.id) return res.status(404).json(liffNotFoundPayload(advId));
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      const employee: any = await findEmployeeByLineUserId(resolvedLineUserId);
      const employeeName = employee?.name || employee?.fullName || employee?.lineDisplayName || displayName || "LINE LIFF";
      const matchedRoleId = employee ? resolvePositionId(employee) : "";

      if (!employee) {
        const denyReason = "บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้งานในระบบ";
        await writeLineActionLog({
          advId,
          action,
          status: advance.status || "",
          lineUserId: resolvedLineUserId,
          employeeId: "",
          employeeName,
          roleId: "",
          positionId: "",
          allowed: false,
          denyReason,
          source: "LINE_LIFF",
          requestPayload: req.body,
          responsePayload: { error: denyReason },
        });
        return res.status(403).json({ error: denyReason });
      }

      if (!isEmployeeEnabled(employee)) {
        const denyReason = "employee inactive or disabled";
        await writeLineActionLog({
          advId,
          action,
          status: advance.status || "",
          lineUserId: resolvedLineUserId,
          employeeId: employee.id,
          employeeName,
          roleId: employee.roleId || matchedRoleId,
          positionId: employee.positionId || matchedRoleId,
          allowed: false,
          denyReason,
          source: "LINE_LIFF",
          requestPayload: req.body,
          responsePayload: { error: denyReason },
        });
        return res.status(403).json({ error: denyReason });
      }

      const settings: any = await getGlobalSettings();
      const permissionSettings = {
        rolePermissions: mergeRolePermissions(settings.rolePermissions),
        approvalWorkflow: normalizeApprovalWorkflow(settings.approvalWorkflow),
      };
      const permissionResult = action === "approve"
        ? canApproveAdvance(employee, advance, permissionSettings, "LINE_LIFF")
        : canRejectAdvance(employee, advance, permissionSettings, "LINE_LIFF");
      const logBase = {
        advId,
        action,
        status: advance.status || "",
        lineUserId: resolvedLineUserId || resolveEmployeeLineUserId(employee) || "",
        employeeId: employee.id,
        employeeName,
        roleId: employee.roleId || permissionResult.matchedRole?.id || matchedRoleId,
        positionId: employee.positionId || permissionResult.matchedRole?.id || matchedRoleId,
        matchedApprovalRuleId: permissionResult.matchedRule?.id || "",
        matchedApprovalRuleName: permissionResult.matchedRule?.name || "",
        source: "LINE_LIFF",
        requestPayload: req.body,
      };

      if (!permissionResult.allowed) {
        await writeLineActionLog({
          ...logBase,
          allowed: false,
          denyReason: permissionResult.reason,
          responsePayload: { error: permissionResult.reason },
        });
        return res.status(403).json({ error: permissionResult.reason, permission: permissionResult });
      }

      const nowIso = new Date().toISOString();
      const roleId = employee.roleId || permissionResult.matchedRole?.id || matchedRoleId;
      const positionId = employee.positionId || permissionResult.matchedRole?.id || matchedRoleId;
      const updatePayload = action === "approve"
        ? {
            status: "WAITING_TRANSFER",
            approvedAt: nowIso,
            approvedBy: employeeName,
            approvedByEmployeeId: employee.id,
            approvedByRoleId: roleId,
            approvedByPositionId: positionId,
            lineActionAt: FieldValue.serverTimestamp(),
            lineActionBy: resolvedLineUserId || employeeName,
            lineActionByLineUserId: resolvedLineUserId || resolveEmployeeLineUserId(employee) || "",
            lineActionSource: "LINE_LIFF",
            matchedApprovalRuleId: permissionResult.matchedRule?.id || "",
            matchedApprovalRuleName: permissionResult.matchedRule?.name || "",
          }
        : {
            status: "REJECTED",
            rejectedAt: nowIso,
            rejectedBy: employeeName,
            rejectedByEmployeeId: employee.id,
            rejectedByRoleId: roleId,
            rejectedByPositionId: positionId,
            rejectReason: rejectReason || "Rejected from LINE LIFF",
            lineActionAt: FieldValue.serverTimestamp(),
            lineActionBy: resolvedLineUserId || employeeName,
            lineActionByLineUserId: resolvedLineUserId || resolveEmployeeLineUserId(employee) || "",
            lineActionSource: "LINE_LIFF",
            matchedApprovalRuleId: permissionResult.matchedRule?.id || "",
            matchedApprovalRuleName: permissionResult.matchedRule?.name || "",
          };

      await firestoreDb.collection("advances").doc(advance.id).set(updatePayload, { merge: true });
      await writeLineActionLog({
        ...logBase,
        allowed: true,
        denyReason: "",
        responsePayload: { status: "success", updatePayload },
      });

      const auditId = `audit-line-${Date.now()}-${advance.id}`;
      await firestoreDb.collection("auditLogs").doc(auditId).set({
        id: auditId,
        advId: advance.advId || advId,
        actionType: action === "approve" ? "APPROVE_ADVANCE" : "REJECT_ADVANCE",
        actionBy: employeeName,
        role: employee.role || roleId || "LINE",
        timestamp: nowIso,
        beforeStatus: advance.status || "",
        afterStatus: updatePayload.status,
        note: action === "approve" ? "อนุมัติผ่าน LINE LIFF" : "ไม่อนุมัติผ่าน LINE LIFF",
      }, { merge: true });

      const updatedAdvance = await getAdvanceForLine(advId);
      return res.json({ status: "success", action, advance: updatedAdvance, permission: permissionResult });
    } catch (err: any) {
      console.error("LINE LIFF action error:", err);
      return res.status(500).json({ error: err.message || "Cannot update advance from LIFF." });
    }
  });

  app.post("/api/line/liff-batch-action", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const { action, advIds = [], lineUserId, reason = "", source = "LINE_LIFF_DAILY_REPORT" } = req.body || {};
      if (!["approve", "reject"].includes(action) || !Array.isArray(advIds) || advIds.length === 0) {
        return res.status(400).json({ error: "Missing action or advIds." });
      }

      const employee: any = await findEmployeeByLineUserId(String(lineUserId || "").trim());
      if (!employee) return res.status(403).json({ error: "บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้งานในระบบ" });
      if (!isEmployeeEnabled(employee)) return res.status(403).json({ error: "employee inactive or disabled" });

      const settings: any = await getGlobalSettings();
      const permissionSettings = {
        rolePermissions: mergeRolePermissions(settings.rolePermissions),
        approvalWorkflow: normalizeApprovalWorkflow(settings.approvalWorkflow),
      };
      const employeeName = employee.name || employee.fullName || employee.lineDisplayName || "LINE LIFF";
      const results: any[] = [];
      const summary = { requested: advIds.length, approved: 0, denied: 0, failed: 0, totalApprovedAmount: 0 };

      for (const rawAdvId of advIds) {
        const advId = String(rawAdvId || "").trim();
        try {
          const advance: any = await findAdvanceForLiff(advId);
          if (!advance?.id) {
            summary.failed += 1;
            results.push({ advId, status: "failed", reason: "advance not found", matchedRuleId: "", matchedRuleName: "" });
            await writeLineActionLog({ advId, action, status: "NOT_FOUND", lineUserId, employeeId: employee.id, employeeName, roleId: employee.roleId || "", positionId: employee.positionId || "", allowed: false, denyReason: "advance not found", source, requestPayload: req.body, responsePayload: { error: "advance not found" } });
            continue;
          }

          if (!isPendingApprovalStatus(advance.status)) {
            summary.denied += 1;
            results.push({ advId, status: "denied", reason: "advance is not PENDING_APPROVAL", matchedRuleId: "", matchedRuleName: "" });
            await writeLineActionLog({ advId, action, status: advance.status || "", lineUserId, employeeId: employee.id, employeeName, roleId: employee.roleId || "", positionId: employee.positionId || "", allowed: false, denyReason: "advance is not PENDING_APPROVAL", source, requestPayload: req.body, responsePayload: { error: "advance is not PENDING_APPROVAL" } });
            continue;
          }

          const permissionResult = action === "approve"
            ? canApproveAdvance(employee, advance, permissionSettings, "LINE_LIFF")
            : canRejectAdvance(employee, advance, permissionSettings, "LINE_LIFF");
          const batchAllowed = Boolean(permissionResult.matchedRole?.permissions.batchApproveAdvance && permissionResult.matchedRule?.allowBatchApproval);
          const allowed = permissionResult.allowed && batchAllowed;
          const denyReason = permissionResult.allowed && !batchAllowed ? "batch approval is disabled for this role/rule" : permissionResult.reason;
          const matchedRoleId = employee.roleId || permissionResult.matchedRole?.id || resolvePositionId(employee);
          const matchedPositionId = employee.positionId || permissionResult.matchedRole?.id || resolvePositionId(employee);

          if (!allowed) {
            summary.denied += 1;
            results.push({ advId, status: "denied", reason: denyReason, matchedRuleId: permissionResult.matchedRule?.id || "", matchedRuleName: permissionResult.matchedRule?.name || "" });
            await writeLineActionLog({ advId, action, status: advance.status || "", lineUserId, employeeId: employee.id, employeeName, roleId: matchedRoleId, positionId: matchedPositionId, matchedApprovalRuleId: permissionResult.matchedRule?.id || "", matchedApprovalRuleName: permissionResult.matchedRule?.name || "", allowed: false, denyReason, source, requestPayload: req.body, responsePayload: { error: denyReason } });
            continue;
          }

          const nowIso = new Date().toISOString();
          const updatePayload = action === "approve"
            ? {
                status: "WAITING_TRANSFER",
                approvedAt: nowIso,
                approvedBy: employeeName,
                approvedByEmployeeId: employee.id,
                approvedByRoleId: matchedRoleId,
                approvedByPositionId: matchedPositionId,
                lineActionByLineUserId: lineUserId || "",
                lineActionSource: source,
                matchedApprovalRuleId: permissionResult.matchedRule?.id || "",
                matchedApprovalRuleName: permissionResult.matchedRule?.name || "",
              }
            : {
                status: "REJECTED",
                rejectedAt: nowIso,
                rejectedBy: employeeName,
                rejectedByEmployeeId: employee.id,
                rejectedByRoleId: matchedRoleId,
                rejectedByPositionId: matchedPositionId,
                rejectReason: reason || "Rejected from LINE daily report",
                lineActionByLineUserId: lineUserId || "",
                lineActionSource: source,
                matchedApprovalRuleId: permissionResult.matchedRule?.id || "",
                matchedApprovalRuleName: permissionResult.matchedRule?.name || "",
              };
          await firestoreDb.collection("advances").doc(advance.id).set(updatePayload, { merge: true });
          await firestoreDb.collection("auditLogs").doc(`audit-batch-${Date.now()}-${advance.id}`).set({
            id: `audit-batch-${Date.now()}-${advance.id}`,
            advId: advance.advId || advId,
            actionType: action === "approve" ? "APPROVE_ADVANCE" : "REJECT_ADVANCE",
            actionBy: employeeName,
            role: employee.role || matchedRoleId,
            timestamp: nowIso,
            beforeStatus: advance.status || "",
            afterStatus: updatePayload.status,
            note: action === "approve" ? "Batch approved via LINE daily report" : "Batch rejected via LINE daily report",
          }, { merge: true });
          await writeLineActionLog({ advId, action, status: advance.status || "", lineUserId, employeeId: employee.id, employeeName, roleId: matchedRoleId, positionId: matchedPositionId, matchedApprovalRuleId: permissionResult.matchedRule?.id || "", matchedApprovalRuleName: permissionResult.matchedRule?.name || "", allowed: true, denyReason: "", source, requestPayload: req.body, responsePayload: { status: "success", updatePayload } });
          summary.approved += 1;
          summary.totalApprovedAmount += advanceAmount(advance);
          results.push({ advId, status: "success", reason: "allowed", matchedRuleId: permissionResult.matchedRule?.id || "", matchedRuleName: permissionResult.matchedRule?.name || "" });
        } catch (err: any) {
          summary.failed += 1;
          results.push({ advId, status: "failed", reason: err?.message || String(err), matchedRuleId: "", matchedRuleName: "" });
          await writeLineActionLog({ advId, action, status: "FAILED", lineUserId, employeeId: employee.id, employeeName, roleId: employee.roleId || "", positionId: employee.positionId || "", allowed: false, denyReason: err?.message || String(err), source, requestPayload: req.body, responsePayload: { error: err?.message || String(err) } });
        }
      }

      runMirrorAction("syncCollectionToGoogleSheet", { collectionName: "advances", rows: await loadCollectionRows("advances") }, { collectionName: "advances", source: "liff-batch-action" }).catch((err) => console.warn("Batch sheet sync failed:", err?.message || err));
      const lineConfig = await getLineSettings();
      if (lineConfig?.channelAccessToken && lineIdOf(employee)) {
        fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}` },
          body: JSON.stringify({
            to: lineIdOf(employee),
            messages: [{ type: "text", text: `Batch ${action} summary: success ${summary.approved}, denied ${summary.denied}, failed ${summary.failed}, total ${formatMoney(summary.totalApprovedAmount)}` }],
          }),
        }).catch((err) => console.warn("Batch summary LINE push failed:", err?.message || err));
      }

      return res.json({ status: "success", summary, results });
    } catch (err: any) {
      console.error("LINE LIFF batch action error:", err);
      return res.status(500).json({ error: err?.message || "Cannot run batch action." });
    }
  });

  app.post("/api/line/upload-slip", upload.single("slip"), async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firebase Admin Firestore is not initialized on the server." });
      const advId = req.body?.advId;
      if (!advId || !req.file) return res.status(400).json({ error: "Missing advId or slip file." });

      const advance: any = await findAdvanceForLiff(advId);
      if (!advance?.id) return res.status(404).json(liffNotFoundPayload(advId));
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      const extension = path.extname(req.file.originalname || "") || ".jpg";
      const safeAdvId = String(advId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = `slips/${safeAdvId}/slip_${Date.now()}${extension}`;
      let storageMode = "server-local";
      let downloadUrl = "";
      if (bucket) {
        try {
          const remoteFile = bucket.file(filePath);
          await remoteFile.save(req.file.buffer, {
            contentType: req.file.mimetype || "image/jpeg",
            metadata: { cacheControl: "public, max-age=31536000" },
          });
          try {
            const [signedUrl] = await remoteFile.getSignedUrl({ action: "read", expires: "2500-01-01" });
            downloadUrl = signedUrl;
          } catch {
            downloadUrl = `https://storage.googleapis.com/${bucket.name}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
          }
          storageMode = "firebase-admin-storage";
        } catch (storageErr: any) {
          console.warn("Firebase Admin storage upload failed, falling back to local slip storage:", storageErr?.message || storageErr);
        }
      }

      if (!downloadUrl) {
        const localDir = path.join(SLIPS_DIR, safeAdvId);
        fs.mkdirSync(localDir, { recursive: true });
        const filename = path.basename(filePath);
        fs.writeFileSync(path.join(localDir, filename), req.file.buffer);
        downloadUrl = `${getPublicBaseUrl()}/api/slips/${encodeURIComponent(safeAdvId)}/${encodeURIComponent(filename)}`;
      }

      await firestoreDb.collection("advances").doc(advance.id).set({
        status: "WAITING_CLEARANCE",
        slipUrl: downloadUrl,
        transferSlipUrl: downloadUrl,
        transferSlipStorageMode: storageMode,
        transferCompletedAt: FieldValue.serverTimestamp(),
        transferUpdatedFrom: "line_liff",
      }, { merge: true });

      const auditId = `audit-slip-${Date.now()}-${advance.id}`;
      await firestoreDb.collection("auditLogs").doc(auditId).set({
        id: auditId,
        advId: advance.advId || advId,
        actionType: "UPLOAD_TRANSFER_SLIP",
        actionBy: "LINE LIFF",
        role: "LINE",
        timestamp: new Date().toISOString(),
        beforeStatus: advance.status || "",
        afterStatus: "WAITING_CLEARANCE",
        note: "แนบสลิปผ่าน LINE LIFF",
      }, { merge: true });

      return res.json({ status: "success", url: downloadUrl, storageMode });
    } catch (err: any) {
      console.error("LINE LIFF slip upload error:", err);
      return res.status(500).json({ error: err.message || "Cannot upload slip from LIFF." });
    }
  });

  app.post("/api/line/webhook", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const lineConfig = await getLineSettings();
      if (!lineConfig?.channelAccessToken) return res.status(200).json({ status: "skipped", message: "LINE Messaging is not configured." });

      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      const triggers = lineConfig.triggers || [];
      const replies: any[] = [];

      for (const event of events) {
        if (!event.replyToken) continue;
        const data = new URLSearchParams(event.postback?.data || event.message?.text || "");
        let triggerId = "";
        let variables: Record<string, any> = {};

        if (data.get("bindLine")) {
          const employeeId = data.get("employeeId") || "";
          const token = data.get("token") || "";
          const userId = event.source?.userId || "";
          if (!employeeId || !token || !userId) {
            await replyLineMessage(lineConfig, event.replyToken, [{ type: "text", text: "ผูก LINE ไม่สำเร็จ: ข้อมูลปุ่มไม่ครบ กรุณาให้แอดมินส่งปุ่มใหม่" }]);
            replies.push({ action: "bindLine", status: "invalid_payload" });
            continue;
          }

          const employeeRef = firestoreDb.collection("employees").doc(employeeId);
          const employeeSnap = await employeeRef.get();
          const employee = employeeSnap.exists ? employeeSnap.data() : null;
          if (!employee || employee.lineBindToken !== token) {
            await replyLineMessage(lineConfig, event.replyToken, [{ type: "text", text: "ผูก LINE ไม่สำเร็จ: ปุ่มนี้หมดอายุหรือไม่ตรงกับบัญชี กรุณาให้แอดมินส่งปุ่มใหม่" }]);
            replies.push({ action: "bindLine", status: "token_mismatch", employeeId });
            continue;
          }

          const existingSnap = await firestoreDb.collection("employees").where("lineUserId", "==", userId).limit(1).get();
          if (!existingSnap.empty && existingSnap.docs[0].id !== employeeId) {
            await replyLineMessage(lineConfig, event.replyToken, [{ type: "text", text: "LINE นี้ถูกผูกกับบัญชีอื่นแล้ว กรุณาติดต่อแอดมินเพื่อตรวจสอบ" }]);
            replies.push({ action: "bindLine", status: "already_bound_other_employee", employeeId });
            continue;
          }

          const profile = await getLineProfile(lineConfig, event.source);
          await employeeRef.set({
            lineUserId: userId,
            lineDisplayName: profile.displayName || employee.lineDisplayName || "",
            linePictureUrl: profile.pictureUrl || employee.linePictureUrl || "",
            lineLinkedAt: FieldValue.serverTimestamp(),
            lineLinkedFromGroupId: event.source?.groupId || "",
            lineBindToken: FieldValue.delete(),
          }, { merge: true });

          const name = employee.name || employee.fullName || employee.username || "บัญชีนี้";
          await replyLineMessage(lineConfig, event.replyToken, [{ type: "text", text: `เชื่อม LINE ให้ ${name} เรียบร้อยแล้ว` }]);
          replies.push({ action: "bindLine", status: "success", employeeId, userId });
          continue;
        }

        if (data.get("report")) {
          const report = data.get("report");
          triggerId = report === "daily" ? "dailyReport" : report === "weekly" ? "weeklyReport" : "outstandingReport";
        } else if (data.get("action")) {
          const action = data.get("action");
          const advId = data.get("id") || "";
          variables = { advId };
          if (advId) {
            const advance: any = await getDocByIdOrField("advances", advId, "advId");
            if (advance?.id) {
              await firestoreDb.collection("advances").doc(advance.id).set({
                status: action === "approve" ? "WAITING_TRANSFER" : "REJECTED",
                lineActionAt: FieldValue.serverTimestamp(),
                lineActionBy: event.source?.userId || "",
              }, { merge: true });
            }
          }
          triggerId = action === "approve" ? "onManagerApproval" : "onReject";
        }

        const trigger = triggers.find((t: any) => t.id === triggerId && t.isActive);
        if (!trigger) continue;
        const resolvedVariables = await enrichLineVariables(variables, lineConfig);
        const messagePayload = createLineMessagePayload(trigger, resolvedVariables);

        const lineRes = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [messagePayload]
          })
        });
        replies.push({ triggerId, status: lineRes.status, response: await lineRes.text() });
      }

      return res.json({ status: "success", replies });
    } catch (err: any) {
      console.error("LINE webhook error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during LINE webhook." });
    }
  });

  app.get("/api/google-workspace/report/pending-approval", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const report = await buildPendingApprovalReport(String(req.query.date || ""));
      return res.json({ status: "success", report });
    } catch (err: any) {
      console.error("Pending approval report error:", err);
      return res.status(500).json({ error: err?.message || "Cannot load pending approval report." });
    }
  });

  app.get("/api/google-workspace/report/daily", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const report = await buildPendingApprovalReport(String(req.query.date || ""));
      return res.json({ status: "success", report });
    } catch (err: any) {
      console.error("Daily report error:", err);
      return res.status(500).json({ error: err?.message || "Cannot load daily report." });
    }
  });

  app.post("/api/google-workspace/advance-sync", async (req, res) => {
    try {
      const { config, payload } = req.body || {};
      if (!config?.appsScriptWebAppUrl) {
        return res.status(400).json({ error: "Missing appsScriptWebAppUrl" });
      }

      const scriptResponse = await fetch(config.appsScriptWebAppUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: config.appsScriptApiKey || "",
          action: "syncAdvanceBundle",
          mirrorAdvancesEnabled: config.mirrorAdvancesEnabled !== false,
          mirrorVaultFilesEnabled: config.mirrorVaultFilesEnabled !== false,
          payload,
        }),
      });

      const text = await scriptResponse.text();
      if (!scriptResponse.ok) {
        return res.status(scriptResponse.status).send(text || "Apps Script sync failed");
      }

      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    } catch (err: any) {
      console.error("Google Workspace advance sync error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during Apps Script sync." });
    }
  });

  app.post("/api/google-workspace/test-connection", async (req, res) => {
    const result = await runMirrorAction("testConnection", req.body || {}, { collectionName: "settings" });
    return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
  });

  app.post("/api/google-workspace/sync-collection", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const collectionName = String(req.body?.collectionName || "").trim();
      if (!collectionName) return res.status(400).json({ error: "Missing collectionName" });
      const rows = await loadCollectionRows(collectionName);
      const result = await runMirrorAction("syncCollectionToGoogleSheet", {
        collectionName,
        mirrorType: mirrorCollections.includes(collectionName) ? "core" : "raw",
        rows,
      }, { collectionName });
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "syncCollectionToGoogleSheet", collectionName: req.body?.collectionName || "", status: "FAILED", errorMessage: err?.message || String(err), requestPayload: req.body });
      return res.status(500).json({ error: err?.message || "Cannot sync collection." });
    }
  });

  app.post("/api/google-workspace/sync-all", async (_req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const collections: Record<string, any[]> = {};
      for (const collectionName of mirrorCollections) {
        collections[collectionName] = await loadCollectionRows(collectionName);
      }
      const result = await runMirrorAction("syncFullFirestoreToGoogleSheet", { collections, collectionNames: mirrorCollections }, { collectionName: "*" });
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "syncFullFirestoreToGoogleSheet", collectionName: "*", status: "FAILED", errorMessage: err?.message || String(err) });
      return res.status(500).json({ error: err?.message || "Cannot sync all collections." });
    }
  });

  app.post("/api/google-workspace/sync-advance-bundle", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const advId = String(req.body?.advId || "").trim();
      if (!advId) return res.status(400).json({ error: "Missing advId" });
      const advance: any = await getDocByIdOrField("advances", advId, "advId");
      if (!advance) return res.status(404).json({ error: "Advance not found." });
      const vaultFilesSnap = await firestoreDb.collection("vaultFiles").where("advId", "==", advance.advId || advId).get();
      const clearingLogsSnap = await firestoreDb.collection("clearingLogs").where("advId", "==", advance.advId || advId).get();
      const payload = {
        advId,
        advance,
        vaultFiles: vaultFilesSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
        clearingLogs: clearingLogsSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
      };
      const result = await runMirrorAction("syncAdvanceBundleToGoogleWorkspace", payload, { collectionName: "advances", documentId: advance.id });
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "syncAdvanceBundleToGoogleWorkspace", collectionName: "advances", status: "FAILED", errorMessage: err?.message || String(err), requestPayload: req.body });
      return res.status(500).json({ error: err?.message || "Cannot sync advance bundle." });
    }
  });

  app.post("/api/google-workspace/sync-clearance-bundle", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const clrId = String(req.body?.clrId || req.body?.clearingLogId || "").trim();
      if (!clrId) return res.status(400).json({ error: "Missing clrId" });
      const clearance: any = await getDocByIdOrField("clearingLogs", clrId, "clearingNo");
      if (!clearance) return res.status(404).json({ error: "Clearance not found." });
      const itemsSnap = await firestoreDb.collection("clearingItems").where("clearingLogId", "==", clearance.id).get();
      const payload = {
        clrId,
        clearance,
        items: itemsSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
      };
      const result = await runMirrorAction("syncClearanceBundleToGoogleWorkspace", payload, { collectionName: "clearingLogs", documentId: clearance.id });
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "syncClearanceBundleToGoogleWorkspace", collectionName: "clearingLogs", status: "FAILED", errorMessage: err?.message || String(err), requestPayload: req.body });
      return res.status(500).json({ error: err?.message || "Cannot sync clearance bundle." });
    }
  });

  app.post("/api/google-workspace/save-files", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const result = await runMirrorAction("saveFiles", req.body || {}, { collectionName: "vaultFiles" });
      const savedFiles = result.responsePayload?.files || result.responsePayload?.savedFiles || [];
      if (result.ok && Array.isArray(savedFiles)) {
        for (const file of savedFiles) {
          const fileId = file.vaultFileId || file.id || file.fileId;
          if (!fileId) continue;
          await firestoreDb.collection("vaultFiles").doc(String(fileId)).set({
            driveFileId: file.driveFileId || file.id || "",
            driveUrl: file.driveUrl || file.driveFileUrl || file.webViewLink || "",
            driveFileUrl: file.driveUrl || file.driveFileUrl || file.webViewLink || "",
            syncStatus: "SUCCESS",
            syncUpdatedAt: new Date().toISOString(),
            sourceUrl: file.sourceUrl || file.fileUrl || "",
            fileName: file.fileName || "",
            fileType: file.fileType || "",
            advId: file.advId || "",
            clrId: file.clrId || "",
            uploadedBy: file.uploadedBy || "",
            uploadedAt: file.uploadedAt || new Date().toISOString(),
            errorMessage: "",
          }, { merge: true });
        }
      }
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "saveFiles", collectionName: "vaultFiles", status: "FAILED", errorMessage: err?.message || String(err), requestPayload: req.body });
      return res.status(500).json({ error: err?.message || "Cannot save files to Google Drive." });
    }
  });

  app.post("/api/google-workspace/refresh-reports", async (req, res) => {
    const result = await runMirrorAction("refreshGoogleSheetReports", req.body || {}, { collectionName: "settings" });
    return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
  });

  app.post("/api/google-workspace/retry-failed-sync", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const logId = String(req.body?.logId || "").trim();
      if (!logId) return res.status(400).json({ error: "Missing logId" });
      const logSnap = await firestoreDb.collection("mirrorSyncLogs").doc(logId).get();
      if (!logSnap.exists) return res.status(404).json({ error: "Sync log not found." });
      const log = logSnap.data() || {};
      const result = await runMirrorAction(log.action || "syncCollectionToGoogleSheet", log.requestPayload || {}, { retryOf: logId, collectionName: log.collectionName || "" });
      return res.status(result.ok ? 200 : result.status || 500).json(result.responsePayload);
    } catch (err: any) {
      await writeMirrorSyncLog({ action: "retryFailedSync", status: "FAILED", errorMessage: err?.message || String(err), requestPayload: req.body });
      return res.status(500).json({ error: err?.message || "Cannot retry failed sync." });
    }
  });

  // API Route for Google OAuth Token (Placeholder for Workspace Sync)
  app.get("/api/oauth/token", (req, res) => {
    // In this environment, the token is typically managed via Firebase Auth on the client.
    // This endpoint acts as a bridge or placeholder.
    // If a specific GOOGLE_ACCESS_TOKEN was provided in env, return it.
    const token = process.env.GOOGLE_ACCESS_TOKEN || null;
    res.json({ access_token: token });
  });

  // API Route for Google Picker Configuration
  app.get("/api/oauth/picker-config", (req, res) => {
    res.json({
      apiKey: process.env.GOOGLE_PICKER_API_KEY || "",
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ""
    });
  });

  // 404 handler for unmatched API routes to prevent falling through to Vite/SPA index.html
  app.use("/api", (req, res, next) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global Error Handler to return JSON instead of HTML on error for all API requests
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error caught in server.ts:", err);
    if (req.originalUrl && req.originalUrl.startsWith("/api")) {
      return res.status(err.status || 500).json({ 
        status: "error", 
        error: err.message || "Internal Server Error" 
      });
    }
    next(err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
