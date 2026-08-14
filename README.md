# Discord Slip Verifier Bot

บอท Discord สำหรับตรวจสอบสลิปโอนเงินไทย โดยใช้ **OIIO Service API** (`slip-c.oiio.download`) ซึ่งเป็น API ฟรีที่ตรวจสอบกับระบบธนาคารจริง

## Tech Stack

| ส่วนประกอบ | ตัวเลือก |
|---|---|
| Language | TypeScript |
| Discord Library | discord.js v14 |
| Database | MongoDB + Mongoose |
| Slip API | OIIO Service (ฟรี) |

## คำสั่งที่ใช้งานได้

| คำสั่ง | รายละเอียด |
|---|---|
| `!check <ยอดเงิน>` | ตรวจสอบสลิปกับระบบธนาคาร (แนบรูปสลิป) |
| `!scan` | อ่านยอดเงินจากสลิปอัตโนมัติด้วย OCR (แนบรูปสลิป) |
| `!history [n]` | ดูประวัติการตรวจสอบ (ค่าเริ่มต้น 5, สูงสุด 20) |
| `!help` | แสดงคำสั่งทั้งหมด |

## วิธีติดตั้ง

### 1. ติดตั้ง Dependencies

```bash
npm install
```

### 2. ตั้งค่า Environment

```bash
cp .env.example .env
```

แก้ไขไฟล์ `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token_here
MONGODB_URI=mongodb://localhost:27017/slipdb
COMMAND_PREFIX=!
```

**หมายเหตุ:**
- `DISCORD_TOKEN` สร้างได้ที่ [Discord Developer Portal](https://discord.com/developers/applications)
- `MONGODB_URI` ใช้ MongoDB Atlas หรือ Local ก็ได้

### 3. สร้าง Discord Bot

1. ไปที่ [Discord Developer Portal](https://discord.com/developers/applications)
2. คลิก **New Application** → ตั้งชื่อ → ไปที่ **Bot** tab
3. เปิด intents:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
4. คัดลอก **Token** มาใส่ใน `.env`
5. ไปที่ **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`
   - คัดลอก URL แล้วเปิดในเบราว์เซอร์เพื่อเชิญบอทเข้าเซิร์ฟเวอร์

### 4. Build & Run

```bash
# Build TypeScript
npm run build

# Run
npm start

# หรือ dev mode (ไม่ต้อง build)
npm run dev
```

## วิธีใช้งาน

### ตรวจสอบสลิป

1. แนบรูปสลิปโอนเงินในข้อความ
2. พิมพ์คำสั่งพร้อมยอดเงิน:
   ```
   !check 1500.50
   ```
3. รอผลลัพธ์ 10-25 วินาที

### อ่านยอดเงินอัตโนมัติ

1. แนบรูปสลิป
2. พิมพ์:
   ```
   !scan
   ```
3. บอทจะอ่านยอดเงินจากสลิปและแสดงข้อมูลธุรกรรม

### ดูประวัติ

```
!history      # ดู 5 รายการล่าสุด
!history 10   # ดู 10 รายการล่าสุด
```

## โครงสร้างโปรเจค

```
discord-slip-bot-ts/
├── src/
│   ├── config.ts              # การตั้งค่า (อ่านจาก .env)
│   ├── models/
│   │   └── Verification.ts    # Mongoose Model
│   └── index.ts               # Main Bot (commands + API calls)
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## ข้อมูลที่ API ตอบกลับ

เมื่อตรวจสอบผ่าน จะได้ข้อมูล:

| ฟิลด์ | คำอธิบาย |
|---|---|
| `ref` | เลขอ้างอิงธนาคาร |
| `date` | วันเวลาทำรายการ |
| `amount` | ยอดเงินที่ยืนยัน |
| `sender_name` | ชื่อผู้โอน |
| `sender_bank` | รหัสธนาคารผู้โอน |
| `receiver_name` | ชื่อผู้รับ |
| `receiver_bank` | รหัสธนาคารผู้รับ |

## Error Slugs

| Slug | ความหมาย |
|---|---|
| `amount-not-verified` | ยอดเงินไม่ตรงกับที่ระบุ |
| `slip-not-found` | ไม่พบรายการในระบบธนาคาร (สลิปปลอม?) |
| `qr-not-found` | ไม่พบ QR Code ในสลิป |
| `invalid-qr` | QR Code ไม่ถูกต้อง |
| `amount-not-found` | OCR อ่านยอดไม่ได้ |
| `invalid-image` | รูปภาพไม่ถูกต้อง |

## ข้อควรระวัง

- API เป็น **บริการฟรี** อาจมีข้อจำกัดเรื่อง Rate Limit
- การตรวจสอบใช้เวลา **10-25 วินาที** ต่อรายการ
- ไม่ใช่เอกสารยืนยันทางการเงินอย่างเป็นทางการ — ใช้เป็นเครื่องมือช่วยตรวจสอบเบื้องต้น
- ต้องส่ง `tos: true, privacy: true, eula: true` ทุกครั้ง (บอทจัดการให้อัตโนมัติ)

## License

MIT
