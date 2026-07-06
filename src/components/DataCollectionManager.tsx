import React, { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, writeBatch } from "firebase/firestore";
import { AlertCircle, Check, Database, Edit2, Plus, RefreshCw, Search, Trash2, X, Download, Upload, FileSpreadsheet, FileText } from "lucide-react";
import { db } from "../lib/firebase";
import { CollectionFieldSchema, CollectionSchema } from "../lib/collectionSchemas";
import * as XLSX from "xlsx";


type RecordData = { id: string; [key: string]: any };

interface DataCollectionManagerProps {
  schema: CollectionSchema;
}

const emptyFormFor = (schema: CollectionSchema) => {
  return schema.fields.reduce<Record<string, any>>((acc, field) => {
    if (field.type === "boolean") acc[field.key] = false;
    else if (field.type === "number") acc[field.key] = "";
    else if (field.type === "json") acc[field.key] = "";
    else acc[field.key] = "";
    return acc;
  }, {});
};

const formatValue = (value: any) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const parseFieldValue = (field: CollectionFieldSchema, value: any) => {
  if (field.type === "boolean") return Boolean(value);
  if (field.type === "number") return value === "" || value === null || value === undefined ? 0 : Number(value);
  if (field.type === "json") {
    if (value === "" || value === null || value === undefined) return field.key.endsWith("s") ? [] : {};
    return JSON.parse(value);
  }
  return value ?? "";
};

const formValueFromRecord = (field: CollectionFieldSchema, record: RecordData) => {
  const value = record[field.key];
  if (field.type === "json") return value === undefined ? "" : JSON.stringify(value, null, 2);
  if (field.type === "boolean") return Boolean(value);
  return value ?? "";
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CollectionFieldSchema;
  value: any;
  onChange: (value: any) => void;
}) {
  const baseClass = "w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10";

  if (field.type === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl cursor-pointer">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="w-4 h-4 accent-stone-950" />
        <span className="text-xs font-bold text-stone-700">เปิดใช้งาน / ใช่</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={baseClass}>
        <option value="">- เลือก -</option>
        {(field.options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "textarea" || field.type === "json") {
    return (
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className={`${baseClass} min-h-24 font-${field.type === "json" ? "mono" : "sans"}`}
        placeholder={field.placeholder || (field.type === "json" ? "{ } หรือ [ ]" : "")}
      />
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className={baseClass}
      placeholder={field.placeholder}
      readOnly={field.readonly}
    />
  );
}


const parseCSVLine = (line: string) => {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

const parseCSV = (csvText: string) => {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ""));
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj: Record<string, any> = {};
    headers.forEach((header, index) => {
      let val = values[index] !== undefined ? values[index].trim() : "";
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      obj[header] = val;
    });
    results.push(obj);
  }
  return results;
};

const convertToCSV = (headers: string[], rows: any[]) => {
  const csvRows = [];
  csvRows.push(headers.join(","));
  for (const row of rows) {
    const values = headers.map(header => {
      const val = row[header];
      const stringVal = val === undefined || val === null ? "" : String(val);
      const escaped = stringVal.replace(/"/g, '""');
      if (escaped.includes(",") || escaped.includes("\n") || escaped.includes('"')) {
        return `"${escaped}"`;
      }
      return escaped;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
};

const findValueInRow = (row: any, fieldKey: string, fieldLabel: string): any => {
  if (row === null || row === undefined) return undefined;
  
  // Try exact key or label match first
  if (row[fieldKey] !== undefined) return row[fieldKey];
  if (row[fieldLabel] !== undefined) return row[fieldLabel];

  // Try normalized matching (strip stars, spaces, colons)
  const clean = (s: string) => s.toLowerCase().replace(/[\*\s\:\：\-\_\(\)]/g, "").trim();
  const cleanKey = clean(fieldKey);
  const cleanLabel = clean(fieldLabel);

  for (const rowKey of Object.keys(row)) {
    const cleanRowKey = clean(rowKey);
    if (cleanRowKey === cleanKey || cleanRowKey === cleanLabel) {
      return row[rowKey];
    }
  }

  // Fallback: see if cleanRowKey contains cleanKey or cleanLabel
  for (const rowKey of Object.keys(row)) {
    const cleanRowKey = clean(rowKey);
    if (cleanRowKey.includes(cleanKey) || cleanRowKey.includes(cleanLabel) || cleanKey.includes(cleanRowKey) || cleanLabel.includes(cleanRowKey)) {
      return row[rowKey];
    }
  }

  return undefined;
};

export default function DataCollectionManager({ schema }: DataCollectionManagerProps) {
  const [records, setRecords] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingRecord, setEditingRecord] = useState<RecordData | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>(() => emptyFormFor(schema));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Import / Export State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importType, setImportType] = useState<"excel" | "text">("excel");
  const [pastedText, setPastedText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);

  // Selection & Bulk Actions State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [bulkEditFieldKey, setBulkEditFieldKey] = useState("");
  const [bulkEditValue, setBulkEditValue] = useState<any>("");
  const [isApplyingBulkEdit, setIsApplyingBulkEdit] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isApplyingBulkDelete, setIsApplyingBulkDelete] = useState(false);


  useEffect(() => {
    setLoading(true);
    setError(null);
    const colRef = collection(db, schema.collection);
    const q = query(colRef);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRecords(snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })));
        setLoading(false);
      },
      (err) => {
        console.error(`Failed to load ${schema.collection}:`, err);
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [schema]);

  useEffect(() => {
    setEditingRecord(null);
    setFormData(emptyFormFor(schema));
    setSearch("");
    setError(null);
    setSuccess(null);
    setSelectedIds([]);
  }, [schema]);

  const tableFields = schema.fields.slice(0, 8);

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) =>
      schema.fields.some((field) => formatValue(record[field.key]).toLowerCase().includes(keyword))
    );
  }, [records, schema.fields, search]);

  const startCreate = () => {
    setEditingRecord(null);
    setFormData(emptyFormFor(schema));
    setError(null);
    setSuccess(null);
  };

  const startEdit = (record: RecordData) => {
    setEditingRecord(record);
    setFormData(
      schema.fields.reduce<Record<string, any>>((acc, field) => {
        acc[field.key] = formValueFromRecord(field, record);
        return acc;
      }, {})
    );
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const payload = schema.fields.reduce<Record<string, any>>((acc, field) => {
        if (field.readonly) return acc;
        const parsed = parseFieldValue(field, formData[field.key]);
        if (parsed !== "" || field.required || field.type === "number" || field.type === "boolean") {
          acc[field.key] = parsed;
        }
        return acc;
      }, {});

      const primaryValue = String(payload[schema.primaryKey] || editingRecord?.[schema.primaryKey] || editingRecord?.id || "").trim();
      if (!primaryValue) throw new Error(`กรุณากรอก ${schema.primaryKey}`);

      const docId = editingRecord?.id || primaryValue;
      await setDoc(
        doc(db, schema.collection, docId),
        {
          ...payload,
          id: docId,
          updatedAt: payload.updatedAt || new Date().toISOString(),
          ...(editingRecord ? {} : { createdAt: payload.createdAt || new Date().toISOString() }),
        },
        { merge: true }
      );

      setSuccess(editingRecord ? "บันทึกการแก้ไขเรียบร้อย" : "สร้างข้อมูลใหม่เรียบร้อย");
      setEditingRecord(null);
      setFormData(emptyFormFor(schema));
    } catch (err: any) {
      setError(err?.message || "บันทึกข้อมูลไม่สำเร็จ");
    }
  };

  const handleDelete = async (record: RecordData) => {
    const label = record[schema.primaryKey] || record.id;
    if (!window.confirm(`ลบ ${label} จาก ${schema.collection}?`)) return;
    await deleteDoc(doc(db, schema.collection, record.id));
    setSuccess("ลบข้อมูลเรียบร้อย");
    if (editingRecord?.id === record.id) startCreate();
  };

  // Import handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        if (jsonData.length === 0) {
          throw new Error("ไฟล์ Excel ไม่มีข้อมูล");
        }
        
        const mapped = jsonData.map((row: any) => {
          const newRow: Record<string, any> = {};
          schema.fields.forEach(f => {
            const rawVal = findValueInRow(row, f.key, f.label);
            newRow[f.key] = rawVal !== undefined ? rawVal : "";
          });
          const rowId = findValueInRow(row, "id", "ID") || findValueInRow(row, schema.primaryKey, schema.primaryKey);
          newRow.id = rowId ? String(rowId).trim() : doc(collection(db, schema.collection)).id;
          return newRow;
        });
        
        setPreviewRows(mapped);
      } catch (err: any) {
        setImportError(err.message || "ไม่สามารถอ่านไฟล์ Excel ได้");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTextParse = () => {
    if (!pastedText.trim()) {
      setImportError("กรุณากรอกหรือวางข้อความ");
      return;
    }
    setImportError(null);
    setImportSuccess(null);
    try {
      let parsed: any[] = [];
      const trimmed = pastedText.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        const val = JSON.parse(trimmed);
        parsed = Array.isArray(val) ? val : [val];
      } else {
        parsed = parseCSV(trimmed);
      }
      
      if (parsed.length === 0) {
        throw new Error("ไม่มีข้อมูลที่สามารถแยกวิเคราะห์ได้");
      }
      
      const mapped = parsed.map((row: any) => {
        const newRow: Record<string, any> = {};
        schema.fields.forEach(f => {
          const rawVal = findValueInRow(row, f.key, f.label);
          newRow[f.key] = rawVal !== undefined ? rawVal : "";
        });
        const rowId = findValueInRow(row, "id", "ID") || findValueInRow(row, schema.primaryKey, schema.primaryKey);
        newRow.id = rowId ? String(rowId).trim() : doc(collection(db, schema.collection)).id;
        return newRow;
      });
      
      setPreviewRows(mapped);
    } catch (err: any) {
      setImportError(err.message || "ไม่สามารถแยกวิเคราะห์ข้อความได้ (กรุณาใช้รูปแบบ JSON Array หรือ CSV ที่ถูกต้อง)");
    }
  };

  const updatePreviewRowValue = (index: number, key: string, val: any) => {
    setPreviewRows(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [key]: val };
      return copy;
    });
  };

  const removePreviewRow = (index: number) => {
    setPreviewRows(prev => prev.filter((_, idx) => idx !== index));
  };

  const addBlankPreviewRow = () => {
    const blankRow = schema.fields.reduce<Record<string, any>>((acc, f) => {
      acc[f.key] = f.type === "boolean" ? false : f.type === "number" ? 0 : "";
      return acc;
    }, {});
    blankRow.id = doc(collection(db, schema.collection)).id;
    setPreviewRows(prev => [...prev, blankRow]);
  };

  const saveImportedRows = async () => {
    setImportError(null);
    setImportSuccess(null);
    setIsSavingImport(true);
    try {
      const batch = writeBatch(db);
      for (const row of previewRows) {
        const primaryValue = String(row[schema.primaryKey] || row.id || "").trim();
        if (!primaryValue) {
          throw new Error(`ทุกแถวจำเป็นต้องมีค่าของ ${schema.primaryKey}`);
        }
        
        const docId = row.id || primaryValue;
        const cleanPayload: Record<string, any> = {};
        schema.fields.forEach(f => {
          if (f.readonly) return;
          const parsed = parseFieldValue(f, row[f.key]);
          cleanPayload[f.key] = parsed;
        });
        
        const docRef = doc(db, schema.collection, docId);
        batch.set(
          docRef,
          {
            ...cleanPayload,
            id: docId,
            updatedAt: new Date().toISOString(),
            createdAt: row.createdAt || new Date().toISOString(),
          },
          { merge: true }
        );
      }
      
      await batch.commit();
      setImportSuccess(`นำเข้าข้อมูลสำเร็จทั้งหมด ${previewRows.length} รายการ!`);
      setPreviewRows([]);
      setPastedText("");
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSuccess(null);
      }, 2000);
    } catch (err: any) {
      setImportError(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
      setIsSavingImport(false);
    }
  };

  // Export handlers
  const handleExportData = (format: "xlsx" | "csv" | "json") => {
    // Export with keys to make it reversible
    const dataToExport = records;
    
    if (format === "json") {
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${schema.collection}_export_${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "csv") {
      const headers = schema.fields.map(f => f.key);
      const csvContent = convertToCSV(headers, dataToExport);
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${schema.collection}_export_${new Date().toISOString()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // xlsx
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, `${schema.collection}_export_${new Date().toISOString()}.xlsx`);
    }
    setIsExportDropdownOpen(false);
  };

  const handleApplyBulkEdit = async () => {
    if (!bulkEditFieldKey) return;
    const selectedField = schema.fields.find(f => f.key === bulkEditFieldKey);
    if (!selectedField) return;

    setError(null);
    setSuccess(null);
    setIsApplyingBulkEdit(true);
    try {
      const validIds = selectedIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
      if (validIds.length === 0) {
        throw new Error("ไม่มีรหัสรายการที่ถูกต้องเพื่อแก้ไข");
      }
      const parsedValue = parseFieldValue(selectedField, bulkEditValue);
      const batch = writeBatch(db);
      
      validIds.forEach((id) => {
        const docRef = doc(db, schema.collection, id);
        batch.update(docRef, {
          [bulkEditFieldKey]: parsedValue,
          updatedAt: new Date().toISOString()
        });
      });
      
      await batch.commit();
      setSuccess(`แก้ไขข้อมูลฟิลด์ "${selectedField.label}" สำหรับ ${validIds.length} รายการเสร็จสมบูรณ์!`);
      setSelectedIds([]);
      setIsBulkEditModalOpen(false);
    } catch (err: any) {
      console.error("Bulk edit failed:", err);
      setError(err.message || "เกิดข้อผิดพลาดในการแก้ไขข้อมูลหลายรายการ");
    } finally {
      setIsApplyingBulkEdit(false);
    }
  };

  const handleApplyBulkDelete = async () => {
    setError(null);
    setSuccess(null);
    setIsApplyingBulkDelete(true);
    try {
      const validIds = selectedIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
      if (validIds.length === 0) {
        throw new Error("ไม่มีรหัสรายการที่ถูกต้องเพื่อทำการลบ");
      }
      const batch = writeBatch(db);
      validIds.forEach((id) => {
        const docRef = doc(db, schema.collection, id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      setSuccess(`ลบข้อมูลทั้งหมด ${validIds.length} รายการสำเร็จเรียบร้อย!`);
      setSelectedIds([]);
      setIsBulkDeleteModalOpen(false);
    } catch (err: any) {
      console.error("Bulk delete failed:", err);
      setError(err.message || "เกิดข้อผิดพลาดในการลบข้อมูลหลายรายการ");
    } finally {
      setIsApplyingBulkDelete(false);
    }
  };

  return (

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
      <section className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-stone-950 flex items-center gap-2">
              <Database className="w-4 h-4" />
              {schema.title}
            </h4>
            <p className="text-xs text-stone-500 mt-1">{schema.description}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9 pr-3 py-2 rounded-xl border border-stone-200 bg-stone-50 text-xs w-48 sm:w-64 max-w-full"
                placeholder="ค้นหา"
              />
            </div>

            {/* Import Button */}
            <button
              type="button"
              onClick={() => {
                setIsImportModalOpen(true);
                setPreviewRows([]);
                setImportError(null);
                setImportSuccess(null);
              }}
              className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Upload className="w-4 h-4" /> นำเข้า (Import)
            </button>

            {/* Export Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center gap-1.5 transition"
              >
                <Download className="w-4 h-4" /> ส่งออก (Export)
              </button>
              {isExportDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-stone-200 rounded-xl shadow-lg z-30 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleExportData("xlsx")}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-stone-50 font-bold text-stone-700 flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportData("csv")}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-stone-50 font-bold text-stone-700 flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 text-blue-600" /> ข้อความ CSV (.csv)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportData("json")}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-stone-50 font-bold text-stone-700 flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 text-amber-600" /> ข้อความ JSON (.json)
                  </button>
                </div>
              )}
            </div>

            <button type="button" onClick={startCreate} className="px-3 py-2 rounded-xl bg-stone-950 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-stone-800 transition">
              <Plus className="w-4 h-4" /> เพิ่ม
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center gap-2 text-stone-400 text-xs">
            <RefreshCw className="w-6 h-6 animate-spin" />
            กำลังโหลดข้อมูล
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-stone-400 text-sm">ยังไม่มีข้อมูลใน collection นี้</div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Bulk Action Banner */}
            {selectedIds.length > 0 && (
              <div className="bg-stone-900 text-white px-4 py-3 rounded-2xl flex items-center justify-between shadow-lg animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500 text-stone-950 flex items-center justify-center font-bold text-xs">
                    {selectedIds.length}
                  </div>
                  <span className="text-xs font-bold text-stone-200">รายการที่เลือก</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkEditFieldKey("");
                      setBulkEditValue("");
                      setIsBulkEditModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-stone-100 text-stone-950 rounded-xl font-bold text-xs transition cursor-pointer"
                  >
                    แก้ไขทั้งหมดที่เลือก
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBulkDeleteModalOpen(true)}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs transition cursor-pointer"
                  >
                    ลบทั้งหมดที่เลือก
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="p-1 text-stone-400 hover:text-white transition cursor-pointer"
                    title="ยกเลิกการเลือก"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto border border-stone-200 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="px-3 py-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredRecords.length > 0 && selectedIds.length === filteredRecords.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(filteredRecords.map(r => r.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                        className="w-4 h-4 accent-stone-900 rounded cursor-pointer"
                      />
                    </th>
                    {tableFields.map((field) => (
                      <th key={field.key} className="px-3 py-3 font-black text-stone-500 whitespace-nowrap">
                        {field.label}
                      </th>
                    ))}
                    <th className="px-3 py-3 font-black text-stone-500 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className={`hover:bg-stone-50/70 ${editingRecord?.id === record.id ? "bg-amber-50/70" : ""} ${selectedIds.includes(record.id) ? "bg-stone-50" : ""}`}>
                      <td className="px-3 py-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(record.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, record.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== record.id));
                            }
                          }}
                          className="w-4 h-4 accent-stone-900 rounded cursor-pointer"
                        />
                      </td>
                      {tableFields.map((field) => (
                        <td key={field.key} className="px-3 py-3 max-w-[220px] truncate text-stone-700">
                          {formatValue(record[field.key])}
                        </td>
                      ))}
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => startEdit(record)} className="px-2.5 py-2 rounded-lg hover:bg-stone-100 text-stone-700 inline-flex items-center gap-1 text-[11px] font-bold">
                            <Edit2 className="w-4 h-4" />
                            แก้ไข
                          </button>
                          <button type="button" onClick={() => handleDelete(record)} className="px-2.5 py-2 rounded-lg hover:bg-red-50 text-red-600 inline-flex items-center gap-1 text-[11px] font-bold">
                            <Trash2 className="w-4 h-4" />
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <aside className="bg-white border border-stone-200 rounded-2xl p-4 h-max sticky top-20">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h4 className="text-sm font-black text-stone-950">{editingRecord ? "แก้ไขข้อมูล" : "เพิ่มข้อมูลใหม่"}</h4>
            <p className="text-[11px] text-stone-500 mt-1">Collection: {schema.collection}</p>
            {editingRecord && (
              <p className="text-[11px] text-amber-700 font-bold mt-1">
                กำลังแก้ไข: {editingRecord[schema.primaryKey] || editingRecord.id}
              </p>
            )}
          </div>
          {editingRecord && (
            <button type="button" onClick={startCreate} className="p-2 rounded-lg hover:bg-stone-100 text-stone-500">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {error && (
          <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-xl text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="mb-3 p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0" /> {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {schema.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-wide flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-red-500">*</span>}
              </label>
              <FieldInput
                field={field}
                value={formData[field.key]}
                onChange={(value) => setFormData((prev) => ({ ...prev, [field.key]: value }))}
              />
              {field.help && <p className="text-[10px] text-stone-400">{field.help}</p>}
            </div>
          ))}
          <button type="submit" className="w-full py-3 rounded-xl bg-stone-950 text-white text-sm font-black">
            {editingRecord ? "บันทึกการแก้ไข" : "สร้างข้อมูล"}
          </button>
        </form>
      </aside>

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="import_data_modal">
          <div className="bg-white border border-stone-200 rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  📥 นำเข้าข้อมูลหลายรายการ - {schema.title}
                </h3>
                <p className="text-[10px] text-stone-500 mt-1">
                  รองรับการนำเข้าแบบ Excel และ ข้อความ (CSV/JSON) เพื่อสร้างหรืออัปเดตข้อมูลทีละหลายรายการ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {importError && (
                <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl text-xs flex items-start gap-2 animate-shake">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{importError}</span>
                </div>
              )}
              {importSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl text-xs flex items-start gap-2 animate-fade-in">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* Step 1: Input selection if no preview rows exist yet */}
              {previewRows.length === 0 ? (
                <div className="space-y-6">
                  {/* Tabs */}
                  <div className="flex border-b border-stone-200">
                    <button
                      type="button"
                      onClick={() => setImportType("excel")}
                      className={`px-4 py-2 text-xs font-bold border-b-2 transition ${
                        importType === "excel" ? "border-stone-950 text-stone-950" : "border-transparent text-stone-400"
                      }`}
                    >
                      ไฟล์ Excel (.xlsx / .xls)
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportType("text")}
                      className={`px-4 py-2 text-xs font-bold border-b-2 transition ${
                        importType === "text" ? "border-stone-950 text-stone-950" : "border-transparent text-stone-400"
                      }`}
                    >
                      ข้อความ (CSV / JSON)
                    </button>
                  </div>

                  {importType === "excel" ? (
                    <div className="border-2 border-dashed border-stone-200 rounded-3xl p-10 text-center hover:bg-stone-50 transition cursor-pointer relative">
                      <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileChange}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <FileSpreadsheet className="w-12 h-12 text-stone-400 mx-auto mb-3" />
                      <p className="text-xs font-bold text-stone-700">ลากและวางไฟล์ หรือคลิกเพื่ออัปโหลดไฟล์ Excel</p>
                      <p className="text-[10px] text-stone-400 mt-1">ไฟล์ควรใช้หัวตาราง (Headers) ให้ตรงกับฟิลด์ของระบบ</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-stone-500 uppercase tracking-wide">
                          วางข้อความในรูปแบบ CSV หรือ JSON Array
                        </label>
                        <textarea
                          value={pastedText}
                          onChange={(e) => setPastedText(e.target.value)}
                          className="w-full h-48 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-mono focus:ring-2 focus:ring-stone-950/10 focus:outline-none"
                          placeholder={
                            "ตัวอย่าง CSV:\n" +
                            schema.fields.map(f => f.key).join(",") + "\n" +
                            "val1,val2,val3...\n\n" +
                            "ตัวอย่าง JSON:\n" +
                            "[\n  {\n" + schema.fields.slice(0, 3).map(f => `    "${f.key}": "ค่า"`).join(",\n") + "\n  }\n]"
                          }
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleTextParse}
                        className="w-full py-2.5 rounded-xl bg-stone-950 text-white font-bold text-xs"
                      >
                        ประมวลผลข้อความ
                      </button>
                    </div>
                  )}

                  {/* Schema fields help */}
                  <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4">
                    <h4 className="text-xs font-black text-stone-800 mb-2">โครงสร้างคีย์ฟิลด์ที่กำหนด (Schema Fields)</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
                      {schema.fields.map(f => (
                        <div key={f.key} className="bg-white p-2 rounded-xl border border-stone-200 flex flex-col justify-between">
                          <span className="font-bold text-stone-900">{f.key} {f.required && <span className="text-red-500">*</span>}</span>
                          <span className="text-stone-500">{f.label} ({f.type})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Step 2: Preview & Editing Screen */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-stone-800">
                        พบข้อมูลทั้งหมด <span className="text-emerald-600 font-black">{previewRows.length} แถว</span>
                      </p>
                      <p className="text-[10px] text-stone-400">
                        คุณสามารถเพิ่ม แก้ไขค่าในแต่ละช่อง หรือลบแถวที่ไม่ต้องการออกก่อนจะบันทึกจริงลงฐานข้อมูล
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addBlankPreviewRow}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl font-bold text-[11px] flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> เพิ่มแถวใหม่
                    </button>
                  </div>

                  {/* Preview Spreadsheet table */}
                  <div className="border border-stone-200 rounded-2xl overflow-hidden max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-stone-50 sticky top-0 border-b border-stone-200 z-10">
                        <tr>
                          <th className="px-3 py-2 font-black text-stone-500">#</th>
                          {schema.fields.map(f => (
                            <th key={f.key} className="px-3 py-2 font-black text-stone-500 whitespace-nowrap min-w-[120px]">
                              {f.label} ({f.key})
                            </th>
                          ))}
                          <th className="px-3 py-2 font-black text-stone-500 text-right sticky right-0 bg-stone-50">ลบ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 bg-white">
                        {previewRows.map((row, idx) => (
                          <tr key={row.id || idx} className="hover:bg-stone-50">
                            <td className="px-3 py-1 text-stone-400 font-mono">{idx + 1}</td>
                            {schema.fields.map(f => (
                              <td key={f.key} className="px-2 py-1">
                                {f.type === "boolean" ? (
                                  <input
                                    type="checkbox"
                                    checked={Boolean(row[f.key])}
                                    onChange={(e) => updatePreviewRowValue(idx, f.key, e.target.checked)}
                                    className="w-4 h-4 accent-stone-900"
                                  />
                                ) : f.type === "select" ? (
                                  <select
                                    value={row[f.key] ?? ""}
                                    onChange={(e) => updatePreviewRowValue(idx, f.key, e.target.value)}
                                    className="w-full px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-[10px]"
                                  >
                                    <option value="">- เลือก -</option>
                                    {(f.options || []).map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={f.type === "number" ? "number" : "text"}
                                    value={row[f.key] ?? ""}
                                    onChange={(e) => updatePreviewRowValue(idx, f.key, e.target.value)}
                                    placeholder={f.label}
                                    className="w-full px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-[10px] focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-950/20"
                                  />
                                )}
                              </td>
                            ))}
                            <td className="px-3 py-1 text-right sticky right-0 bg-white shadow-l">
                              <button
                                type="button"
                                onClick={() => removePreviewRow(idx)}
                                className="p-1 text-stone-400 hover:text-red-600 rounded transition hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={() => setPreviewRows([])}
                      className="px-4 py-2 border border-stone-200 rounded-xl font-bold text-xs hover:bg-stone-50 text-stone-600"
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="button"
                      disabled={isSavingImport}
                      onClick={saveImportedRows}
                      className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition disabled:opacity-55"
                    >
                      {isSavingImport ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> กำลังบันทึกข้อมูล...
                        </>
                      ) : (
                        <>บันทึกข้อมูลทั้งหมดลงฐานข้อมูล</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {isBulkEditModalOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl border border-stone-200 shadow-2xl max-w-md w-full overflow-hidden animate-scale-up">
            <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="text-sm font-black text-stone-900 font-sans">แก้ไขข้อมูลแบบกลุ่ม (Bulk Edit)</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">แก้ไข {selectedIds.length} รายการพร้อมกัน</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkEditModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-200 text-stone-400 hover:text-stone-700 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-wide">เลือกฟิลด์ที่ต้องการแก้ไข</label>
                <select
                  value={bulkEditFieldKey}
                  onChange={(e) => {
                    setBulkEditFieldKey(e.target.value);
                    const f = schema.fields.find(field => field.key === e.target.value);
                    setBulkEditValue(f?.type === "boolean" ? false : f?.type === "number" ? 0 : "");
                  }}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:ring-2 focus:ring-stone-950/10 focus:outline-none"
                >
                  <option value="">-- เลือกฟิลด์ --</option>
                  {schema.fields.filter(f => !f.readonly).map(f => (
                    <option key={f.key} value={f.key}>{f.label} ({f.key})</option>
                  ))}
                </select>
              </div>

              {bulkEditFieldKey && (
                <div className="space-y-1.5 animate-fade-in">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-wide">ระบุค่าใหม่</label>
                  {(() => {
                    const f = schema.fields.find(field => field.key === bulkEditFieldKey);
                    if (!f) return null;
                    if (f.type === "boolean") {
                      return (
                        <div className="flex items-center gap-2 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(bulkEditValue)}
                            onChange={(e) => setBulkEditValue(e.target.checked)}
                            className="w-4 h-4 accent-stone-900 rounded cursor-pointer"
                            id="bulk-edit-checkbox"
                          />
                          <label htmlFor="bulk-edit-checkbox" className="text-xs text-stone-700 font-bold select-none cursor-pointer">
                            {bulkEditValue ? "ใช่ (Yes / True)" : "ไม่ใช่ (No / False)"}
                          </label>
                        </div>
                      );
                    }
                    if (f.type === "select") {
                      return (
                        <select
                          value={bulkEditValue}
                          onChange={(e) => setBulkEditValue(e.target.value)}
                          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:ring-2 focus:ring-stone-950/10 focus:outline-none"
                        >
                          <option value="">- เลือก -</option>
                          {(f.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      );
                    }
                    if (f.type === "textarea") {
                      return (
                        <textarea
                          value={bulkEditValue}
                          onChange={(e) => setBulkEditValue(e.target.value)}
                          className="w-full h-24 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:ring-2 focus:ring-stone-950/10 focus:outline-none"
                          placeholder={`ระบุ ${f.label}`}
                        />
                      );
                    }
                    return (
                      <input
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                        value={bulkEditValue}
                        onChange={(e) => setBulkEditValue(e.target.value)}
                        className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:ring-2 focus:ring-stone-950/10 focus:outline-none"
                        placeholder={`ระบุ ${f.label}`}
                      />
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-stone-100 bg-stone-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBulkEditModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-stone-200 text-stone-600 hover:bg-stone-100 transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isApplyingBulkEdit || !bulkEditFieldKey}
                onClick={handleApplyBulkEdit}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-stone-950 hover:bg-stone-800 text-white transition disabled:opacity-50 cursor-pointer"
              >
                {isApplyingBulkEdit ? "กำลังประมวลผล..." : `บันทึกสำหรับ ${selectedIds.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {isBulkDeleteModalOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl border border-stone-200 shadow-2xl max-w-sm w-full overflow-hidden animate-scale-up">
            <div className="p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-stone-900">ยืนยันการลบข้อมูลแบบกลุ่ม?</h3>
                <p className="text-xs text-stone-500 mt-1">
                  คุณกำลังจะลบข้อมูลทั้งหมด <span className="font-bold text-red-600">{selectedIds.length} รายการ</span> ออกจากระบบอย่างถาวร การดำเนินการนี้จะไม่สามารถกู้คืนได้
                </p>
              </div>
            </div>
            
            <div className="p-5 border-t border-stone-100 bg-stone-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                className="w-full py-2.5 rounded-xl text-xs font-bold border border-stone-200 text-stone-600 hover:bg-stone-100 transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isApplyingBulkDelete}
                onClick={handleApplyBulkDelete}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50 cursor-pointer"
              >
                {isApplyingBulkDelete ? "กำลังลบ..." : `ยืนยันลบ ${selectedIds.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
