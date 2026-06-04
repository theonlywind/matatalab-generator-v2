from __future__ import annotations

import base64
import json
import os
import re
import struct
import subprocess
import uuid
import zlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent
EXPORTS_DIR = ROOT / "exports"
HOST = "127.0.0.1"
PORT = int(os.environ.get("MATATALAB_HELPER_PORT", "8125"))
PAGE_PORT = int(os.environ.get("MATATALAB_PAGE_PORT", "8126"))


def sanitize_filename(raw_name: str) -> str:
    name = os.path.basename(raw_name).strip() or "export.bin"
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")
    return safe_name or "export.bin"


def json_response(handler: BaseHTTPRequestHandler, status: HTTPStatus, data: dict) -> None:
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def file_response(filename: str) -> dict:
    return {
        "filename": filename,
        "relativePath": f"exports/{filename}",
        "downloadUrl": f"http://127.0.0.1:{PAGE_PORT}/exports/{quote(filename)}",
    }


def unfilter_png_rows(data: bytes, width: int, height: int, bpp: int) -> list[bytes]:
    stride = width * bpp
    rows = []
    offset = 0
    previous = bytearray(stride)

    for _ in range(height):
        filter_type = data[offset]
        offset += 1
        row = bytearray(data[offset : offset + stride])
        offset += stride

        for index in range(stride):
            left = row[index - bpp] if index >= bpp else 0
            up = previous[index]
            up_left = previous[index - bpp] if index >= bpp else 0

            if filter_type == 1:
                row[index] = (row[index] + left) & 255
            elif filter_type == 2:
                row[index] = (row[index] + up) & 255
            elif filter_type == 3:
                row[index] = (row[index] + ((left + up) >> 1)) & 255
            elif filter_type == 4:
                predictor = left + up - up_left
                pa = abs(predictor - left)
                pb = abs(predictor - up)
                pc = abs(predictor - up_left)
                chosen = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                row[index] = (row[index] + chosen) & 255
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG filter: {filter_type}")

        rows.append(bytes(row))
        previous = row

    return rows


def read_png_rgb(path: Path) -> tuple[int, int, bytes]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG file")

    pos = 8
    width = height = color_type = bit_depth = None
    idat_chunks = []

    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        pos += 12 + length

        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, *_ = struct.unpack(">IIBBBBB", payload)
        elif chunk_type == b"IDAT":
            idat_chunks.append(payload)
        elif chunk_type == b"IEND":
            break

    if bit_depth != 8 or color_type not in (2, 6):
        raise ValueError(f"Unsupported PNG format: bit_depth={bit_depth}, color_type={color_type}")

    bpp = 4 if color_type == 6 else 3
    rows = unfilter_png_rows(zlib.decompress(b"".join(idat_chunks)), width, height, bpp)
    rgb_rows = []
    for row in rows:
        if color_type == 2:
            rgb_rows.append(row)
            continue
        rgb = bytearray()
        for index in range(0, len(row), 4):
            rgb.extend(row[index : index + 3])
        rgb_rows.append(bytes(rgb))

    return width, height, b"".join(rgb_rows)


def build_pdf_from_png(png_path: Path, pdf_path: Path) -> None:
    width, height, rgb_bytes = read_png_rgb(png_path)
    page_width = 841.89
    page_height = 595.28
    image_bytes = zlib.compress(rgb_bytes, 9)
    content = f"q\n{page_width:.2f} 0 0 {page_height:.2f} 0 0 cm\n/Im0 Do\nQ\n"

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width:.2f} {page_height:.2f}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n".encode(),
        f"4 0 obj\n<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(image_bytes)} >>\nstream\n".encode()
        + image_bytes
        + b"\nendstream\nendobj\n",
        f"5 0 obj\n<< /Length {len(content)} >>\nstream\n{content}endstream\nendobj\n".encode(),
    ]

    parts = [b"%PDF-1.4\n%\xff\xff\xff\xff\n"]
    offsets = [0]
    current_offset = len(parts[0])
    for object_bytes in objects:
        offsets.append(current_offset)
        parts.append(object_bytes)
        current_offset += len(object_bytes)

    xref_offset = current_offset
    xref = f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        xref += f"{offset:010d} 00000 n \n"
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF"
    parts.append(xref.encode())
    parts.append(trailer.encode())
    pdf_path.write_bytes(b"".join(parts))


class ExportHandler(BaseHTTPRequestHandler):
    server_version = "MatatalabExportHelper/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/save-export":
            self.handle_save_export()
            return
        if self.path == "/render-export":
            self.handle_render_export()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def handle_save_export(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(payload)
            filename = sanitize_filename(str(data.get("filename", "")))
            base64_payload = data.get("base64", "")
            file_bytes = base64.b64decode(base64_payload)

            EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
            output_path = EXPORTS_DIR / filename
            output_path.write_bytes(file_bytes)

            json_response(self, HTTPStatus.OK, file_response(filename))
        except Exception as exc:  # noqa: BLE001
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def handle_render_export(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(payload)
            export_format = str(data.get("format", "")).lower()
            if export_format not in {"png", "pdf"}:
                raise ValueError("format must be png or pdf")

            requested_filename = sanitize_filename(str(data.get("filename", f"export.{export_format}")))
            filename_base = re.sub(r"\.(png|pdf)$", "", requested_filename, flags=re.IGNORECASE)
            filename = f"{filename_base}.{export_format}"
            state = data.get("state")
            if not isinstance(state, dict):
                raise ValueError("state must be an object")

            EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
            token = uuid.uuid4().hex
            state_filename = f".state-{token}.json"
            state_path = EXPORTS_DIR / state_filename
            state_path.write_text(json.dumps(state), encoding="utf-8")

            png_path = EXPORTS_DIR / (filename if export_format == "png" else f".render-{token}.png")
            render_url = f"http://127.0.0.1:{PAGE_PORT}/export-render.html?state={quote(state_filename)}"
            subprocess.run(
                [
                    "npx",
                    "--yes",
                    "playwright",
                    "screenshot",
                    "--viewport-size",
                    "2480,1754",
                    "--wait-for-selector",
                    "#export-ready",
                    render_url,
                    str(png_path),
                ],
                cwd=str(ROOT),
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )

            if export_format == "pdf":
                build_pdf_from_png(png_path, EXPORTS_DIR / filename)
                png_path.unlink(missing_ok=True)

            state_path.unlink(missing_ok=True)
            json_response(self, HTTPStatus.OK, file_response(filename))
        except subprocess.CalledProcessError as exc:
            json_response(
                self,
                HTTPStatus.BAD_REQUEST,
                {"error": exc.stderr or exc.stdout or str(exc)},
            )
        except Exception as exc:  # noqa: BLE001
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def legacy_do_POST(self) -> None:
        if self.path != "/save-export":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(payload)
            filename = sanitize_filename(str(data.get("filename", "")))
            base64_payload = data.get("base64", "")
            file_bytes = base64.b64decode(base64_payload)

            EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
            output_path = EXPORTS_DIR / filename
            output_path.write_bytes(file_bytes)

            response = {
                "filename": filename,
                "relativePath": f"exports/{filename}",
                "downloadUrl": f"http://127.0.0.1:8124/exports/{quote(filename)}",
            }

            body = json.dumps(response).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001
            message = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        print(f"[export-helper] {self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), ExportHandler)
    print(f"Export helper listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
