import { CLIPBOARD_CHAR_LIMIT } from '../shared/constants';

export async function deliver(filename: string, parts: BlobPart[], mime: string): Promise<'clipboard' | 'file'> {
  const blob = new Blob(parts, { type: mime });
  if (blob.size <= CLIPBOARD_CHAR_LIMIT && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(await blob.text());
      return 'clipboard';
    } catch {
      downloadBlob(blob, filename);
      return 'file';
    }
  }
  downloadBlob(blob, filename);
  return 'file';
}

export async function copyText(text: string, filename: string): Promise<'clipboard' | 'file'> {
  return deliver(filename, [text], 'text/plain;charset=utf-8');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
