#!/usr/bin/env python3
"""Generate PNG icon files for the PixelPerfect extension (no dependencies needed)."""
import struct, zlib, os, math

def make_pixel(x, y, size):
    """Crosshair target: indigo circle + white crosshair, transparent corners."""
    cx = cy = (size - 1) / 2.0
    r        = size * 0.46
    cross_w  = max(0.7, size * 0.075)  # crosshair half-width (min 1 px)

    dx, dy = x - cx, y - cy
    dist   = math.sqrt(dx * dx + dy * dy)

    if dist > r:
        return None  # transparent

    indigo = (99, 102, 241)
    white  = (255, 255, 255)

    # White crosshair lines
    if abs(dx) <= cross_w or abs(dy) <= cross_w:
        return white

    return indigo

def write_png(path, size):
    def chunk(tag, data):
        buf = tag + data
        return struct.pack('>I', len(data)) + buf + struct.pack('>I', zlib.crc32(buf) & 0xFFFFFFFF)

    # IHDR: width, height, bit-depth=8, color-type=6 (RGBA), compression=0, filter=0, interlace=0
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter byte (None)
        for x in range(size):
            p = make_pixel(x, y, size)
            if p is None:
                raw += bytes([255, 255, 255, 0])   # transparent
            else:
                raw += bytes([p[0], p[1], p[2], 255])  # opaque

    idat = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = chunk(b'IEND', b'')

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend)
    print(f'  created {path}')

print('Generating icons...')
write_png('icons/icon16.png',  16)
write_png('icons/icon48.png',  48)
write_png('icons/icon128.png', 128)
print('Done.')
