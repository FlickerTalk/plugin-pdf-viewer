// What the viewer says, in the 21 languages of the app (Plan §84). Little: the counter has no
// words, and the rest are the way out and what went wrong.

const CATALOGUE = {
  en: { close: "Close", page: "Page", loading: "Opening…", broken: "This PDF can't be opened", locked: "This PDF is password protected" },
  es: { close: "Cerrar", page: "Página", loading: "Abriendo…", broken: "Este PDF no se puede abrir", locked: "Este PDF tiene contraseña" },
  fr: { close: "Fermer", page: "Page", loading: "Ouverture…", broken: "Ce PDF ne peut pas être ouvert", locked: "Ce PDF est protégé par un mot de passe" },
  de: { close: "Schließen", page: "Seite", loading: "Wird geöffnet…", broken: "Dieses PDF lässt sich nicht öffnen", locked: "Dieses PDF ist passwortgeschützt" },
  it: { close: "Chiudi", page: "Pagina", loading: "Apertura…", broken: "Questo PDF non si può aprire", locked: "Questo PDF è protetto da password" },
  pt: { close: "Fechar", page: "Página", loading: "A abrir…", broken: "Este PDF não se pode abrir", locked: "Este PDF tem palavra-passe" },
  ro: { close: "Închide", page: "Pagina", loading: "Se deschide…", broken: "Acest PDF nu poate fi deschis", locked: "Acest PDF este protejat cu parolă" },
  pl: { close: "Zamknij", page: "Strona", loading: "Otwieranie…", broken: "Nie można otworzyć tego PDF-a", locked: "Ten PDF jest chroniony hasłem" },
  ru: { close: "Закрыть", page: "Страница", loading: "Открытие…", broken: "Этот PDF не открывается", locked: "Этот PDF защищён паролем" },
  uk: { close: "Закрити", page: "Сторінка", loading: "Відкриття…", broken: "Цей PDF не відкривається", locked: "Цей PDF захищено паролем" },
  tr: { close: "Kapat", page: "Sayfa", loading: "Açılıyor…", broken: "Bu PDF açılamıyor", locked: "Bu PDF parola korumalı" },
  ar: { close: "إغلاق", page: "صفحة", loading: "جارٍ الفتح…", broken: "تعذّر فتح ملف PDF هذا", locked: "ملف PDF هذا محمي بكلمة مرور" },
  hi: { close: "बंद करें", page: "पृष्ठ", loading: "खुल रहा है…", broken: "यह PDF नहीं खुल सकता", locked: "यह PDF पासवर्ड से सुरक्षित है" },
  bn: { close: "বন্ধ", page: "পৃষ্ঠা", loading: "খোলা হচ্ছে…", broken: "এই PDF খোলা যাচ্ছে না", locked: "এই PDF পাসওয়ার্ড দিয়ে সুরক্ষিত" },
  id: { close: "Tutup", page: "Halaman", loading: "Membuka…", broken: "PDF ini tidak bisa dibuka", locked: "PDF ini dilindungi kata sandi" },
  vi: { close: "Đóng", page: "Trang", loading: "Đang mở…", broken: "Không mở được PDF này", locked: "PDF này được bảo vệ bằng mật khẩu" },
  th: { close: "ปิด", page: "หน้า", loading: "กำลังเปิด…", broken: "เปิด PDF นี้ไม่ได้", locked: "PDF นี้มีรหัสผ่านป้องกัน" },
  ja: { close: "閉じる", page: "ページ", loading: "開いています…", broken: "この PDF は開けません", locked: "この PDF はパスワードで保護されています" },
  ko: { close: "닫기", page: "페이지", loading: "여는 중…", broken: "이 PDF를 열 수 없습니다", locked: "이 PDF는 비밀번호로 보호되어 있습니다" },
  "zh-CN": { close: "关闭", page: "页", loading: "正在打开…", broken: "无法打开此 PDF", locked: "此 PDF 受密码保护" },
  "zh-TW": { close: "關閉", page: "頁", loading: "正在開啟…", broken: "無法開啟此 PDF", locked: "此 PDF 受密碼保護" },
};

export const LANGUAGES = Object.keys(CATALOGUE);

/** The catalogue for a language tag: exact, then its base (`pt-BR` → `pt`), then English. */
export function catalogueOf(lang) {
  const tag = String(lang ?? "en");
  return CATALOGUE[tag] ?? CATALOGUE[tag.split("-")[0]] ?? CATALOGUE.en;
}

/** A text in the language of the phone, or in English if the catalogue lacks it. */
export function t(lang, key) {
  return catalogueOf(lang)[key] ?? CATALOGUE.en[key] ?? key;
}
