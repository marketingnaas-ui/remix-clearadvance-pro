/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, doc, getDocs, setDoc, query, where, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/errorUtils";
import { performAIOCR, OCRResult } from "../lib/gemini";
import { triggerAutoSyncSheetsIfEnabled, triggerAutoSyncVaultFoldersIfEnabled } from "../lib/workspaceSync";
import { sendLineNotification } from "../lib/lineNotify";
import { Advance, AdvanceStatus, ClearingLog, ClearingItem, ActionType, AuditLog, Employee, SystemSettings } from "../types";
import { exportToExcel } from "../lib/excelExport";
import { getDocumentFormats, generateFormattedId } from "../lib/idGenerator";
import { Sparkles, FileText, Camera, Upload, Check, AlertTriangle, Calculator, DollarSign, RefreshCw, Layers, Plus, Trash2, HelpCircle, Image as ImageIcon, X, Eye, FileSpreadsheet } from "lucide-react";
import AILoadingModal from "./AILoadingModal";
import ImagePreviewModal from "./ImagePreviewModal";

interface EmployeeClearanceProps {
  currentEmployee: Employee;
  onSuccess: () => void;
  editingDraftClearingId?: string | null;
}

export interface PreparedBill {
  id: string;
  vendorName: string;
  vendorTaxId: string;
  documentType: string;
  invoiceNo: string;
  documentDate: string;
  lineItems: { itemName: string; qty: number; unitPrice: number; amount: number; projectId?: string }[];
  vatType: "INCLUDED" | "EXCLUDED" | "NONE";
  whtRate: "NONE" | "1%" | "3%" | "5%";
  discount: number;
  otherExpenseName: string;
  otherExpenseAmount: number;
  imageUrl: string;
  ocrConfidence: number;
  rawOcrJson?: string;
  projectMode: "SINGLE" | "SPLIT";
  singleProjectId: string;
  remarks?: string;
  isManualEntry?: boolean;
}

export default function EmployeeClearance({ currentEmployee, onSuccess, editingDraftClearingId }: EmployeeClearanceProps) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [selectedAdvId, setSelectedAdvId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // System Settings state for Project Options
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  const createEmptyBill = (): PreparedBill => ({
    id: `bill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    vendorName: "",
    vendorTaxId: "",
    documentType: "Receipt",
    invoiceNo: "",
    documentDate: new Date().toISOString().split("T")[0],
    lineItems: [{ itemName: "", qty: 1, unitPrice: 0, amount: 0 }],
    vatType: "NONE",
    whtRate: "NONE",
    discount: 0,
    otherExpenseName: "ค่าบริการเพิ่มเติม",
    otherExpenseAmount: 0,
    imageUrl: "",
    ocrConfidence: 0,
    projectMode: "SINGLE",
    singleProjectId: "",
    remarks: "",
    isManualEntry: true,
  });

  // Prepared bills list (defaults to one empty bill)
  const [preparedBills, setPreparedBills] = useState<PreparedBill[]>([]);
  const [activeBillIndex, setActiveBillIndex] = useState<number>(0);

  // Initialize prepared bills if empty
  useEffect(() => {
    if (preparedBills.length === 0) {
      setPreparedBills([createEmptyBill()]);
    }
  }, [preparedBills]);

  const activeBill = preparedBills[activeBillIndex] || {
    id: "",
    vendorName: "",
    vendorTaxId: "",
    documentType: "Receipt",
    invoiceNo: "",
    documentDate: new Date().toISOString().split("T")[0],
    lineItems: [{ itemName: "", qty: 1, unitPrice: 0, amount: 0 }],
    vatType: "NONE",
    whtRate: "NONE",
    discount: 0,
    otherExpenseName: "ค่าบริการเพิ่มเติม",
    otherExpenseAmount: 0,
    imageUrl: "",
    ocrConfidence: 0,
    projectMode: "SINGLE",
    singleProjectId: "",
  };

  // Helper to update the active bill state
  const updateActiveBill = (fields: Partial<PreparedBill>) => {
    setPreparedBills((prev) => {
      const next = [...prev];
      if (next[activeBillIndex]) {
        next[activeBillIndex] = { ...next[activeBillIndex], ...fields };
      }
      return next;
    });
  };

  const calculateBillTotals = (bill: PreparedBill) => {
    const baseItemPrice = bill.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const taxableBase = baseItemPrice - bill.discount + bill.otherExpenseAmount;

    let calculatedPreVat = taxableBase;
    let calculatedVat = 0;
    let calculatedGross = taxableBase;

    if (bill.vatType === "INCLUDED") {
      calculatedPreVat = taxableBase / 1.07;
      calculatedVat = taxableBase - calculatedPreVat;
      calculatedGross = taxableBase;
    } else if (bill.vatType === "EXCLUDED") {
      calculatedPreVat = taxableBase;
      calculatedVat = taxableBase * 0.07;
      calculatedGross = taxableBase + calculatedVat;
    } else {
      calculatedPreVat = taxableBase;
      calculatedVat = 0;
      calculatedGross = taxableBase;
    }

    const whtPercent = bill.whtRate === "1%" ? 0.01 : bill.whtRate === "3%" ? 0.03 : bill.whtRate === "5%" ? 0.05 : 0;
    const calculatedWht = calculatedPreVat * whtPercent;
    const calculatedNet = calculatedGross - calculatedWht;

    return {
      baseItemPrice,
      taxableBase,
      calculatedPreVat,
      calculatedVat,
      calculatedGross,
      calculatedWht,
      calculatedNet,
    };
  };

  const activeTotals = calculateBillTotals(activeBill);

  useEffect(() => {
    // Fetch settings for list of project options
    const fetchSettings = async () => {
      try {
        const snap = await getDocs(collection(db, "settings"));
        snap.forEach((d) => {
          if (d.id === "global") setSettings(d.data() as SystemSettings);
        });
      } catch (err) {
        console.error("Error fetching settings inside EmployeeClearance:", err);
      }
    };
    fetchSettings();

    // Fetch advances owned by the employee in status waiting clearance, partially cleared, or returned
    const q = query(
      collection(db, "advances"),
      where("employeeId", "==", currentEmployee.id),
      where("status", "in", [AdvanceStatus.WAITING_CLEARANCE, AdvanceStatus.PARTIALLY_CLEARED, AdvanceStatus.RETURNED])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Advance[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Advance);
      });
      setAdvances(list);
      if (list.length > 0) {
        setSelectedAdvId(list[0].id);
      }
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, "advances", false);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentEmployee]);

  // Load draft clearing items if we are editing a draft
  useEffect(() => {
    if (editingDraftClearingId) {
      const loadDraft = async () => {
        try {
          const logSnap = await getDocs(
            query(collection(db, "clearingLogs"), where("id", "==", editingDraftClearingId))
          );
          if (!logSnap.empty) {
            const logData = logSnap.docs[0].data() as ClearingLog;

            // Also find the parent Advance
            const advSnap = await getDocs(
              query(collection(db, "advances"), where("advId", "==", logData.advId))
            );
            if (!advSnap.empty) {
              const matchedAdv = advSnap.docs[0];
              setAdvances((prev) => {
                const exists = prev.some((a) => a.id === matchedAdv.id);
                if (!exists) {
                  return [{ id: matchedAdv.id, ...matchedAdv.data() } as Advance, ...prev];
                }
                return prev;
              });
              setSelectedAdvId(matchedAdv.id);
            }

            // Fetch draft ClearingItems
            const itemSnap = await getDocs(
              query(collection(db, "clearingItems"), where("clearingLogId", "==", editingDraftClearingId))
            );
            if (!itemSnap.empty) {
              const loadedBills: PreparedBill[] = [];
              itemSnap.forEach((docSnap) => {
                const itemData = docSnap.data() as ClearingItem;
                const lines = itemData.lineItems && itemData.lineItems.length > 0
                  ? itemData.lineItems.map((line) => ({
                      itemName: line.itemName,
                      qty: line.qty || 1,
                      unitPrice: line.unitPrice || 0,
                      amount: line.amount || (line.qty * line.unitPrice),
                      projectId: line.projectId || itemData.projectSplits?.[0]?.projectId || "",
                    }))
                  : [{
                      itemName: itemData.itemName || "",
                      qty: itemData.qty || 1,
                      unitPrice: itemData.unitPrice || 0,
                      amount: itemData.netAmount || 0,
                      projectId: itemData.projectSplits?.[0]?.projectId || "",
                    }];

                const hasSplitProjects = lines.some((line) => line.projectId && line.projectId !== lines[0]?.projectId);

                loadedBills.push({
                  id: docSnap.id, // preserve document ID for correct overwrite
                  vendorName: itemData.vendorName || "",
                  vendorTaxId: itemData.vendorTaxId || "",
                  documentType: itemData.documentType || "Receipt",
                  invoiceNo: itemData.invoiceNo || "",
                  documentDate: itemData.documentDate || "",
                  lineItems: lines,
                  vatType: itemData.vatType || "NONE",
                  whtRate: itemData.whtRate || "NONE",
                  discount: itemData.discount || 0,
                  otherExpenseName: "ค่าบริการเพิ่มเติม",
                  otherExpenseAmount: itemData.otherExpenses || 0,
                  imageUrl: itemData.imageUrl || "",
                  ocrConfidence: itemData.ocrConfidence || 100,
                  rawOcrJson: itemData.rawOcrJson || "",
                  projectMode: hasSplitProjects ? "SPLIT" : "SINGLE",
                  singleProjectId: lines[0]?.projectId || "",
                });
              });

              if (loadedBills.length > 0) {
                setPreparedBills(loadedBills);
                setActiveBillIndex(0);
              }
            }
          }
        } catch (err) {
          console.error("Error loading draft clearance:", err);
        }
      };
      loadDraft();
    }
  }, [editingDraftClearingId]);

  const areMerchantsEqual = (m1: OCRResult, m2: PreparedBill): boolean => {
    if (m1.vendorTaxId && m2.vendorTaxId) {
      const cleanTax1 = m1.vendorTaxId.replace(/\D/g, "");
      const cleanTax2 = m2.vendorTaxId.replace(/\D/g, "");
      if (cleanTax1 && cleanTax2 && cleanTax1 === cleanTax2) {
        return true;
      }
    }

    const name1 = (m1.vendorName || "").toLowerCase().replace(/\s+/g, "");
    const name2 = (m2.vendorName || "").toLowerCase().replace(/\s+/g, "");

    if (!name1 || !name2) return false;

    if (name1 === name2 || name1.includes(name2) || name2.includes(name1)) {
      return true;
    }

    const cleanName = (name: string) => {
      return name
        .replace(/จำกัด/g, "")
        .replace(/บจก/g, "")
        .replace(/บริษัท/g, "")
        .replace(/ห้างหุ้นส่วนจำกัด/g, "")
        .replace(/หจก/g, "")
        .replace(/co\.,?ltd/g, "")
        .replace(/ltd/g, "")
        .replace(/inc/g, "");
    };

    const cn1 = cleanName(name1);
    const cn2 = cleanName(name2);

    if (cn1 === cn2 || cn1.includes(cn2) || cn2.includes(cn1)) {
      return true;
    }

    return false;
  };

  // Handle uploading multiple files (Images / PDFs) and process via Gemini AI OCR
  const handleMultipleFilesAndOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setScanning(true);
    setError(null);
    setSuccess(null);

    const fileList = Array.from(files);
    let successCount = 0;
    let failCount = 0;

    const newlyPreparedBills = [...preparedBills];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i] as File;
      try {
        // Compress image using FileReader + Canvas if it is an image
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const rawResult = reader.result as string;
            if (file.type.startsWith("image/")) {
              const img = document.createElement("img");
              img.onload = () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 500;
                const MAX_HEIGHT = 500;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                  if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                  }
                } else {
                  if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                  }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0, width, height);
                const compressedBase64 = canvas.toDataURL("image/jpeg", 0.5);
                resolve(compressedBase64.split(",")[1]);
              };
              img.onerror = () => {
                resolve(rawResult.split(",")[1]);
              };
              img.src = rawResult;
            } else {
              resolve(rawResult.split(",")[1]);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Call client wrapper for Gemini OCR
        const result = await performAIOCR(base64Data, file.type, {
          id: currentEmployee.id,
          name: currentEmployee.name
        });
        successCount++;

        // Duplicate Check Logic
        let isDuplicate = false;
        let duplicateInfo = undefined;
        try {
          const qDup = query(collection(db, "clearingItems"), where("vendorName", "==", result.vendorName || ""), where("invoiceNo", "==", result.invoiceNo || ""), where("netAmount", "==", result.netAmount || 0));
          const snapDup = await getDocs(qDup);
          if (!snapDup.empty) {
            isDuplicate = true;
            const dupData = snapDup.docs[0].data();
            duplicateInfo = { advId: dupData.advId, date: dupData.documentDate };
          }
        } catch (e) {
          console.error("Dup check error", e);
        }

        // Determine if same merchant exists
        const existingBillIndex = newlyPreparedBills.findIndex((bill) => areMerchantsEqual(result, bill));
        const mockUrl = "https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=600";

        if (existingBillIndex >= 0) {
          // Merge under same merchant bill
          const existing = newlyPreparedBills[existingBillIndex];
          const mergedItems = [...existing.lineItems];
          if (result.items && result.items.length > 0) {
            result.items.forEach((item) => {
              mergedItems.push({
                itemName: item.itemName,
                qty: item.qty || 1,
                unitPrice: item.unitPrice || 0,
                amount: item.amount || (item.qty * item.unitPrice),
              });
            });
          }

          const mergedImageUrl = existing.imageUrl ? `${existing.imageUrl},${mockUrl}` : mockUrl;

          newlyPreparedBills[existingBillIndex] = {
            ...existing,
            lineItems: mergedItems,
            imageUrl: mergedImageUrl,
            discount: (existing.discount || 0) + (result.discount || 0),
            otherExpenseAmount: (existing.otherExpenseAmount || 0) + (result.otherExpenses || 0),
            rawOcrJson: existing.rawOcrJson ? `${existing.rawOcrJson}\n\n${JSON.stringify(result, null, 2)}` : JSON.stringify(result, null, 2),
            ocrConfidence: Math.round((existing.ocrConfidence + (result.confidenceScore || 85)) / 2),
            isManualEntry: false,
          };
        } else {
          // Different merchant: Add new bill record
          const newBill: PreparedBill = {
            id: `bill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            vendorName: result.vendorName || "",
            vendorTaxId: result.vendorTaxId || "",
            documentType: result.documentType || "Receipt",
            invoiceNo: result.invoiceNo || "",
            documentDate: result.documentDate || new Date().toISOString().split("T")[0],
            lineItems: result.items && result.items.length > 0
              ? result.items.map((item) => ({
                  itemName: item.itemName,
                  qty: item.qty || 1,
                  unitPrice: item.unitPrice || 0,
                  amount: item.amount || (item.qty * item.unitPrice),
                }))
              : [{ itemName: "", qty: 1, unitPrice: 0, amount: 0 }],
            vatType: result.vatType || "NONE",
            whtRate: result.whtRate || "NONE",
            discount: result.discount || 0,
            otherExpenseName: "ค่าบริการเพิ่มเติม",
            otherExpenseAmount: result.otherExpenses || 0,
            imageUrl: mockUrl,
            ocrConfidence: result.confidenceScore || 85,
            rawOcrJson: JSON.stringify(result, null, 2),
            projectMode: "SINGLE",
            singleProjectId: "",
            remarks: isDuplicate ? `⚠️ ตรวจพบข้อมูลซ้ำกับรายการ ${duplicateInfo?.advId} เมื่อวันที่ ${duplicateInfo?.date}` : "",
            isManualEntry: false,
          };

          // If first item is empty placeholder, replace it
          if (newlyPreparedBills.length === 1 && !newlyPreparedBills[0].vendorName && newlyPreparedBills[0].lineItems.length === 1 && !newlyPreparedBills[0].lineItems[0].itemName) {
            newlyPreparedBills[0] = newBill;
          } else {
            newlyPreparedBills.push(newBill);
          }
        }
      } catch (err) {
        console.error(err);
        failCount++;
      }
    }

    setPreparedBills(newlyPreparedBills);
    setActiveBillIndex(newlyPreparedBills.length - 1);

    if (failCount === 0) {
      setSuccess(`AI วิเคราะห์เอกสารสำเร็จครบทั้งหมด ${successCount} ใบ!`);
    } else {
      setError(`วิเคราะห์เอกสารสำเร็จ ${successCount} ใบ, ล้มเหลว ${failCount} ใบ`);
    }
    setScanning(false);
  };

  const handleAddLineItem = () => {
    const updatedItems = [...activeBill.lineItems, { itemName: "", qty: 1, unitPrice: 0, amount: 0 }];
    updateActiveBill({ lineItems: updatedItems });
  };

  const handleRemoveLineItem = (idx: number) => {
    if (activeBill.lineItems.length <= 1) return;
    const updatedItems = activeBill.lineItems.filter((_, i) => i !== idx);
    updateActiveBill({ lineItems: updatedItems });
  };

  const handleLineItemChange = (idx: number, field: string, value: any) => {
    const updatedItems = activeBill.lineItems.map((item, i) => {
      if (i === idx) {
        const updated = { ...item, [field]: value };
        if (field === "qty" || field === "unitPrice") {
          const q = field === "qty" ? value : item.qty;
          const p = field === "unitPrice" ? value : item.unitPrice;
          updated.amount = q * p;
        } else if (field === "amount") {
          // If total amount is changed, auto-calculate unit price
          const q = item.qty || 1;
          updated.unitPrice = value / q;
        }
        return updated;
      }
      return item;
    });
    updateActiveBill({ lineItems: updatedItems });
  };

  const getTotalSubmittedAmountAllBills = () => {
    return preparedBills.reduce((sum, bill) => {
      return sum + calculateBillTotals(bill).calculatedNet;
    }, 0);
  };

  // Submit Clearance round to Accountant
  const handleSubmitClearance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdvId) {
      setError("กรุณาเลือกรายการใบเบิกเงินที่ต้องการเคลียร์ยอด");
      return;
    }

    // Validate all prepared bills
    for (let b = 0; b < preparedBills.length; b++) {
      const bill = preparedBills[b];
      const billNum = preparedBills.length > 1 ? ` (ใบเสร็จที่ ${b + 1})` : "";

      if (!bill.vendorName.trim()) {
        setError(`กรุณากรอกชื่อร้านค้าสำหรับใบเสร็จ${billNum}`);
        return;
      }

      if (bill.projectMode === "SINGLE" && !bill.singleProjectId) {
        setError(`กรุณาเลือกโครงการสำหรับใบเสร็จ${billNum}`);
        return;
      }

      for (let i = 0; i < bill.lineItems.length; i++) {
        const item = bill.lineItems[i];
        if (!item.itemName.trim()) {
          setError(`กรุณากรอกรายละเอียดรายการสินค้า/บริการ ลำดับที่ ${i + 1} สำหรับใบเสร็จ${billNum}`);
          return;
        }
        if (item.amount < 100) {
          setError(`กรุณาระบุจำนวนเงินรวมที่มีค่าไม่ต่ำกว่า 100 บาท สำหรับรายการ ลำดับที่ ${i + 1} สำหรับใบเสร็จ${billNum}`);
          return;
        }
        if (bill.projectMode === "SPLIT" && !item.projectId) {
          setError(`กรุณาเลือกโครงการสำหรับรายการ ลำดับที่ ${i + 1} สำหรับใบเสร็จ${billNum}`);
          return;
        }
      }
    }

    setShowReviewModal(true);
  };

  const sanitizeForFirestore = (obj: any): any => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeForFirestore(item));
    }
    if (typeof obj === "object") {
      const cleaned: any = {};
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val !== undefined) {
          cleaned[key] = sanitizeForFirestore(val);
        }
      }
      return cleaned;
    }
    return obj;
  };

  const handleSaveClearanceDraft = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const selectedAdv = advances.find((a) => a.id === selectedAdvId);
      if (!selectedAdv) throw new Error("Advance not found.");

      // Calculate round number
      let nextRoundNo = 1;
      if (editingDraftClearingId) {
        const logSnap = await getDocs(query(collection(db, "clearingLogs"), where("id", "==", editingDraftClearingId)));
        if (!logSnap.empty) {
          nextRoundNo = logSnap.docs[0].data().roundNo || 1;
        }
      } else {
        const roundSnap = await getDocs(
          query(collection(db, "clearingLogs"), where("advId", "==", selectedAdv.advId))
        );
        nextRoundNo = roundSnap.size + 1;
      }

      const logId = editingDraftClearingId || `log-${Date.now()}`;

      // 1. Create draft Clearing Round Log
      const totalNetSum = getTotalSubmittedAmountAllBills();
      const docFormats = await getDocumentFormats();
      const clearingNo = generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 0, { advId: selectedAdv.advId, roundNo: nextRoundNo });
      const newLog: ClearingLog = {
        id: logId,
        advId: selectedAdv.advId,
        roundNo: nextRoundNo,
        submittedBy: currentEmployee.name,
        submittedAt: new Date().toISOString(),
        status: "DRAFT",
        totalSubmittedAmount: totalNetSum,
        totalApprovedAmount: 0,
        clearingNo,
      };

      await setDoc(doc(db, "clearingLogs", logId), sanitizeForFirestore(newLog));

      // 2. Save each prepared bill as separate clearingItems
      for (let b = 0; b < preparedBills.length; b++) {
        const bill = preparedBills[b];
        const totals = calculateBillTotals(bill);
        const itemId = bill.id.startsWith("bill-") ? `item-${Date.now()}-${b}` : bill.id;

        const primaryProjectId = (bill.projectMode === "SINGLE"
          ? bill.singleProjectId
          : (bill.lineItems[0]?.projectId || selectedAdv.projectId)) || selectedAdv.projectId || "";

        const newItem: ClearingItem = {
          id: itemId,
          clearingLogId: logId,
          advId: selectedAdv.advId,
          roundNo: nextRoundNo,
          vendorName: bill.vendorName || "",
          vendorTaxId: bill.vendorTaxId || "",
          documentType: bill.documentType,
          invoiceNo: bill.invoiceNo || "",
          documentDate: bill.documentDate || "",
          // Backward-compatible properties
          itemName: bill.lineItems[0]?.itemName || "",
          qty: bill.lineItems[0]?.qty || 1,
          unitPrice: bill.lineItems[0]?.unitPrice || 0,
          lineItems: bill.lineItems.map((item) => ({
            itemName: item.itemName || "",
            qty: item.qty || 1,
            unitPrice: item.unitPrice || 0,
            amount: item.amount || 0,
            projectId: item.projectId || primaryProjectId,
          })),
          vatType: bill.vatType,
          vatAmount: totals.calculatedVat,
          whtRate: bill.whtRate,
          whtAmount: totals.calculatedWht,
          discount: bill.discount || 0,
          otherExpenses: bill.otherExpenseAmount || 0,
          netAmount: totals.calculatedNet,
          imageUrl: bill.imageUrl || "https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=600",
          ocrConfidence: bill.ocrConfidence || 100,
          isDuplicate: false,
          accountantApproved: false,
          rawOcrJson: bill.rawOcrJson || "",
          projectSplits: bill.lineItems.map((item) => ({
            projectId: item.projectId || primaryProjectId,
            amount: item.amount || 0,
          })),
        };

        await setDoc(doc(db, "clearingItems", itemId), sanitizeForFirestore(newItem));
      }

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      setSuccess(`บันทึกร่างเอกสารเคลียร์ยอดทั้งหมด (${preparedBills.length} ใบ) สำหรับใบเบิก ${selectedAdv.advId} รอบที่ ${nextRoundNo} สำเร็จแล้ว!`);
      setShowReviewModal(false);

      // Reset
      setPreparedBills([createEmptyBill()]);
      setActiveBillIndex(0);

      setTimeout(() => {
        onSuccess();
      }, 3000);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการบันทึกข้อมูลร่างเคลียร์ยอด");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSubmitClearance = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const selectedAdv = advances.find((a) => a.id === selectedAdvId);
      if (!selectedAdv) throw new Error("Advance not found.");

      // Calculate round number
      let nextRoundNo = 1;
      if (editingDraftClearingId) {
        const logSnap = await getDocs(query(collection(db, "clearingLogs"), where("id", "==", editingDraftClearingId)));
        if (!logSnap.empty) {
          nextRoundNo = logSnap.docs[0].data().roundNo || 1;
        }
      } else {
        const roundSnap = await getDocs(
          query(collection(db, "clearingLogs"), where("advId", "==", selectedAdv.advId))
        );
        nextRoundNo = roundSnap.size + 1;
      }

      const logIdPrefix = editingDraftClearingId || `log-${Date.now()}`;
      
      // Group preparedBills by vendor if we want "แยกรายการเลขที่ใบเคลียร์คนละเลขที่"
      // However, usually one submission is one log. 
      // But user specifically said: "แยกรายการเลขที่ใบเคลียร์คนละเลขที่"
      // So I will create ONE log PER PreparedBill (since each PreparedBill represents a unique merchant/vendor in my current logic)

      for (let b = 0; b < preparedBills.length; b++) {
        const bill = preparedBills[b];
        const totals = calculateBillTotals(bill);
        const currentLogId = preparedBills.length > 1 ? `${logIdPrefix}-${b}` : logIdPrefix;
        
        // 1. Create/Update Clearing Round Log with PENDING status
        const docFormats = await getDocumentFormats();
        const clearingNo = generateFormattedId(docFormats.clearing || "CLR-{advId}-{roundNo}", 0, { advId: selectedAdv.advId, roundNo: nextRoundNo + b });
        const newLog: ClearingLog = {
          id: currentLogId,
          advId: selectedAdv.advId,
          roundNo: nextRoundNo + b, // increment round number for each vendor if multiple
          submittedBy: currentEmployee.name,
          submittedAt: new Date().toISOString(),
          status: "PENDING",
          totalSubmittedAmount: totals.calculatedNet,
          totalApprovedAmount: 0,
          clearingNo,
        };

        await setDoc(doc(db, "clearingLogs", currentLogId), sanitizeForFirestore(newLog));

        // 2. Save this bill as clearingItem
        const itemId = bill.id.startsWith("bill-") ? `item-${Date.now()}-${b}` : bill.id;
        const primaryProjectId = (bill.projectMode === "SINGLE"
          ? bill.singleProjectId
          : (bill.lineItems[0]?.projectId || selectedAdv.projectId)) || selectedAdv.projectId || "";

        const newItem: ClearingItem = {
          id: itemId,
          clearingLogId: currentLogId,
          advId: selectedAdv.advId,
          roundNo: nextRoundNo + b,
          vendorName: bill.vendorName || "",
          vendorTaxId: bill.vendorTaxId || "",
          documentType: bill.documentType,
          invoiceNo: bill.invoiceNo || "",
          documentDate: bill.documentDate || "",
          itemName: bill.lineItems[0]?.itemName || "",
          qty: bill.lineItems[0]?.qty || 1,
          unitPrice: bill.lineItems[0]?.unitPrice || 0,
          lineItems: bill.lineItems.map((item) => ({
            itemName: item.itemName || "",
            qty: item.qty || 1,
            unitPrice: item.unitPrice || 0,
            amount: item.amount || 0,
            projectId: item.projectId || primaryProjectId,
          })),
          vatType: bill.vatType,
          vatAmount: totals.calculatedVat,
          whtRate: bill.whtRate,
          whtAmount: totals.calculatedWht,
          discount: bill.discount || 0,
          otherExpenses: bill.otherExpenseAmount || 0,
          netAmount: totals.calculatedNet,
          imageUrl: bill.imageUrl || "https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=600",
          ocrConfidence: bill.ocrConfidence || 100,
          isDuplicate: false,
          accountantApproved: false,
          rawOcrJson: bill.rawOcrJson || "",
          projectSplits: bill.lineItems.map((item) => ({
            projectId: item.projectId || primaryProjectId,
            amount: item.amount || 0,
          })),
        };

        await setDoc(doc(db, "clearingItems", itemId), sanitizeForFirestore(newItem));

        // Save attachment in vault
        const vaultId = `file-${Date.now()}-${b}`;
        await setDoc(doc(db, "vaultFiles", vaultId), sanitizeForFirestore({
          id: vaultId,
          advId: selectedAdv.advId,
          fileType: "RECEIPT",
          fileUrl: newItem.imageUrl,
          fileName: `บิลเคลียร์ยอด-${bill.vendorName}-${selectedAdv.advId}.jpg`,
          uploadedBy: currentEmployee.name,
          uploadedAt: new Date().toISOString(),
        }));
      }

      // 3. Update parent advance status to PENDING_AUDIT
      await updateDoc(doc(db, "advances", selectedAdv.id), {
        status: AdvanceStatus.PENDING_AUDIT,
      });

      // 4. Create Audit Log
      const auditId = `audit-${Date.now()}`;
      const totalNetSum = getTotalSubmittedAmountAllBills();
      await setDoc(doc(db, "auditLogs", auditId), sanitizeForFirestore({
        id: auditId,
        advId: selectedAdv.advId,
        actionType: ActionType.SUBMIT_CLEARING,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: selectedAdv.status,
        afterStatus: AdvanceStatus.PENDING_AUDIT,
        note: `ยื่นเอกสารหลักฐานเคลียร์ยอด (แยกตามร้านค้า) ทั้งหมด ${preparedBills.length} ใบเสร็จ รวมเป็นเงิน ${totalNetSum.toLocaleString("th-TH")} บาท`,
      } as AuditLog));

      // Trigger automatic background Workspace sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      sendLineNotification({
        triggerId: "onClearanceSubmitted",
        variables: {
          advId: selectedAdv.advId,
          employeeName: currentEmployee.name,
          amount: totalNetSum.toLocaleString("th-TH"),
          status: "ยื่นเคลียร์เงินแล้ว (รอตรวจสอบบิล)",
          projectName: selectedAdv.projectId,
          category: selectedAdv.category,
          remark: `ส่งบิลจำนวน ${preparedBills.length} ใบเสร็จ`,
          date: new Date().toLocaleDateString("th-TH")
        },
        targetEmployeeId: selectedAdv.employeeId
      });

      setSuccess(`ยื่นใบสำคัญจ่ายและเคลียร์ยอดใบเบิก ${selectedAdv.advId} รอบที่ ${nextRoundNo} สำเร็จแล้ว! อยู่ระหว่างให้บัญชีตรวจสอบ`);
      setShowReviewModal(false);

      // Reset
      setPreparedBills([createEmptyBill()]);
      setActiveBillIndex(0);

      setTimeout(() => {
        onSuccess();
      }, 5000);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการส่งข้อมูลตรวจสอบเอกสารเคลียร์ยอด");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNewBill = () => {
    const newBill = createEmptyBill();
    setPreparedBills((prev) => [...prev, newBill]);
    setActiveBillIndex(preparedBills.length);
  };

  const handleDeleteBill = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (preparedBills.length <= 1) return;
    setPreparedBills((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Adjust active index
      if (activeBillIndex >= next.length) {
        setActiveBillIndex(Math.max(0, next.length - 1));
      } else if (activeBillIndex === idx) {
        setActiveBillIndex(Math.max(0, idx - 1));
      }
      return next;
    });
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(val);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in" id="employee_clearance_tab">
      <AILoadingModal isOpen={scanning} message="iClear Bot กำลังวิเคราะห์ใบเสร็จ..." />
      <ImagePreviewModal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} imageUrl={previewImage} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-stone-900 text-stone-100 rounded-xl">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-stone-900">บันทึกเคลียร์บิลและใบเสร็จ (AI OCR Workspace)</h2>
            <p className="text-xs text-stone-500">อัปโหลดรูปภาพใบเสร็จหรือไฟล์ PDF หลายใบพร้อมกันเพื่อสแกนด้วย Gemini AI และตรวจสอบในระบบเดียว</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => exportToExcel(preparedBills, `My_Clearance_Draft_${new Date().toISOString().split('T')[0]}`)}
          className="px-4 py-2 bg-white border border-stone-200 text-emerald-700 hover:bg-emerald-50 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
          title="ส่งออกรายการบิลที่กรองไว้เป็น Excel"
        >
          <FileSpreadsheet className="w-4 h-4" /> <span>Export Draft to Excel</span>
        </button>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-600 animate-pulse" />
          {success}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 animate-bounce" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-stone-500">กำลังตรวจสอบข้อมูลใบเบิกที่รอเคลียร์...</div>
      ) : advances.length === 0 ? (
        <div className="text-center py-16 bg-white border border-stone-200 rounded-2xl text-stone-500 space-y-3">
          <FileText className="w-10 h-10 mx-auto text-stone-300" />
          <p className="text-sm">คุณไม่มีประวัติใบขอเบิกค้างเคลียร์ (WAITING_CLEARANCE) ในขณะนี้</p>
        </div>
      ) : (
        <form onSubmit={handleSubmitClearance} className="space-y-6">
          {/* Active selection of Advance Document */}
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                เลือกคำขอเบิกเงินทดรองจ่ายที่ต้องการเคลียร์ยอดบิล *
              </label>
              <select
                required
                value={selectedAdvId}
                onChange={(e) => {
                  setSelectedAdvId(e.target.value);
                  setError(null);
                }}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
              >
                {advances.map((adv) => (
                  <option key={adv.id} value={adv.id}>
                    [{adv.advId}] - {adv.projectId} ({adv.category}) | ยอดเบิก: {formatCurrency(adv.requestAmount)} | คงเหลือรอเคลียร์: {formatCurrency(adv.outstandingAmount)}
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Advance Mini card specs */}
            {advances.find((a) => a.id === selectedAdvId) && (
              <>
                <div className="p-4 bg-stone-50/50 rounded-2xl border border-stone-200/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-stone-400 font-semibold block uppercase text-[10px]">โครงการยื่นขอ</span>
                    <span className="font-semibold text-stone-800">
                      {advances.find((a) => a.id === selectedAdvId)?.projectId}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 font-semibold block uppercase text-[10px]">รายละเอียดเบิก</span>
                    <span className="font-semibold text-stone-800 line-clamp-1">
                      {advances.find((a) => a.id === selectedAdvId)?.details}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 font-semibold block uppercase text-[10px]">วงเงินเบิกรับมา</span>
                    <span className="font-mono font-bold text-stone-900">
                      {formatCurrency(advances.find((a) => a.id === selectedAdvId)?.requestAmount || 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 font-semibold block uppercase text-[10px]">ยอดเงินคงค้างค้างเคลียร์</span>
                    <span className="font-mono font-bold text-red-600">
                      {formatCurrency(advances.find((a) => a.id === selectedAdvId)?.outstandingAmount || 0)}
                    </span>
                  </div>
                </div>
                {advances.find((a) => a.id === selectedAdvId)?.status === AdvanceStatus.RETURNED && (
                  <div className="p-4 bg-red-50 text-red-800 border border-red-200 rounded-xl text-xs font-semibold flex gap-2">
                     <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                     <div>
                       <p className="font-bold text-red-700">ฝ่ายบัญชีตีกลับเอกสาร:</p>
                       <p>{advances.find((a) => a.id === selectedAdvId)?.returnedReason || "ไม่ได้ระบุเหตุผล"}</p>
                     </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* AI Scanner / File uploader block (Multi-upload) */}
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" /> 1. อัปโหลดใบเสร็จหรือเอกสาร PDF หลายไฟล์พร้อมกัน
            </h3>

            <div className="border-2 border-dashed border-stone-200 hover:border-stone-400 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-stone-50/50 transition cursor-pointer relative font-sans">
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={handleMultipleFilesAndOCR}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Upload className="w-10 h-10 text-stone-400 mb-2" />
              <p className="text-sm font-bold text-stone-800">ลากไฟล์หรือคลิกเพื่อเลือกไฟล์รูปบิล / PDF หลายไฟล์</p>
              <p className="text-xs text-stone-400 mt-1">วิเคราะห์ข้อมูลภาษี ชื่อร้านค้า ยอดเงิน และโครงสร้างบิลแยกตามใบให้อัตโนมัติด้วย AI</p>

              {scanning && (
                <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center rounded-2xl z-10">
                  <RefreshCw className="w-10 h-10 animate-spin text-stone-900 mb-2" />
                  <p className="text-sm font-bold text-stone-900">Gemini AI กำลังวิเคราะห์และตรวจสอบชุดเอกสารบิล...</p>
                  <p className="text-xs text-stone-400 mt-1 font-sans">คัดแยกร้านค้า รายการจ่าย VAT และหัก ณ ที่จ่ายอย่างละเอียด</p>
                </div>
              )}
            </div>
          </div>

          {/* Two Column Workspace Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Sidebar: Bill tab list */}
            <div className="lg:col-span-1 space-y-4 bg-white border border-stone-200 rounded-3xl p-4 shadow-sm self-start">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-2">
                <span className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                  รายการใบเสร็จ ({preparedBills.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddNewBill}
                  className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs transition flex items-center gap-1 font-bold"
                >
                  <Plus className="w-3.5 h-3.5" /> เพิ่ม
                </button>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {preparedBills.map((bill, index) => {
                  const billTotals = calculateBillTotals(bill);
                  const isActive = index === activeBillIndex;
                  return (
                    <div
                      key={bill.id}
                      onClick={() => setActiveBillIndex(index)}
                      className={`p-3 rounded-2xl border text-left cursor-pointer transition flex items-center justify-between gap-2 group ${
                        isActive
                          ? "bg-stone-900 border-stone-900 text-white shadow-sm"
                          : "bg-stone-50 hover:bg-stone-100/70 border-stone-200 text-stone-800"
                      }`}
                    >
                      <div className="truncate flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">
                          {bill.vendorName || `ใบเสร็จที่ ${index + 1} (ยังไม่กรอก)`}
                        </p>
                        <p className={`text-[10px] ${isActive ? "text-stone-300" : "text-stone-500"} font-mono mt-0.5`}>
                          ยอดเงินสุทธิ: {formatCurrency(billTotals.calculatedNet)}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={preparedBills.length <= 1}
                        onClick={(e) => handleDeleteBill(index, e)}
                        className={`p-1 rounded-md transition ${
                          isActive
                            ? "text-stone-400 hover:text-red-400 hover:bg-stone-800"
                            : "text-stone-400 hover:text-red-600 hover:bg-stone-200"
                        } disabled:opacity-30`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-stone-100 pt-3 mt-4 text-xs space-y-1 text-stone-500">
                <div className="flex justify-between font-bold text-stone-900">
                  <span>ยอดเงินรวมคัดกรอง:</span>
                  <span className="font-mono text-stone-950">{formatCurrency(getTotalSubmittedAmountAllBills())}</span>
                </div>
              </div>
            </div>

            {/* Main Form Editor for the Active Bill */}
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                  <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-stone-900 text-white text-xs rounded-md">บิลใบที่ {activeBillIndex + 1}</span>
                    {activeBill.vendorName || "ใบเสร็จไม่มีชื่อร้านค้า"}
                  </h3>

                  {activeBill.ocrConfidence > 0 && (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      activeBill.ocrConfidence < 60
                        ? "bg-red-50 text-red-700 border border-red-100"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                    }`}>
                      ระดับความมั่นใจ OCR: {activeBill.ocrConfidence}%
                    </span>
                  )}
                </div>

                {/* Form fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      ชื่อร้านค้า / Vendor Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="บจก. หรือ ร้านค้าผู้ให้บริการ"
                      value={activeBill.vendorName || ""}
                      onChange={(e) => updateActiveBill({ vendorName: e.target.value })}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      เลขผู้เสียภาษีร้านค้า / Vendor Tax ID
                    </label>
                    <input
                      type="text"
                      placeholder="13 หลัก เช่น 0105561008544"
                      value={activeBill.vendorTaxId || ""}
                      onChange={(e) => updateActiveBill({ vendorTaxId: e.target.value })}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      ประเภทเอกสาร
                    </label>
                    <select
                      value={activeBill.documentType || "Receipt"}
                      onChange={(e) => updateActiveBill({ documentType: e.target.value })}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                    >
                      <option value="Receipt">Receipt (ใบเสร็จรับเงิน)</option>
                      <option value="Tax Invoice">Tax Invoice (ใบกำกับภาษี)</option>
                      <option value="Invoice">Invoice (ใบแจ้งหนี้)</option>
                      <option value="Slip">Slip (สลิปโอนเงิน)</option>
                      <option value="Others">Others (อื่นๆ)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      เลขที่เอกสาร / Invoice No.
                    </label>
                    <input
                      type="text"
                      placeholder="เช่น RE-2026-0012"
                      value={activeBill.invoiceNo || ""}
                      onChange={(e) => updateActiveBill({ invoiceNo: e.target.value })}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      วันที่ตามบิลเอกสาร *
                    </label>
                    <input
                      type="date"
                      required
                      value={activeBill.documentDate || ""}
                      onChange={(e) => updateActiveBill({ documentDate: e.target.value })}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider">
                      หลักฐานเอกสารใบเสร็จ (Receipt Evidence)
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1 px-3 py-2.5 bg-stone-100 border border-stone-200 rounded-xl text-xs text-stone-500 italic flex items-center gap-2">
                        {activeBill.imageUrl ? (
                          <>
                            <FileText className="w-4 h-4 text-stone-400" />
                            <span>มีเอกสารแนบ {activeBill.imageUrl.split(',').length} ไฟล์</span>
                          </>
                        ) : (
                          "ยังไม่มีการแนบเอกสาร"
                        )}
                      </div>
                      {activeBill.imageUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewImage(activeBill.imageUrl.split(',')[0])}
                          className="px-4 py-2.5 bg-stone-900 text-stone-100 rounded-xl hover:bg-stone-800 transition flex items-center justify-center gap-2 shrink-0 font-bold text-xs"
                          title="กดเพื่อดูพรีวิวเอกสาร"
                        >
                          <Eye className="w-4 h-4" /> ดูตัวอย่างบิล
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Project Allocation Configuration */}
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-3 font-sans">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-bold text-stone-800">
                      รูปแบบการจัดสรรเข้าโครงการ (Project Mode) *
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateActiveBill({ projectMode: "SINGLE" })}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition border ${
                          activeBill.projectMode === "SINGLE"
                            ? "bg-stone-900 border-stone-900 text-white"
                            : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100"
                        }`}
                      >
                        Single Project (เข้าโครงการเดียวทั้งบิล)
                      </button>
                      <button
                        type="button"
                        onClick={() => updateActiveBill({ projectMode: "SPLIT" })}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition border ${
                          activeBill.projectMode === "SPLIT"
                            ? "bg-stone-900 border-stone-900 text-white"
                            : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100"
                        }`}
                      >
                        Split Project (แยกสินค้าตามโครงการ)
                      </button>
                    </div>
                  </div>

                  {activeBill.projectMode === "SINGLE" && (
                    <div className="pt-2 border-t border-stone-200/50">
                      <label className="block text-xs font-semibold text-stone-600 mb-1">
                        เลือกโครงการเป้าหมาย *
                      </label>
                      <select
                        required
                        value={activeBill.singleProjectId || advances.find(a => a.id === selectedAdvId)?.projectId || ""}
                        onChange={(e) => updateActiveBill({ singleProjectId: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none"
                      >
                        <option value="">-- เลือกโครงการ --</option>
                        {settings?.projects.map((proj) => {
                          const isTarget = proj === advances.find(a => a.id === selectedAdvId)?.projectId;
                          return (
                            <option key={proj} value={proj} className={isTarget ? "bg-stone-200 font-bold" : ""}>
                              {proj} {isTarget ? " (โครงการที่ยื่นขอเบิก)" : ""}
                            </option>
                          );
                        })}
                      </select>
                      {advances.find(a => a.id === selectedAdvId)?.projectId && (
                        <p className="mt-1.5 text-[10px] text-stone-500 font-medium">
                          * ระบบแนะนำโครงการ <span className="text-stone-900 font-bold">{advances.find(a => a.id === selectedAdvId)?.projectId}</span> ตามที่ระบุไว้ในใบคำขอเบิก
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Line Items Grid / Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                    <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                      รายการสินค้าและบริการ (Line Items)
                    </h4>
                    <button
                      type="button"
                      onClick={handleAddLineItem}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-lg transition flex items-center gap-1 border border-stone-200"
                    >
                      <Plus className="w-3.5 h-3.5" /> เพิ่มแถวรายการ
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                          <th className="py-2">รายการจ่าย / Description</th>
                          <th className="py-2 w-20 px-2 text-center">จำนวนหน่วย</th>
                          <th className="py-2 w-32 px-2 text-right">ราคาหน่วย</th>
                          <th className="py-2 w-28 text-right pr-2">จำนวนเงิน</th>
                          {activeBill.projectMode === "SPLIT" && <th className="py-2 w-44 px-2">โครงการ</th>}
                          <th className="py-2 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeBill.lineItems.map((item, idx) => (
                          <tr key={idx} className="border-b border-stone-100 last:border-0">
                            <td className="py-2.5">
                              <input
                                type="text"
                                required
                                value={item.itemName || ""}
                                onChange={(e) => handleLineItemChange(idx, "itemName", e.target.value)}
                                placeholder="รายละเอียดสินค้า/บริการ"
                                className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs"
                              />
                            </td>
                            <td className="py-2.5 w-20 px-2">
                              <input
                                type="number"
                                min="1"
                                required
                                value={item.qty || ""}
                                onChange={(e) => handleLineItemChange(idx, "qty", parseInt(e.target.value) || 1)}
                                className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs font-mono text-center"
                              />
                            </td>
                            <td className="py-2.5 w-32 px-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                required
                                value={item.unitPrice || ""}
                                onChange={(e) => handleLineItemChange(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs font-mono text-right"
                              />
                            </td>
                            <td className="py-2.5 w-28 text-right px-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                required
                                value={item.amount || ""}
                                onChange={(e) => handleLineItemChange(idx, "amount", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono text-right focus:border-stone-900 focus:ring-1 focus:ring-stone-900 transition-all"
                              />
                            </td>
                            {activeBill.projectMode === "SPLIT" && (
                              <td className="py-2.5 w-44 px-2">
                                <select
                                  required
                                  value={item.projectId || ""}
                                  onChange={(e) => handleLineItemChange(idx, "projectId", e.target.value)}
                                  className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs"
                                >
                                  <option value="">-- เลือกโครงการ --</option>
                                  {settings?.projects.map((proj) => (
                                    <option key={proj} value={proj}>{proj}</option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="py-2.5 w-10 text-center">
                              <button
                                type="button"
                                disabled={activeBill.lineItems.length <= 1}
                                onClick={() => handleRemoveLineItem(idx)}
                                className="text-stone-400 hover:text-red-600 disabled:opacity-30 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Taxes & Special Configurations */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                      การจัดการโครงสร้างภาษี
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-stone-600 mb-1">
                          ภาษีมูลค่าเพิ่ม (VAT)
                        </label>
                        <select
                          value={activeBill.vatType || "NONE"}
                          onChange={(e) => updateActiveBill({ vatType: e.target.value as any })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                        >
                          <option value="NONE">ไม่มีภาษีมูลค่าเพิ่ม (NONE)</option>
                          <option value="INCLUDED">รวมในราคาสินค้า (INCLUDED 7%)</option>
                          <option value="EXCLUDED">แยกจากราคาสินค้า (EXCLUDED 7%)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-600 mb-1">
                          ภาษีหัก ณ ที่จ่าย (WHT)
                        </label>
                        <select
                          value={activeBill.whtRate || "NONE"}
                          onChange={(e) => updateActiveBill({ whtRate: e.target.value as any })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                        >
                          <option value="NONE">ไม่มีหัก ณ ที่จ่าย (NONE)</option>
                          <option value="1%">ค่าขนส่งสินค้า (1%)</option>
                          <option value="3%">ค่าบริการ/วิชาชีพ (3%)</option>
                          <option value="5%">ค่าเช่าอาคาร/สถานที่ (5%)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Discount & Extras */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                      ส่วนลดและค่าใช้จ่ายอื่นๆ (บิลนี้)
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-stone-600 mb-1">
                          ส่วนลด (Discount)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={activeBill.discount || ""}
                          onChange={(e) => updateActiveBill({ discount: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-600 mb-1">
                          ค่าธรรมเนียม/บริการอื่นๆ
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={activeBill.otherExpenseAmount || ""}
                          onChange={(e) => updateActiveBill({ otherExpenseAmount: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Remarks / Notes Section */}
                <div className="p-5 bg-stone-50 border border-stone-200 rounded-3xl space-y-3">
                  <div className="flex items-center gap-2 text-stone-800">
                    <FileText className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">หมายเหตุประกอบการเคลียร์ (Remarks)</h4>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="ใส่หมายเหตุเพิ่มเติมสำหรับใบเสร็จใบนี้ เช่น 'ค่าอาหารรับรองลูกค้า', 'เอกสารไม่สมบูรณ์เนื่องจาก...'"
                    value={activeBill.remarks || ""}
                    onChange={(e) => updateActiveBill({ remarks: e.target.value })}
                    className="w-full px-4 py-3 bg-white border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-stone-950 resize-none transition-all"
                  />
                  {activeBill.isManualEntry && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-[10px] text-amber-700 font-medium italic">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      รายการนี้เป็นการกรอกข้อมูลด้วยตนเอง (Manual Entry) ไม่ได้ใช้ AI สแกน
                    </div>
                  )}
                  {activeBill.remarks?.includes("⚠️") && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-700 font-bold animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {activeBill.remarks}
                    </div>
                  )}
                </div>

                {/* Sub-total summary block for active bill */}
                <div className="p-4 bg-stone-900 text-stone-100 rounded-2xl space-y-2 font-mono text-xs">
                  <div className="flex justify-between text-stone-400">
                    <span>ฐานคำนวณเงินสินค้ารวม:</span>
                    <span>{formatCurrency(activeTotals.baseItemPrice)}</span>
                  </div>
                  {activeBill.discount > 0 && (
                    <div className="flex justify-between text-red-400">
                      <span>หักส่วนลดพิเศษ:</span>
                      <span>-{formatCurrency(activeBill.discount)}</span>
                    </div>
                  )}
                  {activeBill.otherExpenseAmount > 0 && (
                    <div className="flex justify-between text-amber-400">
                      <span>ค่าใช้จ่ายเสริม/บริการอื่นๆ:</span>
                      <span>+{formatCurrency(activeBill.otherExpenseAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-stone-800 pt-2 text-stone-400">
                    <span>ภาษีมูลค่าเพิ่ม (VAT 7% - {activeBill.vatType}):</span>
                    <span>{formatCurrency(activeTotals.calculatedVat)}</span>
                  </div>
                  <div className="flex justify-between text-stone-400">
                    <span>ภาษีหัก ณ ที่จ่าย (WHT - {activeBill.whtRate}):</span>
                    <span className="text-red-400">-{formatCurrency(activeTotals.calculatedWht)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t-2 border-dashed border-stone-700 pt-2 text-white">
                    <span className="font-sans">ยอดรวมจ่ายสุทธิของบิลใบนี้:</span>
                    <span className="text-amber-500">{formatCurrency(activeTotals.calculatedNet)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Draft and Submit controls */}
          <div className="flex justify-end gap-3 pt-4 border-t border-stone-200 font-sans">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSaveClearanceDraft}
              className="px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-2xl text-xs font-bold uppercase tracking-wider transition flex items-center gap-2"
            >
              <FileText className="w-4 h-4 text-stone-600" /> บันทึกเป็นร่างเก็บไว้ (Draft)
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 bg-stone-900 hover:bg-stone-950 text-white rounded-2xl text-xs font-bold uppercase tracking-wider transition flex items-center gap-2"
            >
              {submitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" /> ส่งตรวจบัญชี (Submit Audit)
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Verification & Review Modal for Clearing */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto" id="clearing_review_modal">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-4xl w-full shadow-2xl p-6 md:p-8 space-y-6 animate-fade-in my-8 font-sans">
            <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
              <div className="p-2 bg-amber-100 text-amber-950 rounded-lg">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900">🔍 สรุปข้อมูลเอกสารเคลียร์ยอดทั้งหมด ({preparedBills.length} ใบ)</h3>
                <p className="text-xs text-stone-500">กรุณาตรวจสอบความถูกต้องของรายการจ่ายรวมและโครงสร้างโครงการปันส่วนก่อนส่งให้ฝ่ายบัญชีตรวจสอบ</p>
              </div>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {preparedBills.map((bill, index) => {
                const totals = calculateBillTotals(bill);
                const primaryProj = (bill.projectMode === "SINGLE"
                  ? bill.singleProjectId
                  : (bill.lineItems[0]?.projectId || advances.find(a => a.id === selectedAdvId)?.projectId)) || "";

                return (
                  <div key={bill.id} className="p-4 bg-stone-50 rounded-2xl border border-stone-200/70 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200/60 pb-2">
                      <div>
                        <span className="text-xs font-bold text-stone-800">
                          ใบที่ {index + 1}: {bill.vendorName || "ไม่ระบุชื่อร้านค้า"}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono ml-2">
                          ({bill.documentType}) [{bill.invoiceNo || "ไม่มีเลขใบเสร็จ"}]
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-stone-500">วันที่ตามบิล: </span>
                        <span className="text-xs font-bold text-stone-800 font-mono">{bill.documentDate || "-"}</span>
                      </div>
                    </div>

                    <div className="text-xs space-y-1.5">
                      {bill.lineItems.map((item, itemIdx) => (
                        <div key={itemIdx} className="flex justify-between text-stone-600 gap-4">
                          <span>
                            - {item.itemName || "รายการเปล่า"} (x{item.qty})
                            <span className="text-[10px] bg-stone-200/60 text-stone-700 px-1.5 py-0.5 rounded-md ml-1.5 font-mono">
                              โครงการ: {bill.projectMode === "SINGLE" ? primaryProj : (item.projectId || primaryProj)}
                            </span>
                          </span>
                          <span className="font-mono">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Bill break-down list */}
                    <div className="bg-[#eef6ff] p-3 rounded-xl flex flex-wrap justify-between gap-4 text-xs">
                      <div>
                        <span className="text-stone-500 block text-[10px] uppercase">โครงการหลักคัดกรอง</span>
                        <span className="font-bold text-stone-800" style={{ color: "#000000" }}>{primaryProj || "-"}</span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[10px] uppercase">ภาษีมูลค่าเพิ่ม (VAT)</span>
                        <span className="font-bold text-stone-800" style={{ color: "#000000" }}>{formatCurrency(totals.calculatedVat)} ({bill.vatType})</span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[10px] uppercase">หัก ณ ที่จ่าย (WHT)</span>
                        <span className="font-bold text-stone-800" style={{ color: "#000000" }}>{formatCurrency(totals.calculatedWht)} ({bill.whtRate})</span>
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500 block text-[10px] uppercase">ยอดจ่ายสุทธิบิลใบนี้</span>
                        <span className="font-bold text-blue-700 font-mono text-sm">{formatCurrency(totals.calculatedNet)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Grand summary panel */}
            <div className="p-4 bg-stone-900 text-stone-100 rounded-3xl space-y-1.5">
              <div className="flex justify-between text-xs text-stone-400">
                <span>จำนวนบิลเอกสารรวม:</span>
                <span>{preparedBills.length} ใบเสร็จ</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-stone-800 pt-2 text-white">
                <span className="font-sans">ยอดหักล้างวงเงินที่ส่งคำขอรวมทั้งหมด (Grand Total Net):</span>
                <span className="text-amber-500 text-base font-mono">{formatCurrency(getTotalSubmittedAmountAllBills())}</span>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <p className="text-xs text-red-600 font-semibold bg-red-50 p-2.5 border border-red-200 rounded-xl">
                ⚠️ {error}
              </p>
            )}

            {/* Buttons: Cancel, Save Draft, Confirm Submit */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-stone-100 text-xs font-bold">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-5 py-2.5 border border-stone-200 rounded-xl text-stone-600 hover:bg-stone-50 transition flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> ยกเลิก
              </button>

              <button
                type="button"
                onClick={handleSaveClearanceDraft}
                disabled={submitting}
                className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-stone-600" /> บันทึกร่าง
              </button>

              <button
                type="button"
                onClick={handleConfirmSubmitClearance}
                disabled={submitting}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-stone-950 rounded-xl transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" /> ส่งเอกสารอนุมัติ
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
