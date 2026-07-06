const fs = require('fs');

const file = 'src/components/Dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// Find the start and end indices
const startMarker = `      {/* ==================================================================== */}\n      {/* 1. EMPLOYEE DASHBOARD VIEW */}`;
const endMarker = `      {/* ==================================================================== */}\n      {/* 4. MODALS & SLIDE-OVERS */}`;

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const replacement = `      {/* ==================================================================== */}
      {/* UNIFIED DASHBOARD LAYOUT */}
      {/* ==================================================================== */}
      <div className="space-y-6">
        {/* Top Menu Cards (All Roles) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <button onClick={() => onNavigate("request")} className="bg-white border border-stone-200 hover:border-stone-400 hover:shadow-md rounded-2xl p-4 transition text-left flex flex-col gap-2 w-full group">
            <div className="w-10 h-10 bg-stone-900 group-hover:bg-stone-800 text-stone-50 rounded-xl flex items-center justify-center shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-xs">ขอเบิก</h4>
              <p className="text-[10px] text-stone-400 mt-0.5">เบิกเงินทดรองจ่าย</p>
            </div>
          </button>
          <button onClick={() => onNavigate("clearance")} className="bg-white border border-stone-200 hover:border-indigo-300 hover:shadow-md rounded-2xl p-4 transition text-left flex flex-col gap-2 w-full group">
            <div className="w-10 h-10 bg-indigo-600 group-hover:bg-indigo-700 text-indigo-50 rounded-xl flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-indigo-950 text-xs">เคลียร์ยอด</h4>
              <p className="text-[10px] text-stone-400 mt-0.5">แนบใบเสร็จหักล้างยอด</p>
            </div>
          </button>
          <button onClick={() => setIsNotificationOpen(true)} className="bg-white border border-stone-200 hover:border-amber-400 hover:shadow-md rounded-2xl p-4 transition text-left flex flex-col gap-2 w-full group">
            <div className="w-10 h-10 bg-amber-500 group-hover:bg-amber-600 text-white rounded-xl flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-xs">แจ้งเตือน</h4>
              <p className="text-[10px] text-stone-400 mt-0.5">ประวัติสถานะเอกสาร</p>
            </div>
          </button>
          <button onClick={() => onNavigate("audit")} className="bg-white border border-stone-200 hover:border-stone-400 hover:shadow-md rounded-2xl p-4 transition text-left flex flex-col gap-2 w-full group">
            <div className="w-10 h-10 bg-stone-100 group-hover:bg-stone-200 text-stone-700 rounded-xl flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-stone-950 text-xs">ประวัติ</h4>
              <p className="text-[10px] text-stone-400 mt-0.5">รายการธุรกรรมทั้งหมด</p>
            </div>
          </button>
        </div>

        {/* KPI Preset Section */}
        {(() => {
          let kpiPreset = "employee";
          if (currentEmployee.position) {
            const roleConfig = globalSettings?.rolePermissions?.roles?.find((r) => r.id === currentEmployee.position);
            if (roleConfig?.dashboard?.kpiPreset) {
              kpiPreset = roleConfig.dashboard.kpiPreset;
            }
          } else {
            if (currentEmployee.role === "ACCOUNTANT") kpiPreset = "accounting";
            else if (currentEmployee.role === "ADMIN" || currentEmployee.role === "MANAGER") kpiPreset = "executive";
          }

          if (kpiPreset === "employee") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดค้างเคลียร์</p>
                  <p className="text-lg font-black text-stone-900 font-mono mt-1">{formatCurrency(empOutstandingBalance)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดเบิกสะสม</p>
                  <p className="text-lg font-black text-indigo-600 font-mono mt-1">{formatCurrency(nonDraftAdvances.reduce((s, a) => s + a.requestAmount, 0))}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดเคลียร์แล้ว</p>
                  <p className="text-lg font-black text-emerald-600 font-mono mt-1">{formatCurrency(empClosedAmount)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">รอส่งเอกสารตัวจริง</p>
                  <p className="text-lg font-black text-amber-600 font-mono mt-1">{advances.filter(a => a.status === "WAITING_CLEARANCE" && a.employeeId === currentEmployee.id).length} คำขอ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดเกินกำหนด</p>
                  <p className="text-lg font-black text-red-600 font-mono mt-1">{formatCurrency(urgentClearingAdvances.filter(a => a.employeeId === currentEmployee.id).reduce((s, a) => s + a.outstandingAmount, 0))}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">จำนวนใบเบิกคงค้าง</p>
                  <p className="text-lg font-black text-stone-900 font-mono mt-1">{nonDraftAdvances.filter(a => a.status !== "CLOSED" && a.status !== "REJECTED").length} ใบ</p>
                </div>
              </div>
            );
          }

          if (kpiPreset === "accounting") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">รอโอนเงิน</p>
                  <p className="text-lg font-black text-blue-600 font-mono mt-1">{advances.filter(a => a.status === "WAITING_TRANSFER").length} รายการ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">รอตรวจบิล</p>
                  <p className="text-lg font-black text-yellow-600 font-mono mt-1">{advances.filter(a => a.status === "PENDING_AUDIT").length} รายการ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ติดตามเอกสาร (รอเคลียร์)</p>
                  <p className="text-lg font-black text-indigo-600 font-mono mt-1">{advances.filter(a => a.status === "WAITING_CLEARANCE").length} รายการ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">จำนวนใบเบิกคงค้าง</p>
                  <p className="text-lg font-black text-stone-900 font-mono mt-1">{acctTotalItems} ใบ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดเงินเกินกำหนดเคลียร์</p>
                  <p className="text-lg font-black text-red-600 font-mono mt-1">{formatCurrency(urgentClearingAdvances.reduce((s, a) => s + a.outstandingAmount, 0))}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">รอโอนคืนบริษัท (ตีกลับ)</p>
                  <p className="text-lg font-black text-stone-900 font-mono mt-1">{formatCurrency(advances.filter(a => a.status === "RETURNED").reduce((sum, a) => sum + a.outstandingAmount, 0))}</p>
                </div>
              </div>
            );
          }

          if (kpiPreset === "executive" || kpiPreset === "admin" || kpiPreset === "ceo") {
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">รออนุมัติ</p>
                  <p className="text-lg font-black text-amber-600 font-mono mt-1">{managerPendingCount} รายการ</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดโอนวันนี้</p>
                  <p className="text-lg font-black text-blue-600 font-mono mt-1">{formatCurrency(heroStats.today.amount)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดใช้จ่ายโครงการ (ปิดยอด)</p>
                  <p className="text-lg font-black text-emerald-600 font-mono mt-1">{formatCurrency(acctClosedValue)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดค้างเคลียร์รวม</p>
                  <p className="text-lg font-black text-indigo-600 font-mono mt-1">{formatCurrency(acctPendingClearValue)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">ยอดค้างเบิกรวม</p>
                  <p className="text-lg font-black text-stone-900 font-mono mt-1">{formatCurrency(managerPendingAmount)}</p>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm relative group">
                  <p className="text-[10px] font-bold text-stone-400 uppercase">พนักงานค้างเคลียร์</p>
                  <div className="mt-1 space-y-1">
                    {topEmployeesOutstanding.length > 0 ? topEmployeesOutstanding.map((e, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px]">
                        <span className="truncate w-16 text-stone-800">{e.name.split(" ")[0]}</span>
                        <span className="font-mono text-red-600 font-bold">{formatCurrency(e.outstanding)}</span>
                      </div>
                    )) : <p className="text-xs text-stone-400">- ไม่มี -</p>}
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* My Tasks (To-Do & Notifications) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex border-b border-stone-100">
            <div className="flex-1 text-center py-3 font-bold text-sm bg-stone-50 border-r border-stone-100 text-stone-900">
              แจ้งเตือน (Notifications)
              <span className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px]">{employeeNotifications.length}</span>
            </div>
            <div className="flex-1 text-center py-3 font-bold text-sm bg-white text-stone-500">
              งานที่ต้องทำ (To-Do)
              <span className="ml-2 px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded-full text-[10px]">
                {draftAdvances.length + draftClearingLogs.length + (currentEmployee.role !== "EMPLOYEE" ? managerPendingCount : 0)}
              </span>
            </div>
          </div>
          <div className="p-4 space-y-3">
             <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {employeeNotifications.length === 0 ? (
                  <div className="py-6 text-center text-stone-400 text-xs">ไม่มีการแจ้งเตือนใหม่</div>
                ) : (
                  employeeNotifications.slice(0, 5).map(log => (
                    <div key={log.id} className="flex items-start gap-3 bg-stone-50 p-3 rounded-xl border border-stone-100">
                       <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg shrink-0">
                         <History className="w-4 h-4" />
                       </div>
                       <div>
                         <p className="text-xs font-bold text-stone-800">{log.note}</p>
                         <p className="text-[10px] text-stone-400 mt-0.5">{log.timestamp.split("T")[0]} • โดย {log.actionBy}</p>
                       </div>
                    </div>
                  ))
                )}
             </div>
          </div>
        </div>
      </div>
\n`;

content = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(file, content);
console.log('Successfully updated Dashboard.tsx');
