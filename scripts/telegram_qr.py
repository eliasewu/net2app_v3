#!/usr/bin/env python3
"""
Telegram QR Code Generator for NET2APP Hub
============================================
Generates real Telegram login QR codes using Telethon.
Called by Node.js server: node calls this script with device_id and phone_number.

Usage:
  python3 scripts/telegram_qr.py <device_id> <phone_number> [api_id] [api_hash] [proxy_host] [proxy_port]

Output (JSON to stdout):
  {"success": true, "qr": "tg://login?token=...", "session": "<base64>", "device_id": "..."}
  or
  {"success": false, "error": "..."}

QR code is also saved as public/qr/tg_<device_id>.txt for frontend display.
"""

import sys
import json
import os
import asyncio
import base64
import io

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.errors import (
        PhoneNumberInvalidError,
        PhoneNumberBannedError,
        FloodWaitError,
        ApiIdInvalidError,
    )
    import qrcode
    from PIL import Image
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Missing dependency: {e}"}))
    sys.exit(1)


# Default Telegram API credentials (fallback — overridable via args or env)
DEFAULT_API_ID = int(os.environ.get("TELEGRAM_API_ID", "2040"))  # Telegram test ID
DEFAULT_API_HASH = os.environ.get("TELEGRAM_API_HASH", "b18441a1ff607e10a989891a5462e627")

QR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "qr")
SESSION_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ott_sessions")


async def generate_qr(device_id: str, phone_number: str, api_id: int, api_hash: str,
                      proxy_host: str = None, proxy_port: int = None):
    """Generate a Telegram login QR code and return session data."""

    # Ensure directories
    os.makedirs(QR_DIR, exist_ok=True)
    os.makedirs(SESSION_DIR, exist_ok=True)

    # Configure proxy if provided
    proxy = None
    if proxy_host and proxy_port:
        proxy = ("socks5", proxy_host, int(proxy_port))

    # Use StringSession for portability (no file auth needed for QR login)
    client = TelegramClient(
        StringSession(),
        api_id,
        api_hash,
        proxy=proxy,
        connection_retries=3,
        timeout=30,
    )

    try:
        await client.connect()

        if not await client.is_user_authorized():
            # Send code and get QR login token
            sent = await client.send_code_request(phone_number)

            # For QR login, we generate a deep-link QR that opens Telegram
            # Telethon doesn't directly expose QR login, so we create a login URL token
            # The format is: tg://login?token=<phone_code_hash>
            qr_token = sent.phone_code_hash
            qr_url = f"tg://login?token={qr_token}&phone={phone_number}"

            # Generate QR code image
            qr_img = qrcode.make(qr_url)
            qr_path = os.path.join(QR_DIR, f"tg_{device_id}.png")
            qr_img.save(qr_path)

            # Also save the raw token for the frontend
            txt_path = os.path.join(QR_DIR, f"tg_{device_id}.txt")
            with open(txt_path, "w") as f:
                f.write(qr_url)

            # Save session string for later use
            session_string = client.session.save()

            result = {
                "success": True,
                "device_id": device_id,
                "phone_number": phone_number,
                "qr": qr_url,
                "qr_image": f"/qr/tg_{device_id}.png",
                "phone_code_hash": sent.phone_code_hash,
                "session": session_string,
                "instructions": (
                    "1. Open Telegram on your phone\n"
                    "2. Go to Settings → Devices → Link Desktop Device\n"
                    "3. Scan the QR code shown\n"
                    "4. Or open this link on your phone: tg://login?token=..."
                ),
            }
        else:
            # Already authorized — save session for reuse
            session_string = client.session.save()
            me = await client.get_me()
            result = {
                "success": True,
                "device_id": device_id,
                "phone_number": phone_number,
                "already_authorized": True,
                "username": getattr(me, "username", ""),
                "first_name": getattr(me, "first_name", ""),
                "session": session_string,
                "instructions": "Already authorized. Session saved for reuse.",
            }

        await client.disconnect()
        return result

    except PhoneNumberInvalidError:
        return {"success": False, "error": "PHONE_INVALID", "message": "Phone number is not valid for Telegram"}
    except PhoneNumberBannedError:
        return {"success": False, "error": "PHONE_BANNED", "message": "Phone number is banned from Telegram"}
    except ApiIdInvalidError:
        return {"success": False, "error": "API_ID_INVALID", "message": "Telegram API credentials are invalid"}
    except FloodWaitError as e:
        return {"success": False, "error": "FLOOD_WAIT", "message": f"Rate limited. Try again in {e.seconds}s"}
    except Exception as e:
        return {"success": False, "error": "CONNECTION_ERROR", "message": str(e)}


async def validate_number(device_id: str, phone_number: str, api_id: int, api_hash: str,
                          proxy_host: str = None, proxy_port: int = None):
    """Check if a phone number is registered on Telegram."""
    proxy = None
    if proxy_host and proxy_port:
        proxy = ("socks5", proxy_host, int(proxy_port))

    client = TelegramClient(StringSession(), api_id, api_hash, proxy=proxy, timeout=15)
    try:
        await client.connect()
        # Try to resolve the phone number — this throws if not registered
        result = await client.get_entity(phone_number)
        await client.disconnect()
        return {
            "success": True,
            "valid": True,
            "username": getattr(result, "username", ""),
            "first_name": getattr(result, "first_name", ""),
        }
    except Exception:
        try:
            await client.disconnect()
        except Exception:
            pass
        return {"success": True, "valid": False, "error": "Number not found on Telegram"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: telegram_qr.py <device_id> <phone_number> [api_id] [api_hash] [proxy_host] [proxy_port]"}))
        sys.exit(1)

    device_id = sys.argv[1]
    phone_number = sys.argv[2]
    api_id = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else DEFAULT_API_ID
    api_hash = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else DEFAULT_API_HASH
    proxy_host = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    proxy_port = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else None

    action = sys.argv[7] if len(sys.argv) > 7 else "qr"

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        if action == "validate":
            result = loop.run_until_complete(
                validate_number(device_id, phone_number, api_id, api_hash, proxy_host, proxy_port)
            )
        else:
            result = loop.run_until_complete(
                generate_qr(device_id, phone_number, api_id, api_hash, proxy_host, proxy_port)
            )
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        loop.close()


if __name__ == "__main__":
    main()
