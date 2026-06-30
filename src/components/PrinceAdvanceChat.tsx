import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Advance, Employee } from "../types";
import { 
  MessageSquare, Bot, Sparkles, Send, X, Minimize2, Maximize2, 
  AlertCircle, HelpCircle, CornerDownLeft, GripVertical, ChevronLeft, ChevronRight, Eye
} from "lucide-react";

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export default function PrinceAdvanceChat({ currentEmployee }: { currentEmployee: Employee }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "model",
      text: "สวัสดีครับผม! ผม 'เจ้าชายแอดวานซ์' (Prince Advance) สถาปนิกและผู้เชี่ยวชาญด้านบริหารจัดการต้นทุนโครงการยินดีให้บริการครับ ยินดีช่วยเหลือท่านตรวจสอบสถิติการเงิน วิเคราะห์กลุ่มพนักงานมียอดค้างชำระ คัดกรองโครงการเกินงบประมาณ หรือสืบค้นข้อมูลราคากลางเหล็ก ปูนซีเมนต์ และค่าแรงครับ มีอะไรให้ผมวิเคราะห์วันนี้ไหมครับ? 🔮"
    }
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Firestore context state
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clearingItems, setClearingItems] = useState<any[]>([]);
  const [aiConfig, setAiConfig] = useState<any>({});
  const [projectBudgets, setProjectBudgets] = useState<any>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Listen to toggle event from header Glass button
  useEffect(() => {
    const handleToggle = () => {
      setIsOpen((prev) => !prev);
    };
    window.addEventListener("toggle-prince-chat", handleToggle);
    return () => window.removeEventListener("toggle-prince-chat", handleToggle);
  }, []);

  // Fetch Firestore snapshots for live context
  useEffect(() => {
    const unsubAdvances = onSnapshot(collection(db, "advances"), (snap) => {
      const list: Advance[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Advance));
      setAdvances(list);
    }, (err) => {
      console.error("Error subscribing to advances in PrinceAdvanceChat:", err);
    });

    const unsubEmployees = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
    }, (err) => {
      console.error("Error subscribing to employees in PrinceAdvanceChat:", err);
    });

    const unsubItems = onSnapshot(collection(db, "clearingItems"), (snap) => {
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setClearingItems(list);
    }, (err) => {
      console.error("Error subscribing to clearingItems in PrinceAdvanceChat:", err);
    });

    const settingsRef = doc(db, "settings", "global");
    getDoc(settingsRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setAiConfig({
          steelPriceUrl: data.steelPriceUrl || "",
          laborCostUrl: data.laborCostUrl || "",
          cementPriceUrl: data.cementPriceUrl || "",
        });
        setProjectBudgets(data.projectBudgets || {});
      }
    }).catch(err => console.error("Error fetching settings for chatbot: ", err));

    return () => {
      unsubAdvances();
      unsubEmployees();
      unsubItems();
    };
  }, []);

  // Auto scroll to latest message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || sending) return;

    const userText = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setSending(true);

    try {
      const databaseContext = {
        advances: advances.map((a) => ({
          advId: a.advId,
          employeeName: a.employeeName,
          projectId: a.projectId,
          category: a.category,
          requestAmount: a.requestAmount,
          approvedClearingAmountTotal: a.approvedClearingAmountTotal || 0,
          outstandingAmount: a.outstandingAmount || 0,
          status: a.status,
          createdAt: a.createdAt,
          neededDate: a.neededDate,
          details: a.details,
        })),
        employees: employees.map((e) => ({
          name: e.name,
          role: e.role,
          status: e.status,
        })),
        clearingItems: clearingItems.map((item) => ({
          advId: item.advId,
          amount: item.amount,
          itemName: item.itemName,
          category: item.category,
          date: item.date,
          ocrConfidence: item.ocrConfidence || 100,
        })),
        projectBudgets,
        aiConfig,
      };

      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          chatHistory: messages,
          databaseContext,
          user: { id: currentEmployee.id, name: currentEmployee.name }
        }),
      });

      if (!response.ok) {
        throw new Error("เกิดความผิดพลาดในการส่งคำสั่งหา AI");
      }

      const resData = await response.json();
      if (resData.status === "success" && resData.reply) {
        setMessages((prev) => [...prev, { role: "model", text: resData.reply }]);
      } else {
        throw new Error("รูปแบบคำตอบจากระบบ AI ไม่ถูกต้อง");
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: `⚠️ เกิดข้อผิดพลาดทางเทคนิค: ${err?.message || "ไม่สามารถติดต่อเจ้าชายแอดวานซ์ได้ในขณะนี้"}`
        }
      ]);
    } finally {
      setSending(false);
    }
  };

  const loadPresetQuery = (queryText: string) => {
    setInput(queryText);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed bottom-6 right-6 md:right-8 w-[360px] sm:w-[420px] h-[520px] bg-white border border-stone-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in z-50"
      id="prince_advance_chatbot"
    >
      {/* Header */}
      <div className="bg-stone-900 text-white px-4 py-3.5 flex items-center justify-between border-b border-stone-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md">
            <Bot className="w-4.5 h-4.5 text-stone-900" />
          </div>
          <div>
            <h3 className="font-bold text-xs sm:text-sm tracking-tight text-white flex items-center gap-1">
              เจ้าชายแอดวานซ์ AI
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            </h3>
            <span className="text-[10px] text-stone-400 font-medium">สถาปนิกและผู้เชี่ยวชาญการก่อสร้างประจำตัวคุณ</span>
          </div>
        </div>

        <button
          onClick={() => setIsOpen(false)}
          className="text-stone-400 hover:text-white p-1 hover:bg-stone-800 rounded-lg transition"
          title="ปิดแชตบอท"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick-Preset suggestions bar */}
      <div className="bg-stone-50 border-b border-stone-100 py-2 px-3 overflow-x-auto whitespace-nowrap flex gap-1.5 scrollbar-thin">
        <button
          onClick={() => loadPresetQuery("วิเคราะห์ยอดเบิกจ่ายสะสมทั้งหมดให้หน่อยครับ")}
          className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 font-bold hover:bg-stone-100 transition inline-block"
        >
          📊 ยอดเบิกจ่ายรวม
        </button>
        <button
          onClick={() => loadPresetQuery("มีใครติดค้างเคลียร์เงินทดรองจ่ายนานที่สุดบ้าง")}
          className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 font-bold hover:bg-stone-100 transition inline-block"
        >
          ⏳ ใครค้างเคลียร์สูงสุด
        </button>
        <button
          onClick={() => loadPresetQuery("วิเคราะห์งบประมาณโครงการและระบุความเสี่ยง")}
          className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 font-bold hover:bg-stone-100 transition inline-block"
        >
          ⚠️ เช็กความเสี่ยงเกินงบ
        </button>
        <button
          onClick={() => loadPresetQuery("ตรวจสอบความปลอดภัย ค้นหาสิ่งผิดปกติหรือใบเสร็จซ้ำ")}
          className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 font-bold hover:bg-stone-100 transition inline-block"
        >
          🔒 สแกนภัยทุจริต/บิลซ้ำ
        </button>
      </div>

      {/* Messages body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-stone-50/50">
        {messages.map((m, idx) => {
          const isAI = m.role === "model";
          return (
            <div key={idx} className={`flex ${isAI ? "justify-start" : "justify-end"} items-start gap-2.5`}>
              {isAI && (
                <div className="w-6.5 h-6.5 bg-stone-900 border border-stone-800 text-amber-500 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-sm text-[11px] font-black">
                  PA
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl p-3 text-xs leading-relaxed shadow-xs font-medium ${
                  isAI
                    ? "bg-white text-stone-800 border border-stone-150 rounded-tl-sm"
                    : "bg-stone-900 text-stone-50 rounded-tr-sm"
                }`}
              >
                {m.text.split("\n").map((line, lIdx) => (
                  <p key={lIdx} className={line ? "mt-1.5 first:mt-0" : "h-2"}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex justify-start items-center gap-2.5 text-stone-400">
            <div className="w-6.5 h-6.5 bg-stone-900 text-amber-500 rounded-lg flex items-center justify-center shrink-0 shadow-sm text-[10px] font-black animate-pulse">
              PA
            </div>
            <div className="bg-white border border-stone-150 rounded-2xl rounded-tl-sm p-3 flex gap-1 items-center shadow-xs">
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Form input */}
      <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-stone-150/80 flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ปรึกษาพาร์ทเนอร์สถาปนิกที่นี่..."
          className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-stone-950 text-stone-850 font-medium"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="p-2.5 bg-stone-950 text-white rounded-xl hover:bg-stone-900 disabled:opacity-40 disabled:hover:bg-stone-950 transition flex items-center justify-center shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
