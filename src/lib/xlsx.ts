/** Tải workbook exceljs về máy (dùng chung cho các nút "Tải Excel") */
export async function saveWorkbook(wb: { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
