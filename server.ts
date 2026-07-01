import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { performServerAIOCR } from "./src/server/gemini";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
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

const buildLiffUrl = (lineConfig: any, advId?: string) => {
  const params = new URLSearchParams();
  if (advId) params.set("adv_id", advId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  if (lineConfig?.liffId) return `https://liff.line.me/${lineConfig.liffId}${suffix}`;
  const baseUrl = process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || "http://localhost:3002";
  return `${baseUrl.replace(/\/$/, "")}/liff/upload-slip${suffix}`;
};

const buildLiffActionUrl = (lineConfig: any, advId?: string, action?: string) => {
  const params = new URLSearchParams();
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

const selectLineRecipients = (allEmployees: any[], trigger: any, variables: Record<string, any>, targetEmployeeId?: string, lineConfig?: any) => {
  const recipientIdsSet = new Set<string>();
  const mode = trigger.recipientMode || "target";
  const targetIds = new Set([targetEmployeeId, variables.targetEmployeeId, variables.employeeId, variables.requesterId].filter(Boolean).map(String));
  const roles = new Set<string>(trigger.recipientRoles || []);
  const accountingRoles = new Set(["Accountant", "Accounting", "Admin"]);
  const approverRoles = roles.size ? roles : new Set(["Manager", "Admin"]);

  allEmployees.forEach((emp) => {
    if (!emp.lineUserId) return;
    const empIds = [emp.id, emp.employeeId, emp.uid, emp.userId].filter(Boolean).map(String);
    const isTarget = empIds.some((id) => targetIds.has(id));
    if (mode === "all") recipientIdsSet.add(emp.lineUserId);
    if (mode === "target" && isTarget) recipientIdsSet.add(emp.lineUserId);
    if (mode === "requester" && isTarget) recipientIdsSet.add(emp.lineUserId);
    if (mode === "accounting" && accountingRoles.has(emp.role)) recipientIdsSet.add(emp.lineUserId);
    if (mode === "approvers" && approverRoles.has(emp.role)) recipientIdsSet.add(emp.lineUserId);
  });

  if (lineConfig?.groupId && typeof lineConfig.groupId === "string" && lineConfig.groupId.trim()) {
    recipientIdsSet.add(lineConfig.groupId.trim());
  }
  if (lineConfig?.lineGroupId && typeof lineConfig.lineGroupId === "string" && lineConfig.lineGroupId.trim()) {
    recipientIdsSet.add(lineConfig.lineGroupId.trim());
  }

  return Array.from(recipientIdsSet);
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
      if (!advId || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "Missing advId or invalid action." });
      }

      const advance: any = await getDocByIdOrField("advances", advId, "advId");
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      let approverName = displayName || "LINE LIFF";
      if (userId) {
        const approverSnap = await firestoreDb.collection("employees").where("lineUserId", "==", userId).limit(1).get();
        if (!approverSnap.empty) {
          const approver = approverSnap.docs[0].data();
          approverName = approver.name || approver.fullName || approver.lineDisplayName || approverName;
        }
      }

      const nowIso = new Date().toISOString();
      const updatePayload = action === "approve"
        ? {
            status: "WAITING_TRANSFER",
            approvedAt: nowIso,
            approvedBy: approverName,
            lineActionAt: FieldValue.serverTimestamp(),
            lineActionBy: userId || approverName,
            lineActionSource: "liff",
          }
        : {
            status: "REJECTED",
            rejectedAt: nowIso,
            rejectedBy: approverName,
            lineActionAt: FieldValue.serverTimestamp(),
            lineActionBy: userId || approverName,
            lineActionSource: "liff",
          };

      await firestoreDb.collection("advances").doc(advance.id).set(updatePayload, { merge: true });

      const auditId = `audit-line-${Date.now()}-${advance.id}`;
      await firestoreDb.collection("auditLogs").doc(auditId).set({
        id: auditId,
        advId: advance.advId || advId,
        actionType: action === "approve" ? "APPROVE_ADVANCE" : "REJECT_ADVANCE",
        actionBy: approverName,
        role: "LINE",
        timestamp: nowIso,
        beforeStatus: advance.status || "",
        afterStatus: updatePayload.status,
        note: action === "approve" ? "อนุมัติผ่าน LINE LIFF" : "ไม่อนุมัติผ่าน LINE LIFF",
      }, { merge: true });

      const updatedAdvance = await getAdvanceForLine(advId);
      return res.json({ status: "success", action, advance: updatedAdvance });
    } catch (err: any) {
      console.error("LINE LIFF action error:", err);
      return res.status(500).json({ error: err.message || "Cannot update advance from LIFF." });
    }
  });

  app.post("/api/line/upload-slip", upload.single("slip"), async (req, res) => {
    try {
      if (!firestoreDb || !bucket) return res.status(500).json({ error: "Firebase Admin storage is not initialized on the server." });
      const advId = req.body?.advId;
      if (!advId || !req.file) return res.status(400).json({ error: "Missing advId or slip file." });

      const advance: any = await getDocByIdOrField("advances", advId, "advId");
      if (!advance?.id) return res.status(404).json({ error: "ไม่พบข้อมูลใบเบิกนี้" });

      const extension = path.extname(req.file.originalname || "") || ".jpg";
      const safeAdvId = String(advId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = `slips/${safeAdvId}/slip_${Date.now()}${extension}`;
      const remoteFile = bucket.file(filePath);
      await remoteFile.save(req.file.buffer, {
        contentType: req.file.mimetype || "image/jpeg",
        metadata: { cacheControl: "public, max-age=31536000" },
      });

      let downloadUrl = "";
      try {
        const [signedUrl] = await remoteFile.getSignedUrl({ action: "read", expires: "2500-01-01" });
        downloadUrl = signedUrl;
      } catch {
        downloadUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;
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

      return res.json({ status: "success", url: downloadUrl });
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
