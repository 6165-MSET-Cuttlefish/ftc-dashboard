export default function downloadBlob(
  data: string,
  fileName: string,
  mime: string,
) {
  const a = document.createElement('a');
  a.style.display = 'none';
  document.body.appendChild(a);

  const blob = new Blob([data], { type: mime });
  const url = window.URL.createObjectURL(blob);

  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}
