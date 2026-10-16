# Kontrol yüzeyleri incelemesi — 13 Ekim 2026

> Bu belge ilk incelemenin kaydıdır. Ardından uygulanan düzeltmeler ve güncel doğrulama sonuçları [CONTROLLER_FIXES.md](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/docs/CONTROLLER_FIXES.md) dosyasındadır. Envanter ve ilk ölçümler değişiklik öncesi durumu gösterir.

İşlev sayısı artmış; kontrol davranışlarının ortak standardı aynı hızda gelişmemiş. En ciddi eksik estetik değil: bazı kontroller yanlış zamanı kaydediyor, bazıları değiştirdikleri değeri kullanmıyor, bazıları da ekranda gösterdikleri değerden farklı bir işlem uyguluyor. Hassas düzenleme beklentisini karşılayan tutarlı bir etkileşim modeli henüz yok.

Bu çalışma inceleme talebidir. Uygulama kodu değiştirilmedi. Bulgular aşağıdaki dosyalara ve yeniden üretim kayıtlarına bağlandı.

## Kapsam ve kanıtın sınırı

- Kaynak kodu, parametre şeması, store bildirimleri, kaynak/proje zamanı dönüşümleri ve kontrol olayları birlikte incelendi.
- Chromium üzerinde gerçek uygulama, Waitress ve uygulamanın CSP başlığıyla çalıştırıldı. Dört ses kanalı, iki video klibi, dört görsel katman, bir grup ve bir return kullanılan örnekte **1.917 DOM kontrolü/yüzeyi** kaydedildi: 124 range, 147 checkbox, 5 radio, 567 number, 201 select, 746 button, 67 canvas. Diğer input ve textarea türleri de envanterde bulunur. Bunların tamamı aynı anda görünür değildir.
- 124 slider'ın 107'sine ayrı pointer/input/change dizisi uygulandı. 17'si örnekte ön koşulları sağlanmadığı için devre dışıydı. İlk tarama kapalı panelleri de programatik olarak tetikler; bu, her slider'ın elle sürüklendiği anlamına gelmez.
- Checkbox/radio ikinci geçişinde 152 öğenin 117'si tetiklendi; 27 devre dışı ve 8 gizli öğe atlandı. Yeniden oluşturulan DOM öğeleri her adımda yeniden bulundu. Yerel seçim, taslak, metronom veya görünüm tercihinin proje state'ini değiştirmemesi hata olarak değerlendirilmedi.
- İlk sentetik taramada taslağı bulunmayan, gizli warp alanları zorla tetiklenince altı JavaScript hatası oluştu. Kullanıcı o durumdaki alanlara ulaşamadığı için bunlar kullanıcıya açık ürün hatası listesine alınmadı. Ayrı, geçerli kullanıcı senaryolarındaki hata kayıtları boştu.
- İşaretçi, sayısal alan, select kısayolu, salt okunur warp noktası ve Slip sorunları ayrıca görünür alanlarda sınandı. Bazı zaman/snap/doluluk kontrolleri gerçek kontrol olayına programatik giriş verilerek doğrulandı; bu ayrım kanıt JSON'unda görülebilir.
- 320, 375, 768, 1024 ve 1440 px genişlikler kontrol edildi. Bu örnekte sayfa düzeyinde yatay taşma görülmedi. Telefon donanımı, iOS Safari, Firefox, ağ tüneli, ekran okuyucu konuşma çıktısı ve her olası özellik kombinasyonu doğrulanmadı. Bütün düğmelerin bütün durumlarının elle sınandığı iddia edilmiyor.

Tam öğe listesi: [CONTROLLER_INVENTORY.csv](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/docs/CONTROLLER_INVENTORY.csv). Yeniden üretim değerleri: [CONTROLLER_AUDIT_EVIDENCE.json](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/docs/CONTROLLER_AUDIT_EVIDENCE.json).

Ek olarak sekiz mevcut Playwright arayüz testi çalıştırıldı ve geçti (38,423 sn): otomasyon kalem/snap/zoom/undo, ek kanal otomasyonu, Slide sınır/iptal/kilit, Rolling handle/klavye/touch, LUT import/yoğunluk/karşılaştırma, görsel katman chroma, Warp hassasiyet/iptal/kilit ve vektör serbest çizim/iptal. Bunlar koşullu editörlerdeki mevcut akışlara ek kanıt sağlar; aşağıdaki yeni yeniden üretimleri kapsamadıkları için geçmeleri bulguları geçersiz kılmaz. Buradaki touch testi tarayıcı olayıdır, fiziksel telefon testi değildir.

P1: düzenlemenin doğruluğunu etkileyen, önce düzeltilmesi gereken sorun. P2: işlev, kontrol hissi, erişilebilirlik veya anlaşılabilirlik sorunu. Tasarım değerlendirmeleri ayrıca belirtilmiştir.

## Bulgular

### 1. P1 — İşaretçi sürükleme zoom/pan ile yanlış zamanı kaydediyor

**Tarayıcıda doğrulandı.** Proje 3 sn, görünür aralık 1–2 sn iken timeline'ın %75 konumuna sürüklenen işaretçi 1,75 sn yerine **2,25 sn** kaydedildi. Sürükleme sırasında hesaplanan zaman görünüm dönüşümünü kullanıyor, çizilen konum tam proje süresine bölünüyor; bırakma ise görünümü tamamen yok sayıyor. Böylece sürükleme önizlemesi ile kaydedilen değer de aynı koordinat sisteminde değil.

Kaynak: [markers.js:94](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:94), [markers.js:102](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:102).

Öneri: hesaplama, çizim ve commit aynı `timelineView.time/fraction` dönüşümünü kullanmalı. Fareyi bırakınca marker başka bir zamana sıçramamalı.

### 2. P1 — Waveform snapping kaynak saniyesiyle proje saniyesini karıştırıyor

**Kontrol olayıyla doğrulandı.** Ana kaynak girişi 0,5 sn, hız 1,5× ve proje işaretçisi 1 sn olduğunda hedef kaynak zamanı 2 sn olmalı. Kenar 2,02 sn'ye getirildiğinde doğru işaretçiye yapışmayıp 2,02 sn olarak kaldı. Snap noktaları proje zamanında, WaveSurfer region sınırları kaynak zamanında karşılaştırılıyor.

Ayrıca yüksek zoom'da minimum tolerans 50 ms kalıyor. 1.000 px/sn zoom'da, işaretçiden **40 px** uzaktaki 2,04 sn sınırı 2 sn'ye yapıştı. Kodun "8px" açıklamasına karşın gerçek yarıçap 50 px oluyor. Bu, ince ayarı zorlaştıran doğrudan bir kontrol tasarımı hatası.

Kaynak: [audio.js:235](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/audio.js:235), [markers.js:135](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:135).

Öneri: snap hedeflerini düzenlenen waveform'un kaynak saatine dönüştürmek; ekran pikseli toleransını süre doğrulamasındaki minimum klip uzunluğundan ayırmak.

### 3. P1 — Video giriş/çıkış/hız kontrolleri montaj modunda etkisiz kalıyor

**Kontrol olayıyla doğrulandı.** İki video klibi bulunan projede genel Görüntü panelindeki giriş 0,4 sn ve hız 1,75× olarak kaydediliyor. Kontroller etkin görünüyor; buna rağmen klip süreleri, oynatma hızı ve kaynak zaman eşlemesi değişmiyor. Montaj `videoClips` alanlarını okurken bu panel `project.video` alanlarına yazıyor. Aynı kaynak girişi/çıkışı seçeneği Hassas değer girişi bölümünde de var.

Kaynak: [video-controls.js:45](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/video-controls.js:45), [scene-renderer.js:3](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/scene-renderer.js:3), [precision-controls.js:40](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/precision-controls.js:40).

Öneri: kaynak zamanı ve hız düzenlemesini seçili klibe yönlendirmek veya bu modda etkisiz genel alanları açıklamasıyla kaldırmak. Genel kadraj gibi çalışan ayarlar bu bulgudan ayrı.

### 4. P2 — Salt okunur warp uç noktaları sürüklenerek değiştirilebiliyor

**Gerçek fareyle doğrulandı.** Warp'ın ilk kaynak noktası `readOnly=true` olmasına rağmen 0'dan **0,1 sn**'ye sürüklendi. Taslak daha sonra "Warp başlangıç/bitiş işaretleri kesitin uçlarını göstermeli" hatasına düştü. Yazmayı engelleyen alan, ortak sayısal sürükleyici tarafından değiştiriliyor.

Kaynak: [mouse.js:25](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/mouse.js:25), [audio-warp-editor.js:17](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/audio-warp-editor.js:17).

Öneri: ortak gesture katmanı `disabled` yanında `readOnly` kontrolü de yapmalı; kaynak uçları hiçbir giriş yöntemiyle taslak işaretçisi üzerinden değiştirilememeli.

### 5. P2 — Sayısal sürükleme bazı video editörlerinde yalnızca yazıyı değiştiriyor

**Slip alanında gerçek fareyle doğrulandı.** Kaynak kaydırma alanı sürükleme sırasında **0,1** gösterirken Slip taslağı **0** kaldı. Fare bırakılınca alan tekrar 0 oldu. Ortak scrubber yalnızca `change` gönderiyor; Slip, Slide, Rolling ve J/L sayısal taslakları `input` dinliyor. Slip'te yeniden üretildi; diğer üçünde aynı uyumsuzluk kaynak kodundan görüldü.

Kaynak: [mouse.js:39](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/mouse.js:39), [video-slip-editor.js:27](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/video-slip-editor.js:27), [video-slide-editor.js:17](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/video-slide-editor.js:17), [rolling-editor.js:34](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/rolling-editor.js:34), [split-cut-editor.js:28](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/split-cut-editor.js:28).

Öneri: sayısal sürükleyiciyi açık bir preview/commit sözleşmesiyle bağlamak. İki DOM olayını körlemesine göndermek çift uygulama riski yaratır; alanın düzenleme modeli tanımlanmalı.

### 6. P2 — Escape ve pointercancel sayısal sürüklemeyi iptal etmiyor

**Escape gerçek klavyeyle; pointercancel olayla doğrulandı.** Seviye 100'den 100,5'e sürüklendiğinde Escape sonrasında da 100,5 kaldı. Pointercancel da değişikliği commit etti. Buna karşılık birçok yeni canvas editörü özel taslağı iptal ediyor. Kullanıcı aynı iptal hareketinin anlamını editöre göre yeniden öğrenmek zorunda kalıyor.

Kaynak: [mouse.js:41](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/mouse.js:41), karşılaştırma için [layer-effects-editor.js:142](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/layer-effects-editor.js:142).

Öneri: başlangıç değerini, pointer kimliğini, preview'ü, commit'i ve cancel'ı tek gesture modeliyle yönetmek. Escape bütün sayısal ve grafik kontrollerde başlangıca dönmeli.

### 7. P2 — "Shift ince" ortak sayısal kontrolü yeterince hassas yapmıyor

**Kaynak kodu bulgusu.** `max >= 60` olan sayı alanlarında minimum sürükleme adımı 0,05; Shift yalnızca hareketin kaç pikselde bir adım sayılacağını değiştiriyor. Değerin en küçük adımını küçültmüyor. Örneğin uzun süre aralığı olan `step=any` zaman alanında fareyle en küçük değişim 50 ms olabilir; 24 fps'de bir kareden büyük. Birimi Hz, yüzde veya saniye olan farklı alanlar aynı `max` sezgisine bağlı.

Kaynak: [mouse.js:33](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/mouse.js:33), [precision-controls.js:4](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/precision-controls.js:4).

Öneri: parametre bazında temel/ince/büyük adım, birim ve yuvarlama politikası tanımlamak; kare alanında kare, dB alanında dB, süre alanında açık hassasiyet kullanmak. Elle ondalık yazılabiliyor olması sürükleme problemini çözmüyor.

### 8. P2 — Bas kontrolündeki dB değeri gerçeği göstermiyor

**UI ve işlem koduyla doğrulandı.** Slider 100 iken rozet **+100 dB**, gerçek lowshelf artışı **+15 dB**. 20 değeri de 20 dB değil 3 dB. Hem tarayıcı ses motoru hem Python render aynı 0,15 katsayısını uyguluyor; yanlış olan UI birimi.

Kaynak: [main.js:75](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/main.js:75), [audio.js:1093](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/audio.js:1093), [engine.py:119](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/engine.py:119).

Öneri: kontrolü gerçek 0–15 dB aralığında sunmak veya etiketi açıkça yüzde/kuvvet olarak değiştirmek. Hassas ses kontrolünde yanlış birim kabul edilemez.

### 9. P2 — Overlay ölçeğinde slider, sayı ve state farklı sınırları kabul ediyor

**Kontrol olayıyla doğrulandı.** Sayısal girişe 300 yazıldığında state ve sayı **300**, slider **250** oluyor. HTML 10–250 sınırı tanımlarken handler 5–300 kabul ediyor; `validity` kontrolü yapmıyor. Boş alanın `Number('')` ile sıfıra dönüşüp clamp edilmesi de ayrı bir ani değişim riski.

Kaynak: [index.html:231](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/templates/index.html:231), [overlay.js:114](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/overlay.js:114), [overlay.js:139](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/overlay.js:139).

Öneri: sınır ve varsayılanı şemadan almak; sayı ve slider aynı domain'i paylaşmalı. Geçersiz/boş girişte açıklama ve son geçerli değere dönüş olmalı.

### 10. P2 — Dinamik slider dolulukları gerçek değeri yansıtmıyor

**Tarayıcıda doğrulandı.** Yakınlık slider'ı 0,1–4 aralığında 2 değerindeyken doluluk **%0** kaldı; beklenen yaklaşık **%48,72**. Başlangıçta bulunan range'lere bağlanan boyama, sonradan kurulan video/VFX/bas kontrollerinde ortak şekilde kullanılmıyor. Bazı programatik refresh yollarında da knob ve doluluk farklı kalabiliyor.

Kaynak: [style.css:67](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/css/style.css:67), [main.js:80](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/main.js:80), [video-controls.js:33](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/video-controls.js:33), [bass-controls.js:50](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/bass-controls.js:50).

Öneri: normalize doluluk hesabı `(value-min)/(max-min)` ortak kontrolün render işinin parçası olmalı. Firefox'un native progress çizmesi Chromium/Safari yolunu doğrulamış sayılmaz. Bipolar pan/pozisyon kontrollerinde sıfır merkezinden doluluk tasarımı ayrıca değerlendirilmeli.

### 11. P2 — Select içindeki M tuşu monitörü sessize alıyor

**Gerçek klavyeyle doğrulandı.** Yerleşim select'i odaktayken M'ye basınca `audioEngine.isMuted` false'tan true'ya geçti. Global kısayol INPUT ve TEXTAREA'yı dışlıyor; SELECT'i dışlamıyor. Native seçenek aramasıyla transport komutu çakışıyor.

Kaynak: [main.js:277](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/main.js:277).

Öneri: form alanı, dialog ve aktif editör bağlamı için tek kısayol filtresi; `defaultPrevented` ve SELECT dahil edilmeli.

### 12. P2 — Bazı kontrol etiketleri görünür ama erişilebilir adları bağlı değil

**DOM ve kaynak koduyla doğrulandı.** Hız/yankı/bas range'lerinde caption bir span; slider ile label ilişkisi yok. Overlay'in dört sayısal girişi, aynı label içindeki ikinci kontrol oldukları için ayrı ad almıyor. Dört otomasyon zaman-zoom alanında ise label önceki `output` öğesine bağlanıyor; range'in `labels` listesi boş.

Kaynak: [index.html:117](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/templates/index.html:117), [index.html:220](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/templates/index.html:220), [automation-tools.js:10](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/automation-tools.js:10).

Öneri: her bağımsız girişin açık `for/id` veya `aria-labelledby` ilişkisi olmalı. Sadece görünür caption olması yeterli değil. Başlığı (`title`) bulunan renk picker'ları bu bulgudaki adsız kontrol sayısına dahil edilmedi.

### 13. P2 — Checkbox gibi çalışan VideoFX seçimleri durumlarını sadece renkle iletiyor

**Tarayıcıda doğrulandı.** Zoom bas efekti seçildiğinde düğme `preset-active` alıyor; `aria-pressed`, `aria-checked` ve seçim rolü bulunmuyor. Aynı grup çoklu seçim, atmosfer/frekans/tema gibi komşu gruplar tekli seçim; hepsi benzer düğme diliyle sunuluyor. Kullanıcı hangisinde birden çok öğe açılabildiğini anlamak zorunda.

Kaynak: [video-controls.js:672](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/video-controls.js:672), diğer seçim refresh'leri aynı dosyada 661–709.

Öneri: çoklu seçimde checkbox/toggle, tekli seçimde radio/segmented control semantiği; durum yalnızca renk değil işaret ve erişilebilir state ile verilmeli. Native checkbox'lardaki 117 tetikleme, bu özel düğmelerin doğru semantiğe sahip olduğunu kanıtlamaz.

### 14. P2 — Marker kontrolünün hedefi ve alternatifleri yetersiz

**DOM/kod bulgusu; ergonomi değerlendirmesi.** Marker 2 px çizgi ve 10 px pin; `tabIndex=-1`. Zaman değiştirme sürükleme, adlandırma çift tıklama/prompt, silme contextmenu. Klavyeyle erişilebilir marker listesi veya zaman alanı burada yok. Touch için ayrı düzenleme/silme yolu sunulmuyor. Pointer kimliği/capture/cancel işlemleri de diğer yeni timeline kontrollerindeki kadar tanımlı değil.

Kaynak: [markers.js:56](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:56), [markers.js:71](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:71), [markers.js:109](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/markers.js:109).

Öneri: görünür pini büyütmeden hit-area büyütülebilir. Seçili marker için ad/zaman/sil alanı ve ok tuşu hareketi eklenmeli; sağ tık tek silme yolu olmamalı.

### 15. P2 — Waveform normal tekerlek kaydırmasını ele geçiriyor

**Wheel olayıyla doğrulandı.** Waveform üzerindeki normal dikey wheel `preventDefault()` ile durdurulup 91,99'dan 99,99 px/sn zoom'a dönüştürüldü. Uzun inspector'ı aşağı kaydırırken pointer waveform'un üstünden geçtiğinde kullanıcı bağlam değiştirmeden zoom yapmış oluyor. Trackpad yatay hareketi ayrı ele alınıyor; dikey scroll yine zoom'a ayrılmış.

Kaynak: [audio.js:590](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/audio.js:590).

Öneri: normal wheel scroll; açık modifier + wheel zoom. Kaynak waveform zoom'u ile proje timeline zoom'u farklı işlevlerse etiketlerinde bu ayrım belirgin olmalı.

### 16. P2 — Slider güncellemesi gereksiz geniş UI işini tetikliyor

**Ölçüldü.** Dört ses/dört görsel katmanlı örnekte ana seviye slider'ının 15 `input` olayının senkron işlem süresi **49,5–71,6 ms**, medyan **58,7 ms**. Bu ortamda 60 Hz için yaklaşık 16,7 ms kare aralığından belirgin biçimde uzun. Ölçüm donanımdan bağımsız evrensel bir hız garantisi veya FPS ölçümü değildir; fakat doğrudan giriş işleme maliyeti olarak yüksek.

Store her input'ta projeyi kopyalayıp doğruluyor ve bütün `change` dinleyicilerini çağırıyor. Routing gibi ilgisiz/kapalı paneller de DOM'u yeniden kuruyor. Ölçüm bu zincirin toplamını gösterir; tek bir modülün payı ayrıca CPU profiliyle ölçülmelidir.

Kaynak: [project.js:539](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/project.js:539), [audio-routing-editor.js:71](C:/Users/Fatma/Desktop/file/projects/ambientmusic/web/static/js/audio-routing-editor.js:71).

Öneri: düzenlenen parametreye bağlı preview yolu; değişen alanları izleyen subscriber'lar; kapalı panel render'ını erteleme. Store doğrulamasını kaldırmak doğru çözüm değil. Gesture sonunda tek doğrulanmış commit, canlı preview sırasında sınırlı iş hedeflenmeli.

### 17. P2 — Inspector düzeni özellik eklemeyi kullanım akışının önüne koyuyor

**Tasarım değerlendirmesi.** Örnek DOM'da Görüntü inspector'ına 575, Ana şarkı inspector'ına 390 kontrol/yüzey bağlı; sayılar kapalı ve alternatif alanları da içeriyor. 159 details/fieldset grubu var; bu 159 açık panel anlamına gelmez. 320 px sol sidebar'da yükleme, temel mix, montaj, kayıt, comp, spektral işlem, warp ve sequence aynı gezinme alanına birikiyor. Katlanabilir yapmak bulunabilirliği tek başına çözmüyor.

Genel video, seçili klip ve seçili sahne katmanı kontrollerinin hedefleri tutarlı biçimde başlıklandırılmıyor. Aynı "Giriş", "Hız", "Yatay" gibi ifadeler farklı kapsamları temsil edebiliyor. Genel Yatay/Dikey ile Tuval yatay/dikey kontrolleri de farklı koordinat anlamlarını sezdiriyor ama sonucu öngörmeyi zorlaştırıyor.

Öneri: hedefi üstte sabitlemek — Proje / Klip adı / Katman adı; ana görünümü temel kontrollere ayırmak; ses kayıt/işleme araçlarını ayrı çalışma bağlamında açmak; zamanı kaynak/proje/yerel olarak açık adlandırmak. Yeni bir kontrol eklemeden önce hangi nesneyi düzenlediği ve mevcut kontrolle çakışıp çakışmadığı net olmalı.

## Kontrol aileleri ve inceleme matrisi

Envanter tek tek öğeleri içerir. Aşağıdaki tablo aile bazında kapsama açıklığı sağlar; "olay taraması" üretimdeki bütün kombinasyonların ve ses/görüntü çıktısının doğrulandığı anlamına gelmez.

| Kontrol ailesi | İnceleme | Sonuç / açık nokta |
|---|---|---|
| Ana/yağmur/şömine/ek ses seviye ve ducking | Olay taraması, gerçek numeric drag, dB dönüşüm kodu | Ortak iptal/hassasiyet ve latency sorunları; range gesture'larında çoklu undo görülmedi |
| Hız, reverb, bas, tone radio | Olay taraması, kaynak/işlem eşlemesi | Bas birimi yanlış; üç range etiketsiz; radio modunda bass range ve sayı disabled davranışı eşit değil |
| Kaynak waveform trim/seek/zoom | WaveSurfer olayları, source/project örnekleri | Yanlış clock snapping, yüksek zoom toleransı, wheel ele geçirme |
| Proje timeline zoom/pan/timecode/frame step | Olay taraması, viewport dönüşümü | Marker dönüşümü bozuk; diğer timeline canvas'larının aynı hataya sahip olduğu varsayılmadı |
| Marker | Gerçek DOM pointer akışı, keyboard semantiği | Yanlış kayıt zamanı, küçük hedef, klavye/touch alternatifleri eksik |
| Ana montaj, klip seçim, clipboard, ripple | Kontrol envanteri, olay bağları ve yerel seçim state'i | Ortak kaynak/proje zamanı adlandırması ve yoğunluk değerlendirmesine dahil |
| Ritim/BPM/snap seçenekleri | Envanter, sayı/checkbox bağları | Ses waveform snap politikasından farklı seçenekler; bu fark görünür kılınmalı |
| Parametre otomasyonu ve nokta listesi | Range/checkbox taraması, araç/eksen kodu | Grafik + sayısal alternatif var; zaman zoom label'ı bozuk; canvas davranışları ortak numeric katmanla tutarsız |
| Touch/latch otomasyon kaydı | Ön koşul ve lifecycle kodu | Read modunda fader disabled doğru; dört fader'ın tüm canlı kayıt kombinasyonları bu genel taramada çalıştırılmadı |
| EQ/katman efektleri/dynamics/sidechain | Olay taraması, pointer/key/cancel ve lock kodu | Yeni EQ canvas'ında cancel/numeric alternatifleri var; global numeric cancel bu davranışı bozuyor |
| Grup/return/gönderimler/bus otomasyonu | İki bus türüyle checkbox taraması, refresh kodu | Her değişimde panel DOM'unu yeniden kurma maliyeti; bypass checkbox dili katman efektlerinin 'etkin' diliyle ters |
| Mikrofon/punch/metronom | Envanter ve yerel durum/izin bağları | Gerçek mikrofon donanımı ve izin reddi bu taramanın dışında |
| Comp/take/spektral işlem | Envanter, taslak ve checkbox state ayrımı | Taslak alanlar proje commit'iyle karıştırılmadı; tam DSP çıktısı yeniden analiz edilmedi |
| Warp | Uç marker gerçek fare, taslak/canvas kodu | readOnly ihlali yeniden üretildi |
| Sequence/örnek instance | Seçim checkbox'ları, kaynak/proje kapsamı | Yoğunluk ve nested bağlam adlandırması değerlendirmesine dahil |
| Video montage/trim/hız | Olay taraması, renderer clock karşılaştırması | Genel zaman alanları montajda etkisiz |
| Geçiş süresi/yön/yumuşaklık | Range taraması, komşu klip doğrulama kodu | Klip alanlarına bağlı; sayısal fine-step ve doluluk standardı gerekli |
| Slip/Slide/Rolling | Kaynak ve taslak olay bağları, Slip gerçek fare | Ortak numeric scrubber ile input/change uyumsuzluğu |
| Video sesi/J/L cuts | Kontrol ve taslak olay bağları, range taraması | J/L sayı alanlarında aynı olay uyumsuzluğu kaynak kodunda mevcut |
| Time-remap/reverse/freeze | Kontrol envanteri, checkbox state ve kaynak saat modeli | Genel hız ile seçili klip hızı ayrımı kullanıcının önünde açık değil |
| Video transform/crop/mirror/precision | Range/checkbox taraması, birim dönüşümleri | Bazı aktif alanlar yanlış kapsamı düzenliyor; doluluk ve numeric model birleştirilmeli |
| Keyframe ve easing/curve segment | Envanter, point/time alanları | İşaretçiyle aynı kontrol davranışı varsayılmadı; zaman kapsamı etiketleri tutarlı olmalı |
| Video/görsel maskeleri | Envanter, numeric ve canvas cancel alternatifleri | Canvas'ta yerel preview/cancel modeli var; tüm polygon/alpha durumları bu turda elle çizilmedi |
| Görsel katman/overlay | Dört tip ile envanter, checkbox taraması, overlay sınır testi | Eski overlay ayrı ve daha zayıf bir kontrol sistemi; 300/250 ayrışması |
| Title/vektör/particle | Seçim ve style kontrol envanteri, yerel editör bağları | Gelişmiş özelliklere erişim yoğun; tip değişimindeki tüm dinamik alanlar başlangıç envanterinde görünmez |
| Motion path/tracking/perspective/reframe | Envanter, point/handle/numeric giriş modelleri | Yerel canvas preview modeli ortaklaştırılmalı; gerçek izleme analizi bu genel turda tekrar çalıştırılmadı |
| Klip rengi/curve/önce-sonra | Range/checkbox taraması, draft/commit kodu | Yeni draft modeli görece tutarlı; global VFX/genel renk/klip rengi kapsamları açıklaştırılmalı |
| Chroma/LUT/scopes | Envanter, etkinlik koşulu, range/checkbox bağları | Başlangıçta medyasız görsel chroma ve tablosuz LUT aralıkları disabled; ayrı koşullu testler ek kanıt sağlar |
| VideoFX/bas reaktif/görselleştirici | Range/checkbox taraması, gerçek seçim state'i | Eksik seçim semantiği, farklı tekli/çoklu seçim dili, doluluk sorunu |
| Şarkı sözleri/kelime zamanları/toplu düzenleme | Range/checkbox ve zaman alanı envanteri | İnce/büyük klavye adımları editöre göre farklı; ortak shortcut sözleşmesi gerekli |
| Altyazı dil/format/stil | Kontrol ve taslak durum envanteri | Taslak/uygula akışı korunmalı; bütün format kombinasyonları bu turda tekrar import edilmedi |
| Preview quality/transport/monitor | DOM/shortcut ve viewport testleri | SELECT içinde M çakışması; 375 px'de transport 119 px yüksek ve çalışma alanını daraltıyor |
| Media import/library/packages/export/sections | Input/button/checkbox ve hata-state bağları | Bu inceleme download/encode uçtan uca yeniden doğrulama turu değil |
| LUFS ölçüm/hedef/dinleme | Sayısal hedefler, draft ve canlı meter kodu | Birimler açık; normalizasyon taslağı ve ana transport ayrımı mevcut; uzun ses ölçümü tekrar koşulmadı |

## Önerilen düzeltme sırası ve kabul koşulları

1. Marker ve waveform saat dönüşümleri; her zoom/pan/hız/offset kombinasyonunda pointer hedefi ile kaydedilen zaman aynı olmalı.
2. Video kontrollerinin hedef kapsamı; etkin görünen her alan görüntü/ses sonucunda gözlenebilir etki üretmeli.
3. Ortak sayısal kontrol sözleşmesi; readonly korunmalı, preview çalışmalı, Escape/cancel geri dönmeli, pointer kimliği ve parametre hassasiyeti açık olmalı.
4. Birimler ve sınırlar; UI, slider, sayı, state ve renderer aynı değeri/domain'i ifade etmeli.
5. Seçim/label semantiği ve marker alternatifleri; bütün işlemler klavye ve dokunma ile erişilebilir olmalı.
6. Giriş maliyeti ve inspector düzeni; aynı örnekte slider senkron maliyeti yeniden ölçülmeli, ilgisiz kapalı editörlerin yeniden kurulması azaltılmalı.

Erişilebilir adlar, etkileşim alternatifleri ve odak davranışı değerlendirmesinde [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) referans alındı. Asıl bulgu kanıtı bu projenin kodu ve yukarıdaki yeniden üretim senaryolarıdır.
