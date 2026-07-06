/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { collection, doc, getDoc, runTransaction, setDoc, addDoc, onSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Employee, Advance, AdvanceStatus, ActionType, AuditLog, SystemSettings } from "../types";
import { Send, FileText, Calendar, Building2, User, Landmark, DollarSign, Plus, RefreshCw, AlertCircle, Sparkles, Search, ChevronDown, Check, X, Eye } from "lucide-react";
import { generateFormattedId, DEFAULT_DOCUMENT_FORMATS } from "../lib/idGenerator";
import { triggerAutoSyncSheetsIfEnabled, triggerAutoSyncVaultFoldersIfEnabled } from "../lib/workspaceSync";
import { sendLineNotification } from "../lib/lineNotify";
import { uploadBase64 } from "../lib/storage";
import ImagePreviewModal from "./ImagePreviewModal";

interface AdvanceRequestFormProps {
  currentEmployee: Employee;
  onSuccess: () => void;
  editingDraft?: Advance | null;
}

export default function AdvanceRequestForm({ currentEmployee, onSuccess, editingDraft }: AdvanceRequestFormProps) {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lineNotifyMsg, setLineNotifyMsg] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // System Settings state
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Form Fields
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState<string>("");
  const [showProjectDropdown, setShowProjectDropdown] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [requestItems, setRequestItems] = useState<{description: string; category: string; amount: number}[]>([
    { description: "", category: "", amount: 0 }
  ]);
  const requestAmount = requestItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const category = requestItems.length > 0 ? requestItems[0].category : "";
  const details = requestItems.map(item => item.description).join(", ");

  const [neededDate, setNeededDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [attachments, setAttachments] = useState<{ url: string; name: string; type: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generatedAdvId, setGeneratedAdvId] = useState<string>("กำลังสร้างเลข ADV-ID...");

  const [useCustomAccount, setUseCustomAccount] = useState<boolean>(false);
  const [customBankName, setCustomBankName] = useState<string>("");
  const [customAccountNo, setCustomAccountNo] = useState<string>("");
  const [customAccountName, setCustomAccountName] = useState<string>("");

  // Click outside to close project dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Load configuration and prepare tentative ADV-ID
  useEffect(() => {
    // Subscribe to settings for real-time project list updates
    const settingsRef = doc(db, "settings", "global");
    const unsub = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const globalSettings = snap.data() as SystemSettings;
        setSettings(globalSettings);
        
        // Populate default values if not editing and no values are set
        if (!editingDraft) {
          if (globalSettings.categories && globalSettings.categories.length > 0) {
            setRequestItems(prev => {
              if (prev.length === 1 && !prev[0].category) {
                const newItems = [...prev];
                newItems[0].category = globalSettings.categories[0];
                return newItems;
              }
              return prev;
            });
          }
        }
        
        // Generate tentative ADV-ID
        if (!editingDraft || !editingDraft.advId) {
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const currentYM = `${yy}${mm}`;

          let nextSeq = 1;
          if (globalSettings.runningNumbers && globalSettings.runningNumbers.yearMonth === currentYM) {
            nextSeq = globalSettings.runningNumbers.lastSequence + 1;
          }
          
          const formats = (globalSettings as any).documentFormats || DEFAULT_DOCUMENT_FORMATS;
          const pattern = formats.advance || "ADV-{yy}{mm}-P{seq:3}";
          const formattedId = generateFormattedId(pattern, nextSeq, {
            year: String(now.getFullYear()),
            month: mm
          });
          setGeneratedAdvId(formattedId);
        }
      }
    }, (err) => {
      console.error("Error subscribing to settings:", err);
    });

    if (editingDraft) {
      if (editingDraft.projectId) {
        setSelectedProjects(editingDraft.projectId.split(", ").map(p => p.trim()));
      }
      if (editingDraft.requestItems && editingDraft.requestItems.length > 0) {
        setRequestItems(editingDraft.requestItems);
      } else if (editingDraft.details || editingDraft.requestAmount) {
        setRequestItems([{
          description: editingDraft.details || "",
          category: editingDraft.category || "",
          amount: editingDraft.requestAmount || 0
        }]);
      }
      if (editingDraft.neededDate) {
        setNeededDate(editingDraft.neededDate);
      }
      if (editingDraft.note) {
        setNote(editingDraft.note);
      }
      if (editingDraft.attachmentUrl) {
        setAttachments([{ url: editingDraft.attachmentUrl, name: "ไฟล์หลัก.jpg", type: "image/jpeg" }]);
      }
      if (editingDraft.additionalAttachmentUrls) {
        const additional = editingDraft.additionalAttachmentUrls.map((url, i) => ({
          url,
          name: `ไฟล์แนบที่ ${i + 1}.jpg`,
          type: "image/jpeg"
        }));
        setAttachments(prev => [...prev, ...additional]);
      }
      if (editingDraft.customTransferAccount) {
        setUseCustomAccount(true);
        setCustomBankName(editingDraft.customTransferAccount.bankName || "");
        setCustomAccountNo(editingDraft.customTransferAccount.accountNo || "");
        setCustomAccountName(editingDraft.customTransferAccount.accountName || "");
      }
      if (editingDraft.advId) {
        setGeneratedAdvId(editingDraft.advId);
      }
    } else {
      // Default neededDate to 30 days from now
      const nextMonth = new Date();
      nextMonth.setDate(nextMonth.getDate() + 30);
      setNeededDate(nextMonth.toISOString().split("T")[0]);
    }

    return () => unsub();
  }, [currentEmployee, editingDraft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProjects.length === 0) {
      setError("กรุณาเลือกโครงการที่ต้องการใช้เงินอย่างน้อย 1 โครงการ");
      return;
    }
    
    // Validate request items
    for (let i = 0; i < requestItems.length; i++) {
      const item = requestItems[i];
      if (!item.description.trim()) {
        setError(`กรุณากรอกรายละเอียดในรายการที่ ${i + 1}`);
        return;
      }
      if (!item.category) {
        setError(`กรุณาเลือกหมวดหมู่ในรายการที่ ${i + 1}`);
        return;
      }
      if (item.amount <= 0) {
        setError(`กรุณากรอกยอดเงินในรายการที่ ${i + 1} ให้มากกว่า 0`);
        return;
      }
    }

    if (requestAmount < 100) {
      setError("จำนวนเงินขอเบิกรวมต้องไม่ต่ำกว่า 100 บาท");
      return;
    }

    if (useCustomAccount) {
      if (!customBankName.trim() || !customAccountNo.trim() || !customAccountName.trim()) {
        setError("กรุณากรอกข้อมูลบัญชีธนาคารสำหรับโอนเงินให้ครบถ้วน");
        return;
      }
    }

    setShowReviewModal(true);
  };

  const handleSaveDraft = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let finalAdvId = generatedAdvId;
      let docId = editingDraft ? editingDraft.id : `adv-${Date.now()}`;

      // If not editing an existing draft, generate running sequence ADV-ID
      if (!editingDraft) {
        const settingsRef = doc(db, "settings", "global");
        await runTransaction(db, async (transaction) => {
          const settingsSnap = await transaction.get(settingsRef);
          if (!settingsSnap.exists()) {
            throw new Error("System settings do not exist.");
          }

          const globalSettings = settingsSnap.data() as SystemSettings;
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const currentYM = `${yy}${mm}`;

          let nextSeq = 1;
          if (globalSettings.runningNumbers && globalSettings.runningNumbers.yearMonth === currentYM) {
            nextSeq = globalSettings.runningNumbers.lastSequence + 1;
          }

          const formats = (globalSettings as any).documentFormats || DEFAULT_DOCUMENT_FORMATS;
          const pattern = formats.advance || "ADV-{yy}{mm}-P{seq:3}";
          finalAdvId = generateFormattedId(pattern, nextSeq, {
            year: String(now.getFullYear()),
            month: mm
          });

          // Update sequence in settings
          transaction.update(settingsRef, {
            "runningNumbers.yearMonth": currentYM,
            "runningNumbers.lastSequence": nextSeq,
          });
        });
      }

      // Save the draft document
      const draftAdvance: Advance = {
        id: docId,
        advId: finalAdvId,
        employeeId: currentEmployee.id,
        employeeName: currentEmployee.name,
        projectId: selectedProjects.join(", "),
        category,
        requestAmount,
        approvedClearingAmountTotal: 0,
        outstandingAmount: requestAmount,
        status: AdvanceStatus.DRAFT,
        createdAt: editingDraft ? editingDraft.createdAt : new Date().toISOString(),
        details,
        requestItems,
        neededDate,
        note,
        attachmentUrl: attachments[0]?.url || "",
        additionalAttachmentUrls: attachments.slice(1).map(a => a.url),
        ...(useCustomAccount ? {
          customTransferAccount: {
            bankName: customBankName,
            accountNo: customAccountNo,
            accountName: customAccountName
          }
        } : {})
      };

      await setDoc(doc(db, "advances", docId), draftAdvance);

      // Trigger automatic background sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      // Create Audit Log for saving draft
      const auditLogId = `audit-${Date.now()}`;
      const newAudit: AuditLog = {
        id: auditLogId,
        advId: finalAdvId,
        actionType: ActionType.CREATE_ADVANCE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: editingDraft ? editingDraft.status : "-",
        afterStatus: AdvanceStatus.DRAFT,
        note: `บันทึกร่างใบขอเบิกเงินทดรองจ่าย ยอดรวม ${requestAmount} บาท (รวมโครงการ: ${selectedProjects.join(", ")})`,
      };
      await setDoc(doc(db, "auditLogs", auditLogId), newAudit);

      // Save all attachments to VaultFiles
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const fileId = `file-${Date.now()}-${i}`;
        await setDoc(doc(db, "vaultFiles", fileId), {
          id: fileId,
          advId: finalAdvId,
          fileType: "REQUEST",
          fileUrl: att.url,
          fileName: att.name || `เอกสารประกอบใบเบิก-${finalAdvId}-${i + 1}.jpg`,
          uploadedBy: currentEmployee.name,
          uploadedAt: new Date().toISOString(),
        });
      }

      setSuccessMsg(`บันทึกร่างใบขอเบิกเงินทดรองจ่ายเลขที่ ${finalAdvId} สำเร็จแล้ว! สามารถกลับมาแก้ไขและส่งคำขอใหม่ได้ภายหลัง`);
      setShowReviewModal(false);

      // Clear form inputs
      setRequestItems([{ description: "", category: settings?.categories?.[0] || "", amount: 0 }]);
      setNote("");
      setAttachments([]);

      setTimeout(() => {
        onSuccess();
      }, 3000);

    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการบันทึกข้อมูลร่าง กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setLineNotifyMsg(null);

    try {
      let finalAdvId = generatedAdvId;
      let docId = editingDraft ? editingDraft.id : `adv-${Date.now()}`;

      // Only run running-number transaction if we are NOT editing an existing draft
      if (!editingDraft) {
        const settingsRef = doc(db, "settings", "global");
        await runTransaction(db, async (transaction) => {
          const settingsSnap = await transaction.get(settingsRef);
          if (!settingsSnap.exists()) {
            throw new Error("System settings do not exist.");
          }

          const globalSettings = settingsSnap.data() as SystemSettings;
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const currentYM = `${yy}${mm}`;

          let nextSeq = 1;
          if (globalSettings.runningNumbers && globalSettings.runningNumbers.yearMonth === currentYM) {
            nextSeq = globalSettings.runningNumbers.lastSequence + 1;
          }

          const formats = (globalSettings as any).documentFormats || DEFAULT_DOCUMENT_FORMATS;
          const pattern = formats.advance || "ADV-{yy}{mm}-P{seq:3}";
          finalAdvId = generateFormattedId(pattern, nextSeq, {
            year: String(now.getFullYear()),
            month: mm
          });

          // Update sequence in settings
          transaction.update(settingsRef, {
            "runningNumbers.yearMonth": currentYM,
            "runningNumbers.lastSequence": nextSeq,
          });
        });
      }

      // Save/Submit the advance document with PENDING_APPROVAL status
      const newAdvance: Advance = {
        id: docId,
        advId: finalAdvId,
        employeeId: currentEmployee.id,
        employeeName: currentEmployee.name,
        projectId: selectedProjects.join(", "),
        category,
        requestAmount,
        approvedClearingAmountTotal: 0,
        outstandingAmount: requestAmount,
        status: AdvanceStatus.PENDING_APPROVAL,
        createdAt: editingDraft ? editingDraft.createdAt : new Date().toISOString(),
        details,
        requestItems,
        neededDate,
        note,
        attachmentUrl: attachments[0]?.url || "",
        additionalAttachmentUrls: attachments.slice(1).map(a => a.url),
        ...(useCustomAccount ? {
          customTransferAccount: {
            bankName: customBankName,
            accountNo: customAccountNo,
            accountName: customAccountName
          }
        } : {})
      };

      await setDoc(doc(db, "advances", docId), newAdvance);

      const clearanceDate = new Date();
      clearanceDate.setDate(clearanceDate.getDate() + 15);
      const photoUrl = currentEmployee.profilePhotoURL || currentEmployee.profileImage || "";

      await sendLineNotification({
        triggerId: "onNewRequest",
        variables: {
          advId: finalAdvId,
          employeeId: currentEmployee.id,
          employeeName: currentEmployee.name,
          amount: requestAmount.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
          status: "รออนุมัติ",
          projectName: selectedProjects.join(", "),
          category,
          remark: details || "ไม่มีรายละเอียด",
          date: new Date().toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' }),
          clearanceDate: clearanceDate.toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' }),
          outstanding: "38.5K", // Placeholder for template
          accumulated: "425.8K", // Placeholder for template
          closed: "387.3K", // Placeholder for template
          employeePhotoUrl: photoUrl,
          profileImageUrl: photoUrl
        },
        targetEmployeeId: currentEmployee.id
      });

      // Trigger automatic background sync
      triggerAutoSyncSheetsIfEnabled();
      triggerAutoSyncVaultFoldersIfEnabled();

      // Create Audit Log
      const auditLogId = `audit-${Date.now()}`;
      const newAudit: AuditLog = {
        id: auditLogId,
        advId: finalAdvId,
        actionType: ActionType.CREATE_ADVANCE,
        actionBy: currentEmployee.name,
        role: currentEmployee.role,
        timestamp: new Date().toISOString(),
        beforeStatus: editingDraft ? editingDraft.status : "-",
        afterStatus: AdvanceStatus.PENDING_APPROVAL,
        note: `ยื่นขอเงินทดรองจ่าย ยอดรวม ${requestAmount} บาท (รวมโครงการ: ${selectedProjects.join(", ")})`,
      };
      await setDoc(doc(db, "auditLogs", auditLogId), newAudit);

      // Save all attachments to VaultFiles
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const fileId = `file-${Date.now()}-${i}-submit`;
        await setDoc(doc(db, "vaultFiles", fileId), {
          id: fileId,
          advId: finalAdvId,
          fileType: "REQUEST",
          fileUrl: att.url,
          fileName: att.name || `เอกสารประกอบใบเบิก-${finalAdvId}-${i + 1}.jpg`,
          uploadedBy: currentEmployee.name,
          uploadedAt: new Date().toISOString(),
        });
      }

      // Simulate LINE Notify message
      const lineMsg = `🟢 [LINE Notify] แจ้งเตือนไปยังกลุ่มผู้บริหาร:
มีใบขอเบิกใหม่: ${finalAdvId}
โดย: ${currentEmployee.name} (${currentEmployee.role})
โครงการ: ${selectedProjects.join(", ")}
หมวดหมู่: ${category}
จำนวนเงิน: ${requestAmount.toLocaleString("th-TH")} บาท
รายละเอียด: ${details}
โปรดเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติผ่าน ClearAdvance PRO`;
      
      setLineNotifyMsg(lineMsg);
      setSuccessMsg(`ส่งใบขอเบิกเงินทดรองจ่ายเลขที่ ${finalAdvId} สำเร็จแล้ว!`);
      setShowReviewModal(false);
      
      // Clear form inputs
      setRequestItems([{ description: "", category: settings?.categories?.[0] || "", amount: 0 }]);
      setNote("");
      setAttachments([]);

      setTimeout(() => {
        onSuccess();
      }, 5000);

    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการส่งข้อมูลตรวจสอบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        if (file.size > 8 * 1024 * 1024) {
          setError(`ไฟล์ ${file.name} ใหญ่เกินไป (จำกัดไม่เกิน 8MB)`);
          return;
        }

        const reader = new FileReader();
        reader.onloadend = async () => {
          if (typeof reader.result === "string") {
            const resultStr = reader.result;
            
            try {
              let finalBase64 = resultStr;
              if (file.type.startsWith("image/")) {
                finalBase64 = await new Promise<string>((resolve) => {
                  const img = document.createElement("img");
                  img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const MAX_WIDTH = 1200; // Increased quality
                    const MAX_HEIGHT = 1200;
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
                    resolve(canvas.toDataURL("image/jpeg", 0.8));
                  };
                  img.src = resultStr;
                });
              }

              // Upload immediately to get a real URL
              const storagePath = `attachments/${currentEmployee.id}/${Date.now()}_${file.name}`;
              const realUrl = await uploadBase64(finalBase64, storagePath, file.type);
              
              setAttachments(prev => [...prev, { url: realUrl, name: file.name, type: file.type }]);
            } catch (uploadErr) {
              console.error("Upload failed in AdvanceRequestForm:", uploadErr);
              setError(`ไม่สามารถอัปโหลดไฟล์ ${file.name} ได้`);
            }
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in" id="advance_request_tab">
      <ImagePreviewModal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} imageUrl={previewImage} />
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-stone-900 text-stone-100 rounded-xl">
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-stone-900">เขียนคำขอเบิกเงินทดรองจ่าย</h2>
          <p className="text-xs text-stone-500">สร้างใบขอเบิกใหม่ตามโครงการและหมวดหมู่ขององค์กร</p>
        </div>
      </div>

      {successMsg && (
        <div className="p-5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl space-y-2">
          <p className="font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600 animate-pulse" />
            {successMsg}
          </p>
          <p className="text-xs text-emerald-600">ระบบกำลังนำคุณกลับไปที่หน้าหลักในสักครู่...</p>
        </div>
      )}

      {lineNotifyMsg && (
        <div className="p-5 bg-stone-900 border border-stone-800 text-stone-200 font-mono text-xs rounded-2xl shadow-inner relative overflow-hidden">
          <div className="absolute top-3 right-3 px-2 py-0.5 bg-green-500 text-white font-sans text-[10px] font-bold uppercase tracking-wider rounded">
            LINE Notify
          </div>
          <p className="font-semibold text-amber-500 mb-1 border-b border-stone-800 pb-1 font-sans">
            🔔 จำลองส่งแจ้งเตือนเข้าระบบ LINE เรียบร้อย
          </p>
          <pre className="whitespace-pre-wrap leading-relaxed">{lineNotifyMsg}</pre>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-3xl shadow-sm p-8 space-y-6">
        {/* Dynamic ADV-ID Display */}
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block">เลขที่ใบขอเบิกเงินรอดำเนินการ</span>
            <span className="text-lg font-bold text-stone-900 font-mono tracking-wider">{generatedAdvId}</span>
          </div>
          <div className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold rounded-lg w-fit">
            สถานะเริ่มต้น: PENDING_APPROVAL (รออนุมัติ)
          </div>
        </div>

        {/* Form Fields Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Employee Meta Info */}
          <div className="p-4 bg-stone-50/50 rounded-2xl border border-stone-200/60 space-y-3">
            <h3 className="text-xs font-bold text-stone-700 uppercase tracking-wider pb-1 border-b border-stone-200">
              ข้อมูลบัญชีผู้เบิกเงิน
            </h3>
            <div className="grid grid-cols-3 gap-y-2 text-xs">
              <span className="text-stone-500">ชื่อผู้ขอเบิก:</span>
              <span className="col-span-2 font-semibold text-stone-800">{currentEmployee.name}</span>

              <span className="text-stone-500">ตำแหน่ง:</span>
              <span className="col-span-2 text-stone-700">{currentEmployee.role}</span>

              <span className="text-stone-500">เลขที่บัญชี:</span>
              <span className="col-span-2 font-mono text-stone-700">{currentEmployee.bankNo}</span>

              <span className="text-stone-500">ธนาคาร:</span>
              <span className="col-span-2 text-stone-700">{currentEmployee.bankName}</span>

              <span className="text-stone-500">ชื่อบัญชี:</span>
              <span className="col-span-2 text-stone-700">{currentEmployee.bankAccountName}</span>
            </div>
          </div>

          {/* Core Parameters */}
          <div className="space-y-4">
            {/* Project Selection with Multi-select search dropdown */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                โครงการ (Project) *เลือกได้หลายโครงการ*
              </label>
              
              {/* Selected Project Tags */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedProjects.map((proj) => (
                  <span key={proj} className="inline-flex items-center gap-1 bg-stone-100 border border-stone-200 text-stone-800 text-[11px] font-bold px-2 py-0.5 rounded-lg">
                    {proj}
                    <button
                      type="button"
                      onClick={() => setSelectedProjects(selectedProjects.filter((p) => p !== proj))}
                      className="text-stone-400 hover:text-stone-600 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {selectedProjects.length === 0 && (
                  <span className="text-xs text-stone-400 font-sans italic">*ยังไม่ได้เลือกโครงการ*</span>
                )}
              </div>

              {/* Search input with search icon & chevron */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="ค้นหาและเลือกโครงการเพิ่มเติม..."
                  value={projectSearch}
                  onFocus={() => setShowProjectDropdown(true)}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
                <button
                  type="button"
                  onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                  className="absolute right-3 top-3 text-stone-400 hover:text-stone-600"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Dropdown list */}
              {showProjectDropdown && settings?.projects && (
                <div className="absolute z-30 w-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-stone-50 animate-fade-in">
                  {settings.projects
                    .filter((proj) => {
                      const matchesSearch = proj.toLowerCase().includes(projectSearch.toLowerCase());
                      const isAlreadySelected = selectedProjects.includes(proj);
                      return matchesSearch && !isAlreadySelected;
                    })
                    .map((proj) => (
                      <button
                        key={proj}
                        type="button"
                        onClick={() => {
                          setSelectedProjects([...selectedProjects, proj]);
                          setProjectSearch("");
                        }}
                        className="w-full text-left px-3.5 py-2 text-xs text-stone-700 hover:bg-stone-50 hover:text-stone-950 transition font-medium flex items-center justify-between"
                      >
                        <span>{proj}</span>
                        <Plus className="w-3 h-3 text-stone-400" />
                      </button>
                    ))}
                  {settings.projects.filter((proj) => {
                    const matchesSearch = proj.toLowerCase().includes(projectSearch.toLowerCase());
                    const isAlreadySelected = selectedProjects.includes(proj);
                    return matchesSearch && !isAlreadySelected;
                  }).length === 0 && (
                    <div className="px-4 py-2 text-xs text-stone-400 italic text-center">
                      ไม่พบโครงการใหม่ที่ตรงกับการค้นหา
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Dynamic Items (Details, Category, Amount) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stone-200">
            <label className="block text-sm font-semibold text-stone-900 tracking-wider">
              รายการค่าใช้จ่ายที่ต้องการเบิก *
            </label>
            <button
              type="button"
              onClick={() => setRequestItems([...requestItems, { description: "", category: settings?.categories?.[0] || "", amount: 0 }])}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-stone-100 rounded-lg text-[11px] font-bold hover:bg-stone-800 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              เพิ่มรายการใหม่
            </button>
          </div>

          <div className="space-y-3">
            {requestItems.map((item, index) => (
              <div key={index} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-stone-50 border border-stone-200 p-4 rounded-xl relative group">
                {requestItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newItems = [...requestItems];
                      newItems.splice(index, 1);
                      setRequestItems(newItems);
                    }}
                    className="absolute -right-2 -top-2 bg-red-100 text-red-600 p-1.5 rounded-full transition shadow-sm hover:bg-red-200 border border-red-200 z-10"
                    title="ลบรายการ"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}

                <div className="flex-1 w-full space-y-2">
                  <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider">รายละเอียด (รายการที่ {index + 1})</label>
                  <input
                    type="text"
                    required
                    value={item.description}
                    onChange={(e) => {
                      const newItems = [...requestItems];
                      newItems[index].description = e.target.value;
                      setRequestItems(newItems);
                    }}
                    placeholder="ระบุจุดประสงค์..."
                    className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                  />
                </div>

                <div className="w-full sm:w-48 space-y-2 shrink-0">
                  <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider">หมวดหมู่</label>
                  <select
                    value={item.category}
                    onChange={(e) => {
                      const newItems = [...requestItems];
                      newItems[index].category = e.target.value;
                      setRequestItems(newItems);
                    }}
                    className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                  >
                    {settings?.categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="w-full sm:w-40 space-y-2 shrink-0">
                  <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider">ยอดเงิน (บาท)</label>
                  <div className="relative">
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={item.amount || ""}
                      onChange={(e) => {
                        const newItems = [...requestItems];
                        newItems[index].amount = parseFloat(e.target.value) || 0;
                        setRequestItems(newItems);
                      }}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-stone-900 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-stone-950 text-right"
                    />
                    <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      ฿
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-between p-4 bg-stone-50 border border-stone-200 rounded-xl mt-4 items-start sm:items-center gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                วันที่กำหนดเคลียร์บิลภายใน
              </label>
              <input
                type="date"
                required
                value={neededDate}
                onChange={(e) => setNeededDate(e.target.value)}
                style={{ width: "0px" }}
                className="bg-transparent border-0 focus:outline-none pointer-events-none opacity-0 h-0 block"
              />
              <span className="text-xs font-bold text-stone-900 bg-stone-100 border border-stone-200 px-3.5 py-2 rounded-xl block w-fit mt-1">
                {neededDate ? new Date(neededDate).toLocaleDateString("th-TH", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }) : "-"} (ระบุอัตโนมัติ 30 วัน)
              </span>
            </div>
            
            <div className="sm:text-right w-full sm:w-auto p-3 sm:p-0 bg-white sm:bg-transparent rounded-lg border sm:border-0 border-stone-200">
              <span className="text-sm font-semibold text-stone-600 block mb-1">ยอดเงินขอเบิกรวมสุทธิ:</span>
              <span className="text-2xl font-mono font-black text-emerald-600">฿ {requestAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Custom Transfer Account Section */}
        <div className="pt-4 border-t border-stone-100">
          <div className="flex items-center gap-3 mb-4">
            <input
              type="checkbox"
              id="useCustomAccount"
              checked={useCustomAccount}
              onChange={(e) => {
                setUseCustomAccount(e.target.checked);
                if (!e.target.checked) {
                  setCustomBankName("");
                  setCustomAccountNo("");
                  setCustomAccountName("");
                }
              }}
              className="w-4 h-4 rounded text-stone-900 border-stone-300 focus:ring-stone-900"
            />
            <label htmlFor="useCustomAccount" className="text-sm font-semibold text-stone-700 cursor-pointer select-none">
              ต้องการให้โอนเงินเข้าบัญชีอื่น (เช่น บัญชีร้านค้า หรือ ซัพพลายเออร์) แทนบัญชีพนักงาน
            </label>
          </div>

          {useCustomAccount && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-stone-50 p-5 rounded-2xl border border-stone-200">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">ธนาคาร *</label>
                <select
                  required={useCustomAccount}
                  value={customBankName}
                  onChange={(e) => setCustomBankName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                >
                  <option value="">เลือกธนาคาร</option>
                  <option value="ธนาคารกสิกรไทย (KBANK)">ธนาคารกสิกรไทย (KBANK)</option>
                  <option value="ธนาคารไทยพาณิชย์ (SCB)">ธนาคารไทยพาณิชย์ (SCB)</option>
                  <option value="ธนาคารกรุงเทพ (BBL)">ธนาคารกรุงเทพ (BBL)</option>
                  <option value="ธนาคารกรุงไทย (KTB)">ธนาคารกรุงไทย (KTB)</option>
                  <option value="ธนาคารกรุงศรีอยุธยา (BAY)">ธนาคารกรุงศรีอยุธยา (BAY)</option>
                  <option value="ธนาคารทหารไทยธนชาต (TTB)">ธนาคารทหารไทยธนชาต (TTB)</option>
                  <option value="ธนาคารออมสิน (GSB)">ธนาคารออมสิน (GSB)</option>
                  <option value="อื่นๆ">อื่นๆ</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">เลขที่บัญชี *</label>
                <input
                  type="text"
                  required={useCustomAccount}
                  value={customAccountNo}
                  onChange={(e) => setCustomAccountNo(e.target.value)}
                  placeholder="เช่น 012-3-45678-9"
                  className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-stone-900 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">ชื่อบัญชี *</label>
                <input
                  type="text"
                  required={useCustomAccount}
                  value={customAccountName}
                  onChange={(e) => setCustomAccountName(e.target.value)}
                  placeholder="เช่น บจก. ซัพพลายเออร์"
                  className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
              </div>
            </div>
          )}
        </div>

        {/* Multiple Attachments Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100">
          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              แนบเอกสารใบเสนอราคา หรือ เอกสารประกอบ (อัปโหลดได้หลายไฟล์)
            </label>
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-3 bg-stone-50 border-2 border-dashed border-stone-200 hover:border-stone-400 rounded-2xl text-stone-500 text-sm flex items-center justify-center gap-2 transition-all hover:bg-stone-100"
            >
              <Plus className="w-5 h-5" />
              <span>คลิกเพื่อแนบไฟล์เอกสาร (PDF หรือ รูปภาพ)</span>
            </button>

            {/* Attachment List */}
            {attachments.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">ไฟล์ที่แนบแล้ว ({attachments.length} รายการ)</p>
                <div className="grid grid-cols-1 gap-2">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 bg-stone-50 border border-stone-200 rounded-xl group">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-8 h-8 bg-white border border-stone-100 rounded-lg flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-stone-400" />
                        </div>
                        <span className="text-[11px] font-bold text-stone-700 truncate">{file.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(file.url)}
                          className="p-1.5 text-stone-400 hover:text-stone-900 transition"
                          title="ดูตัวอย่าง"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="p-1.5 text-stone-400 hover:text-red-600 transition"
                          title="ลบออก"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              หมายเหตุเพิ่มเติม
            </label>
            <textarea
              rows={4}
              placeholder="ระบุข้อมูลเพิ่มเติมถ้ามี..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950 resize-none"
            />
          </div>
        </div>

        {/* Form Submission Button */}
        <div className="flex justify-end gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="pr-6 pt-3 pl-[10px] pb-[10px] ml-[-200px] mt-[-12px] mr-[31px] text-justify font-['Noto_Sans_Thai'] no-underline bg-[#4977bd] hover:bg-[#4977bd]/90 text-stone-50 font-bold rounded-xl text-sm transition-all focus:outline-none disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" /> ส่งใบขอเบิกเงินทดรองจ่าย
              </>
            )}
          </button>
        </div>
      </form>

      {/* Verification & Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto" id="advance_review_modal">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-2xl w-full shadow-2xl p-6 md:p-8 space-y-6 animate-fade-in my-8">
            <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
              <div className="p-2 bg-stone-100 text-stone-950 rounded-lg">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900">🔍 ตรวจสอบและยืนยันข้อมูลใบขอเบิกเงิน</h3>
                <p className="text-xs text-stone-500">กรุณาตรวจสอบรายละเอียดความถูกต้อง ท่านสามารถแก้ไขข้อมูลที่ต้องการได้จากฟอร์มนี้โดยตรงก่อนส่ง</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Projects */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  โครงการที่เลือกใช้เงิน
                </label>
                <div className="flex flex-wrap gap-1.5 p-3 bg-stone-50 border border-stone-200 rounded-xl min-h-[44px]">
                  {selectedProjects.map((proj) => (
                    <span key={proj} className="inline-flex items-center gap-1 bg-stone-900 text-stone-50 text-[10px] font-bold px-2.5 py-1 rounded-lg">
                      {proj}
                      <button
                        type="button"
                        onClick={() => setSelectedProjects(selectedProjects.filter((p) => p !== proj))}
                        className="hover:text-red-400 font-bold"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  {selectedProjects.length === 0 && (
                    <span className="text-xs text-stone-400 font-sans italic">ยังไม่ได้เลือกโครงการ (โปรดระบุ)</span>
                  )}
                </div>
              </div>

              {/* Request Items */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  รายการเบิกเงิน
                </label>
                <div className="space-y-2">
                  {requestItems.map((item, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row justify-between bg-stone-50 border border-stone-200 p-3 rounded-xl gap-2">
                      <div className="flex-1">
                        <p className="text-xs font-bold text-stone-900">{item.description}</p>
                        <p className="text-[10px] text-stone-500">{item.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-emerald-600">฿ {item.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between items-center px-2 pt-2 border-t border-stone-100">
                    <span className="text-xs font-bold text-stone-700">ยอดรวมทั้งหมด</span>
                    <span className="text-base font-mono font-black text-emerald-700">฿ {requestAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Needed Date */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  วันที่ครบกำหนดเคลียร์ยอด
                </label>
                <input
                  type="date"
                  value={neededDate}
                  onChange={(e) => setNeededDate(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  หมายเหตุเพิ่มเติม
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
              </div>

              {useCustomAccount && (
                <div className="md:col-span-2 mt-2 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">
                    โอนเข้าบัญชีอื่น (ไม่ใช่บัญชีพนักงาน)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-blue-700 font-semibold mb-1">ธนาคาร</p>
                      <p className="text-xs text-blue-950 font-bold">{customBankName || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-700 font-semibold mb-1">เลขที่บัญชี</p>
                      <p className="text-xs text-blue-950 font-bold font-mono">{customAccountNo || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-700 font-semibold mb-1">ชื่อบัญชี</p>
                      <p className="text-xs text-blue-950 font-bold">{customAccountName || "-"}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error in modal */}
            {error && (
              <p className="text-xs text-red-600 font-semibold bg-red-50 p-2.5 border border-red-200 rounded-xl">
                ⚠️ {error}
              </p>
            )}

            {/* Buttons: Cancel, Save Draft, Submit Request */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-5 py-2.5 border border-stone-200 rounded-xl text-stone-600 hover:bg-stone-50 text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> ยกเลิก
              </button>
              
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={loading}
                className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-stone-600" /> บันทึกร่าง
              </button>

              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={loading}
                className="px-5 py-2.5 bg-[#4977bd] hover:bg-[#4977bd]/90 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> ส่งคำขอ
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
