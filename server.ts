import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { performServerAIOCR } from "./src/server/gemini";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { initializeApp as initClientApp } from "firebase/app";
import { 
  getFirestore as getClientFirestore, 
  doc as clientDoc, 
  getDoc as clientGetDoc, 
  setDoc as clientSetDoc, 
  updateDoc as clientUpdateDoc, 
  collection as clientCollection, 
  query as clientQuery, 
  where as clientWhere, 
  limit as clientLimit, 
  getDocs as clientGetDocs, 
  serverTimestamp as clientServerTimestamp 
} from "firebase/firestore";
import multer from "multer";

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

// 1. Initialize Firebase Admin SDK (used primarily for bucket/storage if permitted)
try {
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
} catch (e: any) {
  console.warn("Firebase Admin SDK initialization skipped or failed. Serving local file uploads fallback:", e?.message || e);
  bucket = null;
}

// 2. Initialize Firebase Client SDK on Node.js to act as a 100% reliable, rule-permitted Firestore bridge
try {
  const clientApp = initClientApp(firebaseConfig);
  const dbId = firebaseConfig.firestoreDatabaseId || "ai-studio-remixclearadvanc-17d5f5ae-d1c1-4457-bef4-365e55fd21aa";
  const clientDb = getClientFirestore(clientApp, dbId);

  // Implement high-fidelity compatibility wrapper matching Firebase Admin Firestore queries
  firestoreDb = {
    collection(collectionName: string) {
      return {
        doc(docId?: string) {
          const resolvedDocId = docId || clientDoc(clientCollection(clientDb, collectionName)).id;
          const docRef = clientDoc(clientDb, collectionName, resolvedDocId);
          return {
            id: resolvedDocId,
            async get() {
              const snap = await clientGetDoc(docRef);
              return {
                exists: snap.exists(),
                id: snap.id,
                data: () => snap.data(),
              };
            },
            async set(data: any, options?: { merge?: boolean }) {
              await clientSetDoc(docRef, data, options);
            },
            async update(data: any) {
              await clientUpdateDoc(docRef, data);
            }
          };
        },
        where(field: string, op: any, value: any) {
          const constraints: any[] = [clientWhere(field, op, value)];
          return {
            where(f2: string, o2: any, v2: any) {
              constraints.push(clientWhere(f2, o2, v2));
              return this;
            },
            limit(limitVal: number) {
              constraints.push(clientLimit(limitVal));
              return this;
            },
            async get() {
              const q = clientQuery(clientCollection(clientDb, collectionName), ...constraints);
              const querySnap = await clientGetDocs(q);
              const docs = querySnap.docs.map(snap => ({
                id: snap.id,
                data: () => snap.data(),
              }));
              return {
                empty: querySnap.empty,
                size: querySnap.size,
                docs,
                forEach(callback: (doc: any) => void) {
                  docs.forEach(callback);
                }
              };
            }
          };
        },
        async get() {
          const querySnap = await clientGetDocs(clientCollection(clientDb, collectionName));
          const docs = querySnap.docs.map(snap => ({
            id: snap.id,
            data: () => snap.data(),
          }));
          return {
            empty: querySnap.empty,
            size: querySnap.size,
            docs,
            forEach(callback: (doc: any) => void) {
              docs.forEach(callback);
            }
          };
        }
      };
    }
  };
  console.log("SUCCESS: Client-based Firestore bridge initialized successfully on the server!");
} catch (e: any) {
  console.error("CRITICAL ERROR: Failed to initialize client-based Firestore bridge on the server:", e?.message || e);
  firestoreDb = null;
}

// 3. Define FieldValue for serverTimestamp mapping
const FieldValue = {
  serverTimestamp() {
    return clientServerTimestamp();
  }
};

// Local directory for storing profile photos to bypass Cloud Storage permission issues
const PROFILES_DIR = path.join(process.cwd(), "profiles");
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
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

const getPublicBaseUrl = (lineConfig?: any) => {
  const productionBaseUrl = "https://let-s-me-clear-599121738708.asia-southeast1.run.app";
  const rawUrl = lineConfig?.appBaseUrl || process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || process.env.VERCEL_URL || productionBaseUrl;
  
  // LINE requires https for all URIs. 
  let normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  
  // Force https if it's not localhost
  if (!normalized.includes("localhost") && normalized.startsWith("http://")) {
    normalized = normalized.replace("http://", "https://");
  }
  
  // Final fallback if something is weird
  if (normalized === "http://localhost:3000" && process.env.NODE_ENV === "production") {
    normalized = productionBaseUrl;
  }
  
  return normalized.replace(/\/$/, "");
};

const absolutizeUrl = (url?: string, lineConfig?: any) => {
  if (!url) return "";
  if (url.startsWith("data:")) return "";
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://")) {
    // Force https for LINE compatibility if not localhost
    if (!url.includes("localhost")) return url.replace("http://", "https://");
    return url;
  }
  if (url.startsWith("/")) return `${getPublicBaseUrl(lineConfig)}${url}`;
  // If it's a relative path without leading slash
  if (!url.includes("://")) return `${getPublicBaseUrl(lineConfig)}/${url}`;
  return url;
};

const buildDbProfileImageUrl = (employeeId?: string, updatedAt?: any, lineConfig?: any) => {
  if (!employeeId) return "";
  const version = typeof updatedAt?.toMillis === "function"
    ? updatedAt.toMillis()
    : updatedAt?.seconds || updatedAt || "";
  const suffix = version ? `?v=${encodeURIComponent(String(version))}` : "";
  return `${getPublicBaseUrl(lineConfig)}/api/profile-image/${encodeURIComponent(employeeId)}${suffix}`;
};

const resolveProfileImageUrl = (employee?: any, preferredUrl?: string, lineConfig?: any) => {
  const absolutePreferred = absolutizeUrl(preferredUrl, lineConfig);
  if (absolutePreferred) return absolutePreferred;
  const absolutePhotoUrl = absolutizeUrl(employee?.profilePhotoURL || employee?.photoURL || employee?.avatarUrl, lineConfig);
  if (absolutePhotoUrl) return absolutePhotoUrl;
  if (employee?.profileImage && (employee?.id || employee?.employeeId)) {
    return buildDbProfileImageUrl(employee.id || employee.employeeId, employee.profilePhotoUpdatedAt || employee.updatedAt, lineConfig);
  }
  return "https://placehold.co/400x400/00A5E0/FFFFFF.png?text=Profile";
};

const getDocByIdOrField = async (collectionName: string, idOrValue?: string, fieldName?: string) => {
  if (!firestoreDb || !idOrValue) return null;
  
  // Create a list of promises to try finding the document
  const lookups: Promise<any>[] = [];
  
  // 1. Direct ID lookup
  lookups.push(firestoreDb.collection(collectionName).doc(idOrValue).get().then(snap => snap.exists ? { id: snap.id, ...snap.data() } : null));

  // 2. Collection specific lookups
  if (collectionName === "advances") {
    lookups.push(firestoreDb.collection("advances").where("advId", "==", idOrValue).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null));
    lookups.push(firestoreDb.collection("advances").where("advanceNo", "==", idOrValue).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null));
    lookups.push(firestoreDb.collection("advances").where("documentNo", "==", idOrValue).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null));
    lookups.push(firestoreDb.collection("advances").where("requestNo", "==", idOrValue).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null));
  }

  // 3. Field name lookup
  if (fieldName) {
    lookups.push(firestoreDb.collection(collectionName).where(fieldName, "==", idOrValue).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null));
  }

  const results = await Promise.all(lookups);
  return results.find(r => r !== null) || null;
};

const findAdvanceForLiff = async (documentId: string) => {
  if (!documentId) return null;
  const fields = ["docId", "advId", "advanceNo", "documentNo", "id", "requestNo"];
  
  // Try direct lookup first
  let advance = await getDocByIdOrField("advances", documentId);
  if (advance) return advance;

  // Try field lookups
  for (const field of fields) {
    advance = await firestoreDb.collection("advances").where(field, "==", documentId).limit(1).get().then(snap => !snap.empty ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null);
    if (advance) return advance;
  }

  return null;
};

const replaceVariables = (template: string, vars: Record<string, any>): string => {
  let result = template || "";
  for (const [key, val] of Object.entries(vars)) {
    // Escape special characters in key just in case, though they are usually standard
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`{${escapedKey}}`, "g"), String(val ?? ""));
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

const validateFlexPayload = (obj: any): any => {
  if (obj === null || obj === undefined) return "";
  if (Array.isArray(obj)) return obj.map(validateFlexPayload);
  if (typeof obj === "object") {
    const newObj = { ...obj };
    for (const [key, value] of Object.entries(newObj)) {
      if (key === "uri" || key === "url") {
        if (typeof value === "string") {
          let targetUrl = value.trim();
          
          // Force https for LINE compatibility (except localhost)
          if (targetUrl.startsWith("http://") && !targetUrl.includes("localhost")) {
            targetUrl = targetUrl.replace("http://", "https://");
          } else if (targetUrl.startsWith("/")) {
            targetUrl = `${getPublicBaseUrl()}${targetUrl}`;
          }
          
          // Final validation for LINE
          if (!targetUrl || 
              targetUrl.includes("{") || 
              targetUrl.includes("}") || 
              (targetUrl.includes("liff.line.me/") && !targetUrl.split("liff.line.me/")[1]?.split(/[?#]/)[0])) {
            console.warn(`Invalid URL detected in LINE payload: "${value}" -> "${targetUrl}". Replacing with placeholder.`);
            newObj[key] = "https://placehold.co/100x100/png?text=Invalid_URL";
          } else {
            newObj[key] = targetUrl;
          }
        } else {
          // If uri/url is not a string, it's definitely invalid for LINE
          newObj[key] = "https://placehold.co/100x100/png?text=Invalid_Type";
        }
      } else if (key === "text" && (value === "" || value === null || value === undefined)) {
        newObj[key] = " "; // LINE 'text' cannot be empty
      } else {
        newObj[key] = validateFlexPayload(value);
      }
    }
    return newObj;
  }
  return obj;
};

const createLineMessagePayload = (trigger: any, variables: Record<string, any>) => {
  let payload: any;
  if (trigger.type === "flex") {
    const templateJson = parseLineTemplate(trigger.messageTemplate);
    const resolvedJson = validateFlexPayload(normalizeLineLiffActions(replaceVariablesInObject(templateJson, variables), variables));
    let contents = resolvedJson?.type === "flex" && resolvedJson.contents
      ? resolvedJson.contents
      : resolvedJson?.contents || resolvedJson;

    // Ensure contents is a valid bubble or carousel
    if (Array.isArray(contents)) {
      contents = {
        type: "carousel",
        contents: contents
      };
    } else if (contents && typeof contents === "object" && !contents.type) {
      contents.type = "bubble";
    }

    payload = {
      type: "flex",
      altText: (replaceVariables(trigger.altText || "ClearAdvance แจ้งเตือน {advId}", variables) || "ClearAdvance Notification").substring(0, 400),
      contents,
    };
    if (resolvedJson?.quickReply && Array.isArray(resolvedJson.quickReply.items) && resolvedJson.quickReply.items.length > 0) {
      // Validate quickReply items
      const validItems = resolvedJson.quickReply.items.filter((item: any) => {
        return item && item.type === "action" && item.action && (item.action.type === "postback" || item.action.type === "uri" || item.action.type === "message");
      });
      if (validItems.length > 0) {
        payload.quickReply = { items: validItems.slice(0, 13) }; // LINE allows up to 13 items
      }
    }
  } else {
    let text = replaceVariables(trigger.messageTemplate || "", variables);
    if (!text || text.trim() === "") text = "ClearAdvance Notification (No content)";
    payload = {
      type: "text",
      text: text,
    };
  }

  // Validate that no placeholders are left unreplaced in the resolved payload
  const payloadStr = JSON.stringify(payload);
  const matched = payloadStr.match(/\{id\}|\{advId\}|\{documentId\}|\{date\}|\{LIFF_ID\}|\{liffId\}/i);
  if (matched) {
    console.warn("Placeholders left in LINE payload:", matched[0]);
    // Try one last pass with common defaults if possible, otherwise it will be cleaned by string replace below
  }
  
  // Final safety: strip any remaining common placeholders to avoid 400 error from LINE
  // Also ensures that values are strings for string-only fields
  const finalPayloadStr = payloadStr
    .replace(/\{liffId\}/gi, String(variables.liffId || ""))
    .replace(/\{advId\}/gi, String(variables.advId || ""))
    .replace(/\{id\}/gi, String(variables.advId || ""))
    .replace(/\{docId\}/gi, String(variables.advId || ""))
    .replace(/\{documentId\}/gi, String(variables.advId || ""));

  const finalPayload = JSON.parse(finalPayloadStr);
  
  // Last check for Flex contents validity
  if (finalPayload.type === "flex") {
    if (!finalPayload.contents || typeof finalPayload.contents !== "object") {
       console.error("Invalid Flex contents detected after resolution:", finalPayload.contents);
       return { type: "text", text: finalPayload.altText || "Notification (Payload Error)" };
    }
    // Deep check for empty URIs which cause 400
    const checkUris = (o: any) => {
       if (!o || typeof o !== "object") return;
       if (Array.isArray(o)) { o.forEach(checkUris); return; }
       for (const [k, v] of Object.entries(o)) {
          if ((k === "uri" || k === "url") && (v === "" || v === null || v === undefined)) {
             o[k] = "https://placehold.co/100x100/png?text=Empty_URL";
          } else if (typeof v === "object") {
             checkUris(v);
          }
       }
    };
    checkUris(finalPayload.contents);
  }

  return finalPayload;
};

const getLineSettings = async () => {
  const settingsSnap = await firestoreDb.collection("settings").doc("global").get();
  if (!settingsSnap.exists) return null;
  return settingsSnap.data()?.lineMessagingConfig || null;
};

const buildLiffUrl = (lineConfig: any, advId?: string) => {
  const cleanAdvId = encodeURIComponent(String(advId || "").trim());
  
  if (lineConfig?.uploadSlipUrlTemplate) {
    return lineConfig.uploadSlipUrlTemplate
      .replace(/{advId}/g, cleanAdvId)
      .replace(/{id}/g, cleanAdvId)
      .replace(/{docId}/g, cleanAdvId)
      .replace(/{documentId}/g, cleanAdvId);
  }

  const liffId = String(lineConfig?.liffId || "").trim();
  const liffIdPattern = /^[0-9]+-[A-Za-z0-9_-]+$/;
  if (liffId && liffIdPattern.test(liffId) && liffId !== "123456-abcde") {
    return `https://liff.line.me/${liffId}?route=upload-slip&adv_id=${cleanAdvId}`;
  }
  
  const productionBaseUrl = "https://let-s-me-clear-599121738708.asia-southeast1.run.app";
  const baseUrl = lineConfig?.appBaseUrl || process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || productionBaseUrl;
  
  return `${baseUrl.replace(/\/$/, "")}/liff/upload-slip?route=upload-slip&adv_id=${cleanAdvId}`;
};

const buildLiffActionUrl = (lineConfig: any, advId?: string, action?: string) => {
  const cleanAdvId = encodeURIComponent(String(advId || "").trim());
  const cleanAction = encodeURIComponent(String(action || "").trim());

  if (action === "approve" && lineConfig?.approveUrlTemplate) {
    return lineConfig.approveUrlTemplate
      .replace(/{advId}/g, cleanAdvId)
      .replace(/{id}/g, cleanAdvId);
  }
  if (action === "reject" && lineConfig?.rejectUrlTemplate) {
    return lineConfig.rejectUrlTemplate
      .replace(/{advId}/g, cleanAdvId)
      .replace(/{id}/g, cleanAdvId);
  }

  const liffId = String(lineConfig?.liffId || "").trim();
  const liffIdPattern = /^[0-9]+-[A-Za-z0-9_-]+$/;
  if (liffId && liffIdPattern.test(liffId) && liffId !== "123456-abcde" && liffId !== "{LIFF_ID}") {
    return `https://liff.line.me/${liffId}?route=action&action=${cleanAction}&adv_id=${cleanAdvId}`;
  }

  const baseUrl = getPublicBaseUrl(lineConfig);

  return `${baseUrl.replace(/\/$/, "")}/liff/action?route=action&action=${cleanAction}&adv_id=${cleanAdvId}`;
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
  const advance: any = await getDocByIdOrField("advances", advId, "advId");
  if (!advance) return null;
  const employeeId = advance.employeeId || advance.requesterId || advance.userId;
  const employee: any = await getDocByIdOrField("employees", employeeId, "employeeId");
  const bankInfo = getEmployeeBankInfo(advance, employee);
  return {
    id: advance.id,
    advId: advance.advId || advance.advanceNo || advance.id,
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
  const advId = variables.advId || variables.advanceId || variables.id;
  const advance: any = await getDocByIdOrField("advances", advId, "advId");
  if (advance) {
    variables.advId = advance.advId || advance.advanceNo || advance.id;
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

  // Ensure variables always include these key aliases as requested
  if (variables.advId) {
    variables.id = variables.advId;
    variables.docId = variables.advId;
    variables.documentId = variables.advId;
  }

  const employee: any = await getDocByIdOrField("employees", variables.employeeId || variables.targetEmployeeId, "employeeId");
  if (employee) {
    variables.employeeName = variables.employeeName || employee.name || employee.fullName || `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
    variables.employeeId = variables.employeeId || employee.id || employee.employeeId;
    variables.profileImageUrl = resolveProfileImageUrl(employee, variables.profileImageUrl, lineConfig);
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
  
  // Add liffId to variables so it can be used in templates
  const configuredLiffId = String(lineConfig?.liffId || "").trim();
  variables.liffId = (configuredLiffId && configuredLiffId !== "123456-abcde" && configuredLiffId !== "{LIFF_ID}") 
    ? configuredLiffId 
    : "";

  variables.liffSlipUrl = variables.liffSlipUrl || buildLiffUrl(lineConfig, variables.advId);
  variables.liffActionApproveUrl = variables.liffActionApproveUrl || buildLiffActionUrl(lineConfig, variables.advId, "approve");
  variables.liffActionRejectUrl = variables.liffActionRejectUrl || buildLiffActionUrl(lineConfig, variables.advId, "reject");
  variables.profileImageUrl = resolveProfileImageUrl(null, variables.profileImageUrl, lineConfig) || "https://placehold.co/320x320/png?text=Profile";
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

const selectLineRecipients = (allEmployees: any[], trigger: any, variables: Record<string, any>, targetEmployeeId?: string, lineConfig?: any) => {
  const recipientIdsSet = new Set<string>();
  const mode = trigger.recipientMode || "target";
  const targetIds = new Set([targetEmployeeId, variables.targetEmployeeId, variables.employeeId, variables.requesterId].filter(Boolean).map(String));
  const roles = new Set<string>(trigger.recipientRoles || []);
  const accountingRoles = new Set(["Accountant", "Accounting", "Admin"]);
  const approverRoles = roles.size ? roles : new Set(["Manager", "Admin"]);

  if (trigger.sendToUsers !== false) {
    allEmployees.forEach((emp) => {
      if (!emp.lineUserId || !emp.lineUserId.startsWith("U")) {
        console.log(`SKIPPED_NO_LINE_USER_ID: { name: "${emp.name || emp.fullName || 'Unknown'}", role: "${emp.role || 'Unknown'}", id: "${emp.id || 'Unknown'}" }`);
        return;
      }
      const empIds = [emp.id, emp.employeeId, emp.uid, emp.userId].filter(Boolean).map(String);
      const isTarget = empIds.some((id) => targetIds.has(id));
      if (mode === "all") recipientIdsSet.add(emp.lineUserId);
      if (mode === "target" && isTarget) recipientIdsSet.add(emp.lineUserId);
      if (mode === "requester" && isTarget) recipientIdsSet.add(emp.lineUserId);
      if (mode === "accounting" && accountingRoles.has(emp.role)) recipientIdsSet.add(emp.lineUserId);
      if (mode === "approvers") {
         if (trigger.useApprovalWorkflowRules && variables.requiredApproverRole) {
           if (emp.role === variables.requiredApproverRole) recipientIdsSet.add(emp.lineUserId);
         } else if (approverRoles.has(emp.role)) {
           recipientIdsSet.add(emp.lineUserId);
         }
      }
      if (trigger.alsoSendToRequester && isTarget) {
        recipientIdsSet.add(emp.lineUserId);
      }
    });
  }

  if (trigger.sendToGroup !== false) {
    if (lineConfig?.enableGroupNotification && lineConfig?.groupId && typeof lineConfig.groupId === "string" && lineConfig.groupId.trim()) {
      recipientIdsSet.add(lineConfig.groupId.trim());
    } else if (lineConfig?.lineGroupId && typeof lineConfig.lineGroupId === "string" && lineConfig.lineGroupId.trim()) {
      recipientIdsSet.add(lineConfig.lineGroupId.trim());
    }
  }

  return Array.from(recipientIdsSet);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  // Debug endpoint for Firebase info
  app.get("/api/debug/firebase-info", (req, res) => {
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      const firebaseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
      res.json({
        projectId: firebaseConfig.projectId,
        storageBucket: firebaseConfig.storageBucket,
        firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
        hasFirestoreAdmin: !!adminAppInstance,
        hasBucket: !!bucket
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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

      const recipients = selectLineRecipients(allEmployees, trigger, resolvedVariables, targetEmployeeId, lineConfig);
      if (recipients.length === 0) {
        console.log("No recipients found with a registered LINE User ID.");
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
      for (const userId of recipients) {
        try {
          const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${channelAccessToken.trim()}`
            },
            body: JSON.stringify({
              to: userId,
              messages: [messagePayload]
            })
          });

          const resText = await lineRes.text();
          console.log(`LINE API response for ${userId}:`, lineRes.status, resText);
          if (lineRes.status === 400) {
            console.log(`USER_NOT_FRIEND_OR_INVALID_LINE_ID for user: ${userId}`);
          }
          results.push({ userId, status: lineRes.status, response: resText });
        } catch (fetchErr: any) {
          console.error(`Fetch error sending to LINE user ${userId}:`, fetchErr);
          results.push({ userId, status: "error", error: fetchErr.message });
        }
      }

      return res.json({ status: "success", recipientsSent: recipients.length, variables: resolvedVariables, results });
    } catch (err: any) {
      console.error("Send LINE Notification error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during notification dispatch." });
    }
  });

  app.get("/api/line/liff-advance/:advId", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const advId = req.params.advId;
      const advance = await getAdvanceForLine(advId);
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
      const { advId, action, userId, displayName } = req.body || {};
      if (!advId || !["approve", "reject", "approve_clearance", "reject_clearance"].includes(action)) {
        return res.status(400).json({ error: "Missing advId or invalid action." });
      }

      const advance: any = await getDocByIdOrField("advances", advId, "advId");
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      if (["approve", "reject"].includes(action) && ["WAITING_TRANSFER", "WAITING_CLEARANCE", "CLOSED", "REJECTED"].includes(advance.status)) {
         return res.status(400).json({ error: `รายการนี้อยู่ในสถานะ ${advance.status} ไม่สามารถดำเนินการอนุมัติซ้ำได้` });
      }
      if (["approve_clearance", "reject_clearance"].includes(action) && ["CLOSED", "REJECTED", "RETURNED", "SUBMITTED", "PENDING_APPROVAL", "DRAFT"].includes(advance.status)) {
         return res.status(400).json({ error: `รายการนี้อยู่ในสถานะ ${advance.status} ไม่สามารถอนุมัติเคลียร์ยอดได้` });
      }

      let approverName = displayName || "LINE LIFF";
      let hasPermission = false;
      let approverRole = "";
      let denyReason = "ไม่มีสิทธิ์อนุมัติรายการนี้";

      if (!userId) {
        return res.status(403).json({
          error: "LINE_ACCOUNT_NOT_LINKED",
          message: "กรุณาเข้าสู่ระบบด้วย PIN หนึ่งครั้งเพื่อเชื่อมบัญชี LINE"
        });
      } else {
        let approverDoc: any = null;
        const approverSnap = await firestoreDb.collection("employees").where("lineUserId", "==", userId).limit(1).get();
        if (!approverSnap.empty) {
          approverDoc = approverSnap.docs[0];
        } else if (userId.startsWith("U")) {
          const docRef = firestoreDb.collection("employees").doc(userId);
          const docSnap = await docRef.get();
          if (docSnap.exists) {
            approverDoc = docSnap;
          }
        }

        if (!approverDoc) {
          return res.status(403).json({
            error: "LINE_ACCOUNT_NOT_LINKED",
            message: "กรุณาเข้าสู่ระบบด้วย PIN หนึ่งครั้งเพื่อเชื่อมบัญชี LINE"
          });
        } else {
          const approver = approverDoc.data();
          const approverId = approverDoc.id;
          approverName = approver.name || approver.fullName || approver.lineDisplayName || approverName;
          approverRole = approver.role;
          
          // Role Normalization
          const roleIdMap: Record<string, string> = {
            "Admin": "admin",
            "Manager": "manager",
            "Accountant": "accountant",
            "Employee": "employee",
            "PM": "pm"
          };
          const approverRoleId = roleIdMap[approverRole] || approverRole?.toLowerCase() || "";

          // Load Approval Workflow Rules
          const globalSettingsSnap = await firestoreDb.collection("settings").doc("global").get();
          const workflow = globalSettingsSnap.data()?.approvalWorkflow || {};
          const rules = workflow.rules || [];

          if (rules.length === 0 || !rules.some((r: any) => r.isActive)) {
             denyReason = "ไม่มีกฎอนุมัติที่เปิดใช้งาน ระบบจะไม่อนุญาตให้ใครอนุมัติผ่าน LINE LIFF";
          } else {
            // Find Matching Rule
            const amount = Number(advance.requestAmount || advance.amount || 0);
            const docType = action.includes("clearance") ? "CLEARING" : "ADVANCE";
            
            const matchingRules = rules.filter((rule: any) => {
              if (!rule.isActive) return false;
              
              // Support old and new schema
              const min = Number(rule.minAmount ?? 0);
              const max = Number(rule.maxAmount ?? 999999999);
              const ruleDocType = rule.documentType || "ADVANCE"; // Default to ADVANCE for old rules

              if (amount < min || amount > max) return false;
              if (ruleDocType !== "BOTH" && ruleDocType !== docType) return false;
              
              // Project Scope (New field)
              if (rule.projectScope === "specific_projects" && rule.projectId && rule.projectId !== advance.projectId) return false;

              return true;
            });

            if (matchingRules.length === 0) {
              denyReason = "ไม่มีกฎอนุมัติที่เปิดใช้งานสำหรับยอดเงินนี้";
            } else {
              // Check if approver is allowed in any matching rule
              const isAllowed = matchingRules.some((rule: any) => {
                // Support old approverRoles (Display Names) and new approverRoleIds
                const allowedRoles = rule.approverRoles || [];
                const allowedRoleIds = rule.approverRoleIds || [];
                const allowedPositionIds = rule.approverPositionIds || [];

                const roleMatch = allowedRoles.includes(approverRole) || allowedRoleIds.includes(approverRoleId);
                const positionMatch = allowedPositionIds.includes(approver.positionId || "");

                if (!roleMatch && !positionMatch) return false;

                // canApproveOwnRequest check
                if (rule.canApproveOwnRequest === false && approverId === advance.employeeId) {
                   return false;
                }

                // allowLineLiffApproval check (default to true if missing for backward compatibility)
                if (rule.allowLineLiffApproval === false) return false;

                return true;
              });

              if (isAllowed) {
                hasPermission = true;
              } else {
                // Check if it was own request
                const matchesOwnRequest = matchingRules.some((rule: any) => rule.canApproveOwnRequest === false && approverId === advance.employeeId);
                if (matchesOwnRequest) {
                  denyReason = "ไม่สามารถอนุมัติใบเบิกของตัวเองได้";
                } else {
                  denyReason = "ตำแหน่งนี้ไม่ได้อยู่ในรายชื่อผู้อนุมัติตามกฎ";
                }
              }
            }
          }
        }
      }

      if (!hasPermission) {
        return res.status(403).json({ error: denyReason });
      }

      const nowIso = new Date().toISOString();
      let updatePayload: any = {};
      if (action === "approve") {
        updatePayload = {
          status: "WAITING_TRANSFER",
          approvedAt: nowIso,
          approvedBy: approverName,
          lineActionAt: FieldValue.serverTimestamp(),
          lineActionBy: userId || approverName,
          lineActionSource: "liff",
        };
      } else if (action === "reject") {
        updatePayload = {
          status: "REJECTED",
          rejectedAt: nowIso,
          rejectedBy: approverName,
          lineActionAt: FieldValue.serverTimestamp(),
          lineActionBy: userId || approverName,
          lineActionSource: "liff",
        };
      } else if (action === "approve_clearance") {
        updatePayload = {
          status: "CLOSED",
          closedAt: nowIso,
          closedBy: approverName,
          lineActionAt: FieldValue.serverTimestamp(),
          lineActionBy: userId || approverName,
          lineActionSource: "liff",
        };
      } else if (action === "reject_clearance") {
        updatePayload = {
          status: "RETURNED",
          lineActionAt: FieldValue.serverTimestamp(),
          lineActionBy: userId || approverName,
          lineActionSource: "liff",
        };
      }

      await firestoreDb.collection("advances").doc(advance.id).set(updatePayload, { merge: true });

      // Step 1: Firestore Update (already done before this block)
      
      // Step 2: Audit Log
      try {
        const auditId = `audit-line-${Date.now()}-${advance.id}`;
        let auditActionType = "APPROVE_ADVANCE";
        let note = "อนุมัติผ่าน LINE LIFF";
        if (action === "reject") {
          auditActionType = "REJECT_ADVANCE";
          note = "ไม่อนุมัติผ่าน LINE LIFF";
        } else if (action === "approve_clearance") {
          auditActionType = "APPROVE_CLEARANCE";
          note = "อนุมัติเคลียร์ยอดผ่าน LINE LIFF";
        } else if (action === "reject_clearance") {
          auditActionType = "REJECT_CLEARANCE";
          note = "ปฏิเสธเคลียร์ยอดและตีกลับผ่าน LINE LIFF";
        }

        await firestoreDb.collection("auditLogs").doc(auditId).set({
          id: auditId,
          advId: advance.advId || advId,
          actionType: auditActionType,
          actionBy: approverName,
          role: approverRole || "LINE",
          timestamp: nowIso,
          beforeStatus: advance.status || "",
          afterStatus: updatePayload.status,
          note,
        }, { merge: true });
      } catch (e: any) {
        console.error("Step 1 Audit Log Error:", e.name, e.stack, { advId: advance.advId, action });
      }

      // Step 3: Timeline (lineActionLogs)
      try {
        const lineActionId = `line-action-${Date.now()}-${advance.id}`;
        let lineActionType = "APPROVE_ADVANCE";
        if (action === "reject") lineActionType = "REJECT_ADVANCE";
        else if (action === "approve_clearance") lineActionType = "APPROVE_CLEARANCE";
        else if (action === "reject_clearance") lineActionType = "REJECT_CLEARANCE";

        await firestoreDb.collection("lineActionLogs").doc(lineActionId).set({
          id: lineActionId,
          advId: advance.advId || advId,
          action: lineActionType,
          status: "SUCCESS",
          lineUserId: userId || "",
          employeeId: "",
          employeeName: approverName,
          role: approverRole || "LINE",
          source: "LINE_LIFF",
          timestamp: nowIso,
          requestPayload: JSON.parse(JSON.stringify(req.body))
        }, { merge: true });
      } catch (e: any) {
        console.error("Step 2 Timeline Error:", e.name, e.stack, { advId: advance.advId, action });
      }

      // Step 4: Notification Queue
      try {
        // Reserved for Notification Queue
      } catch (e: any) {
        console.error("Step 3 Notification Queue Error:", e.name, e.stack, { advId: advance.advId, action });
      }

      // Step 5: LINE Push
      try {
        // Reserved for LINE Push
      } catch (e: any) {
        console.error("Step 4 LINE Push Error:", e.name, e.stack, { advId: advance.advId, action });
      }

      // Step 6: LINE Reply
      try {
        // Reserved for LINE Reply
      } catch (e: any) {
        console.error("Step 5 LINE Reply Error:", e.name, e.stack, { advId: advance.advId, action });
      }

      const updatedAdvance = await getAdvanceForLine(advId);
      return res.json({ status: "success", action, advance: updatedAdvance });
    } catch (err: any) {
      console.error("LINE LIFF action error:", err);
      return res.status(500).json({ error: err.message || "Cannot update advance from LIFF." });
    }
  });

  app.post("/api/line/upload-slip", upload.single("slip"), async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const advId = req.body?.advId;
      if (!advId || !req.file) return res.status(400).json({ error: "Missing advId or slip file." });

      const advance: any = await getDocByIdOrField("advances", advId, "advId");
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      const extension = path.extname(req.file.originalname || "") || ".jpg";
      const safeAdvId = String(advId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `slip_${Date.now()}${extension}`;
      const filePath = `slips/${safeAdvId}/${filename}`;
      
      let downloadUrl = "";
      let uploadedToCloud = false;

      // Try saving to GCS if bucket is available
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
            downloadUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;
          }
          uploadedToCloud = true;
          console.log("Slip uploaded successfully to Firebase Storage (Cloud):", downloadUrl);
        } catch (gcsErr: any) {
          console.warn("Failed to upload slip to Cloud Storage, falling back to local storage:", gcsErr.message);
        }
      }

      // Local storage fallback
      if (!uploadedToCloud) {
        const localSubdir = path.join(PROFILES_DIR, `slips_${safeAdvId}`);
        if (!fs.existsSync(localSubdir)) {
          fs.mkdirSync(localSubdir, { recursive: true });
        }
        const localFilePath = path.join(localSubdir, filename);
        fs.writeFileSync(localFilePath, req.file.buffer);
        downloadUrl = `/api/profiles/slips_${safeAdvId}/${filename}`;
        console.log("Slip saved successfully to Local Storage (Fallback):", downloadUrl);
      }

      await firestoreDb.collection("advances").doc(advance.id).set({
        status: "WAITING_CLEARANCE",
        slipUrl: downloadUrl,
        transferSlipUrl: downloadUrl,
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

      const lineActionId = `line-action-slip-${Date.now()}-${advance.id}`;
      await firestoreDb.collection("lineActionLogs").doc(lineActionId).set({
        id: lineActionId,
        advId: advance.advId || advId,
        action: "UPLOAD_TRANSFER_SLIP",
        status: "SUCCESS",
        lineUserId: "",
        employeeId: "",
        employeeName: "LINE LIFF",
        role: "LINE",
        source: "LINE_LIFF",
        timestamp: new Date().toISOString(),
        requestPayload: { fileUploaded: true, fileName: req.file.originalname }
      }, { merge: true });

      return res.json({ status: "success", url: downloadUrl });
    } catch (err: any) {
      console.error("LINE LIFF slip upload error:", err);
      return res.status(500).json({ error: err.message || "Cannot upload slip from LIFF." });
    }
  });

  app.post("/api/cron/line-reports", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const lineConfig = await getLineSettings();
      if (!lineConfig || !lineConfig.channelAccessToken) {
        return res.json({ status: "skipped", message: "LINE config not found." });
      }

      const { type } = req.body || req.query; 

      if (!type) {
         return res.status(400).json({ error: "Missing report type (daily or weekly)" });
      }

      const empSnap = await firestoreDb.collection("employees").get();
      const allEmployees: any[] = [];
      empSnap.forEach((docSnap: any) => allEmployees.push({ id: docSnap.id, ...docSnap.data() }));

      const advSnap = await firestoreDb.collection("advances").where("status", "in", ["PENDING_APPROVAL", "WAITING_TRANSFER", "WAITING_CLEARANCE", "PENDING_AUDIT"]).get();
      const activeAdvances = advSnap.docs.map(doc => doc.data());

      let triggerId = type === "weekly" ? "weeklyReport" : "dailyReport";
      const trigger = (lineConfig.triggers || []).find((t: any) => t.id === triggerId);
      
      if (!trigger || !trigger.isActive) {
        return res.json({ status: "skipped", message: `Trigger ${triggerId} is disabled or not found` });
      }

      // Pre-calculate summary stats
      const pendingCount = activeAdvances.filter(a => a.status === "PENDING_APPROVAL").length;
      const transferCount = activeAdvances.filter(a => a.status === "WAITING_TRANSFER").length;
      const clearingCount = activeAdvances.filter(a => a.status === "WAITING_CLEARANCE").length;

      const summaryText = `[ยอดคงค้าง]\nรออนุมัติ: ${pendingCount} รายการ\nรอโอนเงิน: ${transferCount} รายการ\nรอเคลียร์: ${clearingCount} รายการ\n\nสามารถตรวจสอบรายการได้ที่ระบบ ClearAdvance`;

      const resolvedVariables = await enrichLineVariables({ 
        dailySummary: summaryText, 
        weeklySummary: summaryText,
        outstandingSummary: summaryText 
      }, lineConfig);

      const recipients = selectLineRecipients(allEmployees, trigger, resolvedVariables, undefined, lineConfig);

      let messagePayload: any = null;
      try {
        messagePayload = createLineMessagePayload(trigger, resolvedVariables);
      } catch (err: any) {
        return res.status(500).json({ error: "Template parse error", details: err.message });
      }

      const results: any[] = [];
      for (const userId of recipients) {
        try {
          const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}` },
            body: JSON.stringify({ to: userId, messages: [messagePayload] })
          });
          const resText = await lineRes.text();
          console.log(`LINE API response for ${userId} in cron:`, lineRes.status, resText);
          if (lineRes.status === 400) {
            console.log(`USER_NOT_FRIEND_OR_INVALID_LINE_ID for user: ${userId}`);
          }
          results.push({ userId, status: lineRes.status, response: resText });
        } catch (pushErr: any) {
          console.error(`Error sending push notification to user ${userId} in cron report:`, pushErr);
          results.push({ userId, status: "error", error: pushErr.message || String(pushErr) });
        }
      }

      return res.json({ status: "success", triggerId, recipientsSent: recipients.length, results });
    } catch (err: any) {
       console.error("Cron report error:", err);
       return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/line/test-notification", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      const { triggerId, targetEmployeeId = "test_user_id", sendToGroup, sendToUsers, variables = { advId: "ADV-TEST-0001", amount: 1500, requesterName: "Test User", purpose: "Test notification", dailySummary: "Test Daily Summary", weeklySummary: "Test Weekly Summary", outstandingSummary: "Test Outstanding", clearingAmount: 1500, settlementAmount: 0 } } = req.body;
      
      const lineConfig = await getLineSettings();
      if (!lineConfig) return res.status(404).json({ error: "Global settings not found" });

      if (triggerId === 'none') {
        const payload: any = { type: 'text', text: 'This is a test message from ClearAdvance PRO system.' };
        const results = [];
        const recipients = [];
        if (sendToGroup && lineConfig.groupId) {
           recipients.push(lineConfig.groupId);
        }
        for (const userId of recipients) {
          try {
            const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}` },
              body: JSON.stringify({ to: userId, messages: [payload] })
            });
            const resText = await lineRes.text();
            console.log(`LINE API response for ${userId} in none test:`, lineRes.status, resText);
            if (lineRes.status === 400) {
              console.log(`USER_NOT_FRIEND_OR_INVALID_LINE_ID for user: ${userId}`);
            }
            results.push({ userId, status: lineRes.status, response: resText });
          } catch (pushErr: any) {
            console.error(`Error sending push notification to user ${userId} in test-notification none:`, pushErr);
            results.push({ userId, status: "error", error: pushErr.message || String(pushErr) });
          }
        }
        return res.json({ status: "success", triggerFound: false, results, recipients });
      }

      const triggers = lineConfig.triggers || [];
      const trigger = triggers.find((t: any) => t.id === triggerId);
      if (!trigger) return res.status(404).json({ error: "Trigger not found" });

      const resolvedVariables = await enrichLineVariables({ ...variables, targetEmployeeId }, lineConfig);
      
      const empSnap = await firestoreDb.collection("employees").get();
      const allEmployees: any[] = [];
      empSnap.forEach((docSnap: any) => allEmployees.push({ id: docSnap.id, ...docSnap.data() }));

      const recipients = selectLineRecipients(allEmployees, trigger, resolvedVariables, targetEmployeeId, lineConfig);

      let messagePayload: any = null;
      try {
        messagePayload = createLineMessagePayload(trigger, resolvedVariables);
      } catch (err: any) {
        return res.status(500).json({ error: "Template parse error", details: err.message });
      }

      const results: any[] = [];
      for (const userId of recipients) {
        try {
          const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineConfig.channelAccessToken.trim()}` },
            body: JSON.stringify({ to: userId, messages: [messagePayload] })
          });
          const resText = await lineRes.text();
          console.log(`LINE API response for ${userId} in test-notification:`, lineRes.status, resText);
          if (lineRes.status === 400) {
            console.log(`USER_NOT_FRIEND_OR_INVALID_LINE_ID for user: ${userId}`);
          }
          results.push({ userId, status: lineRes.status, response: resText });
        } catch (pushErr: any) {
          console.error(`Error sending push notification to user ${userId} in test-notification:`, pushErr);
          results.push({ userId, status: "error", error: pushErr.message || String(pushErr) });
        }
      }

      res.json({
        status: "success",
        configFound: true,
        tokenFound: !!lineConfig.channelAccessToken,
        triggerFound: true,
        triggerActive: trigger.isActive,
        selectedRecipients: recipients,
        lineApiResults: results
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/line/send-linking-invitation", async (req, res) => {
    try {
      if (!firestoreDb) return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      
      const lineConfig = await getLineSettings();
      if (!lineConfig || !lineConfig.channelAccessToken) {
        return res.status(400).json({ error: "LINE Messaging is not configured (missing Channel Access Token)." });
      }

      const { employeeIds = [] } = req.body;
      if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ error: "No employees selected for invitation." });
      }

      const employeesToInvite: string[] = [];
      for (const id of employeeIds) {
        const docSnap = await firestoreDb.collection("employees").doc(id).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data && !data.lineUserId && data.isActive !== false) {
            employeesToInvite.push(data.name || "Unknown");
          }
        }
      }

      if (employeesToInvite.length === 0) {
        return res.status(400).json({ error: "All selected employees have already linked their LINE accounts, or are inactive." });
      }

      const liffId = String(lineConfig.liffId || "").trim();
      const liffUrl = `https://liff.line.me/${liffId}`;
      const groupId = (lineConfig.groupId || lineConfig.lineGroupId || "").trim();

      if (!groupId) {
        return res.status(400).json({ error: "LINE Group ID or Room ID is not configured." });
      }

      const messageText = `📢 แจ้งเตือนพนักงานที่ยังไม่ได้เชื่อมต่อ LINE ID กับระบบ ClearAdvance PRO\n\nกรุณากดลิงก์ด้านล่างเพื่อเชื่อมต่อบัญชี LINE ของท่านเข้ากับระบบ เพื่อความสะดวกและรวดเร็วในการส่งขอเบิก รับเงินโอน และอนุมัติใบเบิกโดยไม่ต้องใส่รหัสผ่านใหม่:\n\n🔗 ลิงก์เชื่อมต่อ: ${liffUrl}\n\nรายชื่อพนักงานที่ต้องดำเนินการเชื่อมบัญชี:\n${employeesToInvite.map(name => `• ${name}`).join("\n")}\n\nขอบคุณค่ะ/ครับ`;

      const messagePayload = {
        type: "text",
        text: messageText
      };

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

      const resText = await lineRes.text();
      console.log(`LINE API invitation response status:`, lineRes.status, resText);

      if (lineRes.status !== 200) {
        return res.status(lineRes.status).json({
          error: `Failed to send to LINE Group. LINE API returned status ${lineRes.status}`,
          details: resText
        });
      }

      res.json({
        status: "success",
        message: "ส่งคำเชิญลงทะเบียนไปยัง LINE Group สำเร็จเรียบร้อยแล้ว",
        recipientsCount: employeesToInvite.length,
        invitedEmployees: employeesToInvite,
        lineResponse: resText
      });
    } catch (err: any) {
      console.error("Error sending linking invitation:", err);
      res.status(500).json({ error: err.message });
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
        const action = data.get("action") || "";

        if (data.get("report")) {
          const report = data.get("report");
          triggerId = report === "daily" ? "dailyReport" : report === "weekly" ? "weeklyReport" : "outstandingReport";
        } else if (action) {
          const advId = data.get("id") || "";
          variables = { advId };
          // Removed direct status update to prevent unvalidated changes.
          // Approval/Rejection should be handled via validated LIFF endpoints.
          triggerId = action === "approve" ? "onManagerApproval" : "onReject";
        }

        let messagePayload: any = null;
        const trigger = triggers.find((t: any) => t.id === triggerId && t.isActive);
        
        if (trigger) {
          try {
            const resolvedVariables = await enrichLineVariables(variables, lineConfig);
            messagePayload = createLineMessagePayload(trigger, resolvedVariables);
          } catch (err: any) {
            console.error("Error creating rich Flex reply payload:", err);
          }
        }

        // Fallback to text reply if no active rich trigger exists but a postback action was performed
        if (!messagePayload && action) {
          const statusText = action === "approve" ? "อนุมัติเรียบร้อย (รอโอนเงิน)" : "ปฏิเสธ/ไม่อนุมัติเรียบร้อย";
          messagePayload = {
            type: "text",
            text: `✔️ ได้ทำรายการ: ${statusText} สำหรับใบขอเบิกเลขที่ ${variables.advId || ""} สำเร็จแล้ว`
          };
        }

        if (!messagePayload) continue;

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
        const resText = await lineRes.text();
        console.log(`LINE reply API response:`, lineRes.status, resText);
        if (lineRes.status === 400) {
          console.log(`USER_NOT_FRIEND_OR_INVALID_LINE_ID for replyToken: ${event.replyToken}`);
        }
        replies.push({ triggerId, status: lineRes.status, response: resText });
      }

      return res.json({ status: "success", replies });
    } catch (err: any) {
      console.error("LINE webhook error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during LINE webhook." });
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
    
    // Log stack trace for better debugging of promise rejections if available
    if (err && err.stack) {
      console.error("Error stack trace:", err.stack);
    }

    if (req.originalUrl && req.originalUrl.startsWith("/api")) {
      return res.status(err.status || 500).json({ 
        status: "error", 
        error: err.message || "Internal Server Error",
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
