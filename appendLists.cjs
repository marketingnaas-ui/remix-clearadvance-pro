const fs = require('fs');

const employeeDrafts = `
          {/* Drafts Section for Employee */}
          {(kpiPreset === "employee") && (draftAdvances.length > 0 || draftClearingLogs.length > 0) && (
            <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-5 md:p-6 shadow-xs space-y-4 animate-fade-in" id="drafts_section">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-amber-950 text-sm">📝 รายการบันทึกร่างของคุณ (Drafts)</h3>
                    <p className="text-[10px] text-amber-700">รายการแบบร่างที่ยังไม่ได้ยื่นคำขอ คุณสามารถกดแก้ไขและส่งคำขอได้ทันที</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full">
                  มีทั้งหมด {draftAdvances.length + draftClearingLogs.length} รายการร่าง
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Draft Advances */}
                {draftAdvances.map((adv) => (
                  <div key={adv.id} className="bg-white border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded uppercase">ร่างคำขอเบิกเงิน</span>
                      </div>
                      <p className="font-bold text-stone-800 text-[11px] truncate">{adv.projectId}</p>
                      <p className="text-[10px] text-stone-500 line-clamp-1">{adv.details}</p>
                      <p className="text-[11px] font-black text-amber-700 font-mono">{formatCurrency(adv.requestAmount)}</p>
                    </div>
                    <button
                      onClick={() => onEditDraftAdvance && onEditDraftAdvance(adv)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold rounded-lg text-[11px] transition flex items-center gap-1 shrink-0"
                    >
                      <FileText className="w-3 h-3" /> แก้ไข/ส่งคำขอ
                    </button>
                  </div>
                ))}
                {/* Draft Clearing Logs */}
                {draftClearingLogs.map((log) => (
                  <div key={log.id} className="bg-white border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-stone-900 text-xs">เคลียร์ยอด {log.advId}</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded uppercase">ร่างตัดยอด (รอบที่ {log.roundNo})</span>
                      </div>
                      <p className="text-[10px] text-stone-500">บันทึกร่างเมื่อ: {log.submittedAt ? log.submittedAt.split("T")[0] : "-"}</p>
                      <p className="text-[11px] font-black text-amber-700 font-mono">{formatCurrency(log.totalSubmittedAmount)}</p>
                    </div>
                    <button
                      onClick={() => onEditDraftClearing && onEditDraftClearing(log.id)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold rounded-lg text-[11px] transition flex items-center gap-1 shrink-0"
                    >
                      <FileText className="w-3 h-3" /> แก้ไข/ส่งคำขอ
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
`;

const employeeLists = `
          {/* Recent list & guideline splits */}
          {kpiPreset === "employee" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between">
                <h3 className="font-bold text-stone-900 text-sm">รายการเบิกเงินล่าสุดของคุณ</h3>
                <span className="text-[10px] font-mono font-bold bg-stone-100 px-2 py-0.5 rounded text-stone-500 uppercase">ทั้งหมด {nonDraftAdvances.length} รายการ</span>
              </div>
              {loading ? (
                <div className="py-20 text-center text-stone-500 text-xs">กำลังโหลดข้อมูล...</div>
              ) : nonDraftAdvances.length === 0 ? (
                <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-3">
                  <FileText className="w-8 h-8 text-stone-300" />
                  <span>คุณยังไม่มีประวัติการขอเบิกเงินทดรองจ่าย</span>
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {nonDraftAdvances.slice(0, 5).map((adv) => (
                    <div key={adv.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/50 transition duration-150">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                          {getStatusBadge(adv.status)}
                        </div>
                        <p className="font-bold text-stone-800 text-xs">{adv.projectId}</p>
                        <p className="text-[11px] text-stone-500 truncate max-w-sm">{adv.details}</p>
                      </div>
                      <div className="flex sm:flex-col items-end justify-between sm:justify-center shrink-0">
                        <span className="text-[10px] text-stone-400 font-mono sm:mb-1">{adv.createdAt.split("T")[0]}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-stone-900 text-sm">{formatCurrency(adv.requestAmount)}</span>
                          <button
                            onClick={() => handleOpenDetails(adv)}
                            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-900 transition"
                            title="ดูรายละเอียด"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Instruction Guidelines Card */}
            <div className="bg-stone-900 text-stone-100 rounded-2xl p-6 shadow-sm border border-stone-800 space-y-4">
              <h3 className="font-bold text-white text-sm">คำแนะนำขั้นตอนการทำงาน</h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">1</span>
                  <div>
                    <p className="font-semibold text-white">ยื่นขอเบิกเงินทดรอง</p>
                    <p className="text-stone-400">พนักงานสร้างใบขอเบิกเงิน โดยกรอกข้อมูลและระบุยอดเงินที่จำเป็น</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">2</span>
                  <div>
                    <p className="font-semibold text-white">ผู้บริหารตรวจสอบและโอนเงิน</p>
                    <p className="text-stone-400">ผู้มีอำนาจตรวจสอบอนุมัติ อัปโหลดสลิปโอนเงินเข้าบัญชีพนักงาน</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-stone-800 border border-stone-700 rounded-full flex items-center justify-center text-[10px] font-bold text-amber-500 shrink-0 mt-0.5">3</span>
                  <div>
                    <p className="font-semibold text-white">พนักงานเคลียร์บิล (Manual / AI Scan)</p>
                    <p className="text-stone-400">พนักงานใช้ AI OCR สแกนบิลใบเสร็จ เพื่อกรอกข้อมูลตัดค่าใช้จ่ายแบบทันที</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
`;

const managerList = `
          {/* Recent list of requests with interactive Approve / Reject buttons */}
          {(kpiPreset === "executive" || kpiPreset === "admin" || kpiPreset === "ceo") && (
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-stone-900 text-sm">รายการรอการตรวจสอบและอนุมัติ</h3>
                <p className="text-[11px] text-stone-400 mt-0.5">รวมทั้งสิ้น {advances.filter(a => a.status === "PENDING_APPROVAL").length} คำขอที่รอการตัดสินใจ</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-stone-100 px-2.5 py-1 rounded text-stone-600 uppercase">รวมทั้งหมด {advances.length}</span>
                <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                  <button
                    onClick={() => setManagerTableViewMode("table")}
                    className={\`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 \${managerTableViewMode === "table" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}\`}
                  >
                    <List className="w-3 h-3" />
                    <span>ตาราง</span>
                  </button>
                  <button
                    onClick={() => setManagerTableViewMode("card")}
                    className={\`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 \${managerTableViewMode === "card" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}\`}
                  >
                    <Grid className="w-3 h-3" />
                    <span>การ์ด</span>
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-stone-500 text-xs">กำลังโหลดข้อมูล...</div>
            ) : advances.length === 0 ? (
              <div className="py-20 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-stone-300" />
                <span>ไม่มีประวัติรายการเบิกเงินในขณะนี้</span>
              </div>
            ) : managerTableViewMode === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                      <th className="py-3 px-4">เลขที่เอกสาร / ผู้ขอเบิก</th>
                      <th className="py-3 px-4">โครงการ / รายละเอียด</th>
                      <th className="py-3 px-4 text-right">จำนวนเงิน</th>
                      <th className="py-3 px-4">สถานะ</th>
                      <th className="py-3 px-4 text-center">จัดการคำขอ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {advances.slice(0, 15).map((adv) => (
                      <tr key={adv.id} className="hover:bg-stone-50/50 transition duration-150">
                        <td className="py-4 px-4">
                          <div className="font-mono font-bold text-stone-900">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-medium uppercase">{adv.employeeName}</div>
                        </td>
                        <td className="py-4 px-4 max-w-xs">
                          <div className="font-bold text-stone-800 truncate">{adv.projectId}</div>
                          <div className="text-[11px] text-stone-500 truncate mt-0.5">{adv.details}</div>
                        </td>
                        <td className="py-4 px-4 text-right font-mono font-bold text-stone-900 text-sm">
                          {formatCurrency(adv.requestAmount)}
                        </td>
                        <td className="py-4 px-4">{getStatusBadge(adv.status)}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenDetails(adv)}
                              className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-lg transition flex items-center gap-1"
                              title="ดูรายละเอียดคำขอ"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ดูรายละเอียด</span>
                            </button>
                            {adv.status === "PENDING_APPROVAL" && (
                              <>
                                <button
                                  onClick={() => handleApprove(adv)}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition flex items-center gap-1"
                                  title="อนุมัติคำขอ"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  onClick={() => handleOpenReject(adv)}
                                  className="px-2.5 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 font-bold rounded-lg transition flex items-center gap-1"
                                  title="ปฏิเสธคำขอ"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 bg-stone-50/50 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {advances.slice(0, 15).map((adv) => (
                  <div key={adv.id} className="bg-white border border-stone-200 rounded-xl p-4 shadow-xs hover:shadow-md transition duration-200 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-bold uppercase mt-0.5">{adv.employeeName}</div>
                        </div>
                        {getStatusBadge(adv.status)}
                      </div>
                      <div className="pt-2 border-t border-stone-100 space-y-1">
                        <div className="text-xs font-bold text-stone-800 truncate">{adv.projectId}</div>
                        <div className="text-[11px] text-stone-500 line-clamp-2 leading-relaxed">{adv.details}</div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-stone-400 uppercase">จำนวนเงินเบิก</div>
                        <div className="font-mono font-black text-stone-900 text-sm mt-0.5">{formatCurrency(adv.requestAmount)}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleOpenDetails(adv)}
                          className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg transition"
                          title="ดูรายละเอียดคำขอ"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {adv.status === "PENDING_APPROVAL" && (
                          <>
                            <button
                              onClick={() => handleApprove(adv)}
                              className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
                              title="อนุมัติคำขอ"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleOpenReject(adv)}
                              className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition"
                              title="ปฏิเสธคำขอ"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
`;

const accountingList = `
          {kpiPreset === "accounting" && (
            <>
          {/* 🚨 Urgent Follow-up Box (กล่องข้อมูลติดตามเร่งด่วน) */}
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm text-stone-850 space-y-6">
            <div className="flex items-center gap-2.5 pb-4 border-b border-stone-200">
              <div className="p-2 bg-red-500/10 text-red-500 rounded-xl border border-red-500/20">
                <AlertCircle className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-[15px] text-black">กล่องข้อมูลติดตามเร่งด่วน (Urgent Follow-up Hub)</h3>
                <p className="text-[11px] text-black mt-0.5">ติดตามรายการใกล้กำหนดส่งเอกสารและสรุปยอดคงค้างพนักงานสูงสุด 3 อันดับแรก</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-stone-500" />
                  <span className="text-[11px] font-normal text-black">รายการใกล้กำหนดส่งเคลียร์เอกสาร (Top 5 Soonest)</span>
                </h4>

                {urgentClearingAdvances.length === 0 ? (
                  <div className="py-10 bg-stone-50 rounded-2xl border border-stone-200 text-center text-xs text-stone-500">
                    ไม่มีรายการค้างเคลียร์ในขณะนี้
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                    {urgentClearingAdvances.map((adv, idx) => {
                      const diffTime = new Date(adv.neededDate).getTime() - new Date().getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      const isOverdue = diffDays < 0;
                      const isFirst = idx === 0;

                      return (
                        <div
                          key={adv.id}
                          className={\`\${isFirst ? "bg-[#696969] text-white border border-stone-200" : "bg-stone-50 border border-stone-200 text-stone-800 hover:bg-stone-100/60"} rounded-2xl p-3.5 transition duration-150 flex items-center justify-between gap-3\`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={\`font-mono font-bold text-xs truncate \${isFirst ? "text-white" : "text-stone-900"}\`}>{adv.advId}</span>
                              <span className={\`text-[10px] px-2 py-0.5 rounded font-medium truncate max-w-[120px] \${isFirst ? "bg-stone-900 text-white" : "bg-stone-200/60 text-stone-600"}\`}>{adv.employeeName}</span>
                            </div>
                            <div className={\`text-[11px] truncate \${isFirst ? "text-white/95" : "text-stone-500"}\`}>
                              โครงการ: <span className={\`\${isFirst ? "text-white" : "text-stone-900"} font-bold\`}>{adv.projectId}</span>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                              <Clock className={\`w-3.5 h-3.5 \${isFirst ? "text-white/80" : "text-stone-400"}\`} />
                              <span className={\`text-[10px] font-bold \${isFirst ? "text-white" : isOverdue ? "text-red-500" : diffDays <= 7 ? "text-amber-600" : "text-stone-500"}\`}>
                                {isOverdue 
                                  ? \`เลยกำหนดมาแล้ว \${Math.abs(diffDays)} วัน\` 
                                  : \`เหลือเวลาอีก \${diffDays} วัน (\${adv.neededDate})\`}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <p className={\`text-[10px] font-bold uppercase \${isFirst ? "text-white/80" : "text-stone-400"}\`}>ยอดคงค้างเคลียร์</p>
                            <p className={\`font-mono font-black text-xs sm:text-sm mt-0.5 \${isFirst ? "text-white" : "text-red-600"}\`}>{formatCurrency(adv.outstandingAmount)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Search, Filter, and All Items List in Bottom Section */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
              <div>
                <h3 className="font-bold text-stone-900 text-sm">รายการคุมยอดทั้งหมดในระบบ</h3>
                <p className="text-[11px] text-stone-400 mt-0.5">ใช้ค้นหาและกรองตรวจสอบยอดเงินทดรองจ่ายของพนักงานทุกคน</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[11px] font-mono font-bold bg-stone-50 px-3 py-1.5 rounded-xl text-stone-600 border border-stone-200/50">
                  พบ {filteredAdvances.length} จากทั้งหมด {advances.length} รายการ
                </div>
                <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                  <button
                    onClick={() => exportToExcel(filteredAdvances, \`Advances_Export_\${new Date().toISOString().split('T')[0]}\`)}
                    className="px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 text-emerald-700 hover:bg-emerald-50"
                    title="ส่งออกไฟล์ Excel"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>Excel</span>
                  </button>
                  <div className="w-[1px] bg-stone-200 mx-0.5 my-1" />
                  <button
                    onClick={() => setAcctTableViewMode("table")}
                    className={\`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 \${acctTableViewMode === "table" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}\`}
                  >
                    <List className="w-3 h-3" />
                    <span>ตาราง</span>
                  </button>
                  <button
                    onClick={() => setAcctTableViewMode("card")}
                    className={\`px-2 py-1 text-[10px] font-bold rounded-md transition flex items-center gap-1 \${acctTableViewMode === "card" ? "bg-white text-stone-900 shadow-xs" : "text-stone-500 hover:text-stone-800"}\`}
                  >
                    <Grid className="w-3 h-3" />
                    <span>การ์ด</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filter and Search controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อผู้เบิก, เลขเอกสาร, รหัสงาน..."
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition"
                />
              </div>
              <div className="relative">
                <Filter className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition appearance-none cursor-pointer"
                >
                  <option value="ALL">ทุกสถานะขั้นตอน</option>
                  <option value="PENDING_APPROVAL">รออนุมัติ (PENDING_APPROVAL)</option>
                  <option value="WAITING_TRANSFER">รอโอนเงิน (WAITING_TRANSFER)</option>
                  <option value="WAITING_CLEARANCE">รอเคลียร์ (WAITING_CLEARANCE)</option>
                  <option value="PENDING_AUDIT">รอตรวจสอบบิล (PENDING_AUDIT)</option>
                  <option value="PARTIALLY_CLEARED">เคลียร์บางส่วน (PARTIALLY_CLEARED)</option>
                  <option value="RETURNED">ตีกลับเอกสาร (RETURNED)</option>
                  <option value="REJECTED">ปฏิเสธการอนุมัติ (REJECTED)</option>
                  <option value="CLOSED">ปิดยอดแล้ว (CLOSED)</option>
                </select>
              </div>
              <div className="relative">
                <Filter className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-stone-900 focus:bg-white transition appearance-none cursor-pointer"
                >
                  <option value="ALL">ทุกรหัสโครงการ</option>
                  {uniqueProjects.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* List Table of Advances */}
            {filteredAdvances.length === 0 ? (
              <div className="py-16 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                <Info className="w-7 h-7 text-stone-300" />
                <span>ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหาและตัวกรองของคุณ</span>
              </div>
            ) : acctTableViewMode === "table" ? (
              <div className="overflow-x-auto border border-stone-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                      <th className="py-3 px-4">เลขที่เอกสาร / ผู้ขอเบิก</th>
                      <th className="py-3 px-4">โครงการ / แผนก</th>
                      <th className="py-3 px-4">วันที่เบิกเงิน</th>
                      <th className="py-3 px-4 text-right">จำนวนเบิกสุทธิ</th>
                      <th className="py-3 px-4 text-right">ยอดคงค้าง</th>
                      <th className="py-3 px-4">สถานะการทำงาน</th>
                      <th className="py-3 px-4 text-center">ดูข้อมูล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredAdvances.map((adv) => (
                      <tr key={adv.id} className="hover:bg-stone-50/40 transition duration-150">
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-stone-900">{adv.advId}</div>
                          <div className="text-[10px] text-stone-400 font-medium uppercase mt-0.5">{adv.employeeName}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-stone-800">{adv.projectId}</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">{adv.category}</div>
                        </td>
                        <td className="py-3.5 px-4 text-stone-500">
                          {adv.createdAt.split("T")[0]}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900">
                          {formatCurrency(adv.requestAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900">
                          <span className={adv.outstandingAmount > 0 ? "text-red-600" : "text-stone-400"}>
                            {formatCurrency(adv.outstandingAmount)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">{getStatusBadge(adv.status)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleOpenDetails(adv)}
                            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-900 transition"
                            title="ดูรายละเอียดเอกสาร"
                          >
                            <Eye className="w-4 h-4 mx-auto" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {filteredAdvances.map((adv) => (
                  <div key={adv.id} className="bg-stone-50/30 border border-stone-200 rounded-2xl p-4 shadow-xs hover:shadow-sm transition duration-150 flex flex-col justify-between gap-4">
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono font-bold text-stone-900 text-xs">{adv.advId}</span>
                          <p className="text-[10px] text-stone-400 font-bold uppercase mt-0.5">{adv.employeeName}</p>
                        </div>
                        {getStatusBadge(adv.status)}
                      </div>
                      <div className="border-t border-stone-100 pt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-stone-400 block font-bold uppercase text-[9px]">โครงการ</span>
                          <span className="text-stone-800 font-semibold truncate block">{adv.projectId}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 block font-bold uppercase text-[9px]">หมวดหมู่</span>
                          <span className="text-stone-800 font-semibold truncate block">{adv.category || "-"}</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-stone-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-stone-300" />
                        <span>วันที่เบิก: {adv.createdAt.split("T")[0]}</span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="text-[9px] font-bold text-stone-400 uppercase">ยอดเบิก / คงค้าง</div>
                        <div className="font-mono font-bold text-xs">
                          <span className="text-stone-900">{formatCurrency(adv.requestAmount)}</span>
                          <span className="text-stone-300 mx-1">/</span>
                          <span className={adv.outstandingAmount > 0 ? "text-red-500 font-extrabold" : "text-stone-400"}>
                            {formatCurrency(adv.outstandingAmount)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleOpenDetails(adv)}
                        className="p-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition flex items-center gap-1.5 text-[11px] font-bold"
                        title="ดูรายละเอียดเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>ดูข้อมูล</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
          )}
`;

const file = 'src/components/Dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `          </div>
        </div>
      </div>`;

if (!content.includes(targetStr)) {
  console.log("Could not find target string to replace.");
  process.exit(1);
}

const finalReplacement = `          </div>
        </div>

${employeeDrafts}
${employeeLists}
${managerList}
${accountingList}

      </div>`;

content = content.replace(targetStr, finalReplacement);
fs.writeFileSync(file, content);
console.log('Appended lists successfully.');
