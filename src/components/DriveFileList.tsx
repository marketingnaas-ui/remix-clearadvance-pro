import React, { useState, useEffect } from 'react';
import { fetchAccessToken, requestGoogleAccessToken } from '../lib/workspaceSync';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const DriveFileList: React.FC = () => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      let accessToken = await fetchAccessToken();
      if (!accessToken) {
        accessToken = await requestGoogleAccessToken();
      }

      if (!accessToken) {
        throw new Error('ไม่พบ Google access token กรุณาอนุมัติสิทธิ์ Google Workspace ก่อน');
      }

      const response = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(id,name,mimeType)', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`โหลดรายการไฟล์ไม่สำเร็จ: ${response.statusText}`);
      }

      const data = await response.json();
      setFiles(data.files);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-stone-200 rounded-lg shadow-sm">
      <h2 className="text-lg font-bold mb-4">ไฟล์ Google Drive ล่าสุด 10 รายการ</h2>
      <button 
        onClick={listFiles}
        className="px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 mb-4"
        disabled={loading}
      >
        {loading ? 'กำลังโหลด...' : 'โหลดรายการไฟล์'}
      </button>
      {error && <p className="text-red-500">{error}</p>}
      <ul className="space-y-2">
        {files.map(file => (
          <li key={file.id} className="p-2 bg-stone-50 rounded">
            <strong>{file.name}</strong> ({file.mimeType})
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DriveFileList;
