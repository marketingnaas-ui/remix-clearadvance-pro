import { db } from "./firebase";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  writeBatch 
} from "firebase/firestore";

// Helper to slugify
function slugify(text: string): string {
  if (!text) return "unknown";
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\wก-๙\-]+/g, "") // support Thai characters
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// Automatically syncs and updates all secondary analytical collections in Firestore
export async function autoUpdateSystemCollections(): Promise<void> {
  try {
    console.log("Triggering auto-update of secondary system collections...");
    
    // 1. Fetch source settings, advances, clearingItems, and employees
    const settingsSnap = await getDoc(doc(db, "settings", "global"));
    const advancesSnap = await getDocs(collection(db, "advances"));
    const clearingItemsSnap = await getDocs(collection(db, "clearingItems"));
    const employeesSnap = await getDocs(collection(db, "employees"));

    const globalSettings = settingsSnap.exists() ? settingsSnap.data() : {};
    const projectDetails = globalSettings.projectDetails || {};
    const projectBudgets = globalSettings.projectBudgets || {};
    
    const advances = advancesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as any);
    const clearingItems = clearingItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as any);
    const employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as any);

    class SmartBatch {
      private currentBatch = writeBatch(db);
      private count = 0;

      async set(docRef: any, data: any, options?: any) {
        this.currentBatch.set(docRef, data, options);
        this.count++;
        if (this.count >= 400) {
          await this.currentBatch.commit();
          this.currentBatch = writeBatch(db);
          this.count = 0;
        }
      }

      async commit() {
        if (this.count > 0) {
          await this.currentBatch.commit();
          this.count = 0;
        }
      }
    }

    const batch = new SmartBatch();

    // 2. Synchronize "projects" collection
    const projectsSet = new Set<string>();
    Object.keys(projectDetails).forEach(p => projectsSet.add(p));
    advances.forEach(a => { if (a.projectId) projectsSet.add(a.projectId); });

    for (const projName of projectsSet) {
      const details = projectDetails[projName] || {};
      const projAdvances = advances.filter(a => a.projectId === projName);
      
      const contractAmount = Number(details.contractAmount || details.contractBudget || projectBudgets[projName] || 0);
      const pettyCashBudget = Number(details.pettyCashBudget || 0);

      // Sum requestAmount for requested advances (excludes rejected ones)
      const totalAdvanceRequested = projAdvances.reduce((sum, a) => {
        return a.status !== "REJECTED" ? sum + Number(a.requestAmount || 0) : sum;
      }, 0);

      // Sum requestAmount for approved advances
      const totalAdvanceApproved = projAdvances.reduce((sum, a) => {
        const isApproved = [
          "WAITING_TRANSFER",
          "WAITING_CLEARANCE",
          "PENDING_AUDIT",
          "PARTIALLY_CLEARED",
          "CLOSED"
        ].includes(a.status);
        return isApproved ? sum + Number(a.requestAmount || 0) : sum;
      }, 0);

      // Sum submitted clearings
      const totalClearingSubmitted = projAdvances.reduce((sum, a) => {
        return sum + Number(a.submittedClearingAmountTotal || 0);
      }, 0);

      // Sum approved/cleared actual expenses (based on receipts)
      const totalClearingApproved = projAdvances.reduce((sum, a) => {
        return sum + Number(a.approvedClearingAmountTotal || 0);
      }, 0);

      // Outstanding Amount is total approved advances minus total approved clearing
      const outstandingAmount = Math.max(0, totalAdvanceApproved - totalClearingApproved);

      const remainingPettyCashBudget = pettyCashBudget - totalClearingApproved;
      const variance = contractAmount - totalClearingApproved;

      const projDocRef = doc(db, "projects", slugify(projName));
      await batch.set(projDocRef, {
        id: slugify(projName),
        projectId: details.projectId || slugify(projName).toUpperCase(),
        projectCode: details.projectCode || slugify(projName).toUpperCase(),
        projectName: projName,
        companyName: details.companyName || "บริษัท จำกัด",
        clientName: details.clientName || "ลูกค้าทั่วไป",
        contractAmount: contractAmount,
        budget: details.budget || contractAmount,
        pettyCashBudget: pettyCashBudget,
        aiReasoning: details.aiReasoning || "สร้างอัตโนมัติจากระบบส่วนกลาง",
        startDate: details.startDate || new Date().toISOString().split("T")[0],
        endDate: details.endDate || new Date().toISOString().split("T")[0],
        status: details.status || "ACTIVE",
        location: details.location || "กรุงเทพฯ",
        
        // Merged cost parameters
        totalAdvanceRequested,
        totalAdvanceApproved,
        totalClearingSubmitted,
        totalClearingApproved,
        outstandingAmount,
        remainingPettyCashBudget,
        variance,
        lastUpdatedAt: new Date().toISOString()
      }, { merge: true });
    }

    // 4. Synchronize "document_tracking" collection
    for (const adv of advances) {
      if (!adv.advId) continue;
      const trackDocRef = doc(db, "document_tracking", slugify(adv.advId));
      await batch.set(trackDocRef, {
        id: slugify(adv.advId),
        documentNo: adv.advId,
        documentType: "ADVANCE_REQUEST",
        status: adv.status || "PENDING",
        employeeName: adv.employeeName || "",
        projectId: adv.projectId || "",
        amount: Number(adv.requestAmount || 0),
        createdAt: adv.createdAt || new Date().toISOString(),
        updatedAt: adv.neededDate || adv.createdAt || new Date().toISOString()
      }, { merge: true });
    }

    // 5. Generate Accounting General Ledger ("GL" collection)
    // Map standard accounts
    // - Cash / Bank (Code: 11100, Name: เงินสด/เงินฝากธนาคาร)
    // - Employee Advance (Code: 11300, Name: เงินทดรองจ่าย - พนักงาน)
    // - Input VAT (Code: 11500, Name: ภาษีมูลค่าเพิ่มรอเรียกคืน)
    // - Expense Categories (Code: 5xxxx, Name: Expenses)
    // - Withholding Tax Payable (Code: 21500, Name: ภาษีเงินได้หัก ณ ที่จ่ายค้างส่ง)

    for (const adv of advances) {
      if (!adv.advId) continue;

      const isApproved = [
        "WAITING_CLEARANCE",
        "PENDING_AUDIT",
        "PARTIALLY_CLEARED",
        "CLOSED"
      ].includes(adv.status);

      if (isApproved) {
        // Entry 1: Issue cash advance
        // Debit: Employee Cash Advance (11300)
        const glIdDebit = slugify(`gl-${adv.advId}-issue-dr`);
        await batch.set(doc(db, "GL", glIdDebit), {
          id: glIdDebit,
          docNo: adv.advId,
          date: adv.createdAt || new Date().toISOString().split("T")[0],
          accountCode: "11300",
          accountName: "เงินทดรองจ่าย - พนักงาน",
          projectId: adv.projectId || "",
          projectName: adv.projectId || "",
          category: adv.category || "เงินทดรอง",
          debit: Number(adv.requestAmount || 0),
          credit: 0,
          employeeName: adv.employeeName || "",
          description: `เบิกจ่ายเงินทดรองหน้างาน รหัสเอกสาร ${adv.advId}`
        }, { merge: true });

        // Credit: Cash/Bank (11100)
        const glIdCredit = slugify(`gl-${adv.advId}-issue-cr`);
        await batch.set(doc(db, "GL", glIdCredit), {
          id: glIdCredit,
          docNo: adv.advId,
          date: adv.createdAt || new Date().toISOString().split("T")[0],
          accountCode: "11100",
          accountName: "เงินสด/เงินฝากธนาคาร",
          projectId: adv.projectId || "",
          projectName: adv.projectId || "",
          category: adv.category || "เงินทดรอง",
          debit: 0,
          credit: Number(adv.requestAmount || 0),
          employeeName: adv.employeeName || "",
          description: `โอนจ่ายเงินทดรองหน้างาน รหัสเอกสาร ${adv.advId}`
        }, { merge: true });
      }

      // Entry 2: Clearing transactions (Approved receipts)
      const linkedItems = clearingItems.filter(item => item.advId === adv.advId && item.status === "APPROVED");
      for (const item of linkedItems) {
        const itemCodeMap: { [key: string]: string } = {
          "ค่าวัสดุก่อสร้าง": "51100",
          "ค่าแรงงาน": "51200",
          "ค่าเดินทาง/ขนส่ง": "51300",
          "ค่าอาหาร/รับรอง": "51400",
          "ค่าเครื่องมือ/เครื่องจักร": "51500",
          "อื่นๆ": "51900"
        };
        const catName = item.category || adv.category || "อื่นๆ";
        const expCode = itemCodeMap[catName] || "51900";

        // Debit: Expense (5xxxx)
        const glIdExp = slugify(`gl-item-${item.id}-exp-dr`);
        await batch.set(doc(db, "GL", glIdExp), {
          id: glIdExp,
          docNo: adv.advId,
          date: item.documentDate || new Date().toISOString().split("T")[0],
          accountCode: expCode,
          accountName: `ค่าใช้จ่าย - ${catName}`,
          projectId: adv.projectId || "",
          projectName: adv.projectId || "",
          category: catName,
          debit: Number(item.netAmount || item.amount || 0),
          credit: 0,
          employeeName: adv.employeeName || "",
          description: `เคลียร์ค่าใช้จ่าย: ${item.itemName || item.description || ""} ใบเสร็จ ${item.invoiceNo || ""}`
        }, { merge: true });

        // Debit: VAT (11500) if exists
        if (Number(item.vatAmount || 0) > 0) {
          const glIdVat = slugify(`gl-item-${item.id}-vat-dr`);
          await batch.set(doc(db, "GL", glIdVat), {
            id: glIdVat,
            docNo: adv.advId,
            date: item.documentDate || new Date().toISOString().split("T")[0],
            accountCode: "11500",
            accountName: "ภาษีซื้อ",
            projectId: adv.projectId || "",
            projectName: adv.projectId || "",
            category: "ภาษีซื้อ",
            debit: Number(item.vatAmount),
            credit: 0,
            employeeName: adv.employeeName || "",
            description: `ภาษีซื้อจากใบกำกับภาษีเลขที่ ${item.invoiceNo || ""}`
          }, { merge: true });
        }

        // Credit: Employee Advance (11300) - clearing the outstanding cash!
        const totalClearedItem = Number(item.netAmount || item.amount || 0) + Number(item.vatAmount || 0);
        const glIdClear = slugify(`gl-item-${item.id}-clear-cr`);
        await batch.set(doc(db, "GL", glIdClear), {
          id: glIdClear,
          docNo: adv.advId,
          date: item.documentDate || new Date().toISOString().split("T")[0],
          accountCode: "11300",
          accountName: "เงินทดรองจ่าย - พนักงาน",
          projectId: adv.projectId || "",
          projectName: adv.projectId || "",
          category: catName,
          debit: 0,
          credit: totalClearedItem,
          employeeName: adv.employeeName || "",
          description: `เคลียร์ลดหนี้เงินทดรองพนักงาน ${item.itemName || item.description || ""}`
        }, { merge: true });

        // Credit: Withholding Tax Payable (21500) if exists
        if (Number(item.whtAmount || 0) > 0) {
          const glIdWht = slugify(`gl-item-${item.id}-wht-cr`);
          await batch.set(doc(db, "GL", glIdWht), {
            id: glIdWht,
            docNo: adv.advId,
            date: item.documentDate || new Date().toISOString().split("T")[0],
            accountCode: "21500",
            accountName: "ภาษีเงินได้หัก ณ ที่จ่ายค้างส่ง",
            projectId: adv.projectId || "",
            projectName: adv.projectId || "",
            category: "ภาษีหัก ณ ที่จ่าย",
            debit: 0,
            credit: Number(item.whtAmount),
            employeeName: adv.employeeName || "",
            description: `ภาษีหัก ณ ที่จ่าย ค้างส่ง ร้านค้า ${item.vendorName || ""}`
          }, { merge: true });
        }
      }
    }

    // Commit all operations as a single, performant transaction batch!
    await batch.commit();
    console.log("Success: Secondary system collections auto-updated successfully!");
  } catch (err) {
    console.error("Critical: Failed to auto-update system collections in Firestore:", err);
  }
}
