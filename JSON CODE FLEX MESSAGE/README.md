# Advance Pro LINE Flex Message Templates

ชุดนี้มี JSON Flex Message แยกไฟล์ครบ 25 Event สำหรับระบบ Advance Pro

## วิธีใช้
1. เลือกไฟล์ JSON ตาม Event เช่น `01_ADVANCE_SUBMITTED.json`
2. Replace placeholder ที่อยู่ใน `{...}` ด้วยข้อมูลจริงจากระบบ เช่น `{advNo}`, `{employeeName}`, `{liffDetailUrl}`
3. ทุก `uri` ต้องเป็น URL ที่ LINE เปิดได้จริง เช่น HTTPS หรือ LIFF URL
4. ส่ง payload นี้ผ่าน LINE Messaging API ได้ทันทีในรูปแบบ `type: flex`

## Style
Modern Glass Apple UI แบบ LINE Flex รองรับได้:
- soft teal primary `#4E958D`
- white card
- rounded large card
- soft border
- clean spacing

## Security Rules
- Risk alert เช่น duplicate, OCR edited, tampering ให้ส่งเฉพาะบัญชีเท่านั้น
- Action ผ่าน LINE ต้องตรวจ LINE User ID + สิทธิ์ + สถานะเอกสารก่อนทุกครั้ง
- หากเอกสารถูกทำรายการแล้ว ห้ามกดซ้ำ
- เงินทอน / เบิกเพิ่ม แสดงหลังบัญชีปิดยอดเท่านั้น
