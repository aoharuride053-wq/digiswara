// SQLite menyimpan waktu dalam UTC dengan format "YYYY-MM-DD HH:MM:SS".
// Tambahkan 'Z' supaya JavaScript memperlakukannya sebagai UTC lalu
// menampilkannya dalam zona waktu lokal pengguna.
export const formatDateTime = (value) => {
  if (!value) return '-';

  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatDateOnly = (value) => {
  if (!value) return '-';

  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
};
