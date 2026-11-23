"""Read dimensions without passing image pixels or metadata to a decoder."""

import re
import struct


PNG_HEADER = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"
JPEG_MARKER = re.compile(rb"\xff+([^\xff])")
JPEG_FRAME = set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def _jpeg_dimensions(content):
    end = content.rfind(b"\xff\xd9")
    offset = 2
    for _ in range(4096):
        marker = JPEG_MARKER.match(content, offset, end) if offset < end else None
        if not marker or marker.end() + 2 > end:
            return None
        kind, start = marker.group(1)[0], marker.end()
        if kind in (0, 0x01, 0xD8, 0xD9, 0xDA):
            return None
        size = int.from_bytes(content[start:start + 2], "big")
        offset = start + size
        if size < 2 or offset > end:
            return None
        if kind in JPEG_FRAME and size >= 8:
            height, width = struct.unpack_from(">HH", content, start + 3)
            return width, height
    return None


def _webp_dimensions(content):
    if len(content) < 25 or content[8:12] != b"WEBP":
        return None
    riff_end = int.from_bytes(content[4:8], "little") + 8
    chunk_size = int.from_bytes(content[16:20], "little")
    if not 20 + chunk_size + chunk_size % 2 <= riff_end <= len(content):
        return None
    chunk = content[12:16]
    if chunk == b"VP8X" and chunk_size == 10 and riff_end > 30:
        return (int.from_bytes(content[24:27], "little") + 1,
                int.from_bytes(content[27:30], "little") + 1)
    if chunk == b"VP8L" and chunk_size >= 5 and content[20] == 0x2F:
        bits = int.from_bytes(content[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8 " and chunk_size >= 10 and content[23:26] == b"\x9d\x01\x2a":
        width, height = struct.unpack_from("<HH", content, 26)
        return width & 0x3FFF, height & 0x3FFF
    return None


def identify(content):
    if content.startswith(PNG_HEADER) and content.find(PNG_END, 33) >= 33:
        return "png", struct.unpack_from(">II", content, 16)
    if content.startswith(b"\xff\xd8"):
        return "jpg", _jpeg_dimensions(content)
    if content.startswith(b"RIFF"):
        return "webp", _webp_dimensions(content)
    return None, None
