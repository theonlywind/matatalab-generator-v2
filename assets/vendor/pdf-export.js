(function attachPdfExport(global) {
  function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function concatBytes(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function stringBytes(text) {
    return new TextEncoder().encode(text);
  }

  function buildPdf(imageBytes, widthPx, heightPx) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const objects = [];

    objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    objects.push(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    );
    objects.push(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
    );
    const contentStream = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
    objects.push(
      `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`,
    );

    const pdfParts = [stringBytes("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n")];
    const offsets = [0];
    let currentOffset = pdfParts[0].length;

    objects.forEach((objectText, objectIndex) => {
      offsets[objectIndex + 1] = currentOffset;
      const bytes = stringBytes(objectText);
      pdfParts.push(bytes);
      currentOffset += bytes.length;

      if (objectIndex === 3) {
        pdfParts.push(imageBytes);
        pdfParts.push(stringBytes("\nendstream\nendobj\n"));
        currentOffset += imageBytes.length + stringBytes("\nendstream\nendobj\n").length;
      }
    });

    const xrefOffset = currentOffset;
    let xref = `xref\n0 ${objects.length + 1}\n`;
    xref += "0000000000 65535 f \n";
    for (let objectNumber = 1; objectNumber <= objects.length; objectNumber += 1) {
      xref += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    pdfParts.push(stringBytes(xref));
    pdfParts.push(stringBytes(trailer));

    return concatBytes(pdfParts);
  }

  function blobFromCanvas(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error(`${type} export returned an empty blob.`));
      }, type, quality);
    });
  }

  async function pdfBlobFromCanvas(canvas) {
    const imageBlob = await blobFromCanvas(canvas, "image/jpeg", 0.95);
    const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
    const pdfBytes = buildPdf(imageBytes, canvas.width, canvas.height);
    return new Blob([pdfBytes], { type: "application/pdf" });
  }

  async function downloadCanvasAsPdf(canvas, filename) {
    const blob = await pdfBlobFromCanvas(canvas);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.PdfExport = { downloadCanvasAsPdf, pdfBlobFromCanvas };
})(window);
