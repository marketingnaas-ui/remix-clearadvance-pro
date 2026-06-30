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

  const [category, setCategory] = useState<string>("");
  const [requestAmount, setRequestAmount] = useState<number>(0);
  const [details, setDetails] = useState<string>("");
  const [neededDate, setNeededDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [attachmentUrl, setAttachmentUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generatedAdvId, setGeneratedAdvId] = useState<string>("กำลังสร้างเลข ADV-ID...");

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
          if (globalSettings.projects && globalSettings.projects.length > 0 && selectedProjects.length === 0) {
            setSelectedProjects([globalSettings.projects[0]]);
          }
          if (globalSettings.categories && globalSettings.categories.length > 0 && category === "") {
            setCategory(globalSettings.categories[0]);
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
      if (editingDraft.category) {
        setCategory(editingDraft.category);
      }
      if (editingDraft.requestAmount) {
        setRequestAmount(editingDraft.requestAmount);
      }
      if (editingDraft.details) {
        setDetails(editingDraft.details);
      }
      if (editingDraft.neededDate) {
        setNeededDate(editingDraft.neededDate);
      }
      if (editingDraft.note) {
        setNote(editingDraft.note);
      }
      if (editingDraft.attachmentUrl) {
        setAttachmentUrl(editingDraft.attachmentUrl);
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
    if (requestAmount < 100) {
      setError("จำนวนเงินขอเบิกต้องไม่ต่ำกว่า 100 บาท");
      return;
    }
    if (!details.trim()) {
      setError("กรุณากรอกรายละเอียดการเบิก");
      return;
    }

    setShowReviewModal(true);
  };

  const handleSaveDraft = async () => {
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
        neededDate,
        note,
        attachmentUrl: attachmentUrl || "",
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

      // Save attachment to VaultFiles if provided
      if (attachmentUrl) {
        const fileId = `file-${Date.now()}`;
        await setDoc(doc(db, "vaultFiles", fileId), {
          id: fileId,
          advId: finalAdvId,
          fileType: "REQUEST",
          fileUrl: attachmentUrl,
          fileName: `เอกสารประกอบใบเบิก-${finalAdvId}.jpg`,
          uploadedBy: currentEmployee.name,
          uploadedAt: new Date().toISOString(),
        });
      }

      setSuccessMsg(`บันทึกร่างใบขอเบิกเงินทดรองจ่ายเลขที่ ${finalAdvId} สำเร็จแล้ว! สามารถกลับมาแก้ไขและส่งคำขอใหม่ได้ภายหลัง`);
      setShowReviewModal(false);

      // Clear form inputs
      setRequestAmount(0);
      setDetails("");
      setNote("");
      setAttachmentUrl("");

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
        neededDate,
        note,
        attachmentUrl: attachmentUrl || "",
      };

      await setDoc(doc(db, "advances", docId), newAdvance);

      sendLineNotification({
        triggerId: "onNewRequest",
        variables: {
          advId: finalAdvId,
          employeeName: currentEmployee.name,
          amount: requestAmount.toLocaleString("th-TH"),
          status: "รออนุมัติ",
          projectName: selectedProjects.join(", "),
          category,
          remark: details || "ไม่มีรายละเอียด",
          date: new Date().toLocaleDateString("th-TH")
        }
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

      // Save attachment to VaultFiles if provided
      if (attachmentUrl) {
        const fileId = `file-${Date.now()}`;
        await setDoc(doc(db, "vaultFiles", fileId), {
          id: fileId,
          advId: finalAdvId,
          fileType: "REQUEST",
          fileUrl: attachmentUrl,
          fileName: `เอกสารประกอบใบเบิก-${finalAdvId}.jpg`,
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
      setRequestAmount(0);
      setDetails("");
      setNote("");
      setAttachmentUrl("");

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
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) {
        setError("ขนาดไฟล์ใหญ่เกินไป (จำกัดไม่เกิน 8MB)");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          const resultStr = reader.result;
          
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
              setAttachmentUrl(compressedBase64);
            };
            img.onerror = () => {
              setAttachmentUrl(resultStr);
            };
            img.src = resultStr;
          } else {
            // PDF or other documents: check if size is reasonable (< 350KB) to avoid exceeding Firestore 1MB limits
            if (file.size > 350 * 1024) {
              setError("เนื่องจากข้อจำกัดของระบบฐานข้อมูลและประมวลผล กรุณาอัปโหลดเอกสาร PDF ขนาดไม่เกิน 350KB หรืออัปโหลดเป็นรูปภาพแทน");
              return;
            }
            setAttachmentUrl(resultStr);
          }
        }
      };
      reader.readAsDataURL(file);
    }
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

            {/* Category Selection */}
            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                หมวดหมู่ค่าใช้จ่าย (Category)
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
              >
                {settings?.categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Details & Amount */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              รายละเอียดและเหตุผลความจำเป็นในการเบิก *
            </label>
            <textarea
              required
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="ระบุจุดประสงค์ เช่น ค่าใช้จ่ายเดินทางไปตรวจงานโรงงานบางปู และที่พักวิศวกร"
              className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950 resize-none"
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                ยอดเงินขอเบิก (บาท) *
              </label>
              <div className="relative">
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={requestAmount || ""}
                  onChange={(e) => setRequestAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-stone-950"
                />
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-stone-500 font-bold text-xs">
                  ฿
                </div>
              </div>
            </div>

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
          </div>
        </div>

        {/* Attachment Mock File Selector / Link input */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100">
          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              แนบเอกสารใบเสนอราคา หรือ เอกสารประมาณการค่าใช้จ่าย (URL รูปภาพประกอบ)
            </label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-600 text-sm flex items-center justify-center sm:justify-start gap-2 hover:bg-stone-100 transition"
              >
                <FileText className="w-4 h-4" />
                {attachmentUrl ? "เปลี่ยนไฟล์ที่แนบ" : "แนบไฟล์ PDF หรือ รูปภาพ"}
              </button>
              {attachmentUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewImage(attachmentUrl.split(',')[0])}
                  className="px-4 py-2.5 bg-stone-900 text-stone-100 rounded-xl hover:bg-stone-800 transition flex items-center justify-center shrink-0"
                  title="ดูตัวอย่างเอกสาร"
                >
                  <Eye className="w-4 h-4" />
                </button>
              )}
            </div>
            {attachmentUrl && (
              <p className="text-[10px] text-emerald-600 mt-1 truncate">
                แนบไฟล์สำเร็จแล้ว: {attachmentUrl.substring(0, 20)}...
              </p>
            )}
            <p className="text-[10px] text-stone-400 mt-1">
              (ถ้าไม่มี สามารถใช้ URL ว่าง หรือรูปภาพทดสอบใดๆ)
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              หมายเหตุเพิ่มเติม
            </label>
            <input
              type="text"
              placeholder="ระบุข้อมูลเพิ่มเติมถ้ามี"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none focus:ring-1 focus:ring-stone-950"
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

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  หมวดหมู่ค่าใช้จ่าย
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950"
                >
                  {settings?.categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Request Amount */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  ยอดเงินขอเบิก (บาท)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={requestAmount || ""}
                    onChange={(e) => setRequestAmount(parseFloat(e.target.value) || 0)}
                    className="w-full pl-8 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-stone-950"
                  />
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-stone-500 font-bold text-xs">
                    ฿
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                  รายละเอียดเหตุผลการขอเบิกเงิน
                </label>
                <textarea
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 resize-none"
                />
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
