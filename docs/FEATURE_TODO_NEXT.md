# Yeni özellik TODO'su — 21–50

İlk 20 maddeden sonraki 30 yeni özellik. Sıralama önerilen geliştirme
önceliğidir; tamamlanan maddeler işaretlenir. Bu liste yaratıcı düzenleme ve
üretim araçları içindir. Hata düzeltmeleri, yedekleme, kurtarma ve altyapı
bakımı bu özelliklerin yerine sayılmaz. Listedeki 30 özellik uygulandı;
kullanım ayrıntıları EDITING.md, doğrulama sonuçları VALIDATION.md içindedir.

21. [x] **Zaman çizgisinde çoklu klip seçimi.** Ses ve video kliplerini
    kutuyla veya Shift ile seçme; seçili klipleri aralarındaki mesafeleri
    koruyarak birlikte taşıma, kopyalama ve silme. Kilitli şeritler korunmalı.
    Uygulandı: ortak ses/video seçimi, kutu seçimi, dokunmatik seçim modu,
    grup sürükleme, kareyle taşıma, bağımsız grup panosu, tek adımlık geri alma
    ve proje dosyasında saklanan toplu düzenleme kilitleri.

22. [x] **Şeritler arası ripple düzenleme.** Seçili zaman aralığını çıkarma
    veya boşluk ekleme; kullanıcının seçtiği ses, video, söz ve otomasyon
    şeritlerinin devamını aynı miktarda kaydırma.
    Uygulandı: proje zamanı/kare aralığı, imleçten veya klip seçiminden aralık,
    bağımsız ses ve otomasyon şeridi seçimi, kilit koruması, kaynak/fade/kelime
    sürekliliğini koruyan bölme, Bézier eğrilerini koruma ve tek geri alma.
    Proje zamanına bağlı sözler önizleme, dosya aktarımı ve MP4 çıktısında desteklenir.

23. [x] **Slip düzenleme.** Klibin zaman çizgisindeki konumu ve süresi
    sabitken kaynak giriş/çıkışını birlikte kaydırma. Önceki/yeni başlangıç
    ve bitiş kareleri yan yana gösterilmeli.
    Uygulandı: saniye ve 1/10 kaynak karesi adımları, sınırlandırılmış kaydırıcı,
    dört kareli kaynak karşılaştırması, uygulamadan önce taslak/iptal,
    hız rampası ve dondurulan kareyle birlikte kaydırma, tek geri alma.
    Klip konumları, boşluklar ve geçiş süreleri korunur.

24. [x] **Slide düzenleme.** Seçili video klibini süresini koruyarak
    komşuları arasında kaydırma; iki komşunun kesitlerini otomatik ayarlayarak
    montajın toplam süresini koruma.
    Uygulandı: saniye, kaydırıcı ve ±1/±10 proje karesi adımları; üç klibin
    önce/sonra konum ve kesit karşılaştırması, taslak/iptal ve tek geri alma.
    Kaynak payı, geçiş ve toplu kilit sınırları korunur; ters/hız rampalı ve
    dondurulmuş komşularla birlikte toplam süre sabit kalır.

25. [x] **Rolling trim.** Komşu iki klibin ortak kesim noktasını tek
    tutamaçla taşıma; toplam süre değişmeden bir klibi uzatırken diğerini
    kısaltma. İki taraftaki kareler karşılaştırılabilmeli.
    Uygulandı: ön/arka kesim seçimi, zaman çizgisinde sürüklenebilir tek tutamaç,
    saniye/kaydırıcı ve ±1/±10 proje karesi adımları, dört kaynak karesiyle
    önce/sonra karşılaştırma, taslak/iptal ve tek geri alma. Kaynak payları,
    geçiş örtüşmeleri, ters/rampalı/dondurulmuş kesitler ve maske fazı korunur.

26. [x] **Videodan ses ayırma ve bağlantılı klipler.** Bir videonun sesini
    ayrı düzenlenebilir şeride çıkarma; ses/görüntü bağlantısını açıp kapatma
    ve bağlantılı parçaları senkron konumda birlikte taşıma.
    Uygulandı: kaynak kesiti/ters oynatma/hız rampası işlenmiş ayrı WAV katmanı,
    bağlantıyı aç/kapat, konum farkını koruma, sese/videoya geçiş ve ses hizalama.
    Bağlı grup seçimi/kopyalama, sayısal ve dokunarak birlikte taşıma, kilit ve
    çakışma kontrolü, WAV indirme/yeniden bağlama ve tek adımlık geri alma.

27. [x] **J-cut ve L-cut ses geçişleri.** Bağlantılı video ve sesin kesim
    noktalarını ayrı düzenleme; sonraki sahnenin sesini erken başlatma veya
    önceki sahnenin sesini görüntü değiştikten sonra sürdürme.
    Uygulandı: ters/rampalı kaynak paylarıyla ses ayırma; bağımsız giriş/çıkış
    farkları, saniye/kaydırıcı ve ±1/±10 kare kontrolleri, ses/video aralık
    karşılaştırması, taslak/iptal ve video sınırlarına dönüş. Kaynak senkronu,
    fade/otomasyon, birlikte taşıma ve tek geri alma korunur; MP4 çıktısı doğrulandı.

28. [x] **Çok kameralı kurgu.** Aynı performansın kamera açılarını elle
    veya ses eşleştirmesiyle senkronlama; oynatma sırasında açı seçerek
    düzenlenebilir kamera kesimleri oluşturma.
    Uygulandı: sekiz açıya kadar eşzamanlı önizleme, kaynak farkı, özgün sesle
    otomatik hizalama, 1–8 tuşlarıyla canlı kesim kaydı, taslak/iptal, kesim
    zamanı düzenleme, tek geri alma ve kamera kaynaklarıyla taşınabilir paket.
    Kesimler normal video kliplerine dönüşür; gerçek MP4 kareleri doğrulandı.

29. [x] **İç içe sekanslar.** Seçili ses/görüntü/metin kliplerini ayrı bir
    sekans olarak açma, ana projede tek klip gibi kullanma ve sekansın içine
    girerek düzenleme. Aynı sekans birden fazla yerde kullanılabilmeli.
    Uygulandı: ana şarkı/ses/video/sahne üyeleri, dört düzey ve yerel saatli
    editör; tek klipten taşıma, kilit, üye çıkarma/ekleme ve sekansı çözme.
    Aynı içeriğe bağlı farklı kullanımlar, ortak parametre/metin/kesim ve
    katman sırası; bağımsızlaştırma, tek geri alma ve paket. Bağlı kullanımda
    klip sayısını değiştirmeden önce bağımsızlaştırılır. Gerçek WAV/MP4,
    kaynak koruma ve üretim arayüzü doğrulandı.

30. [x] **Bölüm bazlı tam kalite dışa aktarım.** Giriş/çıkış işaretleriyle
    yalnızca seçili bölümü veya adlandırılmış bölümleri ayrı dosyalara aktarma;
    her bölüm için dosya adı ve çıktı ayarları seçme.
    Uygulandı: imleç, klip seçimi veya proje işaretlerinden aralık; ad, dosya
    adı, kare hızı, çözünürlük, en boy ve kare üretimi ayarları; tekli/sıralı
    çıktı, sırayı iptal etme ve her dosya için indirme bağlantısı. Ses eğrileri
    ve video anahtarları özgün proje zamanını korur; gerçek MP4 ile doğrulandı.

31. [x] **Akıllı yeniden kadrajlama.** Aynı montajın yatay, kare ve dikey
    sürümlerinde takip edilecek özneyi seçme; özneyi kadrajda tutan düzenlenebilir
    konum anahtarları üretme ve sürüme özel düzeltmeler yapma.
    Uygulandı: bölge takibinden üç oranı tek adımda üretme, hedef konumu ve
    ağırlıklı yumuşatma, kaynak sınırına göre kadraj kısıtlama; sekiz bağımsız
    geometri/çıktı sürümü, normal XY anahtarlarında düzeltme, sürümü güncelleme
    ve açık projeyi değiştirmeden MP4. Üç oran gerçek çıktı ile doğrulandı.

32. [x] **Chroma key.** Damlalıkla arka plan rengi seçme; tolerans, kenar
    yumuşatma ve renk taşması temizleme ile yeşil/mavi perdeyi kaldırma.
    Uygulandı: video klibi ve video/görsel sahne katmanına ayrı anahtarlama;
    özgün kaynak karesinden tıklama/dokunma veya sayısal noktayla renk alma,
    hassas tolerans/yumuşaklık/despill, kilitler ve tek geri alma. GPU/CPU
    alpha eşleşmesi ve alt videonun göründüğü gerçek MP4 doğrulandı.

33. [x] **Hareket takibi.** Bir nesne veya bölgeyi izleyerek metin, görsel
    ya da maskeyi hareketine bağlama; takip noktalarını elle düzeltme ve
    hareketi normal keyframe'lere dönüştürme.
    Uygulandı: özgün kaynakta seçilebilir bölge, ayrıntı eşleştirmesi ve alt
    piksel konum; ters/hız rampası saat dönüşümü, nokta düzeltme/silme,
    göreli veya doğrudan metin/görsel/video yolu ve maske X/Y anahtarları.
    Kayıpta durma, taslak/iptal, kilit, tek geri alma ve gerçek MP4 takibi
    doğrulandı. İzleyici konum değişimini ölçer; dönüş/ölçek çözümü yapmaz.

34. [x] **Dört köşeden perspektif dönüşümü.** Görsel/video köşelerini
    bağımsız taşıyarak ekran, tabela veya eğik yüzeye yerleştirme;
    köşe konumlarını zaman içinde hareketlendirme.
    Uygulandı: kaynak tuvalinde dört sürüklenebilir köşe, hassas sayısal/klavye
    ayarı; proje zamanında doğrusal/yumuşak/sabit anahtarlar, taslak/iptal,
    tek geri alma, kilit ve proje kaydı. Homografi GPU/CPU eşleşmesi, saydam
    dış alan ve köşe animasyonu gerçek MP4 ile doğrulandı.

35. [x] **3D LUT içe aktarma.** `.cube` renk tablolarını klibe uygulama;
    LUT yoğunluğu, mevcut renk düzenlemesiyle işlem sırası ve önce/sonra
    karşılaştırması sunma.
    Uygulandı: 2³–33³ saf 3D .cube, giriş aralığı ve üç doğrusal eksende
    enterpolasyon; ortak LUT kütüphanesi, klibe ayrı yoğunluk/sıra, taslak
    kaydırıcı/iptal/tek geri alma, renk+LUT karşılaştırması ve proje/paket kaydı.
    GPU float/CPU eşleşmesi ve gerçek MP4 renkleri doğrulandı.

36. [x] **Renk ölçüm monitörleri.** Parlaklık dalga biçimi, RGB parade,
    histogram ve vectorscope ile seçili klibin veya son kompozisyonun
    renklerini inceleme.
    Uygulandı: yerel renk uygulanmış seçili klip veya ön plan/sözler dahil son
    önizleme; dört monitör, canlı/dondur/tek kare, doğrusal/log yoğunluk ve
    min/ortalama/max ölçümü. Ölçümler projeyi değiştirmez; piksel toplamları,
    seek sonrası kare ve üretim arayüzü doğrulandı.

37. [x] **Düzenlenebilir hareket yolları.** Konum animasyonlarını tuvalde
    yol olarak gösterme; yol düğümlerini ve mekânsal Bézier tutamaçlarını
    düzenleyerek eğri boyunca hareket oluşturma.
    Uygulandı: video ve metin/görsel/video katmanlarında tuval yolu, düğüm ve
    giriş/çıkış tutamaçları; hassas zaman/konum, bağımsız zaman eğrisi, şekli
    koruyarak Bézier bölme, sürükleme/iptal ve tek geri alma. Gerçek MP4
    hareketi, mevcut video anahtarlarıyla birleşim ve proje kaydı doğrulandı.

38. [x] **Şekil ve çizgi katmanları.** Dikdörtgen, elips, ok ve serbest
    vektör yolları ekleme; dolgu, kontur, kesikli çizgi ve çizilerek görünme
    animasyonu ayarlama.
    Uygulandı: dört şekil türü, açık/kapalı Bézier yolları ve kalem çizimi;
    dolgu/kontur/kesik, ölçülen uzunlukla çizilme, sayısal ve tuval düzenleme,
    şekli koruyan bölme, iptal/tek geri alma, kilit ve dosyasız paket kaydı.
    Gerçek MP4 animasyonu ve üretim arayüzünde yeniden açma doğrulandı.

39. [x] **Ses tepkili parçacıklar.** Bas, orta ve tiz bantlarına bağlanan
    parçacık yayıcıları; yoğunluk, boyut, hız, yön, renk ve ömür kontrolleriyle
    kıvılcım, kar veya ışık alanları oluşturma.
    Uygulandı: üç görünüm, bağımsız bant ve tepki miktarı, alan oranı/tohum;
    sayısal kontroller, normal katman hareketi/maske/perspektif/karışım,
    geri alma ve dosyasız paket. İleri/geri arama kare eşliği, sessizlikte
    sönme, seçili bantla gerçek MP4 ve üretim arayüzü doğrulandı.

40. [x] **Gelişmiş başlık ve alt bant tasarımcısı.** Birden fazla yazı
    stilini aynı başlıkta kullanma; arka plan şeridi, ikon, vurgu ve giriş/çıkış
    hareketlerini düzenlenebilir başlık bileşeni olarak saklama.
    Uygulandı: dört satırda sekizer bağımsız metin stili, arka plan/köşe/
    boşluk, vurgu şeridi ve vektör ikonlar; altı giriş/çıkış seçeneği,
    16 yeniden kullanılabilir bileşen, bağımsız katman kopyaları ve paket.
    Fontlar, karma stiller ve animasyon gerçek MP4/üretim arayüzünde doğrulandı.

41. [x] **Çok dilli altyazı şeritleri.** Aynı projede birden fazla dilin
    söz/altyazısını tutma; dilleri karşılaştırarak düzenleme, çeviri taslağı
    hazırlama ve çıktı için gösterilecek dili seçme.
    Uygulandı: 16 bağımsız dil/metin/zaman/stil şeridi, etkin çıktı dili,
    proje zamanında yan yana karşılaştırma; zamanları koruyan elle çeviri
    taslağı, boş/kopya dil, adlandırma/silme ve paket. Normal söz editörüyle
    eşleme, tüm dillerde ripple, geri alma ve gerçek MP4 doğrulandı.

42. [x] **Gelişmiş altyazı biçimleri.** WebVTT ve ASS içe/dışa aktarımı;
    desteklenen konum, stil ve kelime zamanlarını koruma, dönüştürülemeyen
    biçimlendirmeleri kullanıcıya gösterme.
    Uygulandı: uygulanmadan önce incelenen WebVTT/ASS taslağı, kaynak/proje
    saati, CSS sınıfı ve ASS satır stilleri, XY/hizalama/dikey çapa, yazı
    vurgusu ve kelime araları; satır bazlı stil editörü ve iki biçime indirme.
    Desteklenmeyen etiket/efektler raporlanır. Dosya/paket, saat dönüşümü,
    gerçek MP4 stili ve üretim arayüzü doğrulandı.

43. [x] **Mikrofonla seslendirme kaydı.** Seçili şeride imleçten başlayarak
    mikrofon kaydetme; geri sayım, metronom, giriş seviyesi ve belirli aralığa
    yeniden kayıt seçenekleri sunma.
    Uygulandı: aygıt/mono-stereo/giriş seviyesi, BPM geri sayımı ve metronom;
    ön çalma, örnek saatiyle aralık, konum düzeltmesi, dinlenebilir WAV taslağı.
    Boş hedef veya yeni katman; yeniden kayıtta eski kaynak korunarak aralığa
    kısma, tek geri alma ve paket. Gerçek tarayıcı PCM kaydı ve çıktı sesi doğrulandı.

44. [x] **Take ve comp editörü.** Aynı bölümün alternatif ses kayıtlarını
    alt şeritlerde tutma; her bölüm için en iyi kaydı seçerek tek bir performans
    oluşturma ve seçim sınırlarında crossfade uygulama.
    Uygulandı: alt satırlarda take dalgaları, hassas kesim/bölüm seçimi,
    bölüm başına take ve kaynak payına göre eşit güçte crossfade; ham montaj
    dinleme, ortak efektli tek çıkış ve yeniden düzenleme. Kaynaklar korunur;
    tek geri alma, take'lere dönüş, float WAV/paket ve gerçek çıktı doğrulandı.

45. [x] **Ses grup kanalları ve send/return.** Birden fazla ses katmanını
    ortak gruba yönlendirme; ortak seviye/EQ/efekt kontrolü ve paylaşılan
    reverb/delay kanallarına ayrı gönderim seviyeleri sunma.
    Uygulandı: sekiz grup, dört ıslak return; üye/grup gönderimleri, mute/solo,
    ortak EQ/filtre/efekt sırası ve kanal otomasyonu. Silme/kilit/geri alma,
    paket ve gerçek çıktı doğrulandı; yerel Web Audio ile çıktı DSP eşliği ölçüldü.

46. [x] **Kompresör, gate ve limiter.** Katmana ve gruba dinamik işlemci
    ekleme; eşik, oran, attack/release ve gain reduction göstergeleriyle
    sesin dinamik aralığını düzenleme.
    Uygulandı: katman/grup gate, yumuşak dizli kompresör ve sıfır attack
    örnek-tepe limiter; ayrı attack/release, histerezis/tutma, makeup/karışım
    ve canlı azaltım göstergeleri. Worklet/çıktı örnek eşliği, gerçek WAV,
    kilit/geri alma/kayıt ve üretim arayüzü doğrulandı.

47. [x] **Seçilebilir sidechain yönlendirmesi.** Herhangi bir katman veya
    grubun seviyesini başka bir sinyalle kontrol etme; sidechain filtresi,
    dinleme, eşik ve ritmik ducking karakteri seçme.
    Uygulandı: katman/grup kaynakları, filtreli dedektör dinleme, Compress/
    Duck/Pump, eşik/oran/derinlik/attack/release/tutma ve canlı azaltım.
    Döngüsüz yönlendirme, grup silmede referans temizliği, tek geri alma ve
    kayıt; gerçek Worklet/çıktı ses eşliği ve proje saatli WAV doğrulandı.

48. [x] **Spektral ses temizleme.** Spektrogram üzerinde zaman/frekans
    bölgesi seçerek uğultu, tık veya istenmeyen sesi azaltma; gürültü profili
    alma ve işlenen/çıkarılan sinyali ayrı dinleme.
    Uygulandı: logaritmik spektrogram, fare/dokunma/klavye seçimi, 32 hassas
    bölge ve yumuşak kenarlar; kaynak saatinde 120 sn çalışma alanı, gürültü
    profili/güç/taban ve üç ayrı dinleme. Kaynağı koruyan yeniden düzenleme,
    tek geri alma, ana montaj/tempo öncesi işlem, paket ve gerçek MP4 doğrulandı.

49. [x] **Perdeyi koruyan zaman esnetme ve warp işaretleri.** Sesin hızını
    perdesinden bağımsız değiştirme; belirli hece veya vuruşları warp
    işaretleriyle hedef proje zamanlarına taşıma.
    Uygulandı: kaynak/proje saatli 64 işaret, sayısal/tuval/klavye düzenleme,
    0.25–4× hız, bağımsız ±12 yarım ses, formant ve geçici ses karakteri;
    kaynak paylı geçişler, dinlenebilir taslak ve yeniden üretilebilir katman.
    Kaynağa dönüş/tek geri alma, paket, gerçek ses ve üretim arayüzü doğrulandı.

50. [x] **LUFS hedefleme ve loudness ölçümü.** Anlık/kısa süreli/toplam
    loudness ve true-peak göstergeleri; seçilen LUFS ve tepe hedeflerine göre
    dinlenebilir normalizasyon önerisi ve çıktıya uygulama.
    Uygulandı: canlı M/S/I ve true-peak, tam mix R128 grafiği, özel LUFS/
    tepe/LRA hedefleri; iptal edilebilir dinleme aralığı, doğrusal/dinamik
    normalizasyon önerisi ve çıktı hedefleri. Gerçek WAV, native Worklet,
    mono/stereo kanal eşliği, geri alma ve üretim arayüzü doğrulandı.
