/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, getDocs, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { VaultFile, Employee } from "../types";
import { Folder, FileText, Search, Download, ChevronRight, HardDrive, Filter, RefreshCw, Calendar, User, Trash2, FileDown } from "lucide-react";
import { exportToExcel } from "../lib/excelExport";

interface SecureVaultProps {
  currentEmployee: Employee;
}

// Robust Thai Baht Text Generator for Financial Authenticity
function thaiBahtText(num: number): string {
  if (num === 0) return "ศูนย์บาทถ้วน";
  const numbers = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const positions = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  
  let isNegative = false;
  if (num < 0) {
    isNegative = true;
    num = Math.abs(num);
  }
  
  const integerPart = Math.floor(num);
  const fractionPart = Math.round((num - integerPart) * 100);
  
  let result = "";
  
  if (integerPart > 0) {
    const intStr = integerPart.toString();
    const len = intStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(intStr[i]);
      const pos = len - 1 - i;
      
      if (digit !== 0) {
        if (pos > 0 && pos % 6 === 0) {
          result += positions[6];
        }
        
        const currentPos = pos % 6;
        if (currentPos === 1 && digit === 2) {
          result += "ยี่";
        } else if (currentPos === 1 && digit === 1) {
          // Skip "หนึ่ง"
        } else if (currentPos === 0 && digit === 1 && len > 1 && i === len - 1) {
          result += "เอ็ด";
        } else {
          result += numbers[digit];
        }
        result += positions[currentPos];
      }
    }
    result += "บาท";
  }
  
  if (fractionPart > 0) {
    const fracStr = fractionPart.toString();
    const len = fracStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(fracStr[i]);
      const pos = len - 1 - i;
      if (digit !== 0) {
        if (pos === 1 && digit === 2) {
          result += "ยี่";
        } else if (pos === 1 && digit === 1) {
          // Skip one
        } else if (pos === 0 && digit === 1 && len > 1 && i === len - 1) {
          result += "เอ็ด";
        } else {
          result += numbers[digit];
        }
        result += pos === 1 ? "สิบ" : "";
      }
    }
    result += "สตางค์";
  } else {
    result += "ถ้วน";
  }
  
  if (isNegative) {
    result = "ลบ" + result;
  }
  return result;
}

// Generate highly polished, printable corporate form styled with CSS
const generateDocumentHTML = (file: VaultFile, adv: any, items: any[]) => {
  const reqAmt = adv ? adv.requestAmount : 0;
  const bahtText = thaiBahtText(reqAmt);
  const employeeName = adv ? adv.employeeName : file.uploadedBy;
  const projectId = adv ? adv.projectId : "ไม่ระบุโครงการ";
  const category = adv ? adv.category : "ทั่วไป";
  const details = adv ? adv.details : "-";
  const createdAt = adv ? new Date(adv.createdAt).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : new Date(file.uploadedAt).toLocaleDateString("th-TH");
  const neededDate = adv && adv.neededDate ? new Date(adv.neededDate).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" }) : "-";
  const status = adv ? adv.status : "CLOSED";
  const approvedTotal = adv ? adv.approvedClearingAmountTotal : 0;

  let documentTitle = "";
  let documentSub = "";
  let templateBody = "";
  let badgeColor = "background-color: #f3f4f6; color: #374151; border: 1px solid #e5e7eb;";
  let statusTextThai = status;

  switch (status) {
    case "PENDING_APPROVAL":
      badgeColor = "background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a;";
      statusTextThai = "รออนุมัติ (Pending Approval)";
      break;
    case "WAITING_TRANSFER":
      badgeColor = "background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe;";
      statusTextThai = "รอโอนเงิน (Waiting Transfer)";
      break;
    case "WAITING_CLEARANCE":
      badgeColor = "background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a;";
      statusTextThai = "รอเคลียร์บิล (Waiting Clearance)";
      break;
    case "CLOSED":
      badgeColor = "background-color: #d1fae5; color: #065f46; border: 1px solid #a7f3d0;";
      statusTextThai = "ปิดยอดแล้ว (Closed & Settled)";
      break;
  }

  if (file.fileType === "REQUEST") {
    documentTitle = "ใบขออนุมัติเงินทดรองจ่าย (Cash Advance Request Form)";
    documentSub = "เอกสารประกอบการทำรายการเบิกเงินสดย่อยล่วงหน้าเพื่อใช้ในโครงการ";
    templateBody = `
      <div class="grid">
        <div class="col">
          <strong>ผู้ขอเบิก:</strong> ${employeeName}<br>
          <strong>วันที่ขอเบิก:</strong> ${createdAt}<br>
          <strong>โครงการก่อสร้าง:</strong> ${projectId}
        </div>
        <div class="col">
          <strong>รหัสเอกสาร:</strong> <span class="mono">${file.advId}</span><br>
          <strong>หมวดหมู่ค่าใช้จ่าย:</strong> ${category}<br>
          <strong>กำหนดวันเคลียร์บิล:</strong> ${neededDate}
        </div>
      </div>

      <div class="section-title">รายละเอียดวัตถุประสงค์การใช้เงิน</div>
      <div class="box">
        ${details || "ไม่มีการระบุรายละเอียด"}
      </div>

      <div class="section-title">สรุปมูลค่าเงินเบิกทดรองจ่าย</div>
      <table class="items-table">
        <thead>
          <tr>
            <th style="text-align: left;">รายการ</th>
            <th style="text-align: right; width: 150px;">จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>เงินเบิกทดรองเพื่อนำไปใช้จ่ายสำรองค่า ${category} ประจำโครงการ: ${projectId}</td>
            <td style="text-align: right;" class="bold">${reqAmt.toLocaleString("th-TH")}.00</td>
          </tr>
          <tr class="total-row">
            <td style="text-align: right;">จำนวนเงินรวมทั้งสิ้น (Total Amount)</td>
            <td style="text-align: right;" class="bold font-large">${reqAmt.toLocaleString("th-TH")}.00</td>
          </tr>
          <tr>
            <td colspan="2" style="background: #f9fafb; text-align: left; padding: 12px;">
              <strong>ตัวอักษร:</strong> <span style="color: #4b5563;">${bahtText}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 50px;" class="grid">
        <div class="col text-center signature-box">
          <br><br>
          ____________________________<br>
          ( ${employeeName} )<br>
          ผู้ขอรับเงินทดรองจ่าย<br>
          วันที่ _____/_____/_____
        </div>
        <div class="col text-center signature-box">
          <br><span style="color: #059669; font-weight: bold;">[อนุมัติระบบอิเล็กทรอนิกส์]</span><br>
          ____________________________<br>
          ( ผู้อนุมัติ / ผู้จัดการโครงการ )<br>
          ผู้ตรวจสอบและอนุมัติ<br>
          วันที่ _____/_____/_____
        </div>
      </div>
    `;
  } else if (file.fileType === "SLIP") {
    documentTitle = "ใบสำคัญจ่ายเงินทดรอง (Cash Advance Payment Voucher)";
    documentSub = "หลักฐานโอนเงินผ่านระบบอิเล็กทรอนิกส์จากบริษัทไปยังบัญชีพนักงาน";
    templateBody = `
      <div class="grid">
        <div class="col">
          <strong>ผู้รับเงิน:</strong> ${employeeName}<br>
          <strong>โครงการหลัก:</strong> ${projectId}<br>
          <strong>โอนเข้าบัญชี:</strong> ${adv && adv.bankName ? adv.bankName : "บัญชีธนาคารพนักงาน"}
        </div>
        <div class="col">
          <strong>รหัสอ้างอิง ADV:</strong> <span class="mono">${file.advId}</span><br>
          <strong>วันที่ทำรายการโอน:</strong> ${new Date(file.uploadedAt).toLocaleDateString("th-TH")}<br>
          <strong>รหัสการทำรายการ (TXN):</strong> <span class="mono">${file.id}</span>
        </div>
      </div>

      <div class="section-title" style="margin-top: 30px;">รายละเอียดการโอนเงินสำเร็จ</div>
      <div class="box" style="background: #f0fdf4; border-color: #bbf7d0; display: flex; align-items: center; justify-content: space-between; padding: 20px;">
        <div>
          <span style="font-size: 14px; color: #166534; font-weight: bold; display: block;">โอนเงินสำเร็จ (Transfer Completed)</span>
          <span style="font-size: 11px; color: #4b5563;">ได้นำส่งเงินเข้าเลขบัญชีเรียบร้อยโดยผ่านช่องทาง Mobile Banking</span>
        </div>
        <div style="font-size: 24px; font-weight: bold; color: #15803d; font-family: monospace;">
          ฿${reqAmt.toLocaleString("th-TH")}.00
        </div>
      </div>

      <div class="section-title">เอกสารภาพหลักฐานสลิปการโอนเงิน (Attached Bank Slip)</div>
      <div class="text-center" style="margin: 20px 0;">
        ${file.fileUrl ? `<img src="${file.fileUrl}" alt="Slip" style="max-width: 280px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);" />` : '<div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">ไม่มีรูปภาพ</div>'}
      </div>

      <div style="margin-top: 40px;" class="grid">
        <div class="col text-center signature-box">
          <br><br>
          ____________________________<br>
          ( เจ้าหน้าที่ฝ่ายการเงิน / บัญชี )<br>
          ผู้จัดทำและโอนเงิน<br>
          วันที่ _____/_____/_____
        </div>
        <div class="col text-center signature-box">
          <br><br>
          ____________________________<br>
          ( ${employeeName} )<br>
          ผู้รับเงินทดรองจ่าย<br>
          วันที่ _____/_____/_____
        </div>
      </div>
    `;
  } else if (file.fileType === "RECEIPT") {
    const totalReceipts = items.reduce((sum, item) => sum + (item.netAmount || 0), 0);
    documentTitle = "ใบสำคัญการเคลียร์ยอดบิล (Expense Clearance Voucher)";
    documentSub = "รายละเอียดเอกสารบิลใบเสร็จที่พนักงานนำมาเคลียร์ยอดเงินทดรองจ่ายในระบบ";
    templateBody = `
      <div class="grid">
        <div class="col">
          <strong>พนักงานผู้รับเงิน:</strong> ${employeeName}<br>
          <strong>โครงการก่อสร้าง:</strong> ${projectId}<br>
          <strong>หมวดหมู่เบิกหลัก:</strong> ${category}
        </div>
        <div class="col">
          <strong>รหัสอ้างอิง ADV:</strong> <span class="mono">${file.advId}</span><br>
          <strong>รหัสการเคลียร์:</strong> <span class="mono">${file.id}</span><br>
          <strong>วันที่ยื่นเคลียร์:</strong> ${new Date(file.uploadedAt).toLocaleDateString("th-TH")}
        </div>
      </div>

      <div class="section-title">รายการบิลใบเสร็จและค่าใช้จ่าย (Receipt Bills List)</div>
      <table class="items-table">
        <thead>
          <tr>
            <th>วันที่บิล</th>
            <th>ชื่อผู้ขาย/ร้านค้า</th>
            <th>เลขที่บิล/ใบเสร็จ</th>
            <th>รายการสินค้า/บริการ</th>
            <th style="text-align: right;">ยอดบิลสุทธิ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${items.length > 0 ? items.map((item) => `
            <tr>
              <td class="mono">${item.documentDate || "-"}</td>
              <td class="bold">${item.vendorName || "-"}</td>
              <td class="mono">${item.invoiceNo || "-"}</td>
              <td>${item.itemName || "-"}</td>
              <td style="text-align: right;" class="mono">${(item.netAmount || 0).toLocaleString("th-TH")}.00</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="5" style="text-align: center; color: #9ca3af; padding: 24px;">ไม่พบประวัติรายการบิลชำระเงินที่ผ่านการตรวจสอบในโฟลเดอร์นี้</td>
            </tr>
          `}
          <tr class="total-row">
            <td colspan="4" style="text-align: right;">รวมมูลค่าตามใบสำคัญจ่ายเคลียร์บิลรอบนี้</td>
            <td style="text-align: right;" class="bold font-large">${totalReceipts.toLocaleString("th-TH")}.00</td>
          </tr>
          <tr>
            <td colspan="5" style="background: #f9fafb; text-align: left; padding: 12px;">
              <strong>ตัวอักษร (ยอดบิลที่นำส่ง):</strong> <span style="color: #4b5563;">${thaiBahtText(totalReceipts)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      ${file.fileUrl ? `
        <div class="section-title">ภาพถ่ายใบเสร็จ / บิลหลักฐาน (Attached Bill Receipt)</div>
        <div class="text-center" style="margin: 15px 0;">
          <img src="${file.fileUrl}" alt="Receipt" style="max-width: 320px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);" />
        </div>
      ` : ""}

      <div style="margin-top: 40px;" class="grid">
        <div class="col text-center signature-box">
          <br><br>
          ____________________________<br>
          ( ${employeeName} )<br>
          พนักงานผู้ยื่นเคลียร์ยอด<br>
          วันที่ _____/_____/_____
        </div>
        <div class="col text-center signature-box">
          <br><span style="color: #4f46e5; font-weight: bold;">[ตรวจสอบบัญชีสำเร็จ]</span><br>
          ____________________________<br>
          ( เจ้าหน้าที่ตรวจสอบบัญชี )<br>
          ผู้อนุมัติผลเคลียร์บิล<br>
          วันที่ _____/_____/_____
        </div>
      </div>
    `;
  } else if (file.fileType === "SETTLEMENT") {
    const diff = reqAmt - approvedTotal;
    let diffText = "";
    let diffColor = "color: #374151;";
    if (diff > 0) {
      diffText = `พนักงานส่งเงินคืนบริษัทคงเหลือสุทธิ (Surplus Refund to Company) จำนวนเงิน: ${diff.toLocaleString("th-TH")} บาท`;
      diffColor = "background-color: #fffbeb; border-color: #fef3c7; color: #b45309;";
    } else if (diff < 0) {
      diffText = `บริษัทต้องเบิกจ่ายชดเชยเพิ่มให้พนักงาน (Company Compensation) จำนวนเงิน: ${Math.abs(diff).toLocaleString("th-TH")} บาท`;
      diffColor = "background-color: #eff6ff; border-color: #dbeafe; color: #1d4ed8;";
    } else {
      diffText = `ปิดยอดดุลบัญชีเสร็จสิ้น ยอดเงินเบิกเท่ากับยอดใช้จ่ายจริงพอดี (Fully Balanced Settlement)`;
      diffColor = "background-color: #f0fdf4; border-color: #bbf7d0; color: #15803d;";
    }

    documentTitle = "รายงานปิดสรุปดุลบัญชีเงินทดรองจ่าย (Cash Advance Settlement Report)";
    documentSub = "รายงานการตรวจสอบประเมินผลต่างสุทธิเพื่อปิดประวัติบัญชีของใบเบิกนี้อย่างสมบูรณ์";
    templateBody = `
      <div class="grid">
        <div class="col">
          <strong>พนักงานเจ้าของยอด:</strong> ${employeeName}<br>
          <strong>โครงการก่อสร้าง:</strong> ${projectId}<br>
          <strong>หมวดหมู่หลัก:</strong> ${category}
        </div>
        <div class="col">
          <strong>รหัสโครงการ ADV:</strong> <span class="mono">${file.advId}</span><br>
          <strong>รหัสบันทึกปิดงบ:</strong> <span class="mono">${file.id}</span><br>
          <strong>วันที่ประมวลผลปิดบัญชี:</strong> ${new Date(file.uploadedAt).toLocaleDateString("th-TH")}
        </div>
      </div>

      <div class="section-title">งบดุลเงินทดรองจ่าย (Financial Balance Statement)</div>
      <table class="items-table" style="margin-top: 10px;">
        <tbody>
          <tr>
            <td style="width: 70%;"><strong>1. ยอดวงเงินเบิกเริ่มต้นรับเข้า (Original Advance Released)</strong></td>
            <td style="text-align: right;" class="mono bold">฿${reqAmt.toLocaleString("th-TH")}.00</td>
          </tr>
          <tr>
            <td><strong>2. ยอดรายจ่ายบิลได้รับการตรวจสอบและรับรอง (Approved Clearing Expenses)</strong></td>
            <td style="text-align: right; color: #dc2626;" class="mono bold">- ฿${approvedTotal.toLocaleString("th-TH")}.00</td>
          </tr>
          <tr class="total-row">
            <td><strong>ยอดเงินคงเหลือดุลผลต่างสุทธิ (Net Settlement Difference)</strong></td>
            <td style="text-align: right;" class="mono bold font-large">฿${Math.abs(diff).toLocaleString("th-TH")}.00</td>
          </tr>
        </tbody>
      </table>

      <div class="box bold text-center" style="${diffColor} padding: 18px; border-radius: 12px; margin-top: 20px; font-size: 13px;">
        💡 ${diffText}
      </div>

      <div class="section-title">สรุปประวัติบิลรายรับในรายงานนี้ (${items.length} รายการ)</div>
      <table class="items-table">
        <thead>
          <tr>
            <th>ชื่อผู้ขาย</th>
            <th>เลขที่เอกสาร</th>
            <th>รายละเอียดสินค้า</th>
            <th style="text-align: right;">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          ${items.length > 0 ? items.map(item => `
            <tr>
              <td>${item.vendorName || "-"}</td>
              <td class="mono">${item.invoiceNo || "-"}</td>
              <td>${item.itemName || "-"}</td>
              <td style="text-align: right;" class="mono">${(item.netAmount || 0).toLocaleString("th-TH")}.00</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="4" style="text-align: center; color: #9ca3af; padding: 20px;">ไม่พบรายการยื่นบิลชำระเงินในชุดรายงานนี้</td>
            </tr>
          `}
        </tbody>
      </table>

      <div style="margin-top: 40px;" class="grid">
        <div class="col text-center signature-box">
          <br><br>
          ____________________________<br>
          ( ${employeeName} )<br>
          ผู้ส่งคืนเงิน / ผู้รับเงินชดเชย<br>
          วันที่ _____/_____/_____
        </div>
        <div class="col text-center signature-box">
          <br><span style="color: #10b981; font-weight: bold;">[ตรวจสอบบัญชีปิดงบแล้ว]</span><br>
          ____________________________<br>
          ( เจ้าหน้าที่บัญชีอาวุโส / CFO )<br>
          หัวหน้างานรับรองดุลบัญชี<br>
          วันที่ _____/_____/_____
        </div>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>${documentTitle} - ${file.advId}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Thai:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Inter', 'Noto Sans Thai', sans-serif;
          background-color: #f4f5f7;
          color: #111827;
          margin: 0;
          padding: 40px 20px;
          display: flex;
          justify-content: center;
        }
        .page-container {
          background-color: #ffffff;
          width: 100%;
          max-width: 800px;
          border-radius: 24px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02);
          border: 1px solid #e5e7eb;
          padding: 45px;
          position: relative;
          box-sizing: border-box;
        }
        .print-btn-container {
          margin-bottom: 25px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .btn {
          background-color: #111827;
          color: #ffffff;
          font-weight: 700;
          font-size: 12px;
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background-color 0.2s;
        }
        .btn:hover {
          background-color: #1f2937;
        }
        .btn-outline {
          background-color: #ffffff;
          color: #4b5563;
          border: 1px solid #d1d5db;
        }
        .btn-outline:hover {
          background-color: #f9fafb;
        }
        .header {
          border-bottom: 2px solid #f3f4f6;
          padding-bottom: 25px;
          margin-bottom: 25px;
        }
        .company-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .company-name {
          font-size: 16px;
          font-weight: 700;
          color: #111827;
        }
        .company-desc {
          font-size: 11px;
          color: #6b7280;
          margin-top: 4px;
        }
        .status-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          padding: 4px 12px;
          border-radius: 8px;
          margin-top: 10px;
          ${badgeColor}
        }
        .doc-title {
          font-size: 18px;
          font-weight: 700;
          color: #111827;
          margin-top: 15px;
        }
        .doc-subtitle {
          font-size: 11px;
          color: #6b7280;
          margin-top: 5px;
        }
        .grid {
          display: flex;
          gap: 20px;
          margin-bottom: 25px;
        }
        .col {
          flex: 1;
          font-size: 12px;
          color: #374151;
          line-height: 1.8;
        }
        .col strong {
          color: #111827;
        }
        .mono {
          font-family: monospace;
          font-size: 12px;
          letter-spacing: 0.5px;
        }
        .bold {
          font-weight: 700;
        }
        .font-large {
          font-size: 16px;
        }
        .section-title {
          font-size: 12px;
          font-weight: 700;
          color: #111827;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 8px;
          margin: 30px 0 12px 0;
        }
        .box {
          background-color: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px;
          font-size: 12px;
          line-height: 1.6;
          color: #4b5563;
        }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-top: 15px;
        }
        .items-table th {
          background-color: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          padding: 10px 12px;
          font-weight: 700;
          color: #4b5563;
          text-align: left;
        }
        .items-table td {
          border-bottom: 1px solid #f3f4f6;
          padding: 12px;
          color: #374151;
        }
        .items-table .total-row td {
          font-weight: 700;
          background-color: #fafafa;
          border-top: 2px solid #e5e7eb;
          border-bottom: 2px solid #e5e7eb;
          color: #111827;
        }
        .text-center {
          text-align: center;
        }
        .signature-box {
          background: #fafafa;
          border: 1px dashed #e5e7eb;
          border-radius: 14px;
          padding: 24px;
          font-size: 11px;
          line-height: 1.7;
          color: #6b7280;
        }
        @media print {
          body {
            background-color: #ffffff;
            padding: 0;
          }
          .page-container {
            box-shadow: none;
            border: none;
            padding: 0;
          }
          .print-btn-container {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div style="width: 100%; max-width: 800px;">
        <div class="print-btn-container">
          <button class="btn btn-outline" onclick="window.close()">ปิดหน้าต่างนี้</button>
          <button class="btn" onclick="window.print()">🖨️ พิมพ์เอกสาร / บันทึกเป็น PDF</button>
        </div>
        <div class="page-container">
          <div class="header">
            <div class="company-row">
              <div>
                <div class="company-name">บริษัท เคลียร์แอดวานซ์ โปร จำกัด (ClearAdvance Pro Co., Ltd.)</div>
                <div class="company-desc">ระบบเบิกจ่ายเงินทดรองอัจฉริยะและควบคุมจัดเก็บเอกสารอัตโนมัติ</div>
              </div>
              <div class="text-right">
                <div class="status-badge">${statusTextThai}</div>
              </div>
            </div>
            <div class="doc-title">${documentTitle}</div>
            <div class="doc-subtitle">${documentSub}</div>
          </div>

          ${templateBody}
          
          <div style="margin-top: 40px; border-top: 1px solid #f3f4f6; padding-top: 15px; font-size: 10px; color: #9ca3af; text-align: center;">
            เอกสารฉบับนี้พิมพ์จากระบบจัดเก็บไฟล์เซิร์ฟเวอร์นิรภัย ClearAdvance PRO อย่างเป็นทางการ
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

export default function SecureVault({ currentEmployee }: SecureVaultProps) {
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<string>("ALL");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  // Clear selections on folder or type change
  useEffect(() => {
    setSelectedFileIds([]);
  }, [activeFolderId, selectedFileType]);

  useEffect(() => {
    // Listen to vault files changes
    const q = query(collection(db, "vaultFiles"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: VaultFile[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as VaultFile);
      });
      // Sort by upload date
      list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      setVaultFiles(list);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Grouping files into dynamic folders named by ADV-ID
  const foldersMap: { [advId: string]: VaultFile[] } = {};
  vaultFiles.forEach((file) => {
    if (!foldersMap[file.advId]) {
      foldersMap[file.advId] = [];
    }
    foldersMap[file.advId].push(file);
  });

  const allAdvIds = Object.keys(foldersMap).filter((advId) => {
    return advId.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getFileTypeLabel = (type: string) => {
    switch (type) {
      case "REQUEST":
        return <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-bold rounded">ใบขอเบิก</span>;
      case "SLIP":
        return <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold rounded">สลิปโอนเงิน</span>;
      case "RECEIPT":
        return <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold rounded">บิลเคลียร์</span>;
      case "SETTLEMENT":
        return <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold rounded">ปิดยอดสรุป</span>;
      default:
        return <span className="px-2 py-0.5 bg-stone-50 text-stone-800 border border-stone-200 text-[10px] font-bold rounded">ทั่วไป</span>;
    }
  };

  const downloadFileSimulation = async (file: VaultFile) => {
    try {
      // 1. Fetch live Advance data to make the form look authentic and precise
      let advData: any = null;
      const qAdv = query(collection(db, "advances"), where("advId", "==", file.advId));
      const snapAdv = await getDocs(qAdv);
      if (!snapAdv.empty) {
        advData = snapAdv.docs[0].data();
      }

      // 2. Fetch live clearing item elements
      let itemsList: any[] = [];
      const qItems = query(collection(db, "clearingItems"), where("advId", "==", file.advId));
      const snapItems = await getDocs(qItems);
      snapItems.forEach((docSnap) => {
        itemsList.push(docSnap.data());
      });

      // 3. Compile printable HTML file content
      const compiledHTML = generateDocumentHTML(file, advData, itemsList);

      // 4. Download it directly as a real file from browser window sandbox
      const blob = new Blob([compiledHTML], { type: "text/html;charset=utf-8;" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${file.fileName.split(".")[0]}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถดึงข้อมูลแบบฟอร์มเพื่อดาวน์โหลดจริงได้");
    }
  };

  const currentFolderFiles = activeFolderId
    ? (foldersMap[activeFolderId] || []).filter(
        (file) => selectedFileType === "ALL" || file.fileType === selectedFileType
      )
    : [];

  const handleToggleSelectAll = () => {
    if (selectedFileIds.length === currentFolderFiles.length) {
      setSelectedFileIds([]);
    } else {
      setSelectedFileIds(currentFolderFiles.map((f) => f.id));
    }
  };

  const handleToggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleBulkDownload = async () => {
    const selectedFiles = currentFolderFiles.filter((f) => selectedFileIds.includes(f.id));
    if (selectedFiles.length === 0) {
      alert("กรุณาเลือกไฟล์ที่ต้องการดาวน์โหลด");
      return;
    }
    for (const file of selectedFiles) {
      await downloadFileSimulation(file);
    }
  };

  const handleBulkDelete = async () => {
    const selectedFiles = currentFolderFiles.filter((f) => selectedFileIds.includes(f.id));
    if (selectedFiles.length === 0) {
      alert("กรุณาเลือกไฟล์ที่ต้องการลบ");
      return;
    }

    const confirmed = window.confirm(
      `คุณแน่ใจหรือไม่ว่าต้องการลบเอกสารที่เลือกทั้งหมดจำนวน ${selectedFiles.length} รายการ? การดำเนินการนี้ไม่สามารถย้อนกลับได้`
    );
    if (!confirmed) return;

    try {
      for (const file of selectedFiles) {
        await deleteDoc(doc(db, "vaultFiles", file.id));
      }
      setSelectedFileIds([]);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการลบเอกสาร");
    }
  };

  const handleDeleteSingle = async (file: VaultFile) => {
    const confirmed = window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบเอกสาร "${file.fileName}"?`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "vaultFiles", file.id));
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.id));
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการลบเอกสาร");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="vault_tab">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900">ตู้เก็บเอกสารนิรภัยองค์กร (Secure Document Vault)</h2>
          <p className="text-xs text-stone-500">จัดเก็บไฟล์บิลใบรับเงินและสลิปความลับแยกโฟลเดอร์ตาม ADV-ID ของโครงการแบบอัตโนมัติ</p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-lg text-stone-600">
          <HardDrive className="w-4 h-4 text-stone-500" />
          <span>พื้นที่จัดเก็บ: {Object.keys(foldersMap).length} โฟลเดอร์, {vaultFiles.length} ไฟล์</span>
        </div>
      </div>

      {/* Search Input and file filters */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="ค้นหาตามรหัสเอกสาร ADV-ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-sm focus:outline-none"
          />
          <Search className="absolute inset-y-0 left-3.5 w-4 h-4 text-stone-400 self-center" />
        </div>

        <div className="flex bg-stone-100 border border-stone-200 rounded-lg p-0.5">
          {[
            { id: "ALL", label: "ทั้งหมด" },
            { id: "REQUEST", label: "ใบเบิก" },
            { id: "SLIP", label: "สลิป" },
            { id: "RECEIPT", label: "บิล" },
            { id: "SETTLEMENT", label: "ปิดยอด" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFileType(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedFileType === f.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-stone-500 text-xs">กำลังสแกนตู้เก็บเอกสารนิรภัย...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Folders List (Left 1/3) */}
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <Folder className="w-4 h-4 text-amber-500 fill-amber-500" /> โฟลเดอร์โครงการ ({allAdvIds.length})
            </h3>

            {allAdvIds.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-10">ไม่พบโฟลเดอร์เอกสารตามคำค้น</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {allAdvIds.map((advId) => {
                  const count = foldersMap[advId].length;
                  return (
                    <div
                      key={advId}
                      onClick={() => setActiveFolderId(advId)}
                      className={`w-full p-3 rounded-xl flex items-center justify-between cursor-pointer transition text-xs font-semibold ${
                        activeFolderId === advId
                          ? "bg-stone-950 text-stone-50"
                          : "bg-stone-50 text-stone-800 border border-stone-200/50 hover:bg-stone-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Folder className={`w-4 h-4 shrink-0 ${activeFolderId === advId ? "text-amber-400 fill-amber-400" : "text-amber-500 fill-amber-500"}`} />
                        <span className="font-mono tracking-wider">{advId}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-stone-200/20 text-stone-400 rounded-md text-[10px]">
                          {count} ไฟล์
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Files inside active folder (Right 2/3) */}
          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between gap-6">
            <div>
              <div className="border-b border-stone-100 pb-3 mb-4 flex items-center justify-between">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-stone-500" /> รายการไฟล์ความลับระบบเซิร์ฟเวอร์
                </h3>
                {activeFolderId && (
                  <span className="font-mono text-xs font-bold text-stone-900 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded">
                    โฟลเดอร์: {activeFolderId}
                  </span>
                )}
              </div>

              {!activeFolderId ? (
                <div className="py-24 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                  <Folder className="w-8 h-8 text-stone-200" />
                  <span>กรุณาเลือกโฟลเดอร์โครงการด้านซ้าย เพื่อเข้าถึงไฟล์เอกสาร</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Bulk Action Controls */}
                  {currentFolderFiles.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-stone-50 border border-stone-200/60 p-3.5 rounded-2xl mb-2 text-xs font-semibold">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="select_all_vault"
                          checked={currentFolderFiles.length > 0 && selectedFileIds.length === currentFolderFiles.length}
                          onChange={handleToggleSelectAll}
                          className="w-4 h-4 text-stone-900 border-stone-300 rounded focus:ring-stone-900 cursor-pointer"
                        />
                        <label htmlFor="select_all_vault" className="text-stone-700 cursor-pointer select-none">
                          เลือกไฟล์ในโฟลเดอร์ทั้งหมด ({selectedFileIds.length} / {currentFolderFiles.length} ไฟล์)
                        </label>
                      </div>
                      
                      {selectedFileIds.length > 0 && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={handleBulkDownload}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-stone-50 text-xs font-bold rounded-lg transition"
                          >
                            <Download className="w-3.5 h-3.5" />
                            ดาวน์โหลด ({selectedFileIds.length})
                          </button>
                          <button
                            onClick={() => {
                              const selectedFiles = currentFolderFiles.filter(f => selectedFileIds.includes(f.id));
                              const dataToExport = selectedFiles.map(f => ({
                                "รหัสเอกสาร": f.id,
                                "ADV-ID": f.advId,
                                "ชื่อไฟล์": f.fileName,
                                "ประเภท": f.fileType,
                                "ผู้อัปโหลด": f.uploadedBy,
                                "วันที่อัปโหลด": new Date(f.uploadedAt).toLocaleString("th-TH")
                              }));
                              exportToExcel(dataToExport, `Vault_Files_${activeFolderId}`);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-stone-200 text-stone-600 hover:text-emerald-600 rounded-lg shadow-xs transition"
                            title="ส่งออกรายการที่เลือกเป็น Excel"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleBulkDelete}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            ลบที่เลือก ({selectedFileIds.length})
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {currentFolderFiles.map((file) => (
                    <div
                      key={file.id}
                      className={`p-4 border rounded-xl transition flex items-center justify-between gap-4 text-xs ${
                        selectedFileIds.includes(file.id)
                          ? "bg-stone-100/50 border-stone-900 shadow-xs"
                          : "bg-stone-50 border-stone-200 hover:border-stone-300"
                      }`}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Checkbox for selection */}
                        <div className="pt-0.5 shrink-0">
                          <input
                            type="checkbox"
                            checked={selectedFileIds.includes(file.id)}
                            onChange={() => handleToggleSelectFile(file.id)}
                            className="w-4 h-4 text-stone-900 border-stone-300 rounded focus:ring-stone-900 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {getFileTypeLabel(file.fileType)}
                            <h4 className="font-bold text-stone-900 truncate font-mono text-[11px]">{file.fileName}</h4>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-[10px] text-stone-500">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> โดย: {file.uploadedBy}</span>
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> เมื่อ: {file.uploadedAt.split("T")[0]}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => downloadFileSimulation(file)}
                          className="p-2 bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-lg transition"
                          title="ดาวน์โหลดไฟล์ประกอบธุรกรรม"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteSingle(file)}
                          className="p-2 bg-rose-50 text-rose-600 border border-rose-100 hover:border-rose-200 rounded-lg transition"
                          title="ลบเอกสาร"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {currentFolderFiles.length === 0 && (
                    <p className="text-xs text-stone-400 text-center py-12">
                      ไม่มีไฟล์ประเภทที่กรองอยู่ในโฟลเดอร์นี้
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
