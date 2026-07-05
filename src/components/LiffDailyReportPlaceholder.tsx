import { CalendarDays, Lock } from "lucide-react";

export default function LiffDailyReportPlaceholder() {
  const query = new URLSearchParams(window.location.search);
  const date = query.get("date") || new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-stone-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-stone-950 font-black">
          <CalendarDays className="w-5 h-5" />
          Daily Executive Report
        </div>
        <p className="text-sm text-stone-600 mt-3">วันที่รายงาน: {date}</p>
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 font-bold flex gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          หน้ารายงานรายวันถูกจอง route ไว้แล้ว และจะเปิดข้อมูลจริงในคำสั่ง Daily Executive Report โดยไม่กลับ Dashboard
        </div>
      </div>
    </div>
  );
}
