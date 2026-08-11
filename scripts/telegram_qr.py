#!/usr/bin/env python3
"""
Telegram QR Code Generator for NET2APP Hub
============================================
Generates SELF-CONTAINED Telegram login QR codes using auth.ExportLoginToken.
Unlike qr_login() which requires the session to stay alive, ExportLoginToken
produces tokens that work independently — the Python process can exit and the
QR remains valid until its expiry (~2 minutes, refreshed by cron every 45s).

Usage:
  python3 scripts/telegram_qr.py <device_id> <phone_number> [api_id] [api_hash] [proxy_host] [proxy_port] [action]

Output (JSON to stdout):
  {"success": true, "qr": "tg://login?token=...", "session": "<base64>", ...}
"""

import sys
import json
import os
import asyncio
import base64

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.tl.functions.auth import ExportLoginTokenRequest
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

DEFAULT_API_ID = int(os.environ.get("TELEGRAM_API_ID", "2040"))
DEFAULT_API_HASH = os.environ.get("TELEGRAM_API_HASH", "b18441a1ff607e10a989891a5462e627")

QR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "qr")
SESSION_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ott_sessions")


async def generate_qr(device_id: str, phone_number: str, api_id: int, api_hash: str,
                      proxy_host: str = None, proxy_port: int = None):
    """Generate a self-contained Telegram QR login token via auth.exportLoginToken."""

    os.makedirs(QR_DIR, exist_ok=True)
    os.makedirs(SESSION_DIR, exist_ok=True)

    proxy = None
    if proxy_host and proxy_port:
        proxy = ("socks5", proxy_host, int(proxy_port))

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

        # Export a self-contained login token — this survives process exit.
        # Unlike qr_login(), ExportLoginTokenRequest doesn't need the session
        # to stay alive. The token works independently until expiry (~2 min).
        result = await client(ExportLoginTokenRequest(
            api_id=api_id,
            api_hash=api_hash,
            except_ids=[]
        ))

        # Encode token bytes as base64url for tg://login URL
        token_bytes = result.token
        token_b64 = base64.urlsafe_b64encode(token_bytes).decode('ascii').rstrip('=')
        qr_url = f"tg://login?token={token_b64}"

        # Generate QR code image
        qr_img = qrcode.make(qr_url)
        qr_path = os.path.join(QR_DIR, f"tg_{device_id}.png")
        qr_img.save(qr_path)

        # Save raw URL for frontend
        txt_path = os.path.join(QR_DIR, f"tg_{device_id}.txt")
        with open(txt_path, "w") as f:
            f.write(qr_url)

        # Save session for later message sending
        session_string = client.session.save()
        await client.disconnect()

        return {
            "success": True,
            "device_id": device_id,
            "phone_number": phone_number,
            "qr": qr_url,
            "qr_image": f"/qr/tg_{device_id}.png",
            "pairing_token": token_b64,
            "session": session_string,
            "expires": str(result.expires) if hasattr(result, 'expires') else None,
            "instructions": (
                "1. Open Telegram on your phone\n"
                "2. Go to Settings → Devices → Link Desktop Device\n"
                "3. Scan the QR code shown\n"
            ),
        }

    except ApiIdInvalidError:
        return {"success": False, "error": "API_ID_INVALID", "message": "Telegram API credentials are invalid"}
    except FloodWaitError as e:
        return {"success": False, "error": "FLOOD_WAIT", "message": f"Rate limited. Try again in {e.seconds}s"}
    except Exception as e:
        try:
            await client.disconnect()
        except Exception:
            pass
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


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "success": False,
            "error": "Usage: telegram_qr.py <device_id> <phone_number> [api_id] [api_hash] [proxy_host] [proxy_port] [action]"
        }))
        sys.exit(1)

    device_id = sys.argv[1]
    phone_number = sys.argv[2]
    api_id = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else DEFAULT_API_ID
    api_hash = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else DEFAULT_API_HASH
    proxy_host = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] and sys.argv[5] != 'none' else None
    proxy_port = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] and sys.argv[6] != 'none' else None
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
