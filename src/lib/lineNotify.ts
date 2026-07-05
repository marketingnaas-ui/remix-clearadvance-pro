export interface LineNotificationPayload {
  triggerId: string;
  variables: Record<string, string | number | boolean | null | undefined> & {
    advId?: string;
    employeeId?: string;
    employeeName?: string;
    amount?: string | number;
    status?: string;
    projectName?: string;
    category?: string;
    remark?: string;
    date?: string;
  };
  targetEmployeeId?: string;
}

export async function sendLineNotification(payload: LineNotificationPayload): Promise<any | null> {
  try {
    const res = await fetch("/api/line/send-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(async () => ({ raw: await res.text() }));
    if (!res.ok) {
      console.warn("Failed to send LINE notification:", data);
    } else {
      console.log("LINE notification triggered successfully:", data);
    }
    return data;
  } catch (err) {
    console.error("Error triggering LINE notification:", err);
    return null;
  }
}

export async function sendLineBindInvite(employeeId: string): Promise<any | null> {
  try {
    const res = await fetch("/api/line/send-bind-invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ employeeId }),
    });
    const data = await res.json().catch(async () => ({ raw: await res.text() }));
    if (!res.ok || data.status === "error") {
      console.warn("Failed to send LINE bind invite:", data);
    }
    return data;
  } catch (err) {
    console.error("Error sending LINE bind invite:", err);
    return null;
  }
}
