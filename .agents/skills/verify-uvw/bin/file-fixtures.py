#!/usr/bin/env python3
"""Generate and validate binary Blob fixtures using only the Python standard library."""
import hashlib
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Binary transfer" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{ns}"><sheetData>' + ''.join(
        f'<row r="{i}"><c r="A{i}" t="inlineStr"><is><t>{hashlib.sha256(str(i).encode()).hexdigest()}</t></is></c></row>'
        for i in range(1, 50001)
    ) + '</sheetData></worksheet>',
}
xlsx = root / 'mf-binary.xlsx'
# Stored ZIP entries are valid OpenXML and keep the binary file above the adapter's old cap.
with zipfile.ZipFile(xlsx, 'w', compression=zipfile.ZIP_STORED) as archive:
    for name, content in parts.items():
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + content)
with zipfile.ZipFile(xlsx) as archive:
    assert archive.testzip() is None
    for name in parts:
        ET.fromstring(archive.read(name))
    assert len(ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).find(f'{{{ns}}}sheetData')) == 50000
assert xlsx.stat().st_size > 4 * 1024 * 1024

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

scanline = b'\0\xff\0\x80\xff'
compressed = zlib.compress(scanline)
png = root / 'mf-binary.png'
png.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', compressed) + chunk(b'IEND', b''))
assert zlib.decompress(compressed) == scanline
for path in (xlsx, png):
    print(f'{path.name}\t{path.stat().st_size}\t{hashlib.sha256(path.read_bytes()).hexdigest()}')
