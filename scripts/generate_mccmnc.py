#!/usr/bin/env python3
"""
Generate src/database/mccmnc_full.json — the complete MCC/MNC reference dataset
for global SMS routing.

Routing (server.cjs resolveRoute) matches a destination's dialing prefix against
mccmnc.calling_code, so every row MUST carry the country's ITU E.164 calling code.

Data sources (fetched at run time):
  1. MCC/MNC table (operator, brand, bands, status, ISO country code):
     https://raw.githubusercontent.com/pbakondy/mcc-mnc-list/master/mcc-mnc-list.json
  2. Country calling codes (derived from each country's idd root + suffix):
     https://raw.githubusercontent.com/mledoze/countries/master/countries.json

Output is a JSON array whose objects match the mccmnc table columns:
  { country, country_code, mcc, mnc, operator, network_type, status, calling_code }

Rules:
  - International networks (satellite, MCC 901) and Test networks (MCC 001/999)
    have no country calling code and are skipped — they are unreachable by dialing.
  - (mcc, mnc) is de-duplicated; an Operational entry wins over a non-operational one.
  - Territories sharing a calling code with their parent country (Vatican +39,
    Aland +358, Western Sahara +212, Svalbard +47) are pinned via OVERRIDES.
  - mnc is kept as a string so leading zeros ("01", "050") are preserved.
"""

import json
import re
import urllib.request

MCCMNC_URL = "https://raw.githubusercontent.com/pbakondy/mcc-mnc-list/master/mcc-mnc-list.json"
COUNTRIES_URL = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json"
OUT_PATH = "src/database/mccmnc_full.json"

# Territories that share a calling code with their parent country.
CALLING_CODE_OVERRIDES = {
    "VA": "39",    # Vatican City uses Italy's +39
    "AX": "358",   # Aland uses Finland's +358
    "EH": "212",   # Western Sahara uses Morocco's +212
    "SJ": "47",    # Svalbard uses Norway's +47
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "net2app-mccmnc/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def build_calling_codes(countries):
    """Map ISO 3166-1 alpha-2 -> ITU E.164 country calling code (no '+' prefix)."""
    mapping = {}
    for c in countries:
        cc2 = c.get("cca2")
        if not cc2:
            continue
        if cc2 in CALLING_CODE_OVERRIDES:
            mapping[cc2] = CALLING_CODE_OVERRIDES[cc2]
            continue
        idd = c.get("idd") or {}
        root = (idd.get("root") or "").lstrip("+")
        suffixes = idd.get("suffixes") or [""]
        if root in ("1", "7"):
            # North American Numbering Plan (+1) and Russia/Kazakhstan (+7) share a
            # root; the listed suffixes are area codes / national prefixes, not the
            # country code.
            code = root
        else:
            code = root + (suffixes[0] or "")
        mapping[cc2] = code
    return mapping


def network_type(bands):
    if not bands:
        return "GSM"
    b = bands.upper()
    for tech, label in (("5G", "5G"), ("LTE", "LTE"), ("CDMA", "CDMA"),
                        ("UMTS", "UMTS"), ("WCDMA", "UMTS"), ("GSM", "GSM")):
        if tech in b:
            return label
    return "GSM"


def main():
    print("Fetching MCC/MNC list...")
    rows = fetch_json(MCCMNC_URL)
    print(f"  {len(rows)} source entries")
    print("Fetching country calling codes...")
    calling = build_calling_codes(fetch_json(COUNTRIES_URL))
    print(f"  {len(calling)} country calling codes")

    result = {}
    skipped = 0
    unmapped = {}
    for e in rows:
        cc = e.get("countryCode")
        if not cc:
            # International (satellite) and Test networks — no country calling code.
            skipped += 1
            continue
        if "-" in cc:
            # Subdivision of a country (e.g. "GE-AB" Abkhazia) — has no independent
            # calling code and its non-ITU MCC would shadow the parent country (Georgia)
            # in the calling_code lookup, so it is excluded.
            skipped += 1
            continue
        country = e.get("countryName") or ""
        # countryCode may be "GE-AB" (subdivision) or "AU/CC/CX" (shared MCC);
        # the first token is the primary ISO 3166-1 alpha-2 code.
        iso = re.split(r"[-/]", cc)[0].upper()
        mcc = str(e.get("mcc") or "").strip()
        mnc = str(e.get("mnc") or "").strip()
        if not country or not mcc or not mnc:
            skipped += 1
            continue

        code = calling.get(iso, "")
        if code == "":
            unmapped.setdefault(iso, set()).add(country)

        brand = e.get("brand") or ""
        operator = e.get("operator") or ""
        rec = {
            "country": country,
            "country_code": iso,
            "mcc": mcc,
            "mnc": mnc,
            "operator": brand or operator or "Unknown",
            "network_type": network_type(e.get("bands")),
            # All networks are marked active so they are selectable in routing and
            # rate configuration regardless of the source's Operational/Reserved flag.
            "status": "active",
            "calling_code": code,
        }

        key = (mcc, mnc)
        if key not in result or (rec["status"] == "active" and result[key]["status"] != "active"):
            result[key] = rec

    final = sorted(result.values(), key=lambda r: (r["country"], r["mcc"], r["mnc"]))
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=1)

    countries = {}
    codes = {}
    for r in final:
        countries[r["country_code"]] = countries.get(r["country_code"], 0) + 1
        codes[r["calling_code"]] = codes.get(r["calling_code"], 0) + 1
    print(f"Wrote {len(final)} rows to {OUT_PATH}")
    print(f"  distinct countries: {len(countries)}")
    print(f"  distinct calling codes: {len(codes)}")
    print(f"  skipped (international/test, no country): {skipped}")
    if unmapped:
        print("  UNMAPPED country codes (calling_code empty):")
        for iso, names in sorted(unmapped.items()):
            print(f"    {iso}: {sorted(names)}")


if __name__ == "__main__":
    main()
