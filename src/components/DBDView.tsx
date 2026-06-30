import React, { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { exportToExcel } from "../lib/excelExport";
import { getDocumentFormats, generateFormattedId, DocumentFormats, DEFAULT_DOCUMENT_FORMATS } from "../lib/idGenerator";
import { Advance, AdvanceStatus, ClearingItem, Employee, ClearingLog } from "../types";
import { 
  Search, 
  ChevronDown, 
  Grid, 
  List, 
  Briefcase, 
  Tag, 
  User, 
  Coins, 
  Receipt, 
  Download, 
  Database, 
  FileText, 
  ArrowRight,
  TrendingDown,
  FileSpreadsheet
} from "lucide-react";

export default function DBDView() {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [clearingItems, setClearingItems] = useState<ClearingItem[]>([]);
  const [clearingLogs, setClearingLogs] = useState<ClearingLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab State - defaults to Master Data Center (table3) as requested
  const [activeTab, setActiveTab] = useState<"table1" | "table2" | "table3">("table3");
  // Sub-menus are initially hidden until user clicks Master Data Center tab
  const [subMenusRevealed, setSubMenusRevealed] = useState(false);
  // View Mode for all tables
  const [viewMode, setViewMode] = useState<"table" | "card">("table");

  // Filtering & Searching States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [docFormats, setDocFormats] = useState<DocumentFormats>(DEFAULT_DOCUMENT_FORMATS);

  // Subscriptions to Firebase Firestore
  useEffect(() => {
    let advancesDone = false;
    let clearingDone = false;
    let clearingLogsDone = false;
    let employeesDone = false;
    
    getDocumentFormats()
      .then((formats) => setDocFormats(formats))
      .catch(err => console.error("Error loading doc formats in DBDView:", err));

    const checkDone = () => {
      if (advancesDone && clearingDone && clearingLogsDone && employeesDone) {
        setLoading(false);
      }
    };

    const unsubAdvances = onSnapshot(collection(db, "advances"), (snap) => {
      const list: Advance[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Advance));
      setAdvances(list);
      advancesDone = true;
      checkDone();
    }, (err) => {
      console.error("Error subscribing to advances inside DBDView:", err);
      advancesDone = true;
      checkDone();
    });

    const unsubClearing = onSnapshot(collection(db, "clearingItems"), (snap) => {
      const list: ClearingItem[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ClearingItem));
      setClearingItems(list);
      clearingDone = true;
      checkDone();
    }, (err) => {
      console.error("Error subscribing to clearingItems inside DBDView:", err);
      clearingDone = true;
      checkDone();
    });

    const unsubClearingLogs = onSnapshot(collection(db, "clearingLogs"), (snap) => {
      const list: ClearingLog[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ClearingLog));
      setClearingLogs(list);
      clearingLogsDone = true;
      checkDone();
    }, (err) => {
      console.error("Error subscribing to clearingLogs inside DBDView:", err);
      clearingLogsDone = true;
      checkDone();
    });

    const unsubEmployees = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
      employeesDone = true;
      checkDone();
    }, (err) => {
      console.error("Error subscribing to employees inside DBDView:", err);
      employeesDone = true;
      checkDone();
    });

    return () => {
      unsubAdvances();
      unsubClearing();
      unsubClearingLogs();
      unsubEmployees();
    };
  }, []);

  // Build employee lookup map
  const employeeMap = new Map<string, Employee>();
  employees.forEach((emp) => {
    employeeMap.set(emp.id, emp);
    if (emp.uid) {
      employeeMap.set(emp.uid, emp);
    }
  });

  // Extract unique projects and categories across resources
  const projectsList = Array.from(
    new Set([
      ...advances.map((a) => a.projectId),
    ].filter(Boolean))
  ).sort();

  const categoriesList = Array.from(
    new Set(advances.map((a) => a.category).filter(Boolean))
  ).sort();

  // Helper: Status translator
  const getThaiStatus = (status: AdvanceStatus | string) => {
    switch (status) {
      case AdvanceStatus.PENDING_APPROVAL:
        return "รออนุมัติ";
      case AdvanceStatus.WAITING_TRANSFER:
        return "รอโอนเงิน";
      case AdvanceStatus.WAITING_CLEARANCE:
        return "รอเคลียร์บิล";
      case AdvanceStatus.PENDING_AUDIT:
        return "รอตรวจสอบ";
      case AdvanceStatus.PARTIALLY_CLEARED:
        return "เคลียร์บางส่วน";
      case AdvanceStatus.RETURNED:
        return "บิลถูกตีกลับ";
      case AdvanceStatus.CLOSED:
        return "ปิดยอด";
      case AdvanceStatus.REJECTED:
        return "ปฏิเสธ";
      default:
        return status || "-";
    }
  };

  const getStatusBadge = (status: AdvanceStatus | string) => {
    const text = getThaiStatus(status);
    switch (status) {
      case AdvanceStatus.PENDING_APPROVAL:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_TRANSFER:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-250 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.WAITING_CLEARANCE:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PENDING_AUDIT:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.PARTIALLY_CLEARED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.RETURNED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.CLOSED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-900 text-white border border-stone-950 rounded-full whitespace-nowrap">{text}</span>;
      case AdvanceStatus.REJECTED:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-full whitespace-nowrap">{text}</span>;
      default:
        return <span className="px-2.5 py-1 text-[10px] font-bold bg-stone-100 text-stone-600 rounded-full whitespace-nowrap">{text}</span>;
    }
  };

  // ---------------------------------------------------------------------------
  // DATA CALCULATIONS
  // ---------------------------------------------------------------------------

  // 1. Table 1: Advance Request List
  const table1Data = advances.map((adv) => {
    const emp = employeeMap.get(adv.employeeId);
    const totalRequested = adv.requestAmount || 0;
    const totalCleared = adv.approvedClearingAmountTotal || 0;
    const outstandingBalance = totalRequested - totalCleared;

    return {
      id: adv.id,
      status: adv.status,
      advNo: adv.advId,
      requestDate: adv.createdAt ? new Date(adv.createdAt).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
      dueDate: adv.neededDate ? new Date(adv.neededDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
      requesterName: adv.employeeName || "-",
      projectName: adv.projectId || "-",
      sourceBankName: "ธนาคารกสิกรไทย (KBANK)",
      sourceAccountName: "บจก. คอนสตรัคเทค ไฟแนนเชียล",
      sourceAccountNo: "099-1-23456-7",
      recipientBankName: emp?.bankName || "-",
      recipientAccountNo: emp?.bankNo || "-",
      totalRequested,
      totalCleared,
      outstandingBalance,
      raw: adv,
    };
  });

  const filteredTable1 = table1Data.filter((row) => {
    const matchSearch =
      row.advNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.requesterName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.projectName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchProject = selectedProject ? row.raw.projectId === selectedProject : true;
    const matchCategory = selectedCategory ? row.raw.category === selectedCategory : true;
    const matchStatus = selectedStatus ? row.status === selectedStatus : true;

    const amt = row.totalRequested;
    const matchMin = minAmount ? amt >= parseFloat(minAmount) : true;
    const matchMax = maxAmount ? amt <= parseFloat(maxAmount) : true;

    return matchSearch && matchProject && matchCategory && matchStatus && matchMin && matchMax;
  });

  // 2. Table 2: Clearing List (with chronological Running Balance Carry Forward calculation per advance)
  const table2Data: any[] = [];
  advances.forEach((adv) => {
    const group = clearingItems.filter((item) => item.advId === adv.advId || item.advId === adv.id);

    // Sort clearing items inside advance by documentDate asc, then roundNo asc, then id asc
    group.sort((a, b) => {
      const dateA = a.documentDate || "";
      const dateB = b.documentDate || "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      if (a.roundNo !== b.roundNo) return a.roundNo - b.roundNo;
      return a.id.localeCompare(b.id);
    });

    let runningBalance = adv.requestAmount || 0;
    group.forEach((item) => {
      const carryForward = runningBalance;
      const totalAmount = item.netAmount || 0;
      const currentOutstanding = carryForward - totalAmount;
      runningBalance = currentOutstanding;

      table2Data.push({
        id: item.id,
        status: adv.status,
        clrNo: generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 0, { advId: adv.advId || item.advId || "", roundNo: item.roundNo || 1 }),
        refAdvNo: item.advId || adv.advId,
        itemDate: item.documentDate ? new Date(item.documentDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
        vendorName: item.vendorName || "-",
        taxId: item.vendorTaxId || "-",
        receiptNo: item.invoiceNo || "-",
        taxInvoiceNo: item.documentType === "Tax Invoice" ? item.invoiceNo || "-" : "-",
        itemDescription: item.itemName || "-",
        projectName: adv.projectId || "-",
        amountNet: item.netAmount || 0,
        vatAmount: item.vatAmount || 0,
        discountAmount: item.discount || 0,
        otherCost: item.otherExpenses || 0,
        carryForwardBalance: carryForward,
        totalAmount: totalAmount,
        currentOutstanding: currentOutstanding,
        rawItem: item,
        rawAdv: adv,
      });
    });
  });

  // Include orphan clearing items just in case
  const matchedItemIds = new Set(table2Data.map((d) => d.id));
  clearingItems.forEach((item) => {
    if (!matchedItemIds.has(item.id)) {
      table2Data.push({
        id: item.id,
        status: "WAITING_CLEARANCE",
        clrNo: generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 0, { advId: item.advId || "UNKNOWN", roundNo: item.roundNo || 1 }),
        refAdvNo: item.advId || "-",
        itemDate: item.documentDate ? new Date(item.documentDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
        vendorName: item.vendorName || "-",
        taxId: item.vendorTaxId || "-",
        receiptNo: item.invoiceNo || "-",
        taxInvoiceNo: item.documentType === "Tax Invoice" ? item.invoiceNo || "-" : "-",
        itemDescription: item.itemName || "-",
        projectName: "-",
        amountNet: item.netAmount || 0,
        vatAmount: item.vatAmount || 0,
        discountAmount: item.discount || 0,
        otherCost: item.otherExpenses || 0,
        carryForwardBalance: 0,
        totalAmount: item.netAmount || 0,
        currentOutstanding: -(item.netAmount || 0),
        rawItem: item,
        rawAdv: null,
      });
    }
  });

  const filteredTable2 = table2Data.filter((row) => {
    const matchSearch =
      row.clrNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.refAdvNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.itemDescription.toLowerCase().includes(searchTerm.toLowerCase());

    const matchProject = selectedProject ? row.projectName === selectedProject : true;
    const matchCategory = selectedCategory ? row.rawAdv?.category === selectedCategory : true;
    const matchStatus = selectedStatus ? row.status === selectedStatus : true;

    const amt = row.totalAmount;
    const matchMin = minAmount ? amt >= parseFloat(minAmount) : true;
    const matchMax = maxAmount ? amt <= parseFloat(maxAmount) : true;

    return matchSearch && matchProject && matchCategory && matchStatus && matchMin && matchMax;
  });

  // 3. Table 3: Master Data Center (Join of Table 1 and Table 2, atomized with 31 columns)
  const table3Data: any[] = [];
  advances.forEach((adv) => {
    const emp = employeeMap.get(adv.employeeId);
    const totalRequested = adv.requestAmount || 0;
    const totalCleared = adv.approvedClearingAmountTotal || 0;
    const outstandingBalance = totalRequested - totalCleared;

    const advCols = {
      adv_Status: adv.status,
      adv_ADV_No: adv.advId,
      adv_Request_Date: adv.createdAt ? new Date(adv.createdAt).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
      adv_Due_Date: adv.neededDate ? new Date(adv.neededDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
      adv_Requester_Name: adv.employeeName || "-",
      adv_Project_Name: adv.projectId || "-",
      adv_Source_Bank_Name: "ธนาคารกสิกรไทย (KBANK)",
      adv_Source_Account_Name: "บจก. คอนสตรัคเทค ไฟแนนเชียล",
      adv_Source_Account_No: "099-1-23456-7",
      adv_Recipient_Bank_Name: emp?.bankName || "-",
      adv_Recipient_Account_No: emp?.bankNo || "-",
      adv_Total_Requested: totalRequested,
      adv_Total_Cleared: totalCleared,
      adv_Outstanding_Balance: outstandingBalance,
    };

    const group = clearingItems.filter((item) => item.advId === adv.advId || item.advId === adv.id);

    if (group.length === 0) {
      // Empty clearing columns if no settlement items exist yet
      table3Data.push({
        id: `${adv.id}-no-clr`,
        ...advCols,
        clr_Status: "-",
        clr_CLR_No: "-",
        clr_Ref_ADV_No: "-",
        clr_Item_Date: "-",
        clr_Vendor_Name: "-",
        clr_Tax_ID: "-",
        clr_Receipt_No: "-",
        clr_Tax_Invoice_No: "-",
        clr_Item_Description: "-",
        clr_Project_Name: "-",
        clr_Amount_Net: 0,
        clr_VAT_Amount: 0,
        clr_Discount_Amount: 0,
        clr_Other_Cost: 0,
        clr_Carry_Forward_Balance: 0,
        clr_Total_Amount: 0,
        clr_Current_Outstanding: 0,
        rawAdv: adv,
        rawItem: null,
      });
    } else {
      group.sort((a, b) => {
        const dateA = a.documentDate || "";
        const dateB = b.documentDate || "";
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        if (a.roundNo !== b.roundNo) return a.roundNo - b.roundNo;
        return a.id.localeCompare(b.id);
      });

      let runningBalance = adv.requestAmount || 0;
      group.forEach((item) => {
        const carryForward = runningBalance;
        const totalAmount = item.netAmount || 0;
        const currentOutstanding = carryForward - totalAmount;
        runningBalance = currentOutstanding;

        const matchingLog = clearingLogs.find((log) => log.id === item.clearingLogId);
        const actualClearingNo = matchingLog?.clearingNo || generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 0, { advId: adv.advId || item.advId || "", roundNo: item.roundNo || 1 });

        // Splitting Logic to comply with Atomic Data Rule
        // Scenario A: Splitting by projectSplits
        if (item.projectSplits && item.projectSplits.length > 0) {
          const totalSplitAmt = item.projectSplits.reduce((acc, s) => acc + (s.amount || 0), 0) || 1;
          item.projectSplits.forEach((split, idx) => {
            const ratio = split.amount / totalSplitAmt;
            table3Data.push({
              id: `${item.id}-split-${idx}`,
              ...advCols,
              clr_Status: adv.status,
              clr_CLR_No: actualClearingNo,
              clr_Ref_ADV_No: item.advId || adv.advId || "",
              clr_Item_Date: item.documentDate ? new Date(item.documentDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
              clr_Vendor_Name: item.vendorName || "-",
              clr_Tax_ID: item.vendorTaxId || "-",
              clr_Receipt_No: item.invoiceNo || "-",
              clr_Tax_Invoice_No: item.documentType === "Tax Invoice" ? item.invoiceNo || "-" : "-",
              clr_Item_Description: item.itemName || "-",
              clr_Project_Name: adv.projectId || "-",
              clr_Amount_Net: split.amount || 0,
              clr_VAT_Amount: (item.vatAmount || 0) * ratio,
              clr_Discount_Amount: (item.discount || 0) * ratio,
              clr_Other_Cost: (item.otherExpenses || 0) * ratio,
              clr_Carry_Forward_Balance: carryForward * ratio,
              clr_Total_Amount: totalAmount * ratio,
              clr_Current_Outstanding: currentOutstanding * ratio,
              rawAdv: adv,
              rawItem: item,
            });
          });
        }
        // Scenario B: Splitting by lineItems
        else if (item.lineItems && item.lineItems.length > 0) {
          const totalLineAmt = item.lineItems.reduce((acc, l) => acc + (l.amount || 0), 0) || 1;
          item.lineItems.forEach((line, idx) => {
            const ratio = line.amount / totalLineAmt;
            table3Data.push({
              id: `${item.id}-line-${idx}`,
              ...advCols,
              clr_Status: adv.status,
              clr_CLR_No: actualClearingNo,
              clr_Ref_ADV_No: item.advId || adv.advId || "",
              clr_Item_Date: item.documentDate ? new Date(item.documentDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
              clr_Vendor_Name: item.vendorName || "-",
              clr_Tax_ID: item.vendorTaxId || "-",
              clr_Receipt_No: item.invoiceNo || "-",
              clr_Tax_Invoice_No: item.documentType === "Tax Invoice" ? item.invoiceNo || "-" : "-",
              clr_Item_Description: `${line.itemName} (x${line.qty || 1})`,
              clr_Project_Name: adv.projectId || "-",
              clr_Amount_Net: line.amount || 0,
              clr_VAT_Amount: (item.vatAmount || 0) * ratio,
              clr_Discount_Amount: (item.discount || 0) * ratio,
              clr_Other_Cost: (item.otherExpenses || 0) * ratio,
              clr_Carry_Forward_Balance: carryForward * ratio,
              clr_Total_Amount: totalAmount * ratio,
              clr_Current_Outstanding: currentOutstanding * ratio,
              rawAdv: adv,
              rawItem: item,
            });
          });
        }
        // Scenario C: Pure atomic row
        else {
          table3Data.push({
            id: item.id,
            ...advCols,
            clr_Status: adv.status,
            clr_CLR_No: actualClearingNo,
            clr_Ref_ADV_No: item.advId || adv.advId || "",
            clr_Item_Date: item.documentDate ? new Date(item.documentDate).toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-",
            clr_Vendor_Name: item.vendorName || "-",
            clr_Tax_ID: item.vendorTaxId || "-",
            clr_Receipt_No: item.invoiceNo || "-",
            clr_Tax_Invoice_No: item.documentType === "Tax Invoice" ? item.invoiceNo || "-" : "-",
            clr_Item_Description: item.itemName || "-",
            clr_Project_Name: adv.projectId || "-",
            clr_Amount_Net: item.netAmount || 0,
            clr_VAT_Amount: item.vatAmount || 0,
            clr_Discount_Amount: item.discount || 0,
            clr_Other_Cost: item.otherExpenses || 0,
            clr_Carry_Forward_Balance: carryForward,
            clr_Total_Amount: totalAmount,
            clr_Current_Outstanding: currentOutstanding,
            rawAdv: adv,
            rawItem: item,
          });
        }
      });
    }
  });

  const filteredTable3 = table3Data.filter((row) => {
    const matchSearch =
      row.adv_ADV_No.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.adv_Requester_Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.clr_CLR_No.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.clr_Vendor_Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.clr_Item_Description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchProject = selectedProject
      ? row.adv_Project_Name === selectedProject || row.clr_Project_Name === selectedProject
      : true;

    const matchCategory = selectedCategory ? row.rawAdv?.category === selectedCategory : true;
    const matchStatus = selectedStatus ? row.adv_Status === selectedStatus : true;

    const amt = row.adv_Total_Requested;
    const matchMin = minAmount ? amt >= parseFloat(minAmount) : true;
    const matchMax = maxAmount ? amt <= parseFloat(maxAmount) : true;

    return matchSearch && matchProject && matchCategory && matchStatus && matchMin && matchMax;
  });

  // Export to Excel Functionality
  const handleExportExcel = () => {
    const dataToExport = activeTab === "table1" ? filteredTable1 : activeTab === "table2" ? filteredTable2 : filteredTable3;
    const fileName = activeTab === "table1" ? "Advance_Requests" : activeTab === "table2" ? "Clearing_Records" : "Master_Data_Center";
    exportToExcel(dataToExport, `CFOP_${fileName}_${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <div className="space-y-6 font-sans text-stone-800" id="dbd_disbursement_menu">
      
      {/* Title block with custom aesthetic design */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-6 border border-stone-200 rounded-3xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-stone-900 text-white rounded-xl">
              <Database className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-extrabold text-stone-900 tracking-tight">
              ศูนย์รวมข้อมูลสถิติและการวิเคราะห์ต้นทุน (DBD Data Center)
            </h2>
          </div>
          <p className="text-xs text-stone-500 mt-1.5 ml-1">
            ข้อมูลแบบสูตรอะตอมมิก (Atomic Data Row) เพื่อการทำ Pivot Table วิเคราะห์ต้นทุนโครงการใน Excel ได้เสถียร 100%
          </p>
        </div>

        {/* Tab Selection */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full lg:w-auto">
          {/* Main Master Data Tab Button */}
          <button
            onClick={() => {
              setActiveTab("table3");
              setSubMenusRevealed(prev => !prev);
            }}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap border flex items-center gap-2 cursor-pointer ${
              activeTab === "table3"
                ? "bg-stone-900 text-stone-50 border-stone-900 shadow-sm"
                : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
            }`}
          >
            <Database className="w-4 h-4 text-emerald-500" />
            <span>มาสเตอร์ดาต้าเซ็นเตอร์ (หน้าแรก)</span>
            <span className="text-[9px] bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded">
              {subMenusRevealed ? "ซ่อนเมนูย่อย" : "กดดูตารางย่อย"}
            </span>
          </button>

          {/* Sub Menu of Table 1 & Table 2, visible only when revealed */}
          {subMenusRevealed && (
            <div className="flex items-center gap-1 bg-stone-100 p-1.5 rounded-2xl border border-stone-200 animate-fade-in shrink-0">
              <button
                onClick={() => setActiveTab("table1")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeTab === "table1"
                    ? "bg-white text-stone-950 shadow-xs"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                ตารางรายการเบิก (Table 1)
              </button>
              <button
                onClick={() => setActiveTab("table2")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeTab === "table2"
                    ? "bg-white text-stone-950 shadow-xs"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                ตารางรายการเคลียร์ (Table 2)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Control Actions & Global Filters */}
      <div className="bg-white border border-stone-200 rounded-3xl p-5 shadow-xs space-y-4">
        
        {/* Top bar with Search & Export & View switch */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
          
          {/* Real-time search */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-stone-400" />
            </span>
            <input
              type="text"
              placeholder={
                activeTab === "table1"
                  ? "ค้นหาด้วย รหัสใบเบิก, พนักงาน, โครงการ..."
                  : activeTab === "table2"
                  ? "ค้นหาด้วย เลขใบเคลียร์, พนักงาน, ผู้ขาย, สินค้า..."
                  : "ค้นหาได้ทุกคอลัมน์ในฐานข้อมูลร่วม..."
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800 font-medium"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Excel export button */}
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-xs rounded-2xl transition shadow-xs"
              title="ส่งออกเป็นไฟล์ Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export to Excel</span>
            </button>

            {/* View Mode Toggle for ALL tables */}
            <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg transition ${
                  viewMode === "table" ? "bg-white text-stone-900 shadow-xs font-bold" : "text-stone-500 hover:text-stone-800"
                }`}
                title="Table View"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("card")}
                className={`p-1.5 rounded-lg transition ${
                  viewMode === "card" ? "bg-white text-stone-900 shadow-xs font-bold" : "text-stone-500 hover:text-stone-800"
                }`}
                title="Card View"
              >
                <Grid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Dimensional Filter Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-stone-100/60">
          
          {/* Project dropdown */}
          <div className="relative">
            <label className="block text-[10px] font-extrabold text-stone-400 uppercase mb-1">โครงการ</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800 font-bold appearance-none"
            >
              <option value="">ทั้งหมด (ทุกโครงการ)</option>
              {projectsList.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="absolute bottom-3 right-3 flex items-center pointer-events-none">
              <ChevronDown className="w-4 h-4 text-stone-400" />
            </span>
          </div>

          {/* Category dropdown */}
          <div className="relative">
            <label className="block text-[10px] font-extrabold text-stone-400 uppercase mb-1">หมวดหมู่ค่าใช้จ่าย</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800 font-bold appearance-none"
            >
              <option value="">ทั้งหมด (ทุกหมวดหมู่)</option>
              {categoriesList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="absolute bottom-3 right-3 flex items-center pointer-events-none">
              <ChevronDown className="w-4 h-4 text-stone-400" />
            </span>
          </div>

          {/* Status dropdown */}
          <div className="relative">
            <label className="block text-[10px] font-extrabold text-stone-400 uppercase mb-1">สถานะ</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800 font-bold appearance-none"
            >
              <option value="">ทั้งหมด (ทุกสถานะ)</option>
              <option value="PENDING_APPROVAL">รออนุมัติ</option>
              <option value="WAITING_TRANSFER">รอโอนเงิน</option>
              <option value="WAITING_CLEARANCE">รอเคลียร์บิล</option>
              <option value="PENDING_AUDIT">รอตรวจสอบ</option>
              <option value="PARTIALLY_CLEARED">เคลียร์บางส่วน</option>
              <option value="RETURNED">บิลถูกตีกลับ</option>
              <option value="CLOSED">ปิดยอดแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
            </select>
            <span className="absolute bottom-3 right-3 flex items-center pointer-events-none">
              <ChevronDown className="w-4 h-4 text-stone-400" />
            </span>
          </div>

          {/* Amount boundaries */}
          <div>
            <label className="block text-[10px] font-extrabold text-stone-400 uppercase mb-1">ช่วงงบประมาณ (บาท)</label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="ขั้นต่ำ"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800"
              />
              <span className="text-stone-300 font-medium text-[11px]">-</span>
              <input
                type="number"
                placeholder="สูงสุด"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-900 text-stone-800"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Render Area */}
      {loading ? (
        <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-xs">
          <div className="animate-pulse space-y-4 max-w-md mx-auto">
            <div className="h-5 bg-stone-200 rounded-full w-1/3 mx-auto"></div>
            <div className="h-9 bg-stone-200 rounded-2xl"></div>
            <div className="h-4 bg-stone-200 rounded-full w-2/3 mx-auto"></div>
          </div>
        </div>
      ) : (
        <>
          {/* TAB 1: ADVANCE LIST */}
          {activeTab === "table1" && (
            viewMode === "table" ? (
              <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden animate-fade-in">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        {/* Fixed sticky columns 1 & 2 as requested */}
                        <th className="sticky left-0 bg-stone-50 z-10 min-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider">
                          1. Status
                        </th>
                        <th className="sticky left-[120px] bg-stone-50 z-10 min-w-[140px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider">
                          2. ADV_No
                        </th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[110px]">3. Request_Date</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[110px]">4. Due_Date</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[140px]">5. Requester_Name</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[140px]">6. Project_Name</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[150px]">7. Source_Bank</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[160px]">8. Source_Acc_Name</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[120px]">9. Source_Acc_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[150px]">10. Recipient_Bank</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[120px]">11. Recipient_Acc_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[120px]">12. Total_Requested</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[120px]">13. Total_Cleared</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[130px]">14. Outstanding_Bal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 font-semibold text-stone-700">
                      {filteredTable1.length === 0 ? (
                        <tr>
                          <td colSpan={14} className="py-12 text-center text-stone-400 font-medium">
                            ไม่พบข้อมูลสถิติที่ตรงกับคำค้นหา
                          </td>
                        </tr>
                      ) : (
                        filteredTable1.map((row) => (
                          <tr key={row.id} className="hover:bg-stone-50/50 transition">
                            <td className="sticky left-0 bg-white z-5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-4">
                              {getStatusBadge(row.status)}
                            </td>
                            <td className="sticky left-[120px] bg-white z-5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-4 font-bold font-mono text-stone-900">
                              {row.advNo}
                            </td>
                            <td className="py-3 px-4 font-mono text-stone-600">{row.requestDate}</td>
                            <td className="py-3 px-4 font-mono text-stone-600">{row.dueDate}</td>
                            <td className="py-3 px-4 text-stone-900">{row.requesterName}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-1 bg-stone-100 border border-stone-200 text-stone-800 text-[11px] rounded-lg font-bold">
                                {row.projectName}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-stone-600">{row.sourceBankName}</td>
                            <td className="py-3 px-4 text-stone-600">{row.sourceAccountName}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.sourceAccountNo}</td>
                            <td className="py-3 px-4 text-stone-600">{row.recipientBankName}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.recipientAccountNo}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-stone-900">
                              {row.totalRequested.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-emerald-600">
                              {row.totalCleared > 0 ? `+${row.totalCleared.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "0.00"}
                            </td>
                            <td className={`py-3 px-4 text-right font-mono font-bold ${row.outstandingBalance > 0 ? "text-amber-600" : "text-stone-400"}`}>
                              {row.outstandingBalance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Table 1 Card View */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
                {filteredTable1.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-stone-400 bg-white border border-stone-200 rounded-3xl">
                    ไม่พบข้อมูลสถิติที่ตรงกับคำค้นหา
                  </div>
                ) : (
                  filteredTable1.map((row) => (
                    <div
                      key={row.id}
                      className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs hover:shadow-sm transition flex flex-col justify-between gap-4 relative overflow-hidden"
                    >
                      <div>
                        <div className="flex justify-between items-start border-b border-stone-100 pb-3">
                          <div>
                            <span className="font-mono font-black text-stone-900 text-sm block">{row.advNo}</span>
                            <span className="text-[10px] text-stone-400 font-mono block mt-0.5">
                              วันที่ขอเบิก: {row.requestDate} | กำหนดเคลียร์: {row.dueDate}
                            </span>
                          </div>
                          {getStatusBadge(row.status)}
                        </div>

                        <div className="mt-3.5 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-400">ผู้ขอเบิก:</span>
                            <span className="font-bold text-stone-800">{row.requesterName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">โครงการ:</span>
                            <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 rounded font-bold">
                              {row.projectName}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-stone-100 pt-2">
                            <span className="text-stone-400">บัญชีผู้รับ:</span>
                            <span className="font-mono text-stone-600 text-right">
                              {row.recipientBankName}<br />
                              <span className="text-[10px] text-stone-400">{row.recipientAccountNo}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-stone-50 border border-stone-150 p-3 rounded-xl grid grid-cols-3 gap-2 text-center text-[11px] font-mono">
                        <div>
                          <span className="text-stone-400 text-[9px] font-bold block uppercase mb-1">ขอเบิก</span>
                          <span className="font-bold text-stone-900">฿{row.totalRequested.toLocaleString("th-TH")}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 text-[9px] font-bold block uppercase mb-1">เคลียร์แล้ว</span>
                          <span className="font-bold text-emerald-600">฿{row.totalCleared.toLocaleString("th-TH")}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 text-[9px] font-bold block uppercase mb-1">คงค้าง</span>
                          <span className={`font-bold ${row.outstandingBalance > 0 ? "text-amber-600" : "text-stone-500"}`}>
                            ฿{row.outstandingBalance.toLocaleString("th-TH")}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          )}

          {/* TAB 2: CLEARING LIST */}
          {activeTab === "table2" && (
            viewMode === "table" ? (
              <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden animate-fade-in">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[120px]">1. Status</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[150px]">2. CLR_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[140px]">3. Ref_ADV_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[110px]">4. Item_Date</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[140px]">5. Vendor_Name</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[130px]">6. Tax_ID</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[110px]">7. Receipt_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[120px]">8. Tax_Invoice_No</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[160px]">9. Item_Description</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider min-w-[130px]">10. Project_Name</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[110px]">11. Amount_Net</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[100px]">12. VAT_Amount</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[110px]">13. Discount_Amt</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[100px]">14. Other_Cost</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[130px] bg-stone-100/65 font-bold">15. Carry_Forward_Bal</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[110px]">16. Total_Amount</th>
                        <th className="py-3 px-4 text-stone-500 uppercase font-extrabold text-[10px] tracking-wider text-right min-w-[130px] bg-amber-50/65 font-bold">17. Current_Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 font-semibold text-stone-700">
                      {filteredTable2.length === 0 ? (
                        <tr>
                          <td colSpan={17} className="py-12 text-center text-stone-400 font-medium">
                            ไม่พบข้อมูลรายการเคลียร์ที่ตรงกับคำค้นหา
                          </td>
                        </tr>
                      ) : (
                        filteredTable2.map((row, idx) => (
                          <tr key={row.id + "-" + idx} className="hover:bg-stone-50/50 transition">
                            <td className="py-3 px-4">{getStatusBadge(row.status)}</td>
                            <td className="py-3 px-4 font-bold font-mono text-stone-900">{row.clrNo}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.refAdvNo}</td>
                            <td className="py-3 px-4 font-mono text-stone-600">{row.itemDate}</td>
                            <td className="py-3 px-4 text-stone-800">{row.vendorName}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.taxId}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.receiptNo}</td>
                            <td className="py-3 px-4 font-mono text-stone-500">{row.taxInvoiceNo}</td>
                            <td className="py-3 px-4 text-stone-600 max-w-[160px] truncate" title={row.itemDescription}>
                              {row.itemDescription}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 text-[10px] rounded font-extrabold">
                                {row.projectName}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono">{row.amountNet.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right font-mono text-stone-500">{row.vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right font-mono text-red-600">{row.discountAmount > 0 ? `-${row.discountAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "0.00"}</td>
                            <td className="py-3 px-4 text-right font-mono text-stone-500">{row.otherCost.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold bg-stone-50/70 text-stone-900">
                              {row.carryForwardBalance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-stone-800">{row.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                            <td className={`py-3 px-4 text-right font-mono font-extrabold bg-amber-50/40 ${row.currentOutstanding > 0 ? "text-amber-700" : "text-stone-400"}`}>
                              {row.currentOutstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Table 2 Card View */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
                {filteredTable2.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-stone-400 bg-white border border-stone-200 rounded-3xl">
                    ไม่พบข้อมูลรายการเคลียร์ที่ตรงกับคำค้นหา
                  </div>
                ) : (
                  filteredTable2.map((row, idx) => (
                    <div
                      key={row.id + "-t2card-" + idx}
                      className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs hover:shadow-sm transition flex flex-col justify-between gap-4 relative overflow-hidden"
                    >
                      <div>
                        <div className="flex justify-between items-start border-b border-stone-100 pb-3">
                          <div>
                            <span className="font-mono font-black text-stone-900 text-sm block">{row.clrNo}</span>
                            <span className="text-[10px] text-stone-400 font-mono block mt-0.5">
                              อ้างอิงใบเบิก: {row.refAdvNo} | วันที่บิล: {row.itemDate}
                            </span>
                          </div>
                          {getStatusBadge(row.status)}
                        </div>

                        <div className="mt-3.5 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-400">ร้านค้า / ผู้ขาย:</span>
                            <span className="font-bold text-stone-800 text-right">
                              {row.vendorName}<br />
                              <span className="text-[10px] text-stone-400 font-mono">Tax ID: {row.taxId}</span>
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">เลขที่ใบเสร็จ/ใบกำกับ:</span>
                            <span className="font-mono text-stone-700">{row.receiptNo}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">โครงการ:</span>
                            <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 rounded font-bold">
                              {row.projectName}
                            </span>
                          </div>
                          <div className="p-2.5 bg-stone-50 border border-stone-200/60 rounded-xl space-y-1 mt-2">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-stone-500">รายการ:</span>
                              <span className="font-bold text-stone-800 truncate max-w-[150px]" title={row.itemDescription}>
                                {row.itemDescription}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                              <span className="text-stone-500">ยอดสุทธิ (Net):</span>
                              <span className="font-mono font-bold text-stone-800">฿{row.amountNet.toLocaleString("th-TH")}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs bg-stone-50/50 p-2.5 rounded-xl border border-stone-150 font-mono">
                        <div>
                          <span className="text-[9px] text-stone-400 font-extrabold block uppercase">ยอดยกมา</span>
                          <span className="font-bold text-stone-800">฿{row.carryForwardBalance.toLocaleString("th-TH")}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] text-stone-400 font-extrabold block uppercase">คงค้างรวม</span>
                          <span className={`font-black ${row.currentOutstanding > 0 ? "text-amber-600" : "text-stone-400"}`}>
                            ฿{row.currentOutstanding.toLocaleString("th-TH")}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          )}

          {/* TAB 3: MASTER DATA CENTER */}
          {activeTab === "table3" && (
            <>
              {viewMode === "table" ? (
                /* Master Database Grid - 31 Columns Horizontal Scroll */
                <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs table-layout-fixed">
                      <thead>
                        {/* Split headers into categories */}
                        <tr className="bg-stone-900 text-white text-[9px] font-black uppercase tracking-widest text-center border-b border-stone-950">
                          <th colSpan={14} className="py-2.5 bg-stone-900 text-stone-100 border-r border-stone-800">
                            SECTION 1: ADVANCE DETAILS (14 COLS)
                          </th>
                          <th colSpan={17} className="py-2.5 bg-stone-850 text-stone-200">
                            SECTION 2: CLEARANCE (SETTLEMENT) DATA (17 COLS)
                          </th>
                        </tr>
                        <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-extrabold text-[10px] tracking-wide">
                          {/* 14 ADV Cols */}
                          <th className="sticky left-0 bg-stone-50 z-10 min-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-3">1. Adv_Status</th>
                          <th className="sticky left-[120px] bg-stone-50 z-10 min-w-[130px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-3 px-3 font-bold">2. ADV_No</th>
                          <th className="py-3 px-3 min-w-[105px] bg-stone-100/50">3. Request_Date</th>
                          <th className="py-3 px-3 min-w-[105px] bg-stone-100/50">4. Due_Date</th>
                          <th className="py-3 px-3 min-w-[140px] bg-stone-100/50">5. Requester_Name</th>
                          <th className="py-3 px-3 min-w-[130px] bg-stone-100/50">6. Project_Name</th>
                          <th className="py-3 px-3 min-w-[130px] bg-stone-100/50">7. Source_Bank</th>
                          <th className="py-3 px-3 min-w-[150px] bg-stone-100/50">8. Source_Acc_Name</th>
                          <th className="py-3 px-3 min-w-[110px] bg-stone-100/50">9. Source_Acc_No</th>
                          <th className="py-3 px-3 min-w-[130px] bg-stone-100/50">10. Recipient_Bank</th>
                          <th className="py-3 px-3 min-w-[110px] bg-stone-100/50">11. Recipient_Acc_No</th>
                          <th className="py-3 px-3 text-right min-w-[125px] bg-stone-100/50">12. Total_Requested</th>
                          <th className="py-3 px-3 text-right min-w-[125px] bg-stone-100/50">13. Total_Cleared</th>
                          <th className="py-3 px-3 text-right min-w-[125px] bg-stone-100/50 border-r border-stone-200 font-black">14. Outstanding_Bal</th>

                          {/* 17 CLR Cols */}
                          <th className="py-3 px-3 min-w-[120px] bg-stone-50">15. Clearing_Status</th>
                          <th className="py-3 px-3 min-w-[150px] bg-stone-50 font-bold text-stone-900">16. CLR_No</th>
                          <th className="py-3 px-3 min-w-[130px] bg-stone-50">17. Ref_ADV_No</th>
                          <th className="py-3 px-3 min-w-[105px] bg-stone-50">18. Item_Date</th>
                          <th className="py-3 px-3 min-w-[140px] bg-stone-50">19. Vendor_Name</th>
                          <th className="py-3 px-3 min-w-[120px] bg-stone-50">20. Tax_ID</th>
                          <th className="py-3 px-3 min-w-[110px] bg-stone-50">21. Receipt_No</th>
                          <th className="py-3 px-3 min-w-[120px] bg-stone-50">22. Tax_Invoice_No</th>
                          <th className="py-3 px-3 min-w-[180px] bg-stone-50">23. Item_Description</th>
                          <th className="py-3 px-3 min-w-[130px] bg-stone-50 font-bold text-stone-900">24. Clearing_Project</th>
                          <th className="py-3 px-3 text-right min-w-[115px] bg-stone-50">25. Amount_Net</th>
                          <th className="py-3 px-3 text-right min-w-[100px] bg-stone-50">26. VAT_Amount</th>
                          <th className="py-3 px-3 text-right min-w-[105px] bg-stone-50">27. Discount_Amt</th>
                          <th className="py-3 px-3 text-right min-w-[100px] bg-stone-50">28. Other_Cost</th>
                          <th className="py-3 px-3 text-right min-w-[130px] bg-amber-50/40 font-bold">29. Carry_Forward_Bal</th>
                          <th className="py-3 px-3 text-right min-w-[115px] bg-stone-50">30. Total_Amount</th>
                          <th className="py-3 px-3 text-right min-w-[130px] bg-emerald-50/40 font-extrabold text-emerald-800">31. Current_Outstanding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 font-semibold text-stone-700">
                        {filteredTable3.length === 0 ? (
                          <tr>
                            <td colSpan={31} className="py-16 text-center text-stone-400 font-medium">
                              ไม่มีข้อมูลสอดคล้องตามเงื่อนไขการกรอง
                            </td>
                          </tr>
                        ) : (
                          filteredTable3.map((row, index) => (
                            <tr key={row.id + "-datacenter-" + index} className="hover:bg-stone-50/50 transition">
                              
                              {/* 14 ADV Cells */}
                              <td className="sticky left-0 bg-white z-5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-2.5 px-3">{getStatusBadge(row.adv_Status)}</td>
                              <td className="sticky left-[120px] bg-white z-5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] py-2.5 px-3 font-bold font-mono text-stone-900">{row.adv_ADV_No}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-500 bg-stone-50/20">{row.adv_Request_Date}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-500 bg-stone-50/20">{row.adv_Due_Date}</td>
                              <td className="py-2.5 px-3 text-stone-800 bg-stone-50/20">{row.adv_Requester_Name}</td>
                              <td className="py-2.5 px-3 bg-stone-50/20">
                                <span className="px-1.5 py-0.5 bg-stone-100 text-stone-700 text-[10px] rounded font-bold">
                                  {row.adv_Project_Name}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-stone-500 bg-stone-50/20">{row.adv_Source_Bank_Name}</td>
                              <td className="py-2.5 px-3 text-stone-500 bg-stone-50/20">{row.adv_Source_Account_Name}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400 bg-stone-50/20">{row.adv_Source_Account_No}</td>
                              <td className="py-2.5 px-3 text-stone-500 bg-stone-50/20">{row.adv_Recipient_Bank_Name}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400 bg-stone-50/20">{row.adv_Recipient_Account_No}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-stone-900 bg-stone-50/20">
                                {row.adv_Total_Requested.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-stone-500 bg-stone-50/20">
                                {row.adv_Total_Cleared.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-800 bg-stone-50/20 border-r border-stone-200">
                                {row.adv_Outstanding_Balance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>

                              {/* 17 CLR Cells */}
                              <td className="py-2.5 px-3">{row.clr_CLR_No !== "-" ? getStatusBadge(row.clr_Status) : "-"}</td>
                              <td className="py-2.5 px-3 font-bold font-mono text-stone-900">{row.clr_CLR_No}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400">{row.clr_Ref_ADV_No}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-500">{row.clr_Item_Date}</td>
                              <td className="py-2.5 px-3 text-stone-800">{row.clr_Vendor_Name}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400">{row.clr_Tax_ID}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400">{row.clr_Receipt_No}</td>
                              <td className="py-2.5 px-3 font-mono text-stone-400">{row.clr_Tax_Invoice_No}</td>
                              <td className="py-2.5 px-3 text-stone-600 max-w-[180px] truncate" title={row.clr_Item_Description}>
                                {row.clr_Item_Description}
                              </td>
                              <td className="py-2.5 px-3">
                                {row.clr_Project_Name !== "-" ? (
                                  <span className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 text-[10px] rounded font-bold">
                                    {row.clr_Project_Name}
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">{row.clr_Amount_Net.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-stone-400">{row.clr_VAT_Amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-red-500">{row.clr_Discount_Amount > 0 ? `-${row.clr_Discount_Amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "0.00"}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-stone-400">{row.clr_Other_Cost.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold bg-amber-50/20 text-stone-800">
                                {row.clr_Carry_Forward_Balance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-800">{row.clr_Total_Amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                              <td className={`py-2.5 px-3 text-right font-mono font-black bg-emerald-50/10 ${row.clr_Current_Outstanding > 0 ? "text-emerald-700" : "text-stone-400"}`}>
                                {row.clr_Current_Outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* Master Database Card View */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredTable3.length === 0 ? (
                    <div className="col-span-full py-12 text-center text-stone-400 bg-white border border-stone-200 rounded-3xl">
                      ไม่มีข้อมูลสอดคล้องตามเงื่อนไขการกรอง
                    </div>
                  ) : (
                    filteredTable3.map((row, index) => (
                      <div
                        key={row.id + "-card-" + index}
                        className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs hover:shadow-sm transition flex flex-col justify-between gap-5 relative overflow-hidden"
                      >
                        {/* High-Contrast Section Label Badge */}
                        <div className="absolute top-0 right-0 bg-stone-900 text-white text-[9px] font-black px-2.5 py-0.5 rounded-bl-lg uppercase tracking-widest">
                          Atomic Item
                        </div>

                        <div className="space-y-4">
                          {/* Part 1: Advance Info Header */}
                          <div className="border-b border-stone-100 pb-3">
                            <span className="text-[9px] font-black uppercase text-stone-400 block tracking-widest">1. Parent Advance</span>
                            <div className="flex justify-between items-center mt-1">
                              <div>
                                <span className="font-mono font-black text-stone-900 text-sm block">{row.adv_ADV_No}</span>
                                <span className="text-[10px] text-stone-400 font-mono block mt-0.5">
                                  ยื่นเมื่อ: {row.adv_Request_Date} | โครงการ: {row.adv_Project_Name}
                                </span>
                              </div>
                              {getStatusBadge(row.adv_Status)}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-stone-600 bg-stone-50 p-2 rounded-xl">
                              <div>
                                <span className="text-stone-400 text-[9px] font-bold block uppercase">พนักงานผู้ขอ</span>
                                <span className="font-bold text-stone-800">{row.adv_Requester_Name}</span>
                              </div>
                              <div>
                                <span className="text-stone-400 text-[9px] font-bold block uppercase">ยอดรวมเบิกตั้งต้น</span>
                                <span className="font-bold text-stone-900 font-mono">฿{row.adv_Total_Requested.toLocaleString("th-TH")}</span>
                              </div>
                            </div>
                          </div>

                          {/* Part 2: Settlement/Clearing details inside atomic row */}
                          <div className="space-y-2.5">
                            <span className="text-[9px] font-black uppercase text-stone-400 block tracking-widest">2. Settlement Line</span>
                            
                            {row.clr_CLR_No !== "-" ? (
                              <>
                                <div className="flex justify-between items-start">
                                  <div>
                                    <span className="font-mono font-black text-stone-800 text-xs block">{row.clr_CLR_No}</span>
                                    <span className="text-[10px] text-stone-400 block font-mono mt-0.5">วันที่: {row.clr_Item_Date}</span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[10px] font-extrabold text-stone-800 block truncate max-w-[130px]" title={row.clr_Vendor_Name}>
                                      {row.clr_Vendor_Name}
                                    </span>
                                    <span className="text-[9px] text-stone-400 block font-mono">Tax ID: {row.clr_Tax_ID}</span>
                                  </div>
                                </div>

                                <div className="p-2.5 bg-stone-50 border border-stone-200/60 rounded-xl space-y-1.5">
                                  <div className="flex justify-between text-[11px]">
                                    <span className="text-stone-500">รายละเอียดสินค้า:</span>
                                    <span className="font-bold text-stone-800 truncate max-w-[150px]">{row.clr_Item_Description}</span>
                                  </div>
                                  <div className="flex justify-between text-[11px]">
                                    <span className="text-stone-500">ใช้จริงโครงการ:</span>
                                    <span className="font-extrabold text-stone-800">{row.clr_Project_Name}</span>
                                  </div>
                                  <div className="flex justify-between text-[11px] border-t border-stone-200/50 pt-1.5 mt-1">
                                    <span className="text-stone-500">มูลค่าสุทธิ (Amount Net):</span>
                                    <span className="font-mono font-bold text-stone-900">฿{row.clr_Amount_Net.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="text-center py-6 text-stone-400 text-xs border border-dashed border-stone-200 rounded-xl bg-stone-50">
                                ยังไม่มีรายการหักล้างใดๆ บนใบเบิกนี้
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Part 3: Step running calculation summary at the card bottom */}
                        {row.clr_CLR_No !== "-" && (
                          <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs bg-stone-50/50 p-2.5 rounded-xl border border-stone-150">
                            <div>
                              <span className="text-[9px] text-stone-400 font-extrabold block uppercase">29. ยอดยกมา (Carry Forward)</span>
                              <span className="font-mono font-bold text-stone-800">฿{row.clr_Carry_Forward_Balance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[9px] text-stone-400 font-extrabold block uppercase">31. ยอดคงค้าง (Outstanding)</span>
                              <span className={`font-mono font-black text-sm block ${row.clr_Current_Outstanding > 0 ? "text-amber-600" : "text-stone-400"}`}>
                                ฿{row.clr_Current_Outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
