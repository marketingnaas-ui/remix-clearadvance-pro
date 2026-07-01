import { db } from "./firebase";
import { doc, getDoc, updateDoc, collection, getDocs } from "firebase/firestore";
import { autoUpdateSystemCollections } from "./systemCollections";
import { COLLECTION_SCHEMAS, CORE_SHEET_COLLECTIONS, EXTRA_SHEET_COLLECTIONS, CollectionSchema } from "./collectionSchemas";

export interface GoogleWorkspaceSettings {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  parentFolderId?: string;
  vaultFolderIds?: { [advId: string]: string };
  autoSyncSheets?: boolean;
  autoSyncDrive?: boolean;
  lastSyncedAt?: string;
  appsScriptWebAppUrl?: string;
  appsScriptApiKey?: string;
  mirrorAdvancesEnabled?: boolean;
  mirrorVaultFilesEnabled?: boolean;
}

const GOOGLE_TOKEN_STORAGE_KEY = "clearadvance_google_access_token";
const GOOGLE_TOKEN_EXPIRES_KEY = "clearadvance_google_access_token_expires_at";

const SHEET_TITLES: Record<string, string> = {
  employees: "Employees",
  projects: "Projects",
  project_costs: "ProjectCosts",
  advances: "Advances",
  clearingLogs: "ClearingLogs",
  clearingItems: "ClearingItems",
  clearingItemLines: "ClearingItemLines",
  projectSplits: "ProjectSplits",
  vaultFiles: "VaultFiles",
  document_tracking: "DocumentTracking",
  GL: "GL",
  auditLogs: "AuditLogs",
  settings: "Settings",
  aiUsageLogs: "AIUsageLogs",
  dashboard_cache: "DashboardCache",
  executive_ai: "ExecutiveAI",
  syncLog: "SyncLog",
};

const escapeSheetTitle = (title: string) => `'${title.replace(/'/g, "''")}'`;

function normalizeSheetValue(value: any): any {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function rowsFromSchema(schema: CollectionSchema, records: any[]) {
  const headers = schema.fields.map((field) => `${field.label} (${field.key})`);
  return [
    headers,
    ...records.map((record) => schema.fields.map((field) => normalizeSheetValue(record[field.key]))),
  ];
}

function derivedClearingItemLines(clearingItems: any[]) {
  return clearingItems.flatMap((item) =>
    Array.isArray(item.lineItems)
      ? item.lineItems.map((line: any, index: number) => ({
          lineId: line.lineId || `${item.itemId || item.id || "item"}-line-${index + 1}`,
          itemId: item.itemId || item.id || "",
          advId: item.advId || "",
          clearingLogId: item.clearingLogId || "",
          itemName: line.itemName || "",
          qty: line.qty || 0,
          unitPrice: line.unitPrice || 0,
          amount: line.amount || (Number(line.qty || 0) * Number(line.unitPrice || 0)),
        }))
      : []
  );
}

function derivedProjectSplits(clearingItems: any[]) {
  return clearingItems.flatMap((item) =>
    Array.isArray(item.projectSplits)
      ? item.projectSplits.map((split: any, index: number) => ({
          splitId: split.splitId || `${item.itemId || item.id || "item"}-split-${index + 1}`,
          itemId: item.itemId || item.id || "",
          advId: item.advId || "",
          projectId: split.projectId || "",
          projectName: split.projectName || "",
          amount: split.amount || 0,
          percent: split.percent || 0,
        }))
      : []
  );
}

// Fetch active access token from the environment endpoint
export async function fetchAccessToken(): Promise<string | null> {
  try {
    const cachedToken = localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
    const expiresAt = Number(localStorage.getItem(GOOGLE_TOKEN_EXPIRES_KEY) || 0);
    if (cachedToken && expiresAt > Date.now() + 60_000) {
      return cachedToken;
    }
  } catch (e) {
    console.warn("Cannot read cached Google token:", e);
  }

  try {
    const res = await fetch("/api/oauth/token");
    if (res.ok) {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (data && data.access_token) {
          return data.access_token;
        }
      }
    }
  } catch (e) {
    console.error("Failed to fetch active access token from environment:", e);
  }
  return null;
}

export async function requestGoogleAccessToken(): Promise<string | null> {
  const configRes = await fetch("/api/oauth/picker-config");
  const config = configRes.ok ? await configRes.json() : {};
  const clientId = config.clientId;
  if (!clientId) {
    throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID หรือ VITE_GOOGLE_OAUTH_CLIENT_ID สำหรับ Google Workspace");
  }

  await new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("โหลด Google Identity Services ไม่สำเร็จ"));
    document.body.appendChild(script);
  });

  return new Promise((resolve, reject) => {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
      callback: (response: any) => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!response?.access_token) {
          resolve(null);
          return;
        }
        try {
          localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, response.access_token);
          localStorage.setItem(
            GOOGLE_TOKEN_EXPIRES_KEY,
            String(Date.now() + Number(response.expires_in || 3600) * 1000)
          );
        } catch (e) {
          console.warn("Cannot cache Google token:", e);
        }
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

// Create a new Google Spreadsheet with all core and optional reporting sheets.
export async function createSpreadsheet(token: string): Promise<{ id: string; url: string }> {
  const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      properties: {
        title: "Remix Clear Advance - Complete Financial Database",
      },
      sheets: [...CORE_SHEET_COLLECTIONS, ...EXTRA_SHEET_COLLECTIONS].map((collectionName) => ({
        properties: { title: SHEET_TITLES[collectionName] || collectionName },
      })),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create spreadsheet: ${errText}`);
  }

  const data = await response.json();
  return {
    id: data.spreadsheetId,
    url: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
  };
}

// Clear a range in a sheet
async function clearSheetRange(spreadsheetId: string, range: string, token: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

// Update a range in a sheet
async function updateSheetRange(spreadsheetId: string, range: string, values: any[][], token: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to update sheet range ${range}: ${errText}`);
  }
}

async function ensureSheetsExist(spreadsheetId: string, sheetTitles: string[], token: string) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to inspect spreadsheet sheets: ${errText}`);
  }

  const spreadsheet = await response.json();
  const existingTitles = new Set((spreadsheet.sheets || []).map((sheet: any) => sheet.properties?.title));
  const missingTitles = sheetTitles.filter((title) => !existingTitles.has(title));
  if (missingTitles.length === 0) return;

  const batchResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      requests: missingTitles.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });

  if (!batchResponse.ok) {
    const errText = await batchResponse.text();
    throw new Error(`Failed to add missing sheets: ${errText}`);
  }
}

// Synchronize all system tables to the Google Sheet
export async function syncDatabaseToSheets(spreadsheetId: string, token: string): Promise<void> {
  // Pre-calculate/recalculate all custom analytical and GL collections before sync
  try {
    await autoUpdateSystemCollections();
  } catch (err) {
    console.error("Non-blocking error pre-calculating analytical collections:", err);
  }

  const sheetCollections = [...CORE_SHEET_COLLECTIONS, ...EXTRA_SHEET_COLLECTIONS];
  const sheetTitles = sheetCollections.map((collectionName) => SHEET_TITLES[collectionName] || collectionName);
  await ensureSheetsExist(spreadsheetId, sheetTitles, token);

  const clearingItemsSnapForDerived = await getDocs(collection(db, "clearingItems"));
  const clearingItemsForDerived = clearingItemsSnapForDerived.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const derivedRecords: Record<string, any[]> = {
    clearingItemLines: derivedClearingItemLines(clearingItemsForDerived),
    projectSplits: derivedProjectSplits(clearingItemsForDerived),
    syncLog: [
      {
        syncId: `sync-${Date.now()}`,
        syncedAt: new Date().toISOString(),
        collectionCount: sheetCollections.length,
        status: "SUCCESS",
      },
    ],
  };

  for (const collectionName of sheetCollections) {
    const schema = COLLECTION_SCHEMAS.find((item) => item.collection === collectionName);
    const title = SHEET_TITLES[collectionName] || collectionName;
    let records = derivedRecords[collectionName];
    if (!records) {
      const snap = await getDocs(collection(db, collectionName));
      records = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    }

    const rows = schema
      ? rowsFromSchema(schema, records)
      : [["syncId", "syncedAt", "collectionCount", "status"], ...records.map((record) => [record.syncId || "", record.syncedAt || "", record.collectionCount || 0, record.status || ""])];

    await clearSheetRange(spreadsheetId, `${escapeSheetTitle(title)}!A1:AZ10000`, token);
    await updateSheetRange(spreadsheetId, `${escapeSheetTitle(title)}!A1`, rows, token);
  }

  const syncSettingsRef = doc(db, "settings", "global");
  const syncSettingsSnap = await getDoc(syncSettingsRef);
  if (syncSettingsSnap.exists()) {
    const data = syncSettingsSnap.data();
    const currentWorkspace = data.googleWorkspace || {};
    await updateDoc(syncSettingsRef, {
      googleWorkspace: {
        ...currentWorkspace,
        lastSyncedAt: new Date().toLocaleString("th-TH"),
        syncedSheets: sheetTitles,
      },
    });
  }

  return;

  // 1. Fetch data from Firestore
  const advancesSnap = await getDocs(collection(db, "advances"));
  const clearingItemsSnap = await getDocs(collection(db, "clearingItems"));
  const employeesSnap = await getDocs(collection(db, "employees"));
  const projectsSnap = await getDocs(collection(db, "projects"));
  const glSnap = await getDocs(collection(db, "GL"));
  const docTrackingSnap = await getDocs(collection(db, "document_tracking"));
  const projectCostsSnap = await getDocs(collection(db, "project_costs"));

  const advances = advancesSnap.docs.map((docSnap) => docSnap.data());
  const clearingItems = clearingItemsSnap.docs.map((docSnap) => docSnap.data());
  const employees = employeesSnap.docs.map((docSnap) => docSnap.data());
  const projects = projectsSnap.docs.map((docSnap) => docSnap.data());
  const glEntries = glSnap.docs.map((docSnap) => docSnap.data());
  const docTrackings = docTrackingSnap.docs.map((docSnap) => docSnap.data());
  const projectCosts = projectCostsSnap.docs.map((docSnap) => docSnap.data());

  // 2. Format Advances Data
  const advancesHeaders = [
    "ID เอกสาร (advId)",
    "ชื่อพนักงาน (employeeName)",
    "โครงการ (projectId)",
    "ประเภท/หมวดหมู่ (category)",
    "จำนวนเงินขอเบิก (requestAmount)",
    "ค้างชำระ/Outstanding (outstandingAmount)",
    "จำนวนเงินเคลียร์แล้ว (approvedClearingAmountTotal)",
    "สถานะ (status)",
    "รายละเอียด (details)",
    "วันที่ต้องการเงิน (neededDate)",
    "วันที่สร้าง (createdAt)",
  ];
  const advancesRows = [
    advancesHeaders,
    ...advances.map((adv) => [
      adv.advId || "",
      adv.employeeName || "",
      adv.projectId || "",
      adv.category || "",
      adv.requestAmount || 0,
      adv.outstandingAmount || 0,
      adv.approvedClearingAmountTotal || 0,
      adv.status || "",
      adv.details || "",
      adv.neededDate || "",
      adv.createdAt || "",
    ]),
  ];

  // 3. Format Clearing Items Data
  const clearingHeaders = [
    "ID รายการ (id)",
    "ID ใบขอเงิน (advId)",
    "เลขที่ใบเสร็จ (invoiceNo)",
    "ชื่อร้านค้า (vendorName)",
    "รายละเอียดสินค้า (itemName)",
    "จำนวนเงินก่อนภาษี (qty * unitPrice)",
    "จำนวนเงิน net (netAmount)",
    "ภาษีมูลค่าเพิ่ม VAT (vatAmount)",
    "ภาษีหัก ณ ที่จ่าย WHT (whtAmount)",
    "สถานะรายการ (status)",
  ];
  const clearingRows = [
    clearingHeaders,
    ...clearingItems.map((item) => [
      item.id || "",
      item.advId || "",
      item.invoiceNo || "",
      item.vendorName || "",
      item.itemName || item.description || "",
      (item.qty || 1) * (item.unitPrice || 0),
      item.netAmount || 0,
      item.vatAmount || 0,
      item.whtAmount || 0,
      item.status || "",
    ]),
  ];

  // 4. Format Employees Data
  const employeesHeaders = [
    "รหัสพนักงาน (employeeCode)",
    "ชื่อผู้ใช้ (username)",
    "ชื่อ-นามสกุล (name)",
    "บทบาท (role)",
    "ธนาคาร (bankName)",
    "เลขที่บัญชี (bankNo)",
    "ชื่อบัญชี (bankAccountName)",
    "สถานะใช้งาน (isActive)",
    "สถานะการอนุมัติ (status)",
  ];
  const employeesRows = [
    employeesHeaders,
    ...employees.map((emp) => [
      emp.employeeCode || "",
      emp.username || "",
      emp.name || "",
      emp.role || "",
      emp.bankName || "",
      emp.bankNo || "",
      emp.bankAccountName || "",
      emp.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน",
      emp.status || "",
    ]),
  ];

  // 5. Format Projects Data
  const projectsHeaders = [
    "รหัสโครงการ (projectId)",
    "ชื่อโครงการ (name)",
    "งบประมาณตามสัญญา (contractBudget)",
    "งบเงินทดรองจ่ายสะสม (pettyCashBudget)",
    "คำอธิบายงบประมาณ (aiReasoning)"
  ];
  const projectsRows = [
    projectsHeaders,
    ...projects.map((proj) => [
      proj.projectId || proj.id || "",
      proj.name || "",
      proj.contractBudget || 0,
      proj.pettyCashBudget || 0,
      proj.aiReasoning || ""
    ])
  ];

  // 6. Format GL Entries Data
  const glHeaders = [
    "รหัสรายการ (id)",
    "เลขที่เอกสาร (docNo)",
    "วันที่ (date)",
    "รหัสบัญชี (accountCode)",
    "ชื่อบัญชี (accountName)",
    "รหัสโครงการ (projectId)",
    "หมวดหมู่ (category)",
    "จำนวนเงินเดบิต (debit)",
    "จำนวนเงินเครดิต (credit)",
    "คำอธิบาย (description)"
  ];
  const glRows = [
    glHeaders,
    ...glEntries.map((entry) => [
      entry.id || "",
      entry.docNo || "",
      entry.date || "",
      entry.accountCode || "",
      entry.accountName || "",
      entry.projectId || "",
      entry.category || "",
      entry.debit || 0,
      entry.credit || 0,
      entry.description || ""
    ])
  ];

  // 7. Format Document Tracking Data
  const docTrackingHeaders = [
    "เลขที่เอกสาร (documentNo)",
    "ประเภทเอกสาร (documentType)",
    "สถานะล่าสุด (status)",
    "พนักงานผู้ยื่น (employeeName)",
    "รหัสโครงการ (projectId)",
    "จำนวนเงิน (amount)",
    "วันที่สร้าง (createdAt)",
    "วันที่อัปเดตล่าสุด (updatedAt)"
  ];
  const docTrackingRows = [
    docTrackingHeaders,
    ...docTrackings.map((track) => [
      track.documentNo || "",
      track.documentType || "",
      track.status || "",
      track.employeeName || "",
      track.projectId || "",
      track.amount || 0,
      track.createdAt || "",
      track.updatedAt || ""
    ])
  ];

  // 8. Format Project Costs Data
  const projectCostsHeaders = [
    "ชื่อโครงการ (projectName)",
    "งบประมาณโครงการ (contractBudget)",
    "งบเงินทดรองจ่าย (pettyCashBudget)",
    "ยอดขอเบิกสะสม (totalAdvanceRequested)",
    "ยอดเบิกจ่ายสะสม (totalAdvanceApproved)",
    "ยอดส่งเคลียร์สะสม (totalClearingSubmitted)",
    "ยอดเคลียร์ผ่านจริง (totalClearingApproved)",
    "งบสะสมคงเหลือ (remainingPettyCashBudget)",
    "ส่วนต่างงบประมาณ (variance)",
    "อัปเดตล่าสุด (lastUpdated)"
  ];
  const projectCostsRows = [
    projectCostsHeaders,
    ...projectCosts.map((cost) => [
      cost.projectName || "",
      cost.contractBudget || 0,
      cost.pettyCashBudget || 0,
      cost.totalAdvanceRequested || 0,
      cost.totalAdvanceApproved || 0,
      cost.totalClearingSubmitted || 0,
      cost.totalClearingApproved || 0,
      cost.remainingPettyCashBudget || 0,
      cost.variance || 0,
      cost.lastUpdated || ""
    ])
  ];

  // 9. Overwrite all sheets in the spreadsheet
  // Clear first to remove any old overflowing data
  await clearSheetRange(spreadsheetId, "Advances!A1:K10000", token);
  await clearSheetRange(spreadsheetId, "Clearing Items!A1:J10000", token);
  await clearSheetRange(spreadsheetId, "Employees!A1:I10000", token);
  await clearSheetRange(spreadsheetId, "Projects!A1:E10000", token);
  await clearSheetRange(spreadsheetId, "GL!A1:J10000", token);
  await clearSheetRange(spreadsheetId, "Document Tracking!A1:H10000", token);
  await clearSheetRange(spreadsheetId, "Project Costs!A1:J10000", token);

  // Write new values
  await updateSheetRange(spreadsheetId, "Advances!A1", advancesRows, token);
  await updateSheetRange(spreadsheetId, "Clearing Items!A1", clearingRows, token);
  await updateSheetRange(spreadsheetId, "Employees!A1", employeesRows, token);
  await updateSheetRange(spreadsheetId, "Projects!A1", projectsRows, token);
  await updateSheetRange(spreadsheetId, "GL!A1", glRows, token);
  await updateSheetRange(spreadsheetId, "Document Tracking!A1", docTrackingRows, token);
  await updateSheetRange(spreadsheetId, "Project Costs!A1", projectCostsRows, token);

  // 10. Update last synced timestamp in Firestore
  const settingsRef = doc(db, "settings", "global");
  const settingsSnap = await getDoc(settingsRef);
  if (settingsSnap.exists()) {
    const data = settingsSnap.data();
    const currentWorkspace = data.googleWorkspace || {};
    await updateDoc(settingsRef, {
      googleWorkspace: {
        ...currentWorkspace,
        lastSyncedAt: new Date().toLocaleString("th-TH"),
      },
    });
  }
}

// Automatically sync if auto-sync is enabled in settings
export async function triggerAutoSyncSheetsIfEnabled(): Promise<void> {
  try {
    const settingsRef = doc(db, "settings", "global");
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      const workspace = data.googleWorkspace as GoogleWorkspaceSettings | undefined;
      if (workspace && workspace.spreadsheetId && workspace.autoSyncSheets !== false) {
        const token = await fetchAccessToken();
        if (token) {
          await syncDatabaseToSheets(workspace.spreadsheetId, token);
        }
      }
    }
  } catch (err) {
    console.error("Failed to run auto-sync to Google Sheets:", err);
  }
}

// Helper to find a folder on Google Drive
async function findFolderOnDrive(name: string, parentId: string | null, token: string): Promise<string | null> {
  let queryStr = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    queryStr += ` and '${parentId}' in parents`;
  }
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryStr)}&fields=files(id)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }
  return null;
}

// Helper to create a folder on Google Drive
async function createFolderOnDrive(name: string, parentId: string | null, token: string): Promise<string> {
  const url = "https://www.googleapis.com/drive/v3/files";
  const body: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    body.parents = [parentId];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create Google Drive folder: ${errText}`);
  }

  const data = await res.json();
  return data.id;
}

// Generate/Sync folder structures inside Google Drive based on all Vaults (grouped by advId)
export async function syncVaultFoldersToDrive(token: string): Promise<{ parentFolderId: string; vaultFolderIds: { [advId: string]: string } }> {
  // 1. Fetch vault files to extract unique advIds
  const vaultFilesSnap = await getDocs(collection(db, "vaultFiles"));
  const uniqueAdvIds = new Set<string>();
  vaultFilesSnap.docs.forEach((docSnap) => {
    const file = docSnap.data();
    if (file.advId) {
      uniqueAdvIds.add(file.advId);
    }
  });

  // Also get list from advances to make sure we create folders for all advances with files
  const advancesSnap = await getDocs(collection(db, "advances"));
  advancesSnap.docs.forEach((docSnap) => {
    const adv = docSnap.data();
    if (adv.advId) {
      uniqueAdvIds.add(adv.advId);
    }
  });

  // 2. Look up or create parent folder on Google Drive
  let parentFolderId = await findFolderOnDrive("Remix Clear Advance Vaults", null, token);
  if (!parentFolderId) {
    parentFolderId = await createFolderOnDrive("Remix Clear Advance Vaults", null, token);
  }

  // 3. For each unique advId, look up or create a folder inside the parent folder
  const vaultFolderIds: { [advId: string]: string } = {};
  for (const advId of uniqueAdvIds) {
    let folderId = await findFolderOnDrive(advId, parentFolderId, token);
    if (!folderId) {
      folderId = await createFolderOnDrive(advId, parentFolderId, token);
    }
    vaultFolderIds[advId] = folderId;
  }

  // 4. Update settings in Firestore
  const settingsRef = doc(db, "settings", "global");
  const settingsSnap = await getDoc(settingsRef);
  if (settingsSnap.exists()) {
    const data = settingsSnap.data();
    const currentWorkspace = data.googleWorkspace || {};
    await updateDoc(settingsRef, {
      googleWorkspace: {
        ...currentWorkspace,
        parentFolderId,
        vaultFolderIds,
        lastSyncedAt: new Date().toLocaleString("th-TH"),
      },
    });
  }

  return { parentFolderId, vaultFolderIds };
}

// Automatically sync vault folder if auto-sync is enabled in settings
export async function triggerAutoSyncVaultFoldersIfEnabled(): Promise<void> {
  try {
    const settingsRef = doc(db, "settings", "global");
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      const workspace = data.googleWorkspace as GoogleWorkspaceSettings | undefined;
      if (workspace && workspace.autoSyncDrive !== false) {
        const token = await fetchAccessToken();
        if (token) {
          await syncVaultFoldersToDrive(token);
        }
      }
    }
  } catch (err) {
    console.error("Failed to run auto-sync to Google Drive folders:", err);
  }
}
