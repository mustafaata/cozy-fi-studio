# Kontrol düzeltmeleri — 13 Ekim 2026

İlk [kontrol incelemesindeki](CONTROLLER_AUDIT.md) 17 bulgu için aşağıdaki değişiklikler uygulandı. İlk envanter ve hata kanıtı tarihsel kayıt olarak korundu; güncel ölçüm [CONTROLLER_FIX_EVIDENCE.json](CONTROLLER_FIX_EVIDENCE.json) dosyasındadır.

## Bulguların karşılığı

| No | Değişiklik ve sonucu |
| --- | --- |
| 1 | İşaretçinin pointer, çizim ve kayıt yolu aynı `timelineView.time/fraction` dönüşümünü kullanır. 1–2 sn görünümünün %75 konumu 1,75 sn kaydeder; sürükleme tek geri almadır. |
| 2 | Waveform yapışma hedefleri proje saatinden ilgili kaynak saatine çevrilir. Ana hız/kaynak girişi, yardımcı katman offset/phase/döngüsü hesaba katılır. Ana montajın çok parçalı kaynak dalgasında belirsiz proje hedefleri kullanılmaz. Tolerans gerçek 8 pikselden hesaplanır. |
| 3 | Kaynak giriş/çıkış/hız alanları ve hassas giriş paneli seçili video klibini düzenler. Kapsam başlıkta görünür. Kaynak bilgisi yoksa zaman alanları, şarkı hızına bağlıyken bağımsız hız alanı kapalıdır. Kilit, bağlı ses ve montaj sınırı mevcut doğrulama yolunda korunur. |
| 4 | Ortak sayı sürüklemesi `readOnly` ve `disabled` alanları dışlar; warp uç noktaları değişmez. |
| 5 | Slip, Slide, Rolling ve J/L taslak sayıları açık `data-scrub-event="input"` sözleşmesiyle canlı taslağı yeniler. Taslak işlemleri proje commit'iyle karıştırılmaz. |
| 6 | Sayısal sürükleme Escape, pointercancel, capture kaybı veya pencere odak kaybında ilk değere döner. Store gesture iptali geçmişi ve redo'yu korur. Pointer kimliği kontrol edilir. |
| 7 | Parametreye göre sürükleme adımları tanımlandı. `step=any` sürelerde 0,01 sn normal ve 0,001 sn Shift adımı kullanılabilir. Yerel tamsayı/kare adımı korunur; Alt on kat büyük adım sağlar. Seviye yüzdesinin normal adımı %1'dir. |
| 8 | Bas slider/sayı/rozet gerçek 0–15 dB kazancını gösterir. Ortak şema sınırı tarayıcı ve Python motorunda kullanılır. Kaydedilmiş projelerin 0–100 canonical değeri korunur. |
| 9 | Overlay sayı ve slider sınırları aynı şemadan, 5–300 aralığından gelir. Boş/geçersiz sayı son geçerli değere döner ve hata görünür. |
| 10 | Ortak range boyaması `(value-min)/(max-min)` kullanır; sonradan eklenen kontroller, store/clock yenilemeleri ve DOM eklemeleri birlikte ele alınır. Örneğin 0,1–4 aralığında 2 değeri %48,72 doluluktur. |
| 11 | M transport kısayolu SELECT ve önceden işlenmiş klavye olaylarını dışlar. Native seçenek araması monitörün sesini değiştirmez. |
| 12 | Hız/yankı/bas range'leri, overlay sayıları ve otomasyon zaman yakınlığı bağımsız erişilebilir adlar aldı. |
| 13 | Tekli VideoFX grupları radio, çoklu gruplar checkbox semantiği ve `aria-checked` kullanır. Görünür seçim işareti, ok/Home/End gezinmesi ve tekli grupta roving tabindex eklendi. Grup/return efekt checkbox'ı da katmanlardaki gibi “etkin” anlamını taşır. |
| 14 | İşaretçi hedefi 32 px'e büyütüldü. Klavyeyle kare/ince/büyük adım, ad ve zaman alanları, git/sil düğmeleri eklendi. Pointer capture, iptal ve odak korunur. İşaretçi yokken ek panel alan kaplamaz. |
| 15 | Kaynak waveform normal tekerleği panel kaydırmasına bırakır. Ctrl/⌘ + tekerlek kaynak yakınlaştırmasını açar; kullanım alanın başlığında belirtilir. |
| 16 | İlgisiz değişimde yeniden DOM kurma, aynı viewport bildirimi, kapalı canvas çizimleri ve waveform seçenek yenilemeleri azaltıldı. Preview çizimleri bir sonraki animasyon karesinde birleştirilir. Store doğrulaması korunur. |
| 17 | Ana şarkıya araç seçici eklendi; miks/akustik kontrolleri ileri araçların önüne taşındı. Kaynak, proje oynatma ve bütün kliplerin kadrajı açık başlıklarla ayrıldı. Düzen ilk HTML'de kurulur; yükleme sonrası panel taşıması yapılmaz. |

## Ortak davranış ve sınırlar

`control-inputs.js` değer adımını, range doluluğunu ve seçim semantiğini; `mouse.js` pointer gesture yaşam döngüsünü yönetir. Sayısal sürükleme mevcut editörün doğrulama olayını kullanır. Dokunmada örtük sayı sürüklemesi yerine native yazma/spinner ve panel kaydırması korunur. Yerel `step` tamsayı ise Shift kesirli kare veya kesirli sayaç üretmez.

Kaynak kesimini veya hızını değiştirmek bir klibin proje süresini de etkileyebilir. Komşu kliple geçersiz çakışma oluşturan değişiklik mevcut montaj doğrulamasıyla reddedilir ve alan yenilenir. Inspector araç seçici aynı editörleri açar; kayıt, comp, warp ve sekansın ayrı taslak/uygula akışları korunur. Bu değişiklik kapsam başlıkları ve gezinmeyi iyileştirir; uygulamanın bütün ileri araçlarını ayrı sayfalara taşımaz.

Performans sınırları eklenirken bulunan üç bağımlılık da giderildi: sekans açma kimliği klip render anahtarına dahil edildi; yeni ses katmanlarının montaj kontrolleri viewport olayına bağımlı olmadan kurulur; toplu klip seçimi keyframe ve Rolling handle klavye olaylarını yakalamaz.

## Doğrulama

- **246 JavaScript testi** geçti. Yeni sözleşmeler kaynak saatleri/döngü sınırları, seçili video kaynağı, kilitler, iptal/redo ve yerel taslağın gereksiz store bildirimi üretmemesini kapsar.
- **25 Python testi** geçti: 21 proje/ses regresyonu ve 4 proje sözleşmesi kontrolü. Bas gösterimi değişirken ses motoru ve kaydedilmiş değer uyumu korunur.
- **46 farklı tarayıcı senaryosu** geçti: 7 yeni kontrol senaryosu Waitress ve gerçek CSP ile; 39 mevcut çalışma alanı senaryosu uygulamanın WSGI test sunucusu ve CSP ile. İlk geniş koşuda kalan kare birimi testi, yeni kaynak kontrollerine uygun gerçek video yükleyerek güncellendi ve tekrar geçti. Yeni kaynak kapsamı ve araç gezinme kontrolleri de son değişikliklerden sonra tekrar geçti.
- Yeni testler gerçek fare/klavye sürüklemesi, Escape/pointercancel, readonly warp, Slip taslağı, nullable video çıkışı, seçili klip saati, M kısayolu, birimler/doluluk, overlay sınırı, seçim semantiği, kaynak snap toleransı, wheel davranışı ve gereksiz DOM/viewport yenilemesini kapsar. 320, 375, 768, 1024 ve 1440 px genişliklerde iki tema kontrol edildi.
- Üretim sunucusunda soğuk açılış ve yenileme ayrıca 150 ms gecikme, 256 KB/sn indirme ve kapalı cache ile sınandı; sonuçlar kanıt dosyasındadır. Fiziksel telefon, Safari/iOS, Firefox, ekran okuyucu konuşması ve ağ tüneli bu turda doğrulanmadı.

## Giriş maliyeti

Aynı dört ses/dört görsel katman, iki video, bir grup ve bir return örneğinde ana şarkı inspector'ı seçiliyken 15 slider `input` olayının **senkron işleme medyanı 58,7 ms'den 14,7 ms'ye** indi (yaklaşık %75 azalma). Son örneklerin aralığı 10,7–20,3 ms; tarayıcı hata kaydı boştu.

Bu ölçüm programatik gerçek `input` olayının senkron maliyetidir. Ertelenen preview çizimini ve GPU işini içermez; FPS veya her cihazda 16,7 ms altında kalma garantisi değildir. Görünür/ilgili editörler, proje doğrulaması ve ses güncellemesi çalışmaya devam eder.

## Ek kontrol geçişi

Hassas video panelinin kaynak süresi artık yalnızca seçili klibin medya bilgisinden alınır. Bu bilgi yokken başka bir videonun süresine düşülmez; sayı ve artır/azalt düğmeleri kapalıdır. Sınırlar parametre şemasından veya seçili kaynak kesiminden, gösterilen birime çevrilerek hesaplanır. Sınırdaki düğme kapanır; büyük adım sınırda durur. Boş/geçersiz değer hata mesajıyla son kayıtlı değere döner. Geri alma veya hedef değişimi sırasında odakta kalan eski değer de yenilenir; oynatma sırasında yazılan taslak korunur.

İşaretçi silme odağı görünür sıradaki işaretçiye taşır. Sıradaki işaretçi görünüm dışındaysa seçim editörü açılır; sonuncu silinince odak İşaretçi ekle düğmesine döner. Silme sonucu, gizlenen editörün dışında kalan ortak canlı durum alanında duyurulur.

Bu geçişte **11 tarayıcı testi** geçti: genişletilen kontrol modülünün 9 senaryosu Waitress/CSP ile ve mevcut keyframe/hassas giriş ile canvas transform senaryoları WSGI/CSP ile. İki yeni regresyon testi düzeltme öncesinde düğme durumu ve silme odağı hatalarıyla başarısız oldu, düzeltmeden sonra geçti. Önceki JavaScript/Python sonuçları yukarıdaki ilk geçişe aittir; bu geçiş veri modeli veya ses motorunu değiştirmez.

## Birim alanları — 14 Ekim 2026

Kare alanları artık bağlı oldukları saniye alanının kararlı kimliğini taşır. Söz satırı düzenleme sırasında yeniden kurulduğunda ortak sayı sürüklemesi yeni kare alanını bulur; düzenleme yarıda iptal olmaz. Salt okunur/devre dışı durum asıl alandan devralınır. FPS veya kayıtlı saniye değeri değişirse odaktaki kare alanı da yenilenir. Geçersiz kare girişinde açıklama görünür ve asıl değere dönülür; düzenleme asıl alanın tanımlı doğrulama olayına gönderilir.

Söz satırı onarımı artık zamanı milisaniyeye yuvarlamaz. Örneğin 24 fps'de 22. kare proje içinde tam `22/24` saniye kalır. LRC/SRT çıktısı kendi zaman biçiminde milisaniyeye yuvarlamaya devam eder. Kare gösterimi tam kareye yuvarlar; birimi görüntülemek kayıtlı saniyeyi değiştirmez.

dB alanının üst sınırı yüzde kontrolünden hesaplanır; salt okunur/devre dışı durum ve geçersiz değer mesajı eşlenir. Önceki −120 dB alt sınırı kaldırıldı; sıfırdan büyük, çok düşük geçerli seviyeler de gösterilebilir. Boş dB girişi sessizliktir. Bu boş alandan sürükleme **−120 dB** başlangıcını kullanır; bu bir değer sınırı değildir. Düzeltme öncesi 30 px sürükleme sessizlikten **%112,2** seviyesine sıçrıyordu; yeni regresyon aynı hareketin **%0,001 altında** kaldığını ve Escape'in sessizliğe döndüğünü doğrular. Davranış alanın açıklamasında belirtilir.

Bu geçişte **247 JavaScript**, **14 Python söz/çıktı testi** ve **17 tarayıcı senaryosu** geçti. Tarayıcı kontrollerinin 12'si Waitress/gerçek CSP, beşi mevcut WSGI/CSP test sunucusuyla çalıştı. Yeni üç senaryo yeniden kurulan satırda sürükleme/iptal/tek geri alma, readonly ve odakta FPS yenilemesi, görünür kare/dB doğrulaması, sessizlikten güvenli sürükleme ve −140 dB gösterimini kapsar. İlk denemeler sürükleme iptali, readonly eksikliği ve ani ses sıçramasını yeniden üretti; takip testi milisaniye yuvarlama kaybını da yakaladı. Önceki performans/soğuk yükleme ölçümleri ayrı geçişin kayıtlarıdır.

## Kısa kesitler ve birim sınırları — 14 Ekim 2026

Tam kare gösterimi artık geçerli tam kare aralığına uyar. Örneğin 24 fps'de en az 0,05 sn gerektiren çıkış, 1 kare gösterip kendisini geçersiz hale getirmez; en yakın geçerli 2 kareyi yaklaşık olarak gösterir. Gerçek 0,05 sn proje değeri korunur. Yaklaşık gösterim erişilebilir adda ve açıklamada belirtilir. Kesit aralığında hiçbir tam kare yoksa kare alanı kapanır ve “sn kullanın” gösterir; birim seçici açık kalır. Bu durum odaktaki alanı kapatırsa odak birim seçiciye geçer. Kaynak seçimi yenilemesi açık olay bağıyla izlenir.

Hassas panelin ondalık gösterimi de yuvarlama sırasında kendi alt/üst sınırının dışına çıkmaz. Normal değerlerde kısa ondalık gösterim, sınırda gerektiğinde özgün hassasiyet kullanılır. Ortak saf gösterim yardımcıları boş aralıkları, negatif değerleri ve kesirli sınırları test eder; kayıtlı proje zamanı değiştirilmez.

Negatif piksel ekseni ayrıca sınandı: cover kadrajında aşağı/yukarı boşluk negatif olsa da sayısal sınırlar doğru sıralanır; artırma görüntüyü tam 1 piksel taşır. Piksel/yüzde geçişi kayıtlı konumu korur. Piksel karşılığı sıfırsa alan kapalıdır. Beş genişlik ve iki temada yatay sayfa taşması görülmedi.

Bu geçişte **249 JavaScript testi** ve **20 tarayıcı senaryosu** geçti: 15 kontrol senaryosu Waitress/gerçek CSP, beş mevcut birim/keyframe/söz/otomasyon senaryosu WSGI/CSP ile. İlk iki yeni senaryo düzeltme öncesinde geçerli sürenin native doğrulamada geçersiz görünmesini yakaladı; takip denemesi kapanan kare alanından odak devrini doğruladı. Önceki Python, performans ve soğuk yükleme sonuçları kendi geçişlerinin kayıtlarıdır.
