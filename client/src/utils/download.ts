/**
 * Download a file from a URL by creating a temporary anchor element
 * @param url - The URL to fetch the file from
 * @param filename - The filename to save as
 */
export async function downloadAsFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Download failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}
