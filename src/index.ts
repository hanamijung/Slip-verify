/**
 * Discord Bot ตรวจสอบสลิปโอนเงินไทย
 * Stack: TypeScript + discord.js v14 + MongoDB/Mongoose + OIIO Service API
 *
 * วิธีใช้งาน:
 *   1. cp .env.example .env
 *   2. ใส่ DISCORD_TOKEN และ MONGODB_URI ใน .env
 *   3. npm install
 *   4. npm run build
 *   5. npm start
 *
 * คำสั่ง:
 *   !check <ยอดเงิน>  -- ตรวจสอบสลิปกับระบบธนาคาร (แนบรูป)
 *   !scan             -- อ่านยอดเงินจากสลิปอัตโนมัติ (แนบรูป)
 *   !history [n]      -- ดูประวัติการตรวจสอบ
 *   !help             -- แสดงคำสั่งทั้งหมด
 */

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} from "discord.js";
import mongoose from "mongoose";
import { CONFIG } from "./config";
import { Verification } from "./models/Verification";

// ==================== TYPES ====================
interface SlipApiResponse {
  ok: boolean;
  message: string;
  from_cache?: boolean;
  data?: {
    ref: string;
    date: string;
    amount: number;
    sender_bank: string;
    sender_name: string;
    sender_id: string;
    receiver_bank: string;
    receiver_name: string;
    receiver_id: string;
  };
  slug?: string;
}

// ==================== DATABASE ====================
async function connectDatabase() {
  try {
    await mongoose.connect(CONFIG.MONGODB_URI);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
  }
}

// ==================== HELPERS ====================

/**
 * ดาวน์โหลดรูปจาก Discord Attachment URL แล้วแปลงเป็น Base64 Data URI
 */
async function imageToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Detect MIME type from magic bytes
  let mime = "image/jpeg";
  if (buffer.length >= 8) {
    const header = buffer.toString("hex", 0, 8).toLowerCase();
    if (header.startsWith("89504e47")) {
      mime = "image/png";
    } else if (header.startsWith("ffd8ff")) {
      mime = "image/jpeg";
    } else if (buffer.toString("ascii", 0, 4) === "RIFF") {
      mime = "image/webp";
    }
  }

  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

/**
 * เรียก OIIO API เพื่อตรวจสอบสลิป (มียอดเงินที่คาดหวัง)
 */
async function verifySlip(
  base64Image: string,
  amount: number
): Promise<SlipApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    const response = await fetch(
      `${CONFIG.SLIP_API_BASE_URL}/api/slip/${amount}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          img: base64Image,
          amount,
          tos: true,
          privacy: true,
          eula: true,
        }),
        signal: controller.signal,
      }
    );

    const data = (await response.json()) as SlipApiResponse;
    data.ok = data.ok ?? response.ok;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * เรียก OIIO API ให้อ่านยอดเงินจากสลิปเอง (OCR)
 */
async function detectAmount(base64Image: string): Promise<SlipApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    const response = await fetch(`${CONFIG.SLIP_API_BASE_URL}/api/slip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        img: base64Image,
        tos: true,
        privacy: true,
        eula: true,
      }),
      signal: controller.signal,
    });

    const data = (await response.json()) as SlipApiResponse;
    data.ok = data.ok ?? response.ok;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * แปลงรหัสธนาคารเป็นชื่อ
 */
function bankCodeToName(code: string): string {
  const banks: Record<string, string> = {
    "002": "ธนาคารกรุงเทพ",
    "004": "ธนาคารกสิกรไทย",
    "006": "ธนาคารกรุงไทย",
    "011": "ธนาคารทหารไทยธนชาต",
    "014": "ธนาคารไทยพาณิชย์",
    "025": "ธนาคารกรุงศรีอยุธยา",
    "030": "ธนาคารออมสิน",
    "034": "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
  };
  return banks[code] || `ธนาคารรหัส ${code}`;
}

/**
 * แปลง error slug เป็นข้อความภาษาไทย
 */
function slugToThai(slug: string): string {
  const map: Record<string, string> = {
    "amount-not-verified": "ยอดเงินในสลิปไม่ตรงกับที่ระบุ",
    "slip-not-found": "ไม่พบรายการโอนในระบบธนาคาร (สลิปอาจเป็นสลิปปลอม)",
    "qr-not-found": "ไม่พบ QR Code ในสลิป",
    "invalid-qr": "QR Code ไม่ถูกต้อง",
    "amount-not-found": "ไม่สามารถอ่านยอดเงินจากสลิปได้ (รูปอาจไม่ชัด)",
    "invalid-slip-data": "ข้อมูลสลิปไม่สมบูรณ์",
    "invalid-image": "รูปภาพไม่ถูกต้อง",
    "terms-not-accepted": "ยังไม่ยอมรับเงื่อนไขการใช้งาน",
    "bad-request": "คำขอไม่ถูกต้อง",
  };
  return map[slug] || `ข้อผิดพลาด: ${slug}`;
}

// ==================== DISCORD BOT ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async () => {
  await connectDatabase();
  console.log(`Bot ready: ${client.user?.tag}`);
  client.user?.setActivity("สลิปโอนเงิน | !help", { type: 3 });
});

// ==================== COMMANDS ====================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(CONFIG.COMMAND_PREFIX)) return;

  const args = message.content
    .slice(CONFIG.COMMAND_PREFIX.length)
    .trim()
    .split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // ---------- !check <amount> ----------
  if (command === "check") {
    const amountArg = args[0];
    if (!amountArg || isNaN(Number(amountArg))) {
      await message.reply(
        `❌ กรุณาระบุยอดเงิน\n**ใช้งาน:** \`\`${CONFIG.COMMAND_PREFIX}check <ยอดเงิน>\`\` พร้อมแนบรูปสลิป`
      );
      return;
    }

    const expectedAmount = parseFloat(amountArg);

    const attachment = message.attachments.first();
    if (!attachment) {
      const embed = new EmbedBuilder()
        .setTitle("❌ ไม่พบรูปภาพ")
        .setDescription("กรุณาแนบรูปสลิปโอนเงินพร้อมคำสั่ง")
        .setColor(0xff0000)
        .addFields({
          name: "วิธีใช้งาน",
          value: `\`\`${CONFIG.COMMAND_PREFIX}check <ยอดเงิน>\`\` พร้อมแนบรูปสลิป`,
        });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!attachment.contentType?.startsWith("image/")) {
      await message.reply("❌ ไฟล์ต้องเป็นรูปภาพเท่านั้น (JPEG, PNG, WebP)");
      return;
    }

    const processingMsg = await message.reply(
      "🔍 กำลังตรวจสอบสลิปกับระบบธนาคาร... รอสักครู่ (อาจใช้เวลา 10-25 วินาที)"
    );

    try {
      const base64Image = await imageToBase64(attachment.url);
      const result = await verifySlip(base64Image, expectedAmount);

      const embed = new EmbedBuilder().setTimestamp();

      if (result.ok && result.data) {
        // สลิปถูกต้อง
        const d = result.data;
        embed
          .setTitle("✅ สลิปถูกต้อง")
          .setDescription(`**${result.message}**`)
          .setColor(0x00ff00)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL(),
          })
          .setThumbnail(attachment.url)
          .addFields(
            {
              name: "💰 ยอดเงิน",
              value: `\`\`${d.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}\`\` บาท`,
              inline: true,
            },
            {
              name: "📋 เลขอ้างอิง",
              value: `\`\`${d.ref}\`\``,
              inline: true,
            },
            {
              name: "📅 วันที่",
              value: `\`\`${new Date(d.date).toLocaleString("th-TH")}\`\``,
              inline: true,
            },
            {
              name: "👤 ผู้โอน",
              value: `\`\`${d.sender_name}\`\`\n${bankCodeToName(d.sender_bank)}`,
              inline: true,
            },
            {
              name: "👤 ผู้รับ",
              value: `\`\`${d.receiver_name}\`\`\n${bankCodeToName(d.receiver_bank)}`,
              inline: true,
            }
          )
          .setFooter({
            text: "ตรวจสอบโดย OIIO Service | ใช้ !history ดูประวัติ",
          });

        // บันทึกลง MongoDB
        await Verification.create({
          userId: message.author.id,
          username: message.author.tag,
          guildId: message.guildId || undefined,
          channelId: message.channelId,
          expectedAmount: expectedAmount,
          detectedAmount: d.amount,
          status: "verified",
          ref: d.ref,
          senderName: d.sender_name,
          receiverName: d.receiver_name,
          senderBank: bankCodeToName(d.sender_bank),
          receiverBank: bankCodeToName(d.receiver_bank),
          imageUrl: attachment.url,
        });
      } else {
        // ไม่ผ่าน
        const slug = result.slug || "unknown";
        embed
          .setTitle("❌ ตรวจสอบไม่ผ่าน")
          .setDescription(`**${result.message || "ไม่ทราบสาเหตุ"}**`)
          .setColor(0xff0000)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL(),
          })
          .setThumbnail(attachment.url)
          .addFields(
            {
              name: "📝 สาเหตุ",
              value: slugToThai(slug),
              inline: false,
            },
            {
              name: "💰 ยอดที่ต้องการ",
              value: `\`\`${expectedAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}\`\` บาท`,
              inline: true,
            }
          )
          .setFooter({ text: "ตรวจสอบโดย OIIO Service" });

        await Verification.create({
          userId: message.author.id,
          username: message.author.tag,
          guildId: message.guildId || undefined,
          channelId: message.channelId,
          expectedAmount: expectedAmount,
          status: "rejected",
          errorSlug: slug,
          errorMessage: result.message,
          imageUrl: attachment.url,
        });
      }

      await processingMsg.edit({ content: "", embeds: [embed] });
    } catch (err: any) {
      if (err.name === "AbortError") {
        await processingMsg.edit("⏱️ ตรวจสอบใช้เวลานานเกินไป กรุณาลองใหม่");
      } else {
        await processingMsg.edit(`❌ เกิดข้อผิดพลาด: ${err.message}`);
      }

      await Verification.create({
        userId: message.author.id,
        username: message.author.tag,
        guildId: message.guildId || undefined,
        channelId: message.channelId,
        expectedAmount: expectedAmount,
        status: "error",
        errorMessage: err.message,
        imageUrl: attachment.url,
      });
    }
    return;
  }

  // ---------- !scan ----------
  if (command === "scan") {
    const attachment = message.attachments.first();
    if (!attachment) {
      await message.reply("❌ กรุณาแนบรูปสลิปพร้อมคำสั่ง `!scan`");
      return;
    }

    if (!attachment.contentType?.startsWith("image/")) {
      await message.reply("❌ ไฟล์ต้องเป็นรูปภาพเท่านั้น");
      return;
    }

    const processingMsg = await message.reply(
      "🔍 กำลังอ่านยอดเงินจากสลิปด้วย OCR..."
    );

    try {
      const base64Image = await imageToBase64(attachment.url);
      const result = await detectAmount(base64Image);

      if (result.ok && result.data) {
        const d = result.data;
        const embed = new EmbedBuilder()
          .setTitle("📊 ข้อมูลจากสลิป")
          .setDescription(`**${result.message}**`)
          .setColor(0x3498db)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL(),
          })
          .setThumbnail(attachment.url)
          .addFields(
            {
              name: "💰 ยอดเงินที่ตรวจพบ",
              value: `\`\`${d.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}\`\` บาท`,
              inline: true,
            },
            {
              name: "📋 เลขอ้างอิง",
              value: `\`\`${d.ref}\`\``,
              inline: true,
            },
            {
              name: "👤 ผู้โอน",
              value: `\`\`${d.sender_name}\`\``,
              inline: true,
            },
            {
              name: "👤 ผู้รับ",
              value: `\`\`${d.receiver_name}\`\``,
              inline: true,
            }
          )
          .setFooter({
            text: "ใช้ !check <ยอด> เพื่อตรวจสอบกับยอดที่ต้องการ",
          });

        await processingMsg.edit({ content: "", embeds: [embed] });
      } else {
        const slug = result.slug || "unknown";
        await processingMsg.edit(
          `❌ ไม่สามารถอ่านสลิปได้: ${result.message || slugToThai(slug)}`
        );
      }
    } catch (err: any) {
      await processingMsg.edit(`❌ เกิดข้อผิดพลาด: ${err.message}`);
    }
    return;
  }

  // ---------- !history [limit] ----------
  if (command === "history") {
    const limit = Math.min(parseInt(args[0]) || 5, 20);

    try {
      const records = await Verification.find({ userId: message.author.id })
        .sort({ createdAt: -1 })
        .limit(limit);

      if (records.length === 0) {
        await message.reply("📭 คุณยังไม่มีประวัติการตรวจสอบ");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("📜 ประวัติการตรวจสอบสลิป")
        .setColor(0x9b59b6);

      records.forEach((rec) => {
        const emoji =
          rec.status === "verified" ? "✅" : rec.status === "rejected" ? "❌" : "⚠️";
        const dateStr = rec.createdAt.toLocaleString("th-TH", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        let value = `ยอด: \`\`${rec.expectedAmount.toLocaleString("th-TH")}\`\` บาท | สถานะ: \`\`${rec.status}\`\``;
        if (rec.ref) value += `\nเลขอ้างอิง: \`\`${rec.ref}\`\``;
        if (rec.errorSlug) value += `\nสาเหตุ: ${slugToThai(rec.errorSlug)}`;

        embed.addFields({ name: `${emoji} ${dateStr}`, value, inline: false });
      });

      await message.reply({ embeds: [embed] });
    } catch (err: any) {
      await message.reply(`❌ ไม่สามารถดึงประวัติได้: ${err.message}`);
    }
    return;
  }

  // ---------- !help ----------
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 คำสั่งทั้งหมด")
      .setDescription("บอทตรวจสอบสลิปโอนเงิน (OIIO Service)")
      .setColor(0xf1c40f)
      .addFields(
        {
          name: `\`\`${CONFIG.COMMAND_PREFIX}check <ยอดเงิน>\`\``,
          value: "ตรวจสอบสลิปกับระบบธนาคาร (แนบรูปสลิป)",
          inline: false,
        },
        {
          name: `\`\`${CONFIG.COMMAND_PREFIX}scan\`\``,
          value: "อ่านยอดเงินจากสลิปอัตโนมัติด้วย OCR (แนบรูปสลิป)",
          inline: false,
        },
        {
          name: `\`\`${CONFIG.COMMAND_PREFIX}history [จำนวน]\`\``,
          value: "ดูประวัติการตรวจสอบ (ค่าเริ่มต้น 5 รายการ, สูงสุด 20)",
          inline: false,
        }
      )
      .addFields({
        name: "💡 ตัวอย่างการใช้งาน",
        value: `\`\`\`\n${CONFIG.COMMAND_PREFIX}check 1500.50\n(แนบรูปสลิปพร้อมข้อความ)\n\`\`\``,
        inline: false,
      })
      .setFooter({
        text: "ใช้ API ฟรีจาก OIIO Service | slip-c.oiio.download",
      });

    await message.reply({ embeds: [embed] });
    return;
  }
});

// ==================== ERROR HANDLING ====================
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

// ==================== START ====================
client.login(CONFIG.DISCORD_TOKEN);
