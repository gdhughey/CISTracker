#!/usr/bin/env python3
import sqlite3
import re

DB = '/opt/CISTracker/data/cyberlab.db'
BULK_EQ_IDS = [648, 663, 675]  # DELL OPTIPLEX 790, DELL Optiplex 390, Dell Optiplex 790 Midtowers

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
c = db.cursor()

# Get all units to migrate
c.execute("""
    SELECT eu.id, eu.equipment_id, eu.name, eu.serial_number, eu.barcode,
           e.category, e.group_key, e.location, e.location_id
    FROM equipment_units eu
    JOIN equipment e ON e.id = eu.equipment_id
    WHERE e.id IN (648, 663, 675)
    ORDER BY e.id, eu.id
""")
units = list(c.fetchall())
print(f"Found {len(units)} units to migrate")

# Track seen names to handle duplicates
seen_names = {}

with db:
    for u in units:
        raw_name = (u['name'] or '').strip()
        serial = (u['serial_number'] or '').strip()
        category = u['category'] or 'Computers'
        group_key = u['group_key'] or "Dell OptiPlex's"
        location = u['location'] or ''
        location_id = u['location_id']

        # Reformat: "DELL OPTIPLEX 790 1" -> "#1 DELL OPTIPLEX 790"
        m = re.match(r'^(.+?)\s+(\d+)$', raw_name)
        if m:
            base = m.group(1).strip()
            num = int(m.group(2))
            new_name = f'#{num} {base}'
        else:
            new_name = raw_name

        # Handle duplicates by appending a letter
        orig = new_name
        if new_name in seen_names:
            seen_names[orig] = seen_names.get(orig, 1) + 1
            new_name = f'{orig}b'
        else:
            seen_names[new_name] = 1

        c.execute("""
            INSERT INTO equipment (name, category, serial_number, barcode, status,
                                   group_key, quantity, location, location_id)
            VALUES (?, ?, ?, ?, 'available', ?, 1, ?, ?)
        """, (new_name, category, serial, '', group_key, location, location_id))
        new_id = c.lastrowid
        print(f"  Created eq {new_id}: {new_name}  serial={serial or '(none)'}")

    # Delete equipment_units for these bulk rows
    c.execute("DELETE FROM equipment_units WHERE equipment_id IN (648, 663, 675)")
    print(f"\nDeleted {c.rowcount} equipment_units rows")

    # Delete the 3 bulk equipment rows
    c.execute("DELETE FROM equipment WHERE id IN (648, 663, 675)")
    print(f"Deleted {c.rowcount} bulk equipment rows (648, 663, 675)")

print("\nMigration complete!")

# Verify
c.execute("""
    SELECT group_key, COUNT(*) as cnt
    FROM equipment
    WHERE group_key = "Dell OptiPlex's"
    GROUP BY group_key
""")
row = c.fetchone()
print(f"Dell OptiPlex's group now has {row['cnt'] if row else 0} individual equipment rows")

db.close()
