import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, BrainCircuit } from "lucide-react";

interface AILoadingModalProps {
  isOpen: boolean;
  message?: string;
}

export default function AILoadingModal({ isOpen, message = "AI กำลังทำงาน..." }: AILoadingModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Blurred backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-stone-950/20 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center max-w-sm w-full border border-amber-100/50"
          >
            {/* Cute AI Animation Box */}
            <div className="relative w-24 h-24 mb-6">
              {/* Outer rotating dashed ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border-2 border-dashed border-amber-300 rounded-full opacity-50"
              />
              
              {/* Pulsing glow behind */}
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-2 bg-gradient-to-tr from-amber-200 to-yellow-400 rounded-full blur-xl"
              />

              {/* Central bouncing AI icon */}
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="w-16 h-16 bg-white rounded-2xl shadow-md flex items-center justify-center rotate-3 border border-amber-100">
                  <BrainCircuit className="w-8 h-8 text-amber-500" />
                </div>
              </motion.div>

              {/* Floating Sparkles */}
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -top-2 -right-2 text-amber-400"
              >
                <Sparkles className="w-5 h-5" />
              </motion.div>
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute -bottom-1 -left-2 text-yellow-500"
              >
                <Sparkles className="w-4 h-4" />
              </motion.div>
            </div>

            <h3 className="text-lg font-black text-stone-900 mb-2 text-center bg-clip-text text-transparent bg-gradient-to-r from-stone-900 to-stone-600">
              {message}
            </h3>
            
            <p className="text-xs font-medium text-stone-500 text-center animate-pulse">
              กรุณารอสักครู่... 🔮
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
