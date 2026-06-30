export interface LineNotificationPayload {
  triggerId: "onNewRequest" | "onManagerApproval" | "onClearanceSubmitted" | "onSettlement";
  variables: {
    advId: string;
    employeeName: string;
    amount: string;
    status: string;
    projectName?: string;
    category?: string;
    remark?: string;
    date?: string;
  };
  targetEmployeeId?: string;
}

export async function sendLineNotification(payload: LineNotificationPayload): Promise<void> {
  try {
    const res = await fetch("/api/line/send-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("Failed to send LINE notification:", await res.text());
    } else {
      console.log("LINE notification triggered successfully:", await res.json());
    }
  } catch (err) {
    console.error("Error triggering LINE notification:", err);
  }
}
