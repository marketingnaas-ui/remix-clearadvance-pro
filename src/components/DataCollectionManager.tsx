import React, { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from "firebase/firestore";
import { AlertCircle, Check, Database, Edit2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { db } from "../lib/firebase";
import { CollectionFieldSchema, CollectionSchema } from "../lib/collectionSchemas";

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

export default function DataCollectionManager({ schema }: DataCollectionManagerProps) {
  const [records, setRecords] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingRecord, setEditingRecord] = useState<RecordData | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>(() => emptyFormFor(schema));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const colRef = collection(db, schema.collection);
    const q = query(colRef);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRecords(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
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
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9 pr-3 py-2 rounded-xl border border-stone-200 bg-stone-50 text-sm w-64 max-w-full"
                placeholder="ค้นหา"
              />
            </div>
            <button type="button" onClick={startCreate} className="px-3 py-2 rounded-xl bg-stone-950 text-white text-xs font-bold flex items-center gap-1.5">
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
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
                  <tr key={record.id} className={`hover:bg-stone-50/70 ${editingRecord?.id === record.id ? "bg-amber-50/70" : ""}`}>
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
    </div>
  );
}
