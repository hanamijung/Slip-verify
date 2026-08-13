"""
Discord Bot ตรวจสอบสลิปโอนเงิน (ใช้ OIIO Service API)
==================================================
API: https://slip-c.oiio.download
ติดตั้ง: pip install discord.py aiohttp

วิธีใช้งาน:
    1. สร้าง Bot ที่ https://discord.com/developers/applications
    2. คัดลอก TOKEN มาใส่ในตัวแปร DISCORD_TOKEN
    3. รันไฟล์นี้
    4. ผู้ใช้ส่งรูปสลิปพร้อมคำสั่ง !check <ยอดเงิน>
"""

import discord
from discord.ext import commands
import aiohttp
import base64
import json
import sqlite3
from datetime import datetime
from typing import Optional, Dict

# ==================== CONFIG ====================
DISCORD_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
COMMAND_PREFIX = "!"
SLIP_API_URL = "https://slip-c.oiio.download"
DATABASE_PATH = "slip_history.db"

# ==================== DATABASE ====================
def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            expected_amount REAL,
            detected_amount REAL,
            status TEXT,
            ref TEXT,
            sender_name TEXT,
            receiver_name TEXT,
            bank TEXT,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def save_check(data: Dict):
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO checks (user_id, username, expected_amount, detected_amount, status, ref, sender_name, receiver_name, bank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("user_id"), data.get("username"), data.get("expected_amount"),
        data.get("detected_amount"), data.get("status"), data.get("ref"),
        data.get("sender_name"), data.get("receiver_name"), data.get("bank")
    ))
    conn.commit()
    conn.close()

# ==================== API CLIENT ====================
async def verify_slip(image_bytes: bytes, amount: float) -> Dict:
    """เรียก OIIO API เพื่อตรวจสอบสลิป"""

    # แปลงรูปเป็น base64
    img_b64 = base64.b64encode(image_bytes).decode("utf-8")

    # ตรวจสอบ MIME type จาก magic bytes
    mime = "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif image_bytes[:4] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif image_bytes[:4] == b"RIFF":
        mime = "image/webp"

    img_data_uri = f"data:{mime};base64,{img_b64}"

    payload = {
        "img": img_data_uri,
        "amount": amount,
        "tos": True,
        "privacy": True,
        "eula": True
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{SLIP_API_URL}/api/slip/{amount}",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=35)
        ) as resp:
            status = resp.status
            text = await resp.text()

            try:
                result = json.loads(text)
            except json.JSONDecodeError:
                result = {"raw": text}

            result["http_status"] = status
            return result

async def detect_amount(image_bytes: bytes) -> Dict:
    """ให้ API อ่านยอดเงินจากรูปเอง (OCR)"""

    img_b64 = base64.b64encode(image_bytes).decode("utf-8")

    mime = "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif image_bytes[:4] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif image_bytes[:4] == b"RIFF":
        mime = "image/webp"

    img_data_uri = f"data:{mime};base64,{img_b64}"

    payload = {
        "img": img_data_uri,
        "tos": True,
        "privacy": True,
        "eula": True
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{SLIP_API_URL}/api/slip",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=35)
        ) as resp:
            status = resp.status
            text = await resp.text()

            try:
                result = json.loads(text)
            except json.JSONDecodeError:
                result = {"raw": text}

            result["http_status"] = status
            return result

# ==================== DISCORD BOT ====================
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=COMMAND_PREFIX, intents=intents, help_command=None)

@bot.event
async def on_ready():
    init_db()
    print(f"✅ Bot พร้อมใช้งาน: {bot.user}")
    await bot.change_presence(activity=discord.Activity(
        type=discord.ActivityType.watching, name="สลิปโอนเงิน | !help"
    ))

@bot.command(name="check")
async def check_slip(ctx, amount: float):
    """
    ตรวจสอบสลิปโอนเงิน
    ใช้งาน: !check <ยอดเงิน> (แนบรูปสลิป)
    ตัวอย่าง: !check 1500.50
    """
    if not ctx.message.attachments:
        embed = discord.Embed(
            title="❌ ไม่พบรูปภาพ",
            description="กรุณาแนบรูปสลิปโอนเงินพร้อมคำสั่ง",
            color=discord.Color.red()
        )
        embed.add_field(
            name="วิธีใช้งาน",
            value=f"`{COMMAND_PREFIX}check <ยอดเงิน>` พร้อมแนบรูปสลิป",
            inline=False
        )
        await ctx.send(embed=embed)
        return

    attachment = ctx.message.attachments[0]

    if not attachment.content_type or not attachment.content_type.startswith("image/"):
        await ctx.send("❌ ไฟล์ต้องเป็นรูปภาพเท่านั้น (JPEG, PNG, WebP)")
        return

    processing = await ctx.send("🔍 กำลังตรวจสอบสลิปกับระบบธนาคาร... รอสักครู่ (อาจใช้เวลา 10-25 วินาที)")

    try:
        image_bytes = await attachment.read()
        result = await verify_slip(image_bytes, amount)

        # ดึงข้อมูลจาก response
        ok = result.get("ok", False)
        message = result.get("message", "ไม่มีข้อความ")
        data = result.get("data", {})

        if ok and data:
            # สลิปถูกต้อง
            embed = discord.Embed(
                title="✅ สลิปถูกต้อง",
                description=f"**{message}**",
                color=discord.Color.green(),
                timestamp=datetime.now()
            )

            embed.set_author(name=str(ctx.author), icon_url=ctx.author.display_avatar.url)
            embed.set_thumbnail(url=attachment.url)

            # ข้อมูลธุรกรรม
            ref = data.get("ref", "N/A")
            tx_date = data.get("date", "N/A")
            tx_amount = data.get("amount", 0)
            sender = data.get("sender_name", "N/A")
            sender_bank = data.get("sender_bank", "N/A")
            receiver = data.get("receiver_name", "N/A")
            receiver_bank = data.get("receiver_bank", "N/A")

            embed.add_field(
                name="💰 ยอดเงิน",
                value=f"`{tx_amount:,.2f}` บาท",
                inline=True
            )
            embed.add_field(
                name="📋 เลขอ้างอิง",
                value=f"`{ref}`",
                inline=True
            )
            embed.add_field(
                name="📅 วันที่",
                value=f"`{tx_date}`",
                inline=True
            )

            embed.add_field(
                name="👤 ผู้โอน",
                value=f"{sender}\n(ธนาคาร {sender_bank})",
                inline=True
            )
            embed.add_field(
                name="👤 ผู้รับ",
                value=f"{receiver}\n(ธนาคาร {receiver_bank})",
                inline=True
            )

            # บันทึกลง DB
            save_check({
                "user_id": str(ctx.author.id),
                "username": str(ctx.author),
                "expected_amount": amount,
                "detected_amount": tx_amount,
                "status": "verified",
                "ref": ref,
                "sender_name": sender,
                "receiver_name": receiver,
                "bank": f"{sender_bank} -> {receiver_bank}"
            })

        else:
            # สลิปไม่ผ่าน หรือมี error
            slug = result.get("slug", "unknown")
            embed = discord.Embed(
                title="❌ ตรวจสอบไม่ผ่าน",
                description=f"**{message}**",
                color=discord.Color.red(),
                timestamp=datetime.now()
            )

            embed.set_author(name=str(ctx.author), icon_url=ctx.author.display_avatar.url)
            embed.set_thumbnail(url=attachment.url)

            # อธิบาย error slug
            error_desc = {
                "amount-not-verified": "ยอดเงินในสลิปไม่ตรงกับที่ระบุ",
                "slip-not-found": "ไม่พบรายการโอนในระบบธนาคาร",
                "qr-not-found": "ไม่พบ QR Code ในสลิป",
                "invalid-qr": "QR Code ไม่ถูกต้อง",
                "amount-not-found": "ไม่สามารถอ่านยอดเงินจากสลิปได้",
                "invalid-slip-data": "ข้อมูลสลิปไม่สมบูรณ์",
                "invalid-image": "รูปภาพไม่ถูกต้อง",
                "terms-not-accepted": "ยังไม่ยอมรับเงื่อนไขการใช้งาน"
            }.get(slug, f"รหัสข้อผิดพลาด: {slug}")

            embed.add_field(
                name="📝 สาเหตุ",
                value=error_desc,
                inline=False
            )
            embed.add_field(
                name="💰 ยอดที่ต้องการ",
                value=f"`{amount:,.2f}` บาท",
                inline=True
            )

            # บันทึกลง DB
            save_check({
                "user_id": str(ctx.author.id),
                "username": str(ctx.author),
                "expected_amount": amount,
                "detected_amount": None,
                "status": slug,
                "ref": None,
                "sender_name": None,
                "receiver_name": None,
                "bank": None
            })

        await processing.edit(content=None, embed=embed)

    except aiohttp.ClientTimeout:
        await processing.edit(content="⏱️ ตรวจสอบใช้เวลานานเกินไป กรุณาลองใหม่")
    except Exception as e:
        await processing.edit(content=f"❌ เกิดข้อผิดพลาด: {str(e)}")

@bot.command(name="scan")
async def scan_slip(ctx):
    """
    อ่านยอดเงินจากสลิปอัตโนมัติ (OCR)
    ใช้งาน: !scan (แนบรูปสลิป)
    """
    if not ctx.message.attachments:
        await ctx.send("❌ กรุณาแนบรูปสลิป")
        return

    attachment = ctx.message.attachments[0]

    if not attachment.content_type or not attachment.content_type.startswith("image/"):
        await ctx.send("❌ ไฟล์ต้องเป็นรูปภาพเท่านั้น")
        return

    processing = await ctx.send("🔍 กำลังอ่านยอดเงินจากสลิปด้วย OCR...")

    try:
        image_bytes = await attachment.read()
        result = await detect_amount(image_bytes)

        ok = result.get("ok", False)
        message = result.get("message", "")
        data = result.get("data", {})

        if ok and data:
            embed = discord.Embed(
                title="📊 ข้อมูลจากสลิป",
                description=f"**{message}**",
                color=discord.Color.blue(),
                timestamp=datetime.now()
            )

            embed.set_author(name=str(ctx.author), icon_url=ctx.author.display_avatar.url)
            embed.set_thumbnail(url=attachment.url)

            embed.add_field(
                name="💰 ยอดเงินที่ตรวจพบ",
                value=f"`{data.get('amount', 0):,.2f}` บาท",
                inline=True
            )
            embed.add_field(
                name="📋 เลขอ้างอิง",
                value=f"`{data.get('ref', 'N/A')}`",
                inline=True
            )
            embed.add_field(
                name="👤 ผู้โอน",
                value=f"{data.get('sender_name', 'N/A')}",
                inline=True
            )
            embed.add_field(
                name="👤 ผู้รับ",
                value=f"{data.get('receiver_name', 'N/A')}",
                inline=True
            )

            await processing.edit(content=None, embed=embed)
        else:
            slug = result.get("slug", "unknown")
            await processing.edit(content=f"❌ ไม่สามารถอ่านสลิปได้: {message} ({slug})")

    except Exception as e:
        await processing.edit(content=f"❌ เกิดข้อผิดพลาด: {str(e)}")

@bot.command(name="history")
async def history_cmd(ctx, limit: int = 5):
    """ดูประวัติการตรวจสอบ"""
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT expected_amount, detected_amount, status, ref, checked_at 
        FROM checks 
        WHERE user_id = ? 
        ORDER BY checked_at DESC 
        LIMIT ?
    """, (str(ctx.author.id), limit))
    rows = c.fetchall()
    conn.close()

    if not rows:
        await ctx.send("📭 ไม่มีประวัติการตรวจสอบ")
        return

    embed = discord.Embed(
        title="📜 ประวัติการตรวจสอบ",
        color=discord.Color.blurple()
    )

    for expected, detected, status, ref, checked_at in rows:
        emoji = "✅" if status == "verified" else "❌"
        val = f"ยอด: `{expected:,.2f}` | สถานะ: `{status}`"
        if ref:
            val += f"\nเลขอ้างอิง: `{ref}`"
        embed.add_field(name=f"{emoji} {checked_at}", value=val, inline=False)

    await ctx.send(embed=embed)

@bot.command(name="help")
async def help_cmd(ctx):
    """แสดงคำสั่งทั้งหมด"""
    embed = discord.Embed(
        title="📖 คำสั่งทั้งหมด",
        description="บอทตรวจสอบสลิปโอนเงิน (OIIO Service)",
        color=discord.Color.gold()
    )

    embed.add_field(
        name=f"`{COMMAND_PREFIX}check <ยอดเงิน>`",
        value="ตรวจสอบสลิปกับระบบธนาคาร (แนบรูปสลิป)",
        inline=False
    )
    embed.add_field(
        name=f"`{COMMAND_PREFIX}scan`",
        value="อ่านยอดเงินจากสลิปอัตโนมัติ (แนบรูปสลิป)",
        inline=False
    )
    embed.add_field(
        name=f"`{COMMAND_PREFIX}history [จำนวน]`",
        value="ดูประวัติการตรวจสอบ",
        inline=False
    )

    embed.add_field(
        name="💡 ตัวอย่าง",
        value=f"```
{COMMAND_PREFIX}check 1500.50
(แนบรูปสลิปพร้อมข้อความ)
```",
        inline=False
    )

    embed.set_footer(text="ใช้ API ฟรีจาก OIIO Service | slip-c.oiio.download")
    await ctx.send(embed=embed)

@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.MissingRequiredArgument):
        await ctx.send(f"❌ ขาดข้อมูลที่จำเป็น ใช้ `{COMMAND_PREFIX}help` เพื่อดูวิธีใช้")
    elif isinstance(error, commands.BadArgument):
        await ctx.send("❌ ยอดเงินต้องเป็นตัวเลข (เช่น 1500 หรือ 1500.50)")

# ==================== MAIN ====================
if __name__ == "__main__":
    if DISCORD_TOKEN == "YOUR_DISCORD_BOT_TOKEN_HERE":
        print("⚠️ กรุณาใส่ DISCORD_TOKEN ในไฟล์ก่อนรัน")
    else:
        bot.run(DISCORD_TOKEN)
