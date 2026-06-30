import React, { useState } from "react";
import { Advance, AdvanceStatus } from "../../types";
import { Calendar as CalendarIcon, List as ListIcon, ChevronLeft, ChevronRight, Download, X, User } from "lucide-react";
import { exportToExcel } from "../../lib/excelExport";

interface ClearanceScheduleProps {
  advances: Advance[];
}

export default function ClearanceSchedule({ advances }: ClearanceScheduleProps) {
  const [viewMode, setViewMode] = useState<"calendar" | "card" | "table">("calendar");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateEvents, setSelectedDateEvents] = useState<{ date: string; events: { type: "created" | "deadline" | "cleared", adv: Advance }[] } | null>(null);

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);

  const prevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };
  const nextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const monthNames = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  // Helper to get local date string YYYY-MM-DD
  const toLocalYYYYMMDD = (dStr: string | undefined | null) => {
    if (!dStr) return null;
    return dStr.split("T")[0];
  };

  // Build a map of dates to events
  const dateEvents: Record<string, { type: "created" | "deadline" | "cleared", adv: Advance }[]> = {};

  advances.forEach((adv) => {
    const createdDate = toLocalYYYYMMDD(adv.createdAt);
    const deadlineDate = adv.neededDate;
    const clearedDate = toLocalYYYYMMDD(adv.approvedAt || adv.closedAt || "");

    if (createdDate) {
      if (!dateEvents[createdDate]) dateEvents[createdDate] = [];
      dateEvents[createdDate].push({ type: "created", adv });
    }
    if (deadlineDate) {
      if (!dateEvents[deadlineDate]) dateEvents[deadlineDate] = [];
      dateEvents[deadlineDate].push({ type: "deadline", adv });
    }
    if (clearedDate && (adv.status === AdvanceStatus.CLOSED || adv.status === AdvanceStatus.PARTIALLY_CLEARED)) {
      if (!dateEvents[clearedDate]) dateEvents[clearedDate] = [];
      dateEvents[clearedDate].push({ type: "cleared", adv });
    }
  });

  const renderCalendar = () => {
    const blanks = Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`} className="p-2 border border-stone-100 bg-stone-50/30 min-h-[100px]" />);
    const days = Array.from({ length: daysInMonth }).map((_, i) => {
      const day = i + 1;
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = dateEvents[dateStr] || [];
      
      const createdCount = events.filter(e => e.type === "created").length;
      const clearedCount = events.filter(e => e.type === "cleared").length;
      const deadlineCount = events.filter(e => e.type === "deadline").length;

      return (
        <div key={day} className="p-2 border border-stone-200 bg-white min-h-[100px] flex flex-col gap-1 transition-colors hover:bg-stone-50/80">
          <span className="text-xs font-bold text-stone-400 mb-1">{day}</span>
          <div className="flex flex-col gap-1.5 flex-1 justify-center">
            {events.length > 0 ? (
              <button 
                onClick={() => setSelectedDateEvents({ date: dateStr, events })}
                className="flex flex-col gap-1 w-full text-left"
              >
                {createdCount > 0 && (
                  <div className="text-[10px] font-bold px-1.5 py-1 rounded-md bg-emerald-100 text-emerald-800 flex justify-between items-center shadow-xs hover:bg-emerald-200 transition">
                    <span>สร้างใหม่</span>
                    <span className="bg-emerald-200 px-1.5 py-0.5 rounded-sm">{createdCount}</span>
                  </div>
                )}
                {clearedCount > 0 && (
                  <div className="text-[10px] font-bold px-1.5 py-1 rounded-md bg-yellow-100 text-yellow-800 flex justify-between items-center shadow-xs hover:bg-yellow-200 transition">
                    <span>เคลียร์ยอด</span>
                    <span className="bg-yellow-200 px-1.5 py-0.5 rounded-sm">{clearedCount}</span>
                  </div>
                )}
                {deadlineCount > 0 && (
                  <div className="text-[10px] font-bold px-1.5 py-1 rounded-md bg-red-100 text-red-800 flex justify-between items-center shadow-xs hover:bg-red-200 transition">
                    <span>ถึงกำหนด</span>
                    <span className="bg-red-200 px-1.5 py-0.5 rounded-sm">{deadlineCount}</span>
                  </div>
                )}
              </button>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[10px] text-stone-300">-</span>
              </div>
            )}
          </div>
        </div>
      );
    });

    return (
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-stone-900 text-lg">
            {monthNames[currentMonth]} {currentYear + 543}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-2 bg-stone-100 hover:bg-stone-200 rounded-xl transition text-stone-600">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-bold text-stone-700 transition">
              เดือนปัจจุบัน
            </button>
            <button onClick={nextMonth} className="p-2 bg-stone-100 hover:bg-stone-200 rounded-xl transition text-stone-600">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-stone-200 rounded-xl overflow-hidden border border-stone-200">
          {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((day) => (
            <div key={day} className="bg-stone-100 py-2 text-center text-xs font-bold text-stone-500">
              {day}
            </div>
          ))}
          {blanks}
          {days}
        </div>

        <div className="flex gap-4 pt-4 border-t border-stone-100">
          <div className="flex items-center gap-2 text-xs text-stone-600 font-semibold"><span className="w-3 h-3 bg-emerald-100 rounded-sm"></span> สร้างใหม่</div>
          <div className="flex items-center gap-2 text-xs text-stone-600 font-semibold"><span className="w-3 h-3 bg-yellow-100 rounded-sm"></span> เคลียร์ยอด</div>
          <div className="flex items-center gap-2 text-xs text-stone-600 font-semibold"><span className="w-3 h-3 bg-red-100 rounded-sm"></span> ถึงกำหนด</div>
        </div>
      </div>
    );
  };

  const renderCardView = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
        {advances.map(adv => (
          <div key={adv.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-3">
             <div className="flex justify-between items-start">
                <span className="font-mono text-xs font-bold text-stone-900 bg-stone-100 px-2 py-1 rounded">{adv.advId}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-stone-50 border-stone-200 text-stone-600">{adv.status}</span>
             </div>
             <div>
               <h4 className="font-bold text-stone-800 text-sm truncate">{adv.projectId}</h4>
               <p className="text-xs text-stone-500 truncate">{adv.employeeName}</p>
             </div>
             <div className="pt-3 border-t border-stone-100 space-y-1.5">
               <div className="flex justify-between text-[11px]">
                  <span className="text-stone-400 font-semibold">วันที่สร้าง:</span>
                  <span className="font-mono text-stone-700">{toLocalYYYYMMDD(adv.createdAt)}</span>
               </div>
               <div className="flex justify-between text-[11px]">
                  <span className="text-stone-400 font-semibold">กำหนดเคลียร์:</span>
                  <span className="font-mono font-bold text-red-600">{adv.neededDate}</span>
               </div>
               {adv.approvedAt && (
                 <div className="flex justify-between text-[11px]">
                    <span className="text-stone-400 font-semibold">วันที่อนุมัติ:</span>
                    <span className="font-mono text-emerald-600">{toLocalYYYYMMDD(adv.approvedAt)}</span>
                 </div>
               )}
             </div>
          </div>
        ))}
        {advances.length === 0 && (
          <div className="col-span-full py-10 text-center text-stone-400 text-sm italic">ไม่มีรายการเบิก</div>
        )}
      </div>
    );
  };

  const renderTableView = () => {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden animate-fade-in">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-stone-50 border-b border-stone-200 text-[10px] font-extrabold text-stone-500 uppercase tracking-wider">
              <tr>
                <th className="p-3 pl-4">เลขที่เอกสาร</th>
                <th className="p-3">โครงการ</th>
                <th className="p-3">ผู้เบิก</th>
                <th className="p-3">วันที่สร้าง</th>
                <th className="p-3 text-red-600">กำหนดเคลียร์</th>
                <th className="p-3">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-xs text-stone-700">
              {advances.map(adv => (
                <tr key={adv.id} className="hover:bg-stone-50 transition">
                  <td className="p-3 pl-4 font-mono font-bold text-stone-900">{adv.advId}</td>
                  <td className="p-3">{adv.projectId}</td>
                  <td className="p-3">{adv.employeeName}</td>
                  <td className="p-3 font-mono">{toLocalYYYYMMDD(adv.createdAt)}</td>
                  <td className="p-3 font-mono font-bold text-red-600">{adv.neededDate}</td>
                  <td className="p-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-stone-50 border-stone-200 text-stone-600">
                      {adv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {advances.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-stone-400 italic">ไม่มีรายการเบิก</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-stone-900">กำหนดการเคลียร์เอกสาร (Clearance Schedule)</h2>
          <p className="text-xs text-stone-500">ติดตามกำหนดวันเดดไลน์การเคลียร์เงินทดรองจ่ายและสถานะเอกสารตามปฏิทิน</p>
        </div>
        <div className="flex bg-stone-100 border border-stone-200 rounded-lg p-0.5">
          <button
            onClick={() => {
              const dataToExport = advances.map(adv => ({
                "เลขที่เอกสาร": adv.advId,
                "โครงการ": adv.projectId,
                "ผู้เบิก": adv.employeeName,
                "วันที่สร้าง": adv.createdAt ? adv.createdAt.split("T")[0] : "-",
                "กำหนดเคลียร์": adv.neededDate || "-",
                "สถานะ": adv.status
              }));
              exportToExcel(dataToExport, "Clearance_Schedule");
            }}
            className="p-1.5 rounded-md text-stone-500 hover:text-emerald-600 hover:bg-white transition"
            title="ส่งออก Excel"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-stone-200 self-center mx-0.5" />
          <button
            onClick={() => setViewMode("calendar")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === "calendar" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            ปฏิทิน
          </button>
          <button
            onClick={() => setViewMode("card")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === "card" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            การ์ด
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === "table" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            ตาราง
          </button>
        </div>
      </div>
      
      {viewMode === "calendar" ? renderCalendar() : viewMode === "card" ? renderCardView() : renderTableView()}

      {/* Date Events Modal */}
      {selectedDateEvents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-6 border-b border-stone-100">
              <div>
                <h3 className="text-lg font-black text-stone-900">รายการวันที่ {selectedDateEvents.date}</h3>
                <p className="text-xs text-stone-500">
                  พบ {selectedDateEvents.events.length} รายการที่เกี่ยวข้องในวันนี้
                </p>
              </div>
              <button
                onClick={() => setSelectedDateEvents(null)}
                className="p-2 text-stone-400 hover:text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedDateEvents.events.map((ev, idx) => {
                  let badgeColor = "";
                  let badgeText = "";
                  if (ev.type === "created") {
                    badgeColor = "bg-emerald-100 text-emerald-800";
                    badgeText = "สร้างใหม่";
                  } else if (ev.type === "cleared") {
                    badgeColor = "bg-yellow-100 text-yellow-800";
                    badgeText = "เคลียร์ยอด";
                  } else if (ev.type === "deadline") {
                    badgeColor = "bg-red-100 text-red-800";
                    badgeText = "ถึงกำหนด";
                  }

                  return (
                    <div key={idx} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-4 hover:border-stone-300 transition">
                      <div className="flex justify-between items-start">
                        <span className="font-mono text-xs font-bold text-stone-900 bg-stone-100 px-2 py-1 rounded">
                          {ev.adv.advId}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded shadow-2xs ${badgeColor}`}>
                          {badgeText}
                        </span>
                      </div>
                      
                      <div className="flex gap-3 items-center">
                        <div className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-stone-400" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-stone-900 text-sm truncate">{ev.adv.employeeName}</h4>
                          <p className="text-[10px] text-stone-500 truncate">โครงการ: {ev.adv.projectId}</p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-stone-100 space-y-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-stone-400 font-semibold">ยอดรวม:</span>
                          <span className="font-mono font-bold text-stone-700">
                            {ev.adv.requestAmount?.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"} ฿
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-stone-400 font-semibold">สถานะเอกสาร:</span>
                          <span className="font-mono font-bold text-stone-600">
                            {ev.adv.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
