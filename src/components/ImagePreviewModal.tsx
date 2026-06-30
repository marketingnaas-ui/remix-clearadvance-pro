import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink } from "lucide-react";

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  title?: string;
}

export default function ImagePreviewModal({ isOpen, onClose, imageUrl, title = "พรีวิวเอกสาร" }: ImagePreviewModalProps) {
  return (
    <AnimatePresence>
      {isOpen && imageUrl && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-stone-950/80 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="relative bg-stone-900 rounded-3xl p-1 shadow-2xl flex flex-col items-center max-w-5xl w-full max-h-[90vh] overflow-hidden"
          >
            {/* Header Toolbar */}
            <div className="w-full flex items-center justify-between px-4 py-3 bg-stone-900/50 absolute top-0 z-10">
              <span className="text-white font-semibold text-sm truncate pr-4">{title}</span>
              <div className="flex items-center gap-2">
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 text-stone-300 hover:text-white hover:bg-stone-800 rounded-full transition"
                  title="เปิดในแท็บใหม่"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={onClose}
                  className="p-2 text-stone-300 hover:text-white hover:bg-stone-800 rounded-full transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Image Container */}
            <div className="w-full h-full flex items-center justify-center overflow-auto pt-14 pb-2 px-2">
              <img
                src={imageUrl}
                alt="Document Preview"
                className="max-w-full max-h-[calc(90vh-4rem)] object-contain rounded-2xl"
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
