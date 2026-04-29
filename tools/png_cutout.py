#!/usr/bin/env python3
import struct
import sys
import zlib
from collections import deque


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_png_rgba(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("Not a PNG file")

    offset = len(PNG_SIGNATURE)
    width = height = color_type = bit_depth = None
    compressed = bytearray()

    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        chunk_type = data[offset : offset + 4]
        offset += 4
        chunk = data[offset : offset + length]
        offset += length + 4

        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk)
        elif chunk_type == b"IDAT":
            compressed.extend(chunk)
        elif chunk_type == b"IEND":
            break

    if bit_depth != 8 or color_type != 6:
        raise ValueError("Only 8-bit RGBA PNG files are supported")

    raw = zlib.decompress(bytes(compressed))
    stride = width * 4
    rows = []
    previous = [0] * stride
    cursor = 0

    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        scanline = list(raw[cursor : cursor + stride])
        cursor += stride
        recon = [0] * stride

        for i, value in enumerate(scanline):
            left = recon[i - 4] if i >= 4 else 0
            up = previous[i]
            up_left = previous[i - 4] if i >= 4 else 0

            if filter_type == 0:
                recon[i] = value
            elif filter_type == 1:
                recon[i] = (value + left) & 0xFF
            elif filter_type == 2:
                recon[i] = (value + up) & 0xFF
            elif filter_type == 3:
                recon[i] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                predictor = left + up - up_left
                pa = abs(predictor - left)
                pb = abs(predictor - up)
                pc = abs(predictor - up_left)
                best = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                recon[i] = (value + best) & 0xFF
            else:
                raise ValueError(f"Unsupported PNG filter {filter_type}")

        rows.append(recon)
        previous = recon

    return width, height, rows


def write_png_rgba(path, width, height, rows):
    def chunk(chunk_type, payload):
        return (
            struct.pack(">I", len(payload))
            + chunk_type
            + payload
            + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def crop_rows(rows, x, y, width, height):
    return [row[x * 4 : (x + width) * 4] for row in rows[y : y + height]]


def is_edge_background(pixel):
    red, green, blue, alpha = pixel
    return alpha < 8 or (red < 42 and green < 42 and blue < 42)


def remove_connected_dark_background(rows, width, height):
    visited = set()
    queue = deque()

    def enqueue(x, y):
        if x < 0 or y < 0 or x >= width or y >= height or (x, y) in visited:
            return
        row = rows[y]
        i = x * 4
        if is_edge_background(row[i : i + 4]):
            visited.add((x, y))
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        i = x * 4
        rows[y][i + 3] = 0
        enqueue(x + 1, y)
        enqueue(x - 1, y)
        enqueue(x, y + 1)
        enqueue(x, y - 1)

    return rows


def main():
    if len(sys.argv) != 7:
        raise SystemExit("Usage: png_cutout.py input output x y width height")

    input_path, output_path = sys.argv[1], sys.argv[2]
    x, y, width, height = map(int, sys.argv[3:7])
    source_width, source_height, rows = read_png_rgba(input_path)
    if x < 0 or y < 0 or x + width > source_width or y + height > source_height:
        raise ValueError("Crop is outside the image")

    cropped = crop_rows(rows, x, y, width, height)
    cutout = remove_connected_dark_background(cropped, width, height)
    write_png_rgba(output_path, width, height, cutout)


if __name__ == "__main__":
    main()
