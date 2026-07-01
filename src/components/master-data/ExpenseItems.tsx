import React, { useState, useEffect, useMemo } from "react";
import { collection, query, onSnapshot, doc, orderBy } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ClearingItem } from "../../types";
import { 
  Search, 
  Filter, 
  Download, 
  Receipt, 
  Calendar, 
  User, 
  Tag, 
  Scan,
  AlertCircle,
  Copy,
  RefreshCw,
  Eye,
  FileText,
  Building
, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";

export default function ExpenseItems() {
  const [items, setItems] = useState<ClearingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "clearingItems"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClearingItem));
      setItems(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = 
        item.itemName?.toLowerCase().includes(search.toLowerCase()) || 
        item.vendorName?.toLowerCase().includes(search.toLowerCase()) ||
        item.advId?.toLowerCase().includes(search.toLowerCase());
      return matchesSearch;
    });
  }, [items, search]);

  const handleExport = () => {
    const data = filteredItems.map(({ id, ...rest }) => rest);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ExpenseItems");
    XLSX.writeFile(wb, `expense_items_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">รายการค่าใช้จ่าย (Expenses)</h2>
          <p className="text-[10px] text-stone-500 font-medium">คลังข้อมูลใบเสร็จและรายการหักภาษีทั้งหมด</p>
        </div>
        <button onClick={handleExport} className="p-2 text-stone-600 hover:bg-stone-100 rounded-xl transition">
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text"
            placeholder="ค้นหาชื่อรายการ, ผู้ขาย, รหัสใบเบิก..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-stone-900/5 transition shadow-sm"
          />
        </div>

        <div className="space-y-3 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-stone-300 animate-spin" />
              <span className="text-xs text-stone-400 font-medium">กำลังโหลดรายการค่าใช้จ่าย...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
              <Receipt className="w-12 h-12 text-stone-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-stone-500">ไม่พบรายการค่าใช้จ่าย</p>
            </div>
          ) : (
            filteredItems.map(item => (
              <motion.div 
                layout
                key={item.id}
                className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] font-black text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-md uppercase">{item.documentType}</span>
                        {item.isDuplicate && (
                          <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                            <AlertCircle className="w-2.5 h-2.5" /> ซ้ำ
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-stone-900 truncate">{item.itemName}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                          <Building className="w-3 h-3" /> {item.vendorName}
                        </p>
                        <span className="text-[10px] text-stone-300">•</span>
                        <p className="text-[10px] text-stone-500 font-medium">{item.advId}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-stone-900">฿{item.netAmount?.toLocaleString()}</p>
                      <p className="text-[9px] text-stone-400 font-bold uppercase mt-1">Net Amount</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-stone-50">
                    <div className="space-y-0.5">
                      <p className="text-[9px] text-stone-400 font-bold uppercase">VAT</p>
                      <p className="text-[10px] font-bold text-stone-700">฿{item.vatAmount?.toLocaleString()}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[9px] text-stone-400 font-bold uppercase">WHT</p>
                      <p className="text-[10px] font-bold text-stone-700">฿{item.whtAmount?.toLocaleString()}</p>
                    </div>
                    <div className="space-y-0.5 text-right">
                      <p className="text-[9px] text-stone-400 font-bold uppercase">OCR</p>
                      <p className={`text-[10px] font-bold ${item.ocrConfidence > 0.8 ? "text-emerald-600" : "text-amber-600"}`}>
                        {(item.ocrConfidence * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-stone-400 font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {item.documentDate}
                    </p>
                    {item.imageUrl && (
                      <button 
                        onClick={() => setSelectedImage(item.imageUrl!)}
                        className="text-[10px] font-bold text-stone-900 flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-xl transition"
                      >
                        <Eye className="w-3.5 h-3.5" /> ดูใบเสร็จ
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-950/90 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setSelectedImage(null)}
          >
            <button className="absolute top-6 right-6 text-white p-2 hover:bg-white/10 rounded-full transition">
              <X className="w-8 h-8" />
            </button>
            <motion.img 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={selectedImage} 
              className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
