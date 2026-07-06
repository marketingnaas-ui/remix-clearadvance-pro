import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { db } from "../lib/firebase";
import { LineActionLog } from "../types";
import { Activity, Clock } from "lucide-react";

export default function LiffActionLogs() {
  const [logs, setLogs] = useState<LineActionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "lineActionLogs"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results: LineActionLog[] = [];
      snapshot.forEach((doc) => {
        try {
          results.push(JSON.parse(JSON.stringify(doc.data())) as LineActionLog);
        } catch (e) {
          console.error("Error sanitizing log entry:", e);
        }
      });
      setLogs(results);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-stone-800 border-b border-stone-200 pb-2">LINE LIFF Action Logs</h3>
      
      {loading ? (
        <div className="text-center text-xs text-stone-500 py-4">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="text-center text-xs text-stone-500 py-10 bg-stone-50 rounded-xl border border-stone-200">
          <Activity className="w-8 h-8 text-stone-300 mx-auto mb-2" />
          No LIFF action logs found
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden text-[10px] font-mono shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase tracking-wider">
                <th className="py-2 px-3">Timestamp</th>
                <th className="py-2 px-3">Advance ID</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-700">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-stone-50 transition">
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-stone-400" />
                      {new Date(log.timestamp).toLocaleString("th-TH")}
                    </div>
                  </td>
                  <td className="py-2 px-3 font-bold text-stone-900">{log.advId}</td>
                  <td className="py-2 px-3">
                    <span className="bg-stone-100 px-1.5 py-0.5 rounded text-[9px] font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${log.status === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 truncate max-w-[120px]">
                    {log.employeeName || log.lineUserId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
