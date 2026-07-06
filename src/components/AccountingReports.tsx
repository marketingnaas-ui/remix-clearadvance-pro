import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Advance, AdvanceStatus, ClearingItem, ClearingLog, Employee } from "../types";
import { exportToExcel } from "../lib/excelExport";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Printer,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

type ReportKey =
  | "gl"
  | "vat"
  | "wht"
  | "advance"
  | "clearing"
  | "project_cost"
  | "original_doc"
  | "vendor"
  | "employee_outstanding"
  | "executive";

type GenericRecord = Record<string, any>;

interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  money?: boolean;
}

interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  rows: GenericRecord[];
  columns: ReportColumn[];
  summary: { label: string; value: string }[];
}

interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  project: string;
  status: string;
  requester: string;
  vendor: string;
  advNo: string;
  clrNo: string;
  documentType: string;
}

const INITIAL_FILTERS: ReportFilters = {
  dateFrom: "",
  dateTo: "",
  project: "ALL",
  status: "ALL",
  requester: "ALL",
  vendor: "ALL",
  advNo: "",
  clrNo: "",
  documentType: "ALL",
};

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "gl", label: "บัญชีแยกประเภท / GL" },
  { key: "vat", label: "ภาษีซื้อ VAT" },
  { key: "wht", label: "ภาษีหัก ณ ที่จ่าย WHT" },
  { key: "advance", label: "ADV / เงินทดรอง" },
  { key: "clearing", label: "Clearing" },
  { key: "project_cost", label: "ต้นทุนโครงการ" },
  { key: "original_doc", label: "ติดตามเอกสารต้นฉบับ" },
  { key: "vendor", label: "Vendor / เจ้าหนี้" },
  { key: "employee_outstanding", label: "ยอดคงค้างรายคน" },
  { key: "executive", label: "สรุปผู้บริหาร" },
];

const money = (value: any) =>
  Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const asDate = (value: any) => {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
};

const thaiDate = (value: any) => {
  const normalized = asDate(value);
  if (!normalized) return "-";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toLocaleDateString("th-TH");
};

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    [AdvanceStatus.DRAFT]: "ร่าง",
    [AdvanceStatus.PENDING_APPROVAL]: "รออนุมัติ",
    [AdvanceStatus.WAITING_TRANSFER]: "รอโอนเงิน",
    [AdvanceStatus.WAITING_CLEARANCE]: "รอเคลียร์",
    [AdvanceStatus.PENDING_AUDIT]: "รอตรวจสอบ",
    [AdvanceStatus.PARTIALLY_CLEARED]: "เคลียร์บางส่วน",
    [AdvanceStatus.RETURNED]: "ตีกลับ",
    [AdvanceStatus.REJECTED]: "ไม่อนุมัติ",
    [AdvanceStatus.WAITING_ORIGINAL_DOC]: "รอเอกสารจริง",
    [AdvanceStatus.CLOSED]: "ปิดยอด",
  };
  return map[status] || status || "-";
};

const replaceEmpty = (value: any) => (value === undefined || value === null || value === "" ? "-" : value);

const exportToCsv = (rows: GenericRecord[], columns: ReportColumn[], fileName: string) => {
  if (rows.length === 0) return;
  const escape = (value: any) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.map((col) => escape(col.label)).join(","),
    ...rows.map((row) => columns.map((col) => escape(row[col.key])).join(",")),
  ].join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

export default function AccountingReports() {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [clearingItems, setClearingItems] = useState<ClearingItem[]>([]);
  const [clearingLogs, setClearingLogs] = useState<ClearingLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projectRecords, setProjectRecords] = useState<GenericRecord[]>([]);
  const [glEntries, setGlEntries] = useState<GenericRecord[]>([]);
  const [documentTracking, setDocumentTracking] = useState<GenericRecord[]>([]);
  const [settings, setSettings] = useState<GenericRecord>({});
  const [activeReport, setActiveReport] = useState<ReportKey>("gl");
  const [filters, setFilters] = useState<ReportFilters>(INITIAL_FILTERS);
  const [previewReport, setPreviewReport] = useState<ReportDefinition | null>(null);
  const [syncingToDb, setSyncingToDb] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState("");
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({
    advances: true,
    clearingItems: true,
    clearingLogs: true,
    employees: true,
    projects: true,
    GL: true,
    document_tracking: true,
    settings: true,
  });
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const subscribe = <T,>(
      collectionName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      options?: { docId?: string }
    ) => {
      if (options?.docId) {
        return onSnapshot(
          doc(db, collectionName, options.docId),
          (snap) => {
            setSettings(snap.exists() ? { id: snap.id, ...snap.data() } : {});
            setLoadingMap((prev) => ({ ...prev, [collectionName]: false }));
          },
          (err) => {
            setErrors((prev) => [...prev, `${collectionName}: ${err.message}`]);
            setLoadingMap((prev) => ({ ...prev, [collectionName]: false }));
          }
        );
      }

      return onSnapshot(
        collection(db, collectionName),
        (snap) => {
          setter(snap.docs.map((d) => ({ id: d.id, ...d.data() } as T)));
          setLoadingMap((prev) => ({ ...prev, [collectionName]: false }));
        },
        (err) => {
          setErrors((prev) => [...prev, `${collectionName}: ${err.message}`]);
          setLoadingMap((prev) => ({ ...prev, [collectionName]: false }));
        }
      );
    };

    const unsubscribers = [
      subscribe<Advance>("advances", setAdvances),
      subscribe<ClearingItem>("clearingItems", setClearingItems),
      subscribe<ClearingLog>("clearingLogs", setClearingLogs),
      subscribe<Employee>("employees", setEmployees),
      subscribe<GenericRecord>("projects", setProjectRecords),
      subscribe<GenericRecord>("GL", setGlEntries),
      subscribe<GenericRecord>("document_tracking", setDocumentTracking),
      subscribe<GenericRecord>("settings", setSettings as any, { docId: "global" }),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const loading = Object.values(loadingMap).some(Boolean);

  const advanceByAdvNo = useMemo(() => {
    const map = new Map<string, Advance>();
    advances.forEach((adv) => {
      map.set(adv.advId, adv);
      map.set(adv.id, adv);
    });
    return map;
  }, [advances]);

  const clearingLogById = useMemo(() => {
    const map = new Map<string, ClearingLog>();
    clearingLogs.forEach((log) => map.set(log.id, log));
    return map;
  }, [clearingLogs]);

  const enrichedItems = useMemo(
    () =>
      clearingItems.map((item) => {
        const advance = advanceByAdvNo.get(item.advId);
        const log = clearingLogById.get(item.clearingLogId);
        return {
          ...item,
          projectId: advance?.projectId || item.projectSplits?.[0]?.projectId || "",
          employeeName: advance?.employeeName || "",
          category: advance?.category || "",
          status: item.status || advance?.status || log?.status || "",
          clearingNo: log?.clearingNo || `${item.advId || "ADV"}-${item.roundNo || 1}`,
        };
      }),
    [advanceByAdvNo, clearingItems, clearingLogById]
  );

  const options = useMemo(() => {
    const projects = new Set<string>();
    const statuses = new Set<string>();
    const requesters = new Set<string>();
    const vendors = new Set<string>();
    const docTypes = new Set<string>();

    advances.forEach((adv) => {
      if (adv.projectId) projects.add(adv.projectId);
      if (adv.projectName) projects.add(adv.projectName);
      if (adv.status) statuses.add(adv.status);
      if (adv.employeeName) requesters.add(adv.employeeName);
    });
    enrichedItems.forEach((item) => {
      if (item.projectId) projects.add(item.projectId);
      if (item.status) statuses.add(item.status);
      if (item.employeeName) requesters.add(item.employeeName);
      if (item.vendorName) vendors.add(item.vendorName);
      if (item.documentType) docTypes.add(item.documentType);
    });
    (settings.projects || []).forEach((project: string) => projects.add(project));
    projectRecords.forEach((project) => {
      if (project.projectId) projects.add(project.projectId);
      if (project.projectName) projects.add(project.projectName);
      if (project.projectCode) projects.add(project.projectCode);
    });

    return {
      projects: Array.from(projects).sort(),
      statuses: Array.from(statuses).sort(),
      requesters: Array.from(requesters).sort(),
      vendors: Array.from(vendors).sort(),
      documentTypes: Array.from(docTypes).sort(),
    };
  }, [advances, enrichedItems, projectRecords, settings.projects]);

  const filterByCommonFields = (row: GenericRecord) => {
    const date = asDate(row.date || row.documentDate || row.createdAt || row.requestDate);
    if (filters.dateFrom && date && date < filters.dateFrom) return false;
    if (filters.dateTo && date && date > filters.dateTo) return false;
    if (filters.project !== "ALL" && row.projectId !== filters.project && row.projectName !== filters.project) return false;
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (filters.requester !== "ALL" && row.employeeName !== filters.requester && row.requesterName !== filters.requester) return false;
    if (filters.vendor !== "ALL" && row.vendorName !== filters.vendor) return false;
    if (filters.documentType !== "ALL" && row.documentType !== filters.documentType) return false;
    if (filters.advNo && !String(row.advId || row.docNo || row.refAdvNo || "").toLowerCase().includes(filters.advNo.toLowerCase())) return false;
    if (filters.clrNo && !String(row.clearingNo || row.clrNo || "").toLowerCase().includes(filters.clrNo.toLowerCase())) return false;
    return true;
  };

  const derivedGlRows = useMemo(() => {
    if (glEntries.length > 0) return glEntries;
    const rows: GenericRecord[] = [];
    advances.forEach((adv) => {
      if ([AdvanceStatus.REJECTED, AdvanceStatus.DRAFT].includes(adv.status)) return;
      rows.push({
        id: `${adv.advId}-advance-dr`,
        date: adv.createdAt,
        docNo: adv.advId,
        accountCode: "11300",
        accountName: "เงินทดรองจ่ายพนักงาน",
        projectId: adv.projectId,
        category: adv.category,
        debit: Number(adv.requestAmount || 0),
        credit: 0,
        employeeName: adv.employeeName,
        description: `บันทึกเงินทดรองจ่าย ${adv.advId}`,
        status: adv.status,
      });
      rows.push({
        id: `${adv.advId}-advance-cr`,
        date: adv.createdAt,
        docNo: adv.advId,
        accountCode: "11100",
        accountName: "เงินสด/เงินฝากธนาคาร",
        projectId: adv.projectId,
        category: adv.category,
        debit: 0,
        credit: Number(adv.requestAmount || 0),
        employeeName: adv.employeeName,
        description: `โอนเงินทดรองจ่าย ${adv.advId}`,
        status: adv.status,
      });
    });
    enrichedItems.forEach((item) => {
      rows.push({
        id: `${item.id}-expense`,
        date: item.documentDate,
        docNo: item.advId,
        accountCode: "5xxxx",
        accountName: `ค่าใช้จ่าย - ${item.category || item.documentType || "ทั่วไป"}`,
        projectId: item.projectId,
        category: item.category,
        debit: Number(item.netAmount || 0),
        credit: 0,
        employeeName: item.employeeName,
        description: item.itemName,
        status: item.status,
      });
    });
    return rows;
  }, [advances, enrichedItems, glEntries]);

  const projectCostRows = useMemo(() => {
    const projectDetails = settings.projectDetails || {};
    const projectBudgets = settings.projectBudgets || {};
    const projectSource = projectRecords.length > 0
      ? projectRecords
      : Array.from(new Set([...options.projects, ...Object.keys(projectDetails), ...Object.keys(projectBudgets)])).map((projectName) => ({ id: projectName, projectId: projectName, projectName }));

    return projectSource.map((project) => {
      const projectId = project.projectId || project.projectCode || project.id || project.projectName;
      const projectName = project.projectName || projectId;
      const projectAdvances = advances.filter((adv) => [projectId, projectName, project.projectCode].filter(Boolean).includes(adv.projectId || adv.projectName));
      const approvedClearing = projectAdvances.reduce((sum, adv) => sum + Number(adv.approvedClearingAmountTotal || 0), 0);
      const requested = projectAdvances.reduce((sum, adv) => sum + Number(adv.requestAmount || 0), 0);
      const outstandingAmount = projectAdvances.reduce((sum, adv) => sum + Number(adv.outstandingAmount || 0), 0);
      const contractBudget = Number(project.contractAmount || project.budget || projectDetails[projectId]?.contractBudget || projectBudgets[projectId] || 0);
      const pettyCashBudget = Number(project.pettyCashBudget || projectDetails[projectId]?.pettyCashBudget || project.budget || 0);
      return {
        id: project.id || projectId,
        projectName,
        projectId,
        contractBudget,
        pettyCashBudget,
        totalAdvanceRequested: requested,
        totalClearingApproved: approvedClearing,
        outstandingAmount,
        remainingPettyCashBudget: pettyCashBudget - approvedClearing,
        variance: contractBudget - approvedClearing,
        lastUpdated: new Date().toISOString(),
      };
    });
  }, [advances, options.projects, projectRecords, settings.projectBudgets, settings.projectDetails]);

  const reportDefinition = useMemo<ReportDefinition>(() => {
    const commonSummary = {
      totalRows: (rows: GenericRecord[]) => ({ label: "จำนวนรายการ", value: rows.length.toLocaleString("th-TH") }),
      totalAmount: (label: string, rows: GenericRecord[], key: string) => ({
        label,
        value: `${money(rows.reduce((sum, row) => sum + Number(row[key] || 0), 0))} บาท`,
      }),
    };

    if (activeReport === "gl") {
      const rows = derivedGlRows.filter(filterByCommonFields).map((row) => ({
        ...row,
        dateText: thaiDate(row.date),
        debitText: money(row.debit),
        creditText: money(row.credit),
      }));
      return {
        key: "gl",
        title: "รายงานบัญชีแยกประเภท / General Ledger",
        description: "รายการเดบิตเครดิตจาก GL collection หรือคำนวณจาก ADV และ Clearing ที่มีจริง",
        rows,
        columns: [
          { key: "dateText", label: "วันที่" },
          { key: "docNo", label: "เลขเอกสาร" },
          { key: "accountCode", label: "รหัสบัญชี" },
          { key: "accountName", label: "ชื่อบัญชี" },
          { key: "projectId", label: "โครงการ" },
          { key: "employeeName", label: "ผู้เกี่ยวข้อง" },
          { key: "debitText", label: "เดบิต", align: "right" },
          { key: "creditText", label: "เครดิต", align: "right" },
          { key: "description", label: "คำอธิบาย" },
        ],
        summary: [
          commonSummary.totalRows(rows),
          commonSummary.totalAmount("รวมเดบิต", rows, "debit"),
          commonSummary.totalAmount("รวมเครดิต", rows, "credit"),
        ],
      };
    }

    if (activeReport === "vat") {
      const rows = enrichedItems
        .filter((item) => Number(item.vatAmount || 0) > 0)
        .filter(filterByCommonFields)
        .map((item) => ({ ...item, dateText: thaiDate(item.documentDate), vatText: money(item.vatAmount), netText: money(item.netAmount) }));
      return {
        key: "vat",
        title: "รายงานภาษีซื้อ VAT",
        description: "รายการใบกำกับภาษีซื้อจาก clearingItems ที่มี VAT",
        rows,
        columns: [
          { key: "dateText", label: "วันที่เอกสาร" },
          { key: "invoiceNo", label: "เลขที่ใบกำกับ/ใบเสร็จ" },
          { key: "vendorName", label: "ผู้ขาย" },
          { key: "vendorTaxId", label: "เลขผู้เสียภาษี" },
          { key: "documentType", label: "ประเภทเอกสาร" },
          { key: "projectId", label: "โครงการ" },
          { key: "vatText", label: "VAT", align: "right" },
          { key: "netText", label: "ยอดสุทธิ", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวม VAT", rows, "vatAmount"), commonSummary.totalAmount("รวมสุทธิ", rows, "netAmount")],
      };
    }

    if (activeReport === "wht") {
      const rows = enrichedItems
        .filter((item) => Number(item.whtAmount || 0) > 0)
        .filter(filterByCommonFields)
        .map((item) => ({ ...item, dateText: thaiDate(item.documentDate), whtText: money(item.whtAmount), netText: money(item.netAmount) }));
      return {
        key: "wht",
        title: "รายงานภาษีหัก ณ ที่จ่าย WHT",
        description: "รายการหักภาษี ณ ที่จ่ายจาก clearingItems",
        rows,
        columns: [
          { key: "dateText", label: "วันที่เอกสาร" },
          { key: "invoiceNo", label: "เลขที่เอกสาร" },
          { key: "vendorName", label: "ผู้ขาย" },
          { key: "vendorTaxId", label: "เลขผู้เสียภาษี" },
          { key: "whtRate", label: "อัตรา" },
          { key: "whtText", label: "ยอด WHT", align: "right" },
          { key: "netText", label: "ยอดสุทธิ", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวม WHT", rows, "whtAmount")],
      };
    }

    if (activeReport === "advance") {
      const rows = advances
        .filter((adv) => filterByCommonFields({ ...adv, date: adv.createdAt, requesterName: adv.employeeName }))
        .map((adv) => ({
          ...adv,
          statusText: getStatusText(adv.status),
          dateText: thaiDate(adv.createdAt),
          neededDateText: thaiDate(adv.neededDate),
          requestAmountText: money(adv.requestAmount),
          outstandingText: money(adv.outstandingAmount),
        }));
      return {
        key: "advance",
        title: "รายงาน ADV / เงินทดรอง",
        description: "สรุปใบขอเบิกเงินทดรองและยอดคงค้าง",
        rows,
        columns: [
          { key: "advId", label: "เลข ADV" },
          { key: "dateText", label: "วันที่ขอ" },
          { key: "employeeName", label: "ผู้ขอเบิก" },
          { key: "projectId", label: "โครงการ" },
          { key: "category", label: "หมวดหมู่" },
          { key: "statusText", label: "สถานะ" },
          { key: "requestAmountText", label: "ยอดขอเบิก", align: "right" },
          { key: "outstandingText", label: "ยอดคงค้าง", align: "right" },
          { key: "neededDateText", label: "กำหนดเคลียร์" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวมเงินทดรอง", rows, "requestAmount"), commonSummary.totalAmount("รวมคงค้าง", rows, "outstandingAmount")],
      };
    }

    if (activeReport === "clearing") {
      const rows = enrichedItems
        .filter(filterByCommonFields)
        .map((item) => ({ ...item, dateText: thaiDate(item.documentDate), netText: money(item.netAmount), vatText: money(item.vatAmount), whtText: money(item.whtAmount) }));
      return {
        key: "clearing",
        title: "รายงาน Clearing",
        description: "รายการเคลียร์ยอดจากเอกสารค่าใช้จ่าย",
        rows,
        columns: [
          { key: "clearingNo", label: "เลข CLR" },
          { key: "advId", label: "เลข ADV" },
          { key: "dateText", label: "วันที่เอกสาร" },
          { key: "vendorName", label: "ผู้ขาย" },
          { key: "documentType", label: "ประเภทเอกสาร" },
          { key: "itemName", label: "รายละเอียด" },
          { key: "projectId", label: "โครงการ" },
          { key: "netText", label: "ยอดสุทธิ", align: "right" },
          { key: "vatText", label: "VAT", align: "right" },
          { key: "whtText", label: "WHT", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวมเคลียร์", rows, "netAmount"), commonSummary.totalAmount("รวม VAT", rows, "vatAmount"), commonSummary.totalAmount("รวม WHT", rows, "whtAmount")],
      };
    }

    if (activeReport === "project_cost") {
      const rows = projectCostRows
        .filter(filterByCommonFields)
        .map((row) => ({
          ...row,
          contractBudgetText: money(row.contractBudget),
          pettyCashBudgetText: money(row.pettyCashBudget),
          totalAdvanceRequestedText: money(row.totalAdvanceRequested),
          totalClearingApprovedText: money(row.totalClearingApproved),
          varianceText: money(row.variance),
        }));
      return {
        key: "project_cost",
        title: "รายงานต้นทุนโครงการ",
        description: "ใช้งบประมาณจริงจาก project_costs หรือ settings.projectDetails/projectBudgets ไม่มีค่า hardcode",
        rows,
        columns: [
          { key: "projectName", label: "โครงการ" },
          { key: "contractBudgetText", label: "งบสัญญา", align: "right" },
          { key: "pettyCashBudgetText", label: "งบทดรอง", align: "right" },
          { key: "totalAdvanceRequestedText", label: "ขอเบิกสะสม", align: "right" },
          { key: "totalClearingApprovedText", label: "เคลียร์แล้ว", align: "right" },
          { key: "varianceText", label: "คงเหลือ/ส่วนต่าง", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวมงบสัญญา", rows, "contractBudget"), commonSummary.totalAmount("รวมเคลียร์แล้ว", rows, "totalClearingApproved")],
      };
    }

    if (activeReport === "original_doc") {
      const sourceRows =
        documentTracking.length > 0
          ? documentTracking
          : enrichedItems.map((item) => ({
              id: item.id,
              documentNo: item.invoiceNo || item.advId,
              documentType: item.documentType,
              status: item.originalDocReceived ? "RECEIVED" : "WAITING_ORIGINAL_DOC",
              employeeName: item.employeeName,
              projectId: item.projectId,
              amount: item.netAmount,
              createdAt: item.documentDate,
              vendorName: item.vendorName,
            }));
      const rows = sourceRows
        .filter(filterByCommonFields)
        .map((row) => ({ ...row, dateText: thaiDate(row.createdAt || row.documentDate), amountText: money(row.amount), statusText: getStatusText(row.status) }));
      return {
        key: "original_doc",
        title: "รายงานติดตามเอกสารต้นฉบับ",
        description: "ติดตามสถานะเอกสารจริงจาก document_tracking หรือสถานะ originalDocReceived",
        rows,
        columns: [
          { key: "documentNo", label: "เลขเอกสาร" },
          { key: "documentType", label: "ประเภท" },
          { key: "dateText", label: "วันที่" },
          { key: "employeeName", label: "ผู้เกี่ยวข้อง" },
          { key: "vendorName", label: "ผู้ขาย" },
          { key: "projectId", label: "โครงการ" },
          { key: "statusText", label: "สถานะ" },
          { key: "amountText", label: "ยอดเงิน", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวมมูลค่าเอกสาร", rows, "amount")],
      };
    }

    if (activeReport === "vendor") {
      const vendorMap = new Map<string, GenericRecord>();
      enrichedItems.filter(filterByCommonFields).forEach((item) => {
        const key = item.vendorName || "ไม่ระบุผู้ขาย";
        const current = vendorMap.get(key) || { vendorName: key, vendorTaxId: item.vendorTaxId || "", billCount: 0, netAmount: 0, vatAmount: 0, whtAmount: 0 };
        current.billCount += 1;
        current.netAmount += Number(item.netAmount || 0);
        current.vatAmount += Number(item.vatAmount || 0);
        current.whtAmount += Number(item.whtAmount || 0);
        vendorMap.set(key, current);
      });
      const rows = Array.from(vendorMap.values()).map((row) => ({ ...row, netText: money(row.netAmount), vatText: money(row.vatAmount), whtText: money(row.whtAmount) }));
      return {
        key: "vendor",
        title: "รายงาน Vendor / เจ้าหนี้",
        description: "สรุปยอดค่าใช้จ่ายตามผู้ขายจากเอกสารเคลียร์ยอด",
        rows,
        columns: [
          { key: "vendorName", label: "ผู้ขาย" },
          { key: "vendorTaxId", label: "เลขผู้เสียภาษี" },
          { key: "billCount", label: "จำนวนบิล", align: "right" },
          { key: "netText", label: "ยอดสุทธิ", align: "right" },
          { key: "vatText", label: "VAT", align: "right" },
          { key: "whtText", label: "WHT", align: "right" },
        ],
        summary: [commonSummary.totalRows(rows), commonSummary.totalAmount("รวมเจ้าหนี้/ค่าใช้จ่าย", rows, "netAmount")],
      };
    }

    if (activeReport === "employee_outstanding") {
      const employeeMap = new Map<string, GenericRecord>();
      advances.filter((adv) => filterByCommonFields({ ...adv, date: adv.createdAt, requesterName: adv.employeeName })).forEach((adv) => {
        const key = adv.employeeId || adv.employeeName || "unknown";
        const current = employeeMap.get(key) || {
          employeeId: adv.employeeId || key,
          employeeName: adv.employeeName || "ไม่ระบุพนักงาน",
          advanceCount: 0,
          outstandingCount: 0,
          requestAmount: 0,
          outstandingAmount: 0,
          latestAdvId: "",
          latestDate: "",
        };
        current.advanceCount += 1;
        current.requestAmount += Number(adv.requestAmount || 0);
        const outstanding = Number(adv.outstandingAmount || 0);
        current.outstandingAmount += outstanding;
        if (outstanding > 0) current.outstandingCount += 1;
        const advDate = asDate(adv.createdAt);
        if (!current.latestDate || advDate > current.latestDate) {
          current.latestDate = advDate;
          current.latestAdvId = adv.advId;
        }
        employeeMap.set(key, current);
      });

      const rows = Array.from(employeeMap.values())
        .sort((a, b) => Number(b.outstandingAmount || 0) - Number(a.outstandingAmount || 0))
        .map((row) => ({
          ...row,
          requestAmountText: money(row.requestAmount),
          outstandingAmountText: money(row.outstandingAmount),
          latestDateText: thaiDate(row.latestDate),
        }));

      return {
        key: "employee_outstanding",
        title: "รายงานยอดคงค้างรายคน",
        description: "สรุปยอดคงค้างของพนักงานแต่ละคนจาก advances.outstandingAmount สำหรับใช้ติดตามและทำตัวแปร Flex Message",
        rows,
        columns: [
          { key: "employeeId", label: "รหัสพนักงาน" },
          { key: "employeeName", label: "พนักงาน" },
          { key: "advanceCount", label: "จำนวน ADV", align: "right" },
          { key: "outstandingCount", label: "รายการคงค้าง", align: "right" },
          { key: "requestAmountText", label: "ยอดเบิกรวม", align: "right" },
          { key: "outstandingAmountText", label: "ยอดคงค้าง", align: "right" },
          { key: "latestAdvId", label: "ADV ล่าสุด" },
          { key: "latestDateText", label: "วันที่ล่าสุด" },
        ],
        summary: [
          commonSummary.totalRows(rows),
          commonSummary.totalAmount("รวมยอดเบิก", rows, "requestAmount"),
          commonSummary.totalAmount("รวมยอดคงค้าง", rows, "outstandingAmount"),
        ],
      };
    }

    const totalAdvance = advances.reduce((sum, adv) => sum + Number(adv.requestAmount || 0), 0);
    const totalCleared = advances.reduce((sum, adv) => sum + Number(adv.approvedClearingAmountTotal || 0), 0);
    const totalOutstanding = advances.reduce((sum, adv) => sum + Number(adv.outstandingAmount || 0), 0);
    const rows = [
      { metric: "จำนวน ADV ทั้งหมด", value: advances.length.toLocaleString("th-TH"), note: "จาก collection advances" },
      { metric: "ยอดเงินทดรองทั้งหมด", value: `${money(totalAdvance)} บาท`, note: "รวม requestAmount" },
      { metric: "ยอดเคลียร์อนุมัติแล้ว", value: `${money(totalCleared)} บาท`, note: "รวม approvedClearingAmountTotal" },
      { metric: "ยอดคงค้าง", value: `${money(totalOutstanding)} บาท`, note: "รวม outstandingAmount" },
      { metric: "จำนวนบิล Clearing", value: enrichedItems.length.toLocaleString("th-TH"), note: "จาก collection clearingItems" },
      { metric: "จำนวนโครงการ", value: options.projects.length.toLocaleString("th-TH"), note: "จาก settings, advances และ project_costs" },
      { metric: "จำนวนพนักงาน", value: employees.length.toLocaleString("th-TH"), note: "จาก collection employees" },
    ];
    return {
      key: "executive",
      title: "รายงานสรุปผู้บริหาร",
      description: "ภาพรวมการเงินจากข้อมูลจริงใน Firestore",
      rows,
      columns: [
        { key: "metric", label: "ตัวชี้วัด" },
        { key: "value", label: "ค่า" },
        { key: "note", label: "แหล่งข้อมูล" },
      ],
      summary: [
        { label: "รวม ADV", value: advances.length.toLocaleString("th-TH") },
        { label: "ยอดเงินทดรอง", value: `${money(totalAdvance)} บาท` },
        { label: "ยอดคงค้าง", value: `${money(totalOutstanding)} บาท` },
      ],
    };
  }, [activeReport, advances, derivedGlRows, documentTracking, employees.length, enrichedItems, filters, options.projects.length, projectCostRows]);

  const exportRows = reportDefinition.rows.map((row) => {
    const clean: GenericRecord = {};
    reportDefinition.columns.forEach((col) => {
      clean[col.label] = replaceEmpty(row[col.key]);
    });
    return clean;
  });

  const handleSyncReportsToFirestore = async () => {
    setSyncingToDb(true);
    setSyncSuccessMsg("");
    try {
      const operations: { ref: any; data: any }[] = [];

      // 1. GL Entries (Save to GL collection)
      derivedGlRows.forEach((entry) => {
        const docRef = doc(db, "GL", entry.id);
        operations.push({
          ref: docRef,
          data: {
            id: entry.id,
            docNo: entry.docNo || "",
            date: entry.date || "",
            accountCode: entry.accountCode || "",
            accountName: entry.accountName || "",
            category: entry.category || "",
            description: entry.description || "",
            debit: Number(entry.debit || 0),
            credit: Number(entry.credit || 0),
            employeeName: entry.employeeName || "",
            projectId: entry.projectId || "",
            projectName: entry.projectName || "",
            status: entry.status || "APPROVED",
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // 2. VAT Entries (Save to vat_entries collection)
      const vatItems = enrichedItems.filter((item) => Number(item.vatAmount || 0) > 0);
      vatItems.forEach((item) => {
        const docRef = doc(db, "vat_entries", `${item.id}-vat`);
        const matchedProj = projectRecords.find(p => p.id === item.projectId || p.projectId === item.projectId);
        const projName = matchedProj?.projectName || item.projectId || "";
        operations.push({
          ref: docRef,
          data: {
            id: `${item.id}-vat`,
            date: item.documentDate || "",
            invoiceNo: item.invoiceNo || "",
            vendorName: item.vendorName || "",
            vendorTaxId: item.vendorTaxId || "",
            documentType: item.documentType || "",
            projectId: item.projectId || "",
            projectName: projName,
            vatAmount: Number(item.vatAmount || 0),
            netAmount: Number(item.netAmount || 0),
            employeeName: item.employeeName || "",
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // 3. WHT Entries (Save to wht_entries collection)
      const whtItems = enrichedItems.filter((item) => Number(item.whtAmount || 0) > 0);
      whtItems.forEach((item) => {
        const docRef = doc(db, "wht_entries", `${item.id}-wht`);
        const matchedProj = projectRecords.find(p => p.id === item.projectId || p.projectId === item.projectId);
        const projName = matchedProj?.projectName || item.projectId || "";
        operations.push({
          ref: docRef,
          data: {
            id: `${item.id}-wht`,
            date: item.documentDate || "",
            invoiceNo: item.invoiceNo || "",
            vendorName: item.vendorName || "",
            vendorTaxId: item.vendorTaxId || "",
            documentType: item.documentType || "",
            projectId: item.projectId || "",
            projectName: projName,
            whtRate: item.whtRate || "NONE",
            whtAmount: Number(item.whtAmount || 0),
            netAmount: Number(item.netAmount || 0),
            employeeName: item.employeeName || "",
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // 4. Document Tracking (Save to document_tracking collection)
      const trackingSource = documentTracking.length > 0
        ? documentTracking
        : enrichedItems.map((item) => ({
            id: item.id,
            documentNo: item.invoiceNo || item.advId,
            documentType: item.documentType,
            status: item.originalDocReceived ? "RECEIVED" : "WAITING_ORIGINAL_DOC",
            employeeName: item.employeeName,
            projectId: item.projectId,
            amount: item.netAmount,
            createdAt: item.documentDate,
            vendorName: item.vendorName,
          }));
      trackingSource.forEach((row) => {
        const docRef = doc(db, "document_tracking", row.id);
        operations.push({
          ref: docRef,
          data: {
            id: row.id,
            documentNo: row.documentNo || "",
            documentType: row.documentType || "",
            employeeName: row.employeeName || "",
            projectName: row.projectName || row.projectId || "",
            amount: Number(row.amount || 0),
            status: row.status || "",
            createdAt: row.createdAt || "",
            updatedAt: new Date().toISOString().split("T")[0],
            originalRequired: row.originalRequired || false,
            originalReceived: row.originalReceived || false,
            receivedAt: row.receivedAt || "",
            receivedBy: row.receivedBy || "",
            documentCompleteness: row.documentCompleteness || "COMPLETE",
            note: row.note || ""
          }
        });
      });

      // 5. Projects with Cost Stats (Save directly onto the PROJECTS collection document)
      projectCostRows.forEach((project) => {
        const docRef = doc(db, "projects", project.id);
        operations.push({
          ref: docRef,
          data: {
            totalAdvanceRequested: Number(project.totalAdvanceRequested || 0),
            totalAdvanceApproved: Number(project.totalAdvanceRequested || 0),
            totalClearingSubmitted: Number(project.totalClearingApproved || 0),
            totalClearingApproved: Number(project.totalClearingApproved || 0),
            outstandingAmount: Number(project.outstandingAmount || 0),
            remainingPettyCashBudget: Number(project.remainingPettyCashBudget || 0),
            variance: Number(project.variance || 0),
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // 6. Vendor Reports (Save to vendor_reports collection)
      const vendorMap = new Map<string, GenericRecord>();
      enrichedItems.forEach((item) => {
        const key = item.vendorName || "ไม่ระบุผู้ขาย";
        const current = vendorMap.get(key) || { vendorName: key, vendorTaxId: item.vendorTaxId || "", billCount: 0, netAmount: 0, vatAmount: 0, whtAmount: 0 };
        current.billCount += 1;
        current.netAmount += Number(item.netAmount || 0);
        current.vatAmount += Number(item.vatAmount || 0);
        current.whtAmount += Number(item.whtAmount || 0);
        vendorMap.set(key, current);
      });
      Array.from(vendorMap.values()).forEach((row) => {
        const slug = row.vendorName.replace(/[^a-zA-Z0-9ก-๙]/g, "_").toLowerCase() || "unknown";
        const docRef = doc(db, "vendor_reports", slug);
        operations.push({
          ref: docRef,
          data: {
            id: slug,
            vendorName: row.vendorName,
            vendorTaxId: row.vendorTaxId,
            billCount: row.billCount,
            netAmount: row.netAmount,
            vatAmount: row.vatAmount,
            whtAmount: row.whtAmount,
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // 7. Employee Outstanding Reports (Save to employee_outstanding_reports collection)
      const employeeMap = new Map<string, GenericRecord>();
      advances.forEach((adv) => {
        const key = adv.employeeId || adv.employeeName || "unknown";
        const current = employeeMap.get(key) || {
          employeeId: adv.employeeId || key,
          employeeName: adv.employeeName || "ไม่ระบุพนักงาน",
          advanceCount: 0,
          outstandingCount: 0,
          requestAmount: 0,
          outstandingAmount: 0,
          latestAdvId: "",
          latestDate: "",
        };
        current.advanceCount += 1;
        current.requestAmount += Number(adv.requestAmount || 0);
        const outstanding = Number(adv.outstandingAmount || 0);
        current.outstandingAmount += outstanding;
        if (outstanding > 0) current.outstandingCount += 1;
        const advDate = asDate(adv.createdAt);
        if (!current.latestDate || advDate > current.latestDate) {
          current.latestDate = advDate;
          current.latestAdvId = adv.advId;
        }
        employeeMap.set(key, current);
      });
      Array.from(employeeMap.values()).forEach((row) => {
        const docRef = doc(db, "employee_outstanding_reports", row.employeeId);
        operations.push({
          ref: docRef,
          data: {
            id: row.employeeId,
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            advanceCount: row.advanceCount,
            outstandingCount: row.outstandingCount,
            requestAmount: row.requestAmount,
            outstandingAmount: row.outstandingAmount,
            latestAdvId: row.latestAdvId || "",
            latestDate: row.latestDate || "",
            lastUpdatedAt: new Date().toISOString()
          }
        });
      });

      // Execute batches
      let batch = writeBatch(db);
      let count = 0;
      for (const op of operations) {
        batch.set(op.ref, op.data, { merge: true });
        count++;
        if (count >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }

      setSyncSuccessMsg(`ประมวลผลและบันทึกรายงานลง Firestore สำเร็จ! รวม ${operations.length} รายการ (แยกประเภท: GL, VAT, WHT, ติดตามเอกสาร, สรุปผู้ขาย, ยอดค้างสะสม และงบโครงการบนฐานข้อมูล)`);
    } catch (err: any) {
      console.error("Error syncing reports to Firestore:", err);
      alert(`ไม่สามารถบันทึกรายงานได้: ${err.message}`);
    } finally {
      setSyncingToDb(false);
    }
  };

  const fileBaseName = `${reportDefinition.key}_report_${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-6" id="accounting_reports_tab">
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-stone-900 text-stone-50 rounded-lg">
              <BookOpen className="w-5 h-5" />
            </span>
            <h2 className="font-extrabold text-stone-950 text-lg tracking-tight">ศูนย์รายงานบัญชี</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1 font-medium">
            รวมรายงานบัญชี ภาษี เงินทดรอง เคลียร์ยอด โครงการ เอกสารต้นฉบับ Vendor และสรุปผู้บริหารจากข้อมูลจริงใน Firestore
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSyncReportsToFirestore}
            disabled={syncingToDb}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
          >
            {syncingToDb ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            {syncingToDb ? "กำลังบันทึก..." : "บันทึกรายงานลงฐานข้อมูล"}
          </button>
          <button
            type="button"
            onClick={() => setPreviewReport(reportDefinition)}
            className="px-3.5 py-2 bg-stone-950 hover:bg-stone-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-4 h-4" /> Preview
          </button>
          <button
            type="button"
            onClick={() => exportToExcel(exportRows, fileBaseName, "Report")}
            disabled={reportDefinition.rows.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button
            type="button"
            onClick={() => exportToCsv(exportRows, reportDefinition.columns, fileBaseName)}
            disabled={reportDefinition.rows.length === 0}
            className="px-3.5 py-2 bg-white border border-stone-200 hover:bg-stone-50 disabled:opacity-50 text-stone-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {syncSuccessMsg && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
          <Database className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1">
            <h4 className="text-xs font-bold text-indigo-950">อัปเดตข้อมูลบัญชีลงฐานข้อมูลสำเร็จ!</h4>
            <p className="text-xs text-indigo-700 leading-relaxed font-medium">{syncSuccessMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => setSyncSuccessMsg("")}
            className="p-1 hover:bg-indigo-100 rounded-lg text-indigo-400 hover:text-indigo-600 transition shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {REPORTS.map((report) => (
            <button
              key={report.key}
              type="button"
              onClick={() => setActiveReport(report.key)}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap border transition ${
                activeReport === report.key
                  ? "bg-stone-950 border-stone-950 text-white"
                  : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50"
              }`}
            >
              {report.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-stone-100">
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase flex items-center gap-1"><Calendar className="w-3 h-3" /> จากวันที่</span>
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase">ถึงวันที่</span>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase flex items-center gap-1"><Filter className="w-3 h-3" /> โครงการ</span>
            <select value={filters.project} onChange={(e) => setFilters({ ...filters, project: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="ALL">ทุกโครงการ</option>
              {options.projects.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase">สถานะ</span>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="ALL">ทุกสถานะ</option>
              {options.statuses.map((item) => <option key={item} value={item}>{getStatusText(item)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase">ผู้ขอเบิก</span>
            <select value={filters.requester} onChange={(e) => setFilters({ ...filters, requester: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="ALL">ทุกคน</option>
              {options.requesters.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase">Vendor</span>
            <select value={filters.vendor} onChange={(e) => setFilters({ ...filters, vendor: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="ALL">ทุก Vendor</option>
              {options.vendors.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase">ประเภทเอกสาร</span>
            <select value={filters.documentType} onChange={(e) => setFilters({ ...filters, documentType: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs">
              <option value="ALL">ทุกประเภท</option>
              {options.documentTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-stone-400 uppercase flex items-center gap-1"><Search className="w-3 h-3" /> เลข ADV / CLR</span>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="ADV" value={filters.advNo} onChange={(e) => setFilters({ ...filters, advNo: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono" />
              <input placeholder="CLR" value={filters.clrNo} onChange={(e) => setFilters({ ...filters, clrNo: e.target.value })} className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono" />
            </div>
          </label>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-xs font-semibold flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>บาง collection อ่านไม่ได้: {errors.slice(-3).join(" | ")}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {reportDefinition.summary.map((item) => (
          <div key={item.label} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">{item.label}</span>
            <p className="text-lg font-black text-stone-950 mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-stone-950">{reportDefinition.title}</h3>
            <p className="text-[11px] text-stone-500 mt-0.5">{reportDefinition.description}</p>
          </div>
          <span className="text-[10px] font-bold text-stone-400 shrink-0">{reportDefinition.rows.length.toLocaleString("th-TH")} รายการ</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-stone-400">
            <RefreshCw className="w-7 h-7 animate-spin mx-auto" />
            <p className="text-xs font-semibold mt-2">กำลังโหลดข้อมูลรายงานจาก Firestore...</p>
          </div>
        ) : reportDefinition.rows.length === 0 ? (
          <div className="py-16 text-center text-stone-400">
            <FileText className="w-8 h-8 mx-auto mb-2" />
            <p className="text-xs font-semibold">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-stone-50 border-b border-stone-200 text-[10px] text-stone-500 uppercase tracking-wider">
                <tr>
                  {reportDefinition.columns.map((col) => (
                    <th key={col.key} className={`px-4 py-3 font-black whitespace-nowrap ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reportDefinition.rows.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-stone-50/60">
                    {reportDefinition.columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 align-top ${col.align === "right" ? "text-right font-mono" : col.align === "center" ? "text-center" : ""}`}>
                        {replaceEmpty(row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewReport && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-stone-100 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-stone-950 text-base">{previewReport.title}</h3>
                <p className="text-xs text-stone-500 mt-1">วันที่ออกรายงาน: {new Date().toLocaleString("th-TH")}</p>
                <p className="text-[11px] text-stone-400 mt-1">
                  Filter: วันที่ {filters.dateFrom || "เริ่มต้น"} ถึง {filters.dateTo || "ล่าสุด"} | โครงการ {filters.project} | สถานะ {filters.status} | Vendor {filters.vendor}
                </p>
              </div>
              <button type="button" onClick={() => setPreviewReport(null)} className="p-2 hover:bg-stone-100 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {previewReport.summary.map((item) => (
                  <div key={item.label} className="border border-stone-200 rounded-xl p-3 bg-stone-50">
                    <span className="text-[10px] font-black text-stone-400 uppercase">{item.label}</span>
                    <p className="font-black text-stone-950 mt-1">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="border border-stone-200 rounded-xl overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-900 text-white text-[10px] uppercase tracking-wider">
                    <tr>
                      {previewReport.columns.map((col) => (
                        <th key={col.key} className={`px-3 py-2 font-black whitespace-nowrap ${col.align === "right" ? "text-right" : ""}`}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {previewReport.rows.slice(0, 200).map((row, idx) => (
                      <tr key={row.id || idx}>
                        {previewReport.columns.map((col) => (
                          <td key={col.key} className={`px-3 py-2 ${col.align === "right" ? "text-right font-mono" : ""}`}>
                            {replaceEmpty(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-stone-50 border-t border-stone-200">
                    <tr>
                      <td className="px-3 py-2 font-black" colSpan={previewReport.columns.length}>
                        ยอดรวมท้ายรายงาน: {previewReport.summary.map((item) => `${item.label} ${item.value}`).join(" | ")}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {previewReport.rows.length > 200 && <p className="text-[10px] text-stone-400">พรีวิวแสดง 200 รายการแรกเท่านั้น Export จะใช้ข้อมูลทั้งหมด</p>}
            </div>

            <div className="p-4 border-t border-stone-100 bg-stone-50 flex justify-end gap-2">
              <button type="button" onClick={() => window.print()} className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <Printer className="w-4 h-4" /> Print / PDF
              </button>
              <button type="button" onClick={() => exportToCsv(exportRows, previewReport.columns, fileBaseName)} className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button type="button" onClick={() => exportToExcel(exportRows, fileBaseName, "Report")} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
