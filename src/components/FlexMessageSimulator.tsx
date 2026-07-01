import React, { useState } from "react";
import { AlertCircle, CheckCircle, Code, ExternalLink } from "lucide-react";

export default function FlexMessageSimulator({
  json,
  onChange,
}: {
  json: string;
  onChange: (val: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const validate = (val: string) => {
    try {
      if (val.trim()) JSON.parse(val);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleJsonChange = (val: string) => {
    onChange(val);
    validate(val);
  };

  return (
    <div className="space-y-4 p-4 bg-stone-50 border border-stone-200 rounded-xl">
      <div className="flex justify-between items-center gap-3">
        <h3 className="text-xs font-bold text-stone-900 flex items-center gap-2">
          <Code className="w-4 h-4" /> Flex Message JSON Simulator
        </h3>
        <a
          href="https://developers.line.biz/flex-simulator/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-600 flex items-center gap-1 hover:underline"
        >
          เปิดตัวจำลองอย่างเป็นทางการ <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <textarea
        value={json}
        onChange={(event) => handleJsonChange(event.target.value)}
        className="w-full h-40 font-mono text-[10px] bg-white p-3 rounded-lg border border-stone-300 focus:ring-1 focus:ring-stone-950"
        placeholder="Paste Flex Message JSON here..."
      />
      {error ? (
        <div className="text-red-500 text-[10px] flex items-center gap-1 bg-red-50 p-2 rounded">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      ) : json ? (
        <div className="text-green-600 text-[10px] flex items-center gap-1 bg-green-50 p-2 rounded">
          <CheckCircle className="w-3 h-3" />
          JSON ถูกต้อง
        </div>
      ) : null}
    </div>
  );
}
