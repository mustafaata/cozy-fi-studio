# Preset geliştirme durumu

15 Ekim 2026 — **200/200 preset tamamlandı:** 50 video, 50 audio, 50 text,
50 audio reactive. Onaylanan beş aşamanın bütün ID'leri uygulanmıştır.
Son teslim kalan 75 preseti tamamlar: VFX-36–50, AFX-06–10 / AFX-31–35 /
AFX-41–50, TFX-31–50 ve ARX-31–50. Ayrıntılı takip:
[PRESET_TODO.md](PRESET_TODO.md). Önceki paketlerin aşağıdaki doğrulama
notları, yazıldıkları teslimdeki sayıları ve performans ölçümlerini korur.

## Kullanım

- **VideoFX → Video FX · preset kataloğu:** seçili montaj klibi, arka plan
  sahnesi veya seçili görsel/video katmanı hedeflenebilir. Arka plan hedefi
  montajın tamamına uygulanır; bağımsız görsel katmanlarının kendi ayarları vardır.
- **Miks → Ses Karakteri & Akustik → Ses FX · preset kataloğu:** katalog
  başlangıçta kapalıdır. Hedef menüsü ana şarkı, ek ses kanalları ve bus'ları
  içerir. Ctrl/⌘+K ile kataloglar bulunup açılabilir.
- Ctrl/⌘+K araması dört kataloğun preset adlarını, ailelerini ve açıklamalarını
  da tarar. Örneğin **Halation Red** ilgili kataloğu açar; projeye efekt uygulamaz.
- **Sözler → Metin FX · preset kataloğu:** hedef olarak sözler/altyazılar
  veya seçili metin/başlık katmanı kullanılabilir. Söz hedefi bütün satırları
  biçimlendirir; her satır kendi zamanında animasyonunu oynatır. Katman hedefi
  için görsel katman düzenleyicisinden bir metin veya başlık seçilir.
- **VideoFX → Audio reactive FX · preset kataloğu:** görüntü efektleri arka plan sahnesine uygulanır; ARX-41–45
  söz/metin/başlıkları, ARX-44 ayrıca vektör konturlarını işler. Analiz kaynağı
  master, ses kanalı veya bus olabilir. FX öncesi/sonrası noktasını seçip
  **Ses analizini hazırla** düğmesine basın. Ses/route ayarları değişince analiz
  geçersizleşir ve durum alanı yeniden hazırlamanızı ister. Preset ve görsel
  parametre değişiklikleri aynı ses analizini kullanabilir.
- Arama, favoriler, son kullanılanlar ve kullanıcı kopyaları vardır. Video
  kartlarında örnek görünüm, ses kartlarında dalga örneği ve **Örneği dinle**
  bulunur. Ses örneği yerel olarak üretilir; kullanıcı dosyası yüklemez.
  **Örneği durdur** ve örneğin RMS seviyesini eşitleme seçeneği vardır.
- Slider ve sayısal alan aynı değeri düzenler. Sürükleme yerel taslaktır;
  bitişi tek geri alma işlemidir. Escape, pointer cancel, pencere odağı veya
  hedef değişimi taslağı iptal eder. Önce/sonra karşılaştırması proje verisini değiştirmez.
- Efekt anahtar kareleri proje saniyesiyle çalışır; doğrusal, yumuşak, sabit,
  hızlanan ve yavaşlayan geçişler kullanılabilir. Video tohum değeri ve sesin
  IR/delay yapısını değiştiren kontroller yapısaldır. Ses miktarı, çıkış kazancı,
  kesim frekansları ve Dub Throw rezonansı otomasyona bağlanabilir.
- Mevcut efekt eğrileri varken farklı presete geçmek veya efekti kaldırmak
  için **efekt eğrilerini temizle** seçeneği açıkça seçilir. Diğer şeritlerin
  ses seviyesi, klip zamanlaması, EQ, renk ve otomasyonları korunur.
- Modülasyon presetlerinde hız, derinlik ve diğer sürekli değerler eğri alır.
  Chorus ses sayısı ve phaser kademe sayısı yapısaldır. Tape Vibrato'nun
  işlenmiş yolu 40 ms gecikmelidir; saf perde salınımı için güç %100 seçilir.
- Distorsiyon ailesinde Parallel Grit'in paralel oranı ortak güç kontrolüdür;
  aynı karışımı düzenleyen ikinci bir slider yoktur. Wavefold kat sayısı ayrık,
  eşiği ve bias değeri otomasyonludur. Diğer sürekli kontroller de eğri alır.
- Her katalogdan hedef başına bir preset etkindir. Mevcut renk/LUT, film,
  bas tepkileri ve ses zinciri bu aşamayla birlikte kullanılabilir.

Favoriler ve en fazla 50 kullanıcı kopyası kategori başına bu tarayıcıda
saklanır. Kullanıcı kopyası projeye özgü zaman eğrilerini içermez. Uygulanmış
efektin bütün değerleri ve eğrileri proje dosyasına dahildir; kütüphanede
aynı kullanıcı adı bulunmadan da proje görünümü/sesi yeniden üretilebilir.

## Uygulama sınırları

Video transferleri `creative-video.js`, GPU/CPU çizimi
`creative-video-renderer.js` içindedir. Sahne, montaj klibi ve medya katmanı
aynı çiziciyi kullanır; MP4 dışa aktarma bu modülleri de yükler. Örtük arka plan
klibinde presetin iki kez uygulanması önlenir. Shader parametrelerinin sırası
JSON nesne sırasından bağımsız bir dizidir; Flask'ın sıralı JSON'u ve bağımsız
export şeması aynı sonucu verir. Gren hücreleri piksel merkezinden örneklenir;
çizikler kenar yumuşatır. CRT'de çözünürlük altındaki tarama/fosfor desenleri
aliasing oluşturmamak için yumuşatılır.

VFX-11–20 optik hesapları `creative-optics.js`, WebGL/CPU çizimi
`creative-optics-renderer.js` içinde ayrı tutulur. Her iki yol premultiplied
RGBA ile çalışır; saydam görsellerde kenar rengi ve alfa birlikte filtrelenir.
Anamorphic Streak parlaklık çıkarımı, yatay yayılma ve son birleştirme olmak
üzere üç GPU geçişi kullanır. 64 sütunlu ara yüzey, noktasal ışıkların ayrı
kopyalar yerine kesintisiz yatay ışık çizgilerine dönüşmesini sağlar.
CPU aynı örnekleme ve ara yüzey nicemlemesini kullanır. GPU bağlam kaybında
ve ara yüzey oluşturma hatasında CPU devralır; bağlam geri gelince ara
yüzeyler yeniden oluşturulur. GPU olmayan cihazlarda büyük görüntülerin
CPU filtrelemesi daha yavaş olabilir.

Halation Red sıcak kenar taşması, Tilt Miniature odak şeridi, Split Diopter
iki dairesel odak bölgesi, Dream Diffusion ayrıntı koruyan yumuşatma üretir.
Fisheye Bubble, Barrel Vintage ve Pincushion Tunnel farklı lens dönüşümleridir;
Isometric Window perspektifli pencere, Cylinder Wrap dönen silindir yüzeyidir.
Piksel yarıçapları 720 piksel kaynak yüksekliğine göre ölçeklenir. İleri
merkez/konum ayarları da otomasyon alır; Fisheye kenar doldurma seçimi ayrık
olduğundan eğri almaz. Cylinder Wrap hareketi mevcut klip/sahne saatini kullanır.
Klip, sahne ve görsel/video katmanı aynı modüllerle önizleme ve MP4 üretir.

Ses tanımları `audio-presets.js`, native dinleme `audio-preset-node.js`,
dosya DSP'si `creative_audio.py` içindedir. Yeni aşama mevcut katman zincirinden
sonra, dinamik işlemciden ve kanal fader/pan kontrollerinden önce çalışır.
Bus'lar da aynı aşamayı kullanır. Beş oda farklı erken yansıma dizileri,
sönümleri ve tekrarlanabilir stereo impulslarla üretilir. Delay zamanları
örnek çerçevesine yuvarlanır; feedback render kuantumu iki tarafta eşleşir.
Dotted Ping Pong proje BPM'sini veya manuel BPM'yi kullanır; Multi Tap Stair
dört ayrı zaman/pan içerir. Ducking Echo giriş sinyalini kendi algılayıcısı
olarak kullanır; proje yönlendirmesinde sahte bir kanal bağlantısı oluşturmaz.

IR değişiminde kısa çapraz geçiş yapılır; geçici eski dallar en fazla iki,
bağlamdaki impuls önbelleği en fazla sekiz kayıt tutar. Çıkış aralığı ve mevcut
kanal bitiş/fade kuralları korunur; preset kendiliğinden proje süresini uzatmaz.

AFX-16–20 beş ayrı wet işlemci kullanır: fazları farklı çoklu chorus gecikmeleri,
geri beslemeli kısa flanger gecikmesi, kademeli all-pass phaser, düzensiz
fractional-delay vibrato ve iki bantlı Doppler/genlik rotor modeli.
`audio-modulation-dsp.js` AudioWorklet ile canlı ses ve örnek dinlemede,
`audio_modulation.py` dosya üretiminde çalışır. Her iki tarafta kontrol eğrileri
mevcut 128 örneklik kontrol saatinden okunur; gecikme konumu/filtre değişimlerinin
tık üretmesini azaltmak için kontroller 10 ms zaman sabitiyle yumuşatılır.
Hız değişimi LFO fazını sıfırlamaz. Rotary'nin hızlanma kontrolü ayrıca iki
rotorun hedef hıza ulaşma süresini belirler.

Modül oynatmadan önce hazırlanır. Canlı preset değişiminde geç yüklenen
modül en son seçimi kullanır; bağlantısı kaldırılmış bir işlemciyi geri bağlamaz.
Hazırlama hatası görünür mesaj verir ve yeniden oynatmada tekrar denenebilir.
AudioWorklet desteği bu beş efektin canlı dinlemesi için gereklidir; dosya
üretimi Python DSP'siyle yapılır. Seek/yeniden oynatmada gecikme ve filtre
geçmişi boş başlar; dosya karşılaştırmaları proje başlangıcından yapılmıştır.

AFX-21–25 ayrı nonlinear işlemciler kullanır: bias'lı yumuşak bant eğrisi,
asimetrik tüp eğrisi, sert/cubic kırpma, temiz alt bant + işlenmiş üst bant ve
üçgen wavefold. `audio-distortion-dsp.js` canlı/örnek ses, `audio_distortion.py`
dosya üretimi içindir. Dört kat örnekleme, 65 tap FIR giriş/çıkış filtreleri,
10 Hz DC engelleme ve 10 ms kontrol yumuşatması aynı iki yolda çalışır.
Yüksek harmoniklerin teslim bandına geri katlanması azaltılır; tamamen
aliasing'siz bir model olduğu iddia edilmez.

Resampling'in 16 örneklik grup gecikmesi temiz yola da uygulanır; böylece
aktif efektin dry/wet karışımı hizalıdır. Bu gecikme 44,1 kHz'de yaklaşık
0,36 ms'dir ve her aktif distorsiyon aşamasında eklenir. Proje genelinde
kanallar arası gecikme telafisi yapılmaz; bypass tam gecikmesizdir. Dosya
süresi uzatılmaz. Bias nedeniyle sessiz girişte sabit ses üretilmez; mevcut
filtre geçmişinin kuyruğu fiziksel olarak söner.

Worklet hazırlama, proje saati ve kontrol eğrisi planlama
`audio-preset-worklet-node.js` içinde ortaktır; ailelerin DSP kodu ayrıdır.
Gecikmeli yüklemede modülasyon/distorsiyon arasında en son seçime bağlanılır.
Bir ailedeki hazırlama hatası diğerini engellemez. Ses FX çıkış kazancında
eğri yaklaşım toleransı 0,00001'e indirildi; yüksek seviyeli distorsiyon
otomasyonunda dosya/önizleme farkı test toleransını gevşetmeden giderildi.

## Doğrulama

- Node testlerinin tamamı: **302 geçti**.
- Video: **4 Python sözleşme testi**, **4 üretim WSGI/CSP arayüz senaryosu**.
  GPU/CPU karşılaştırması 720 piksel yüksekliğinde 20 preseti de çalıştırır;
  ileri/geri zaman erişimi aynı kareyi verir. Beş ekran genişliği, iki tema,
  klip/katman kilitleri, taslak iptali, undo, kullanıcı kaydı ve favori odağı kontrol edilir.
- **2 gerçek MP4 karşılaştırması**: 10 farklı presetli montaj; ayrıca sahne
  otomasyonu ve bağımsız video katmanı. Teslim codec'inin renk örneklemesi
  dikkate alınarak mevcut RGB/luma toleransları kullanılır.
- Optik paket: **3 üretim WSGI/CSP arayüz senaryosu**; klip/sahne/görsel
  hedefleri, ileri merkez eğrisi, ayrık doldurma, undo/redo, saydam RGBA
  GPU/CPU bileşimi, 10 ayrı görünüm ve her presette en az üç makro kontrolün
  görüntüyü değiştirmesi. Güncel yatay ışık algoritmasıyla bu üç senaryo ve
  20 presetlik eski GPU/CPU testi birlikte **4 test geçti**.
- **1 GPU hata/kurtarma testi**: gerçek bağlam kaybı, CPU sonucu, bağlam
  geri dönüşü, yeni ara yüzeyler ve zorlanan eksik framebuffer hatası.
  **2 ek gerçek MP4 testi**: 10 optik presetin tamamı; ayrıca sahne eğrisi,
  perspektifli klip ve saydam görsel katmanı. RGB/luma toleransları korunur.
- Preset adıyla araç araması ve mevcut stüdyo arayüzünde **5 regresyon testi** geçti.
- Ses: **5 Python DSP/sözleşme testi**, toplam **8 farklı üretim WSGI/CSP
  arayüz/native ses senaryosu**. 20 presetin gerçek kanal düğümü native OfflineAudioContext çıktısı Python
  DSP ile karşılaştırılır. Oda impulsları, otomasyon yenilemeleri, bus hedefi,
  örnek dinleme ve hızlı oda değişimlerinin kaynak sınırları kontrol edilir.
- Modülasyon için ayrıca 44,1 kHz'de beş algoritmanın hız/güç/kazanç eğrileri
  ve otomasyon yenilemeleri karşılaştırıldı. Kanal/bus hedefleri, ayrık kademe
  seçimi, anahtar kare, kullanıcı kopyası, undo/redo, RMS eşlenmiş örnek dinleme,
  beş genişlik/iki tema, hızlı preset değişimi, sınırlı eski dallar, en son seçime
  bağlanma ve zorlanan modül hazırlama hatasından gerçek yeniden yüklemeyle
  kurtarma kontrol edildi. Ayrıntılı loglar `PRESET_EVIDENCE.json` içindedir.
- Distorsiyon: **4 ek Python DSP testi**; 16 örneklik dry hizası, tam bypass,
  otomasyon/blok sürekliliği, kanal/bus kayıtları, wavefold yüksek frekans alias
  bastırması, tüpün çift harmonikleri ve fuzz temiz alt dalı. Yeni **6 üretim
  WSGI/CSP arayüz/native ses senaryosu**; 44,1 kHz eğriler/yenilemeler,
  gerçek dry gecikmesi, beş ayrı thumbnail, arama, kat sayısı, eşik eğrisi,
  kayıtlı kopya, undo/redo, örnek dinleme, iki tema/beş genişlik, aileler arası
  geç yükleme/hata kurtarma ve gerçek ana kanal + bus oynatması.
- **1 gerçek WAV testi**, kanal ve bus üzerinde iki alt senaryo; mevcut
  **8 katman efekt testi** de geçti.
- **1 ek gerçek WAV testi / 10 alt senaryo:** beş modülasyon efekti, kanal ve
  bus üzerinden 44,1 kHz dosya üretimiyle karşılaştırıldı. Bu testi de içeren
  mixer/routing/track FX/reactive analiz regresyonlarında **28 test geçti**.
- **1 ek gerçek WAV testi / 10 alt senaryo:** beş distorsiyon presetinin
  kanal ve bus dosyaları. Son preset DSP, mixer, routing, track FX ve reactive
  analiz regresyonunda bu testi de içeren **38 test geçti**.
- Metin: **3 Python sözleşme testi**, **4 üretim WSGI/CSP arayüz senaryosu**.
  10 presetin normal metin ve karaoke çizimleri ayrı ayrı çalıştırılır; zaman
  atlamaları, vurgulu/normal kelime renkleri, kısa süreler, keskin/yumuşak maske
  sınırları, ters gradyan ve birleşik emoji satır kırılımı kontrol edilir.
  Beş genişlik ve iki temada katalog taşması, sayı/slider taslakları, tek adımlı
  undo, kullanıcı kaydı, karşılaştırma, anahtar kareler ve katman kilidi doğrulanır.
- **2 ek gerçek MP4 karşılaştırması:** 10 text FX'in metin/zengin başlık
  katmanlarında kullanımı; ayrıca karaoke maskesi, miktar eğrisi ve dağılmış
  harflerin birlikte kullanımı. Mevcut **8 video/ses katalog testi** tekrar geçti.
- Audio reactive: **5 Python analiz/sözleşme/API testi**; stereo ters faz,
  blok boyutundan bağımsız spektrum, gerçek track/bus pre/post delay,
  mute, fader öncesi kanal noktası, hatalı kaynak, meşgul sunucu ve iptal.
  Bu testlerle birlikte mixer/routing/track FX regresyonlarında **38 test geçti**.
- **4 üretim WSGI/CSP arayüz senaryosu:** 10 ayrı çizim, aynı zamana tekrar
  erişim, sessizlikte nötr kaynak, gerçek pre/post analiz, ses değişiminde
  geçersizleşme, kaynak bus silme/undo, iptal/hata, eğriler, kayıtlı kopyalar,
  slider taslakları, beş genişlik ve iki tema.
- **2 gerçek MP4 senaryosu / 12 alt karşılaştırma:** 10 presetin her biri;
  ayrıca bus pre/post analizi, parametre eğrisi ve üstte metin katmanı.

Chromium doğrulandı. Fiziksel telefon, Safari/iOS, Firefox, tünel ve ekran
okuyucu sesli çıktı doğrulaması yapılmadı. Kalan 80 preset tamamlanmış sayılmaz.

## Metin efektlerinin davranışı

TFX-01–05 sırasıyla harf düşüşü, kelime yükselişi, kelime merkezinden açılma,
tracking geçişi ve tohumlu harf birleşmesi üretir. TFX-06–10 çizgi, daire,
alfa gradyanı, iki yönlü perde ve gecikmeli şerit maskeleridir. Bütün efektler
aynı `text-fx.js` çizim katmanını önizleme ve export'ta kullanır. Metin içeriği,
başlıkların renk/font/bold run'ları ve karaoke kelime zamanları korunur.

TFX-11–15 gerçek harf sınırlarını kullanır: Outline Trace konturu çizip
özgün dolguyu getirir; Neon Sign On kontur segmentlerini sırayla ateşler;
Chalk Write kontur boyunca tohumlu tebeşir dolgusu üretir; Double Stroke Chase
iki rengi kontur boyunca döndürür; Contour Erase satır sonunda dolguyu,
ardından konturu siler. Kalınlık, pürüz ve glow değerleri yazı boyunun yüzdesidir.
Süreler kısa satıra sığacak şekilde sınırlandırılır; döngü ve doku yerel saat/tohumdan
hesaplanır. Sıra, yön ve tohum yapısaldır; diğer sayısal değerler otomasyon alır.

`text-contours.js` tarayıcının yerleştirdiği glyph alfa sınırından marching
squares ile sıralı, alt piksel kapalı yollar çıkarır; harflerin iç boşlukları
ayrı konturdur. Ek font kontur dosyası veya bağımlılık gerekmez. Kullanılan
fontun tarayıcıda görünen hali, Türkçe/birleşik karakterler ve emoji silueti
çizilir. Renkli emojinin iç renk sınırları alfa konturu değildir; özgün renkli
dolgu korunur. Kontur örneklemesi çözünürlüğe bağlıdır; büyük maskeler en fazla
262.144 piksel / 2048 kenarda örneklenir. Geometri önbelleği en fazla 32 kayıt
ve 262.144 nokta tutar; font yüklenince geçersizleşir.

`text-contour-renderer.js` bu yolları önizleme ve MP4 için aynı şekilde çizer.
Neon/erase ışığı özgün dolgunun arkasındadır; karaoke aktif/pasif renkleri ve
başlık run renkleri ışıkla boyanmaz. Tebeşir dokusu harfin yerel koordinatına
bağlıdır; karaoke glow padding'i değişince kaymaz. Başlık efektleri mevcut
başlık çerçevesi içinde çizilir; yüksek glow için mevcut başlık padding'i
artırılabilir. Zaman atlamaları geçmiş kare verisi gerektirmez.

Ortak `blendTextFxSurfaces` karışımı iki premultiplied RGBA katkısını toplar.
Mevcut maske presetlerinin ara güçte aynı opak pikselleri gereksiz soldurması
giderildi; ışık/gölge ikinci kez uygulanmaz. Bypass özgün boyamayı doğrudan kullanır.

Güncel **3 Python sözleşme testi** 20 metin presetini söz,
metin ve başlık hedeflerinde dolaştırır. **6 üretim WSGI/CSP arayüz senaryosu**;
beş font/Unicode/emoji, kapalı yollar ve iç boşluklar, önbellek/font invalidation,
beş ayrı çizim, bütün makro kontroller, tekrar seek, karaoke renkleri, zengin
run stilleri, sabit tebeşir dokusu, kısmi güçte alfa, eski maskelerde alfa,
anahtar kare, taslak iptali, undo, kullanıcı kopyası, arama, kilit ve iki tema/beş
genişlik. Mevcut **4 metin arayüz senaryosu** da tekrar geçti. **2 yeni gerçek
MP4 testi** beş konturu metin/başlık katmanlarında, ayrıca karaoke+doku eğrisi,
kontur chase eğrisi ve erase ile karşılaştırır. Değişen eski maskelerin gerçek
karaoke MP4 karşılaştırması da tekrar geçti; RGB/luma toleransları korunur.

Giriş/çıkış katman veya söz satırının yerel saatinden; parametre otomasyonu
proje saniyesinden çalışır. Kısa satırların giriş süresi otomatik sınırlandırılır;
satır ortasında efekt yerleşmiş pozuna ulaşır. Tohum ve ayrık seçenekler yapısaldır.
Merkez, easing ve diğer ileri kontroller ayrıntılar bölümündedir. Tracking'in
son aralığı görsel olarak uygulanır; kayıtlı metin kutusunun satır yerleşimi sabittir.
Türkçe karakterler, birleşik işaretler, emoji aileleri, ten rengi ve bayraklar
harf hareketi ve satır kırılımında tek grapheme olarak ele alınır.

## Metin malzemeleri

TFX-16–20 sırasıyla hareketli krom yansıması, tohumlu altın folyo,
gerçek sahneyi kıran cam, lif dokulu kağıt kabartması ve akan gökkuşağı folyodur.
Her biri 4–5 ana kontrol, ortak güç ve gelişmiş yüzey ayrıntıları sunar.
Sürekli kontroller proje saniyesinde otomasyon alır; doku tohumları yapısaldır
ve tam sayı olarak istemcide/sunucuda doğrulanır. Krom/hologram hızı negatif
olabilir veya sıfırla durdurulabilir; animasyon satır/katman yerel saatinden
hesaplanır. Geriye atlayıp aynı zamana gelmek aynı yüzeyi üretir.

`text-materials.js` alfa maskesinden iç mesafeyi, kenar normalini, yüzey
rengini ve tohumlu dokuyu hesaplar. `text-material-renderer.js` gerçek font
maskelerini ve sınırlı LRU önbelleğini kullanır: en fazla 16 kayıt, toplam
1.048.576 maske pikseli. Tek maske yaklaşık 131.072 piksel / 1024 kenarla
sınırlıdır; çok büyük metinlerde yüzey örneklemesi küçültülür. Font yüklenince
önbellek temizlenir. Kullanıcıya ait font/stil ve Türkçe, birleşik karakter,
emoji siluetleri korunur; bu malzemeler metnin dolgu rengini değiştirir.

Cam, her metin katmanının çiziminden önce altındaki sahneyi yakalar.
Örnekleme dönüşümü döndürme/ölçek, başlık giriş/çıkışı, perspektif ve
hareketli katman yerleşimini izler; başlığın kendi dekorasyonu da hesaba
katılır. Maskeler mevcut katman bileşiminde uygulanır. Söz önizlemesinde
video + ön plan görseli, çıktı tarafında aynı birleşik sahne örneklenir;
satır kutuları ve önceki geçiş satırları metin boyanmadan eklenir.
Karaoke kelime/vurgu boyamaları aynı sabit alt görüntüyü kullanır;
harflerin kendini tekrar tekrar örneklemesi önlenir. Saydam örnekleme ve
bulanıklık premultiplied alfa ile çalışır. Alt görüntü yoksa sahte opak
bir zemin üretilmez; yalnızca ayarlanan cam kenar ışığı görünür.

Malzeme dolgusu ile outline/glow ayrı boyanır; aynı antialias maskesini
kendisinden çıkarmanın saydam camda bıraktığı kenar kalıntısı önlenir.
Karaoke ilerleme maskesi, pasif/aktif opaklık ve ışık korunur; malzeme
yüzeyi, özgün beyaz/cyan dolgu renklerinin yerine geçer. Başlıkların mevcut
çerçevesi yüksek glow'u sınırlayabilir; başlık padding'i kullanılabilir.
Bu bir 2D malzeme benzetimidir; fiziksel bir 3D ışın izleyici değildir.

Doğrulama: **4 yeni Node testi**, **6 yeni üretim WSGI/CSP arayüz testi**,
önceki **10 metin arayüz testinin** tekrarı; beş ayrı görünüm, her makronun
piksel etkisi, gerçek alt görüntü, homografi/koordinat eşlemesi, font/Unicode,
harf boşlukları, cache sınırı, font yükleme, bypass, eğri, iptal, undo, kilit,
arama ve iki temada beş ekran genişliği kontrol edildi. **3 yeni gerçek MP4
karşılaştırması** beş malzemeyi, karaoke + ön plan + eğrileri ve perspektifli,
maskeli, animasyonlu zengin cam başlığı kapsar. Önceki kontur ve karaoke
maskesi için **2 MP4 regresyonu** da geçti; RGB/luma toleransları değiştirilmedi.
Son Python metin/video/ses/proje sözleşmesi regresyonunda **16 test geçti**.

## Audio reactive davranışı ve analiz noktaları

ARX-01–05 sub ile zoom, kick halkası, snare kenar ışığı, hi-hat kıvılcımı ve
bas perspektifidir. ARX-16–20 köz çeşmesi, tiz ateş böcekleri, onset konfetisi,
yörünge tozu ve takımyıldızı bağlantılarıdır. Kick/snare/hi-hat isimleri bant
ve transient algılayıcılarını tanımlar; ayrı enstrüman/stem çıkarımı yapılmaz.

Kanal pre/post noktaları kanalın FX zincirinin girişi/çıkışıdır, fader ve zaman
fade'leri öncesindedir. Ana şarkının eski global DSP zinciri bu kanal zincirinin
önündedir; kanal pre noktasında da duyulur. Bus pre noktası üyelerin işlenmiş,
fader sonrası toplamıdır; post noktası bus FX çıkışı, bus fader öncesidir.
Mute/solo kuralları geçerlidir. Master pre noktası master kazancı/limiter
öncesindeki mix'tir; post noktası teslim PCM sesi, etkinse normalizasyon sonrasıdır.
Monitör ses seviyesi analizi değiştirmez.

`reactive_analysis.py` gerçek renderer tap'lerinden 60 Hz / 64 logaritmik bant
üretir; 2048 örneklik pencere yalnızca geçmiş sesi okur. Stereo güç ortalaması
ters fazlı sesin iptal olmasını önler. Aynı işlemci ve analiz kodu preview API
ve export tarafından kullanılır. Legacy bas/viz `VisualSignal` yolu kendi kuru
analiz davranışını korur; yeni ARX kataloğu ayrı seçilmiş analiz kullanır.

Geçici analiz proje JSON'una eklenmez. Kaynak, nokta, tohum, parametreler ve
eğriler kaydedilir; proje yeniden açıldığında kaynak dosyaları bağlayıp analiz
hazırlanır. Export gerekli analizi otomatik üretir. Örnek kartlar sentetik
bir referans vuruşunu gösterir; kullanıcının gerçek sesini temsil etmez.

Tetikleyiciler sabit analiz saatinde, minimum olay aralığıyla hesaplanır;
parçacıklar olay zamanı ve tohumdan yeniden üretilir. Arama sırası veya oynatma
FPS'i rastgele sonucu değiştirmez. Bant sınırları, parçacık sayısı ve tohum
yapısaldır; diğer sayısal değerler anahtar kare kullanabilir. Aktif parçacıklar
512 ile sınırlıdır; yoğun olaylarda en yeni olay grupları korunur. Sessizlikte
zarflar/lifetime'lar tamamlanınca görüntü nötr duruma döner.


## Spektrum ve stereo geometrisi

ARX-06–10: Log Spectrum Skyline, Circular Spectrum Petals, Spectral Waterfall,
Octave Ladder ve Spectral Ribbon. Logaritmik bant enerjisi sütun, yaprak,
geçmiş renk alanı, oktav basamağı ve yumuşak gradyan şeridine dönüşür.
Tepe tutma ve waterfall geçmişi hazırlanmış analizden okunur; oynatılmış
veya boyanmış kare biriktirilmez. Waterfall kayma hızı panel yüksekliği/sn
olarak zaman eksenini, geçmiş süresi en eski görünür veriyi sınırlar.
Dinamik aralık spektrumun -30 dB tavanına göre çalışır; sessizlik renk üretmez.

ARX-11–15: Stereo Lissajous, Polar Wave Halo, Mid Side Wings, Stereo Compass
ve Dual Wave Tunnel. Lissajous gerçek sol/sağ XY izidir; halo iki dalgayı
çembere taşır. Mid/side gövde/kanatları (L+R)/2 ve (L-R)/2 sinyallerinden
çizilir. Compass dengeyle döner, side oranıyla açılır; korelasyon renk ve
ibre uzunluğuna yansır. Tunnel halkaları gerçek geçmişteki iki dalgadır.
Korelasyon bir ses kalitesi puanı veya enstrüman ayrımı değildir.

`reactive_stereo.py` dalga görünümü için 129 tap nedensel FIR ile 2400 Hz
alçak geçiren filtre ve 6000 Hz örnekleme uygular; iki kanal 8 bit µ-law
olarak taşınır. Bu veri ölçüm PCM'i değildir. Dalga görünümünde yaklaşık
1,45 ms ortak filtre gecikmesi vardır. Compass güç/korelasyon ölçümleri
filtrelenmemiş tam bant sol/sağ örneklerden, 60 Hz aralıklarda hesaplanır;
yüksek frekanslar ve ters faz ölçümü kaybolmaz. Analiz pencereleri 1/60 sn
çözünürlükte yuvarlanır, yumuşatma yalnızca geçmiş ölçümleri kullanır.

Analiz yanıtı v2, dalga ve stereo ölçümlerini spektrumla birlikte içerir;
bir kez hazırlanıp 20 preset arasında yeniden kullanılabilir. v1 spektrum
yanıtları desteklenir; stereo veri yoksa yeni stereo efektler hazırlama
gereğini açıkça gösterir. Base64 uzunluğu, örnek sayısı, sonlu ölçümler ve
korelasyon sınırları istemcide doğrulanır. Hazır analiz proje dosyasına
gömülmez; kaynak/FX değişince mevcut geçersizleştirme ve iptal akışı işler.

`reactive-geometry.js` veri örnekleme ve saf zaman/koordinat hesabıdır;
`reactive-geometry-renderer.js` stüdyo ve MP4'ün ortak Canvas2D çizicisidir.
Bant/yaprak/oktav/örnek/halka sayıları tam sayı ve yapısaldır; frekans
aralığı da yapısaldır. Diğer sürekli değerler ve güç otomasyon alır.
Geçmiş en fazla 144 satır, dalga izi 512 nokta, iz grubu 12 adet,
tünel 24 halka ve bant eşleme önbelleği 16 kayıtla sınırlıdır.
Sessizlikte geçmişin/tepe tutmanın/izin süresi dolunca özgün görüntü
piksel düzeyinde geri gelir. Efektler metin ve bağımsız katmanların altındadır.

Doğrulama: **5 yeni Node testi**, **3 yeni Python stereo testi**;
blok boyutundan bağımsız dalga/ölçüm, boşluk/dolgu, mono/ters faz/tek kanal,
8 kHz sesin tam bant ölçümü ve görüntü filtresi, nedensellik, log bant,
peak hold, geçmiş, sınırlar, ayrık seçenekler ve bozuk transport verisi.
Son ses/analiz/proje regresyonunda **25 Python testi** geçti.
**6 yeni üretim WSGI/CSP arayüz senaryosu** ve **4 eski reactive senaryosu**;
on ayrı görünüm, tüm ana kontroller, seek tekrarı, geçmiş sönümü,
gerçek ters faz dosyası, 20 preset arasında analiz kullanımı, v1 hazırlama
uyarısı, taslak/iptal/undo, eğri, kullanıcı kopyası, arama, iki tema ve
beş genişlik. 720h çizim profili kanıt dosyasındadır; telefon FPS iddiası değildir.
**2 yeni gerçek MP4 testi / 10 preset alt senaryosu** güç ve geometri
eğrileriyle üçer kareyi karşılaştırır. Eski bus pre/post + üst katman ve
cam karaoke için **2 ek MP4 testi / 3 alt senaryo** da geçti. RGB/luma
toleransları değiştirilmedi. Toplam ilerleme 80/200; ikinci aşama tamamlandı.

## Video geometrisi ve dijital bozulma

VFX-21–25: Prism Facets, Liquid Mirror, Shattered Tiles, Infinite Corridor
ve Tri Mirror. Prizma yüzlerinin kırılması ve RGB ayrımı; dalgalı ayna ekseni;
tohumdan üretilen döndürülmüş cam karolar; iç içe küçülen perspektif kopyaları;
ortak kenarlarda kesintisiz üçgen yansıma örgüsü birbirinden ayrı algoritmalardır.
Tri Mirror, görüntüyü küçük üçgenlere sıkıştırmadan önce kademeli küçültmeyle
örnekler. Shattered Tiles yumuşak kenar ve cam kenarının renk yoğunluğu kontrolünü
gelişmiş görünümde sunar.

VFX-26–30: Codec Blocks, RGB Scan Tear, Pixel Sort Ribbons, Terminal Dither
ve Signal Dropout. Codec Blocks blok kayması/renk nicemleme simülasyonudur.
RGB Scan Tear hareketli bir bantta kanalları ayırır. Pixel Sort gerçek RGBA
piksellerini parlaklık eşiklerinin arasındaki kesintisiz şeritlerde kararlı
biçimde sıralar; saydam veya karanlık ayırıcıları geçmez. Terminal Dither
hücre merkezlerini örnekleyen Bayer matrisiyle yeşil, amber, buz veya 16 renkli
RGBI paleti üretir. Signal Dropout tohumlu aralıklarda kısa yatay sinyal
kesilmeleri üretir; olay dışındaki kare özgün görüntüdür.

Sürekli kontroller ve ortak güç anahtar kare alır. Seçenekler, tam sayı
adetler, tohum, Codec Blocks yenileme aralığı ve Signal Dropout olay aralığı
yapısaldır. Katalog kartları Signal Dropout'u aktif olay anında gösterir.
Tohum 0–288 aralığındadır; mevcut ortak gürültü fonksiyonunun dönemi aşılmaz.
Saat mutlak proje zamanıdır: seek ve kare çizim sırası sonucu değiştirmez.

Dokuz efektin ortak önizleme/MP4 motorunda WebGL ve eşdeğer CPU yolları vardır.
RGBA örnekleme alfa ile çarpılmış renklerle yapılır; saydam piksellerin
gizli rengi kenarlara sızmaz. GPU bağlam kaybı veya yükleme hatası görünür
uyarıyla CPU çizimine geçer. Pixel Sort iki modda da aynı gerçek CPU
sıralamasını kullanır: küçük şeritlerde insertion sort, uzunlarda 256 parlaklık
kovasıyla kararlı counting sort. Çalışma alanı eksen uzunluğu ile sınırlıdır.
Koridor en fazla 16 kopyadır; dither hücreleri fiziksel olarak çift sayılı
ve en az dört pikseldir. Kare havuzları her kare başında yeniden kullanılır.

Pixel Sort'un 1280×720, eşik 0 ve 512 piksellik şerit ölçümünde beş karenin
ortancası yaklaşık **51 ms** oldu. Yoğun kullanım önizleme FPS'ini düşürebilir;
bu masaüstü ölçümü telefon performansı değildir. Çok küçük 4:2:0 MP4 çıktıları
ince renkli karo/üçgen desenlerinde renk kaybeder. Bu iki efektin 144h ham
çıktısı stüdyo ile ayrıca karşılaştırıldı; kodlanmış teslim karşılaştırmaları
720h'de yapıldı. Genel MP4 karşılaştırma toleransları artırılmadı.

Doğrulama: **283 Node testi**, **17 Python sözleşme/regresyon testi**,
**9 üretim WSGI/CSP arayüz senaryosu** (5 yeni, 4 optik regresyon),
**4 gerçek MP4 testi / 12 alt senaryo** ve **1 ham çıktı testi / 2 alt senaryo**
geçti. Yeni on efektin güç ve geometri eğrileri, on saydam görsel katmanı,
eski on optik klip, tüm ana makrolar, GPU/CPU alfa eşleşmesi, bağlam
kaybı/geri dönüş, zorlanmış yükleme hatası, taslak iptali, geri alma,
arama, kullanıcı kopyası, kilitler, iki tema ve beş genişlik doğrulandı.
144h ham çıktı testi üç zamanda RGB ortalama 1,5 / luma ortalama 1 sınırı
kullanır; kodlanmış MP4 testi mevcut RGB 8 / luma 4 sınırlarını korur.
Waitress üzerinden 30 video presetinin ve beş ilgili betiğin güncel
baytları, CSP ve no-cache başlıkları da doğrulandı. Fiziksel telefon,
Safari/iOS, Firefox ve tünel doğrulanmadı. Toplam ilerleme **90/200**;
sırada AFX-26–30 ve AFX-36–40 var.

## Lo-fi karakter ve ritim işlemleri

AFX-26–30: Bitcrush Arcade, Dusty Vinyl, Broken Cassette, Telephone Booth
ve Sample Rate Dust. Bitcrush bit nicemlemesi ve örnek tutma uygular;
plak efekti tohumlu bağımsız stereo çıtırtı, yüzey gürültüsü ve yumuşak
sınırlama üretir. Kaset wow ve flutter hızlarını ayrı tutar, tohumlu
sinyal kaybını yumuşatır. Telefon alt/üst kesim, sürüş ve rezonans uygular.
Sample Rate Dust ön filtre, örnek tutma saati ve son filtreyi ayrı sunar.
Bu iki dijital azaltma efekti yaratıcı aliasing üretir; kaliteli örnekleme
dönüşümü iddiası taşımaz. Plak yüzey gürültüsü sessizlikte de devam eder.

AFX-36–40: Tempo Tremolo, Auto Wah, Step Gate, Filter Staircase ve Stutter
Grid. Tremolo sinüs, üçgen ve kenarı yumuşatılmış kare dalga sunar.
Auto Wah stereo bağlı kaynak zarfını attack/release ve hassasiyetle ölçer,
rezonans filtresini alt/üst frekans arasında logaritmik açar.
Gate 16 aç/kapa adımını gate uzunluğu ve yumuşatma ile uygular.
Filter Staircase 16 yüzde değerini logaritmik kesim frekansına dönüştürür;
glide iki stereo kanalda aynı filtre hareketini korur.

Stutter Grid canlı adımlarda bir hücre kaydeder; seçili tekrar adımlarında
son tamamlanmış canlı hücreyi stereo olarak tekrarlar. Tekrar sınırlarında
canlı girdiye karıştırarak sert birleşimleri yumuşatır. Soğuk seek sonrası
önce tam bir canlı hücre gerekir; tampon hazır olana kadar canlı ses geçer.
Bütün adımlar tekrar seçiliyse kayıt yapılamaz ve canlı ses devam eder.
En uzun hücre 20 BPM / 4 vuruşta 12 saniyedir. 48 kHz'de iki stereo hücre
tamponu toplam 9.216.000 bayttır; geçmiş süreyle büyümez.

16 adım ayrı bir kontrol grubu olarak görünür. Gate ve stutter düğmeleri
basılı durumlarını ve adım numaralarını gösterir, klavyeyle değiştirilebilir.
Filtre adımları etiketli yüzde alanlarıdır. Her düzenleme bir geri alma
adımıdır; kullanıcı kopyası deseni korur. Karşılaştırma ve hedef kilidi
adım editörünü de kilitler. Desen, bölüm, tohum, bit/hold adetleri ve dalga
seçimi yapısaldır; diğer sürekli kontroller ve güç/kazanç eğri alır.
Ritim saatinin başlangıcı proje sıfırıdır; bölüm proje BPM'ini kullanır,
`rhythm.offset` bu aileyi kaydırmaz. Tremolo ve stutter ayrıca faz sunar.
BPM veya yapısal kontrol değişince mevcut kısa dal geçişiyle işlemci yenilenir.

`audio-character-dsp.js` AudioWorklet ve katalog dalga örneklerinin ortak
ıslak ses çekirdeğidir; `audio_character.py` eşdeğer akış işlemcisidir.
Sürekli kontroller 10 ms ses saatiyle yumuşatılır. Tohumlu gürültü mutlak
örnek indeksinden hesaplanır; blok boyutuyla rastgele sonuç değişmez.
Seek filtreleri, zarfları, glide ve hücreleri temizler. İşlenmiş kaset yolu
30 ms gecikmelidir; kuru yol da hizalanır. Aktif kaset güç %0 durumunda
bu gecikme korunur; efekt devre dışıyken bypass birebir özgün sestir.

Yeni 44,1 kHz / otomasyon yenileme testi ortak native gain planlamasında
tek örneklik sıçrama buldu. Gelecekteki rampayı iptal etmek eski başlangıç
değerini bir örnek için açığa çıkarıyordu. Yenileme artık devam eden rampaya
bir uç nokta koyar ve olayları örnek sınırından 1e-10 sn önceye sabitler.
Bu düzeltme eski presetlerde de kullanılır; karşılaştırma toleransları
değiştirilmeden eski ses aileleri regresyondan geçirildi.

Doğrulama: **289 Node testi** (6 yeni DSP testi), **21 Python testi**
(4 yeni karakter sözleşmesi, regresyonlar ve gerçek WAV), **20 üretim
WSGI/CSP arayüz senaryosu** (6 yeni, 14 önceki ses senaryosu).
Yeni on AudioWorklet hem 44,1 kHz otomasyon/refill hem 48 kHz soğuk seek
ile Python çıktısına karşılaştırıldı; 137 BPM ile tam sayı olmayan hücre
süreleri de kullanıldı. Eski toplu native test artık 30 ses presetini
8 kHz'de karşılaştırır. Gerçek WAV testi on preseti kanal ve bus hedefinde
güç eğrisiyle sınar: **20 alt senaryo**. Adım düzenleme, hatalı değer,
geri alma/kopya, taslak iptali, kilit, arama, örnek dinleme, üç ses ailesi
arasında geçiş, tempo değişimi, iki tema ve beş genişlik de geçti.
48 kHz / 128 örneklik çekirdek profilinde ortancalar yaklaşık 0–0,1 ms
ölçüldü; sıfırlar tarayıcı zamanlayıcı çözünürlüğüdür ve cihaz garantisi değildir.
Waitress üzerinde 30 ses preseti, güncel betik baytları, worklet modülü,
CSP ve no-cache doğrulandı. Fiziksel telefon, Safari/iOS, Firefox, tünel
ve donanımdan dinleme doğrulanmadı. Toplam ilerleme **100/200**;
sırada **TFX-21–30** var.

## Dijital metin ve kinetik tipografi

TFX-21–25: Decode Scramble, RGB Type Tear, Pixel Assemble, Scanline Type ve
Terminal Cursor. Semboller soldan, sağdan, merkezden veya tohumlu sırada
özgün harflere çözülür. RGB kopması özgün alfa maskesini korur. Kare parçalar
tohumlu konumlardan birleşir; tarama metni çizgilerle açar. Terminal yazımı
grapheme kümelerini, noktalama/kelime duraklarını ve üç imleç biçimini kullanır.
Birden fazla rich text parçası aynı satırın yazım saatini paylaşır;
sınırda iki imleç çizilmez. Kısa cue'larda yazım/giriş tamamlanacak şekilde
sıkışır. Metin içeriği, kelime zamanları ve rich run stilleri değiştirilmez.

TFX-26–30: Elastic Bounce, Letter Wave, Orbit Caption, Flip Tiles ve
Perspective Crawl. Elastic analitik yay denklemini kullanır; az, kritik ve
aşırı sönüm ayrı hesaplanır. Dalga harfler arasındaki faz farkıyla hareket
eder. Orbit satır merkezine göre yay yolu ve harf yönelimi sunar.
Flip kartları odak uzaklığı ve dönme ekseniyle perspektifli açılır.
Crawl gerçek derinlik bölmesiyle kaçış noktasına küçülür ve uzaklıkla söner.
Perspektif 20 şerit / 40 üçgenle yaklaşık çizilir. Ağ yalnızca gerçek metin
alanına uygulanır; boş hareket payını bölmekten kaynaklanan zikzak giderildi.

`text-kinetic.js` saf zaman/geometri hesabıdır; `text-kinetic-renderer.js`
önizleme ve MP4'ün ortak Canvas2D çizicisidir. Zaman biriktirilmez, rastgele
görünümler cue zamanı ve tohumdan yeniden hesaplanır. Eğriler proje zamanı,
girişler cue/katman yerel zamanı kullanır. Seçenekler ve tohum yapısaldır;
diğer sürekli parametreler ve güç otomasyon alır. Slider, sayı, taslak iptali,
tek geri alma, kullanıcı kopyası, arama ve hedef kilidi ortak katalogdadır.
Kart önizlemeleri RGB kopmasını aktif zamanda, piksel/kart girişlerini
daha görünür bir giriş anında gösterir.

Karışım özgün ve işlenmiş RGBA yüzeylerini alfa ile çarpılmış katkılarla
bir kez birleştirir. Dış opaklık ve dönüşüm bir kez uygulanır. Yeni kinetik
efektlerde karaoke vurgu maskesi kaynak metinde uygulanıp harfle birlikte
taşınır; sabit hedef maskesinin uzaklaşan metni silmesi giderildi.
Eski efektlerin maskelemesi korunur. Çözülme/birleşme/yay/kart girişleri
tamamlandığında doğrudan özgün metin boyanır; settled görüntü piksel aynıdır.

Yüzeyler yaklaşık 262.144 piksel / 2048 kenarla, yuvarlama en fazla 4096
ek pikselle sınırlıdır. Çok büyük metinler ve geniş hareket payları daha
düşük raster çözünürlüğü kullanır. Harf yerleşimi önbelleği 16 kayıt ve
8192 grapheme ile sınırlıdır; font yüklenince temizlenir. Mevcut başlık
çerçevesi hareketli harfleri kırpabilir; başlık padding'i alanı belirler.
Harf düzeyindeki animasyonda birleşen yazılar ve ligatürler özgün bütün
metinden farklı şekillenebilir; tamamlanmış girişler özgün metne döner.

Doğrulama: **295 Node testi** (6 yeni saf geometri/saat testi), **13 Python
sözleşme testi** ve **21 üretim WSGI/CSP arayüz senaryosu** (5 yeni, 16 eski
metin/kontur/malzeme regresyonu) geçti. On farklı görünüm, bütün ana
makrolar, seek tekrarı, Türkçe/birleşik aksan/emoji, kısa cue, native settled
görüntü, kısmi güç, RGB alfa maskesi, karaoke renkleri, tek imleç, font/cache
sınırları, taslak/iptal/undo, eğri, kopya, arama, kilit, iki tema ve beş
genişlik doğrulandı. Masaüstü çizim profili kanıt dosyasında; telefon FPS
iddiası değildir.

**2 yeni gerçek MP4 testi / 10 alt senaryo**, her preseti aynı çıktıda düz
metin, maskeli renkli rich title ve karaoke ile, güç ve parametre eğrileriyle
dört zamanda karşılaştırır. Cam ve kontur karaoke için **2 eski MP4 testi**
de geçti; RGB ortalama 8 / luma ortalama 4 toleransları artırılmadı.
Waitress üzerinden 30 metin preseti, güncel beş betik, export betik listesi,
CSP ve no-cache doğrulandı. Fiziksel telefon, Safari/iOS, Firefox, tünel
ve sesli ekran okuyucu çıktısı doğrulanmadı. İlerleme **110/200**;
sırada **ARX-21–30** audio reactive efektler var.

## Ses tepkili alanlar ve ritmik geometriler

ARX-21–25: Liquid Bass Pool, Vocal Flow Field, Spectral Terrain, Jelly Orb
ve Aurora Bands. Bas vuruşları sıvı yükseklik alanında ilerleyen halkalar ve
ışık yönüne bağlı yüzey normalleri üretir. Flow Field seçilen vokal kanalının
veya mid bantlarının enerjisiyle yön değiştiren akış çizgileridir; vokal
ayırma yapmaz. Terrain geçmiş frekans yüksekliklerinden perspektifli bir ağ
çizer. Jelly üç bant katkısıyla 3D küre yüzeyini deforme eder; ortak yumuşak
aydınlatma kullanılır ve bağımsız yüz kenarlarındaki dikişler kaldırılmıştır.
Aurora farklı bant/faz/renkte katmanlı ışık perdeleridir.

ARX-26–30: Beat Hex Grid, Triangle Stack, Spectral Mandala, Cubic Pulse Wall
ve Polygon Morph. Altıgenlerde vuruş merkezden halka halka gecikerek yayılır.
Üçgenlerde bant eşleme ve ölçek oranı, mandalada frekans halkalarının simetri
kolları düzenlenir. Küp/kutu duvarı bant derinliğini üç görünür yüze taşır.
Polygon bas/mid/tiz oranlarıyla köşeleri değiştirir; kenar yuvarlaması sıfırdan
kesintisiz artar. Bunlar düzenlenebilir 3D sahne nesneleri değildir; Canvas
projeksiyonları ve yüzey çizimleridir. Sıvı havuzu bir akışkan simülatörü veya
arka plan kırılması değildir; aydınlatılmış raster yükseklik alanıdır.

Yeni `reactive-fields.js` hazırlanmış geçmiş veriyi ve saf geometriyi,
`reactive-field-renderer.js` önizleme/MP4 ortak boyamasını içerir. Bütün
efektler arka plan sahnesindedir; metin ve bağımsız görsel katmanları üstte
kalır. Oynatılmış kare birikmez. Eski v1 yalnız spektrum analizi yeterlidir;
v2 analizi de doğrudan kullanılır. Kaynak master, kanal veya bus ve pre/post
noktası mevcut analiz editöründen seçilir. Ses/route değişimi analizi
geçersizleştirir; preset/şekil değişimi analizi yeniden kullanır.

Sayısal sürekli kontroller ve güç otomasyon alır. Adetler, bant sınırları,
eşleme seçenekleri ve tohum yapısaldır. Kare başına beş geçmiş örnekle
yumuşatma yapılır; event efektlerinde bu kontrol vuruş yükseliş süresidir.
Bas/mid/tiz ağırlıkları gelişmiş görünümde ayrı düzenlenir; hepsi sıfırsa
ilgili küre/çokgen görünmez. Sessizlikte geçmiş/sönüm pencereleri bittiğinde
özgün görüntü piksel ve kaynak nesnesi düzeyinde geri gelir. Bypass ve
anahtar kare sıfır gücü de doğrudan özgün kaynağı döndürür.

Sınırlar: 16 aktif vuruş, 96 akış çizgisi × 32 nokta, 16 akış geçmiş örneği,
32×32 arazi örneği / 961 hücre, 2304 küre hücresi, 10 aurora katmanı,
12 altıgen halkası / en fazla 469 hücre, 24 üçgen, 24 mandala kolu,
16×24 kutu / 1152 yüz ve 16 çokgen köşesi. Yoğun vuruşlarda en yeni ilgili
16 olay korunur, eski uzun kuyruklar düşebilir. Havuz rasteri hem yatay hem
çok uzun dikey görüntüde en fazla 192 kenar ve 20.736 pikseldir.

Havuzun merkezleri, yayılma yarıçapları ve genlikleri kare başına bir kez
hesaplanır; dört genişlikten uzaktaki Gaussian kuyruklar 8 bit kapsama
duyarlılığının altında atlanır. 720h / 16 olay en yoğun masaüstü denemesinde
ortanca yaklaşık **76 ms'den 26 ms'ye** indi. Diğer efektlerin ortancaları
kanıt dosyasındadır. Havuz yoğun kullanımda başka efektlerle önizleme FPS'ini
düşürebilir; bu ölçüm telefon veya tüm cihazlar için performans garantisi değildir.

Doğrulama: **302 Node testi** (7 yeni alan/geometri testi), **14 Python
sözleşme/analiz testi** (2 yeni sözleşme), **15 üretim WSGI/CSP arayüz
senaryosu** (5 yeni, 10 eski reactive/spektrum/stereo regresyonu) geçti.
30 farklı preset görünümü, yeni bütün ana kontroller, seek tekrarı, gelecek
verinin geçmiş kareyi etkilememesi, sessizlik/bypass, geçmiş sönümü,
v1 uyumu, gerçek bus post-FX analizi, analiz kullanımı/geçersizleşmesi,
taslak/iptal/undo, tam sayı/yapısal seçenekler, eğri, kullanıcı kopyası,
arama, kilit, iki tema ve beş genişlik doğrulandı. Maksimum yoğunluk ve
320×1280 dikey raster sınırı da test edildi.

**2 yeni gerçek MP4 testi / 10 alt senaryo**, darbeli 110/900/4800 Hz stereo
sesi seçili bus post-FX noktasından analiz eder; güç/geometri eğrilerini
ve üst metin katmanını üçer karede karşılaştırır. Eski bus pre/post ve üst
katman için **1 MP4 regresyon testi / 2 alt senaryo** da geçti. RGB ortalama
8 / luma ortalama 4 toleransları değiştirilmedi. Waitress üzerinde dört
katalogda 30'ar preset, güncel betikler, export betik listesi, CSP ve
no-cache doğrulandı. Fiziksel telefon, Safari/iOS, Firefox, tünel ve sesli
ekran okuyucu çıktısı doğrulanmadı.

İlerleme **120/200**; üçüncü aşama tamamlandı. Kalan **80 preset** dördüncü
ve beşinci aşamalardadır. Sırada **VFX-31–40** zaman tabanlı video efektleri var.


## VFX-31 — gerçek geçmiş karelerle Ghost Trail

Dördüncü aşamanın ilk preseti tamamlandı. Klip, arka plan sahnesi ve video
katmanlarında 1–6 geçmiş kare; 0,02–0,50 sn kare aralığı; %0–100 opaklık
düşüşü ve ortak efekt gücü düzenlenir. Aralık, düşüş ve güç proje saniyesinde
otomasyon alır; kare sayısı tam sayı/yapısaldır. Örnek küçük resmi hareketli
bir nesnenin gerçek farklı zamanlarını gösterir; kullanıcı kopyalarında da
ayarlar değerlendirilir. Durağan resimler nötr kalır.

`creative-temporal.js` örnekleme planını ve premultiplied RGBA karışımını,
`temporal-media.js` bağımsız, duraklatılmış video çözücülerini yönetir.
Oynatılmış kare birikmez. Aynı zaman her seek sırasından yeniden üretilebilir.
Klip izi kendi kesitinin/döngüsünün başlangıcını, katman izi görünme başlangıcını
aşmaz. Sahne izi montaj geçmişini izler; önceki klip ve geçişleri içerebilir.
Reverse, hız rampası, freeze, katman fazı/döngüsü ve kare interpolasyonu mevcut
zaman haritalarından okunur. Sahne geçmişi renk/LUT, perspektif, maske, klip FX
ve temel video işlemlerini içerir; global Ghost Trail ve reactive FX tekrar
uygulanmaz. Bağımsız katmanlar, üst görsel ve sözler bu sahne izinin üstündedir.
Renk karşılaştırması için önce/sonra geçmişleri ayrı hazırlanır.

Önizleme tamamlanan zaman damgasını gösterir. Yeni seek, taslak, proje/kaynak
ve kalite değişimleri eski asenkron işin görüntüyü geri yazmasını engeller.
Hazırlanırken efekti kapatmak hemen nötr görüntüyü verir. Hata görünür bildirilir;
aynı ayarlarda her karede tekrar bildirilmez, bir düzenlemeden sonra yeniden
denenir. Sıfır güç, bypass ve %100 düşüş örneklemeyi çalıştırmaz.

En fazla dört çözücü grubu aynı anda çalışır; interpolasyon bir gruba ikinci
video ekleyebilir. Eşdeğer kaynak kareleri bir kez çözülür. Başarısız bir grup
diğer açık aramalar bitmeden serbest bırakılmaz. Ham kare LRU önbelleği en fazla
24 kare / 64 MiB'dir; geçici kompozisyonlar ve çizici yüzeyleri bu sınıra dahil
değildir. Yüksek çözünürlük ve birden fazla izli katman daha fazla bellek ister.
İç içe klip/sahne geçmişleri bütün bir karesel ağaç halinde önceden tutulmaz.

Doğrulama: **308 Node**, **21 Python sözleşme**, **7 yeni + 9 eski arayüz**
ve **3 gerçek MP4 testi** geçti. Üç MP4 normal arka planı, geçişli montajda
iç içe klip/sahne izini ve fazlı/ters video katmanını üçer karede karşılaştırır.
RGB ortalama 8 / luma ortalama 4 toleransları değişmedi. Yeni arayüz testleri
hızlı seek ve tekrar, hazırlanırken bypass, cache/çözücü tahliyesi, görünür
hata/yeniden deneme, şeffaf karışım, taslak/iptal, undo, eğri/kopya, renk
karşılaştırması ve iki tema/beş genişliği kapsar. Waitress/CSP üzerinde 31 video
preseti ve güncel preview/export betikleri doğrulandı.

Sınır: altı izli 405×720 dikey Chromium denemesinde yakın üç kare hazırlığının
ortancası yaklaşık **315 ms**, ilk hazırlık yaklaşık **814 ms** ölçüldü.
Paralel çözücüler bu denemede toplam süreyi düşürmedi; geçmiş sahnelerin yeniden
çizimi maliyetli. Bu ağır ayar akıcı/30 FPS önizleme sağlamaz; daha az iz ve düşük
önizleme kalitesi gerekir. MP4 bütün kareleri bekleyerek üretir. Telefon,
Safari/iOS, Firefox, tünel ve sesli ekran okuyucu bu turda doğrulanmadı.

İlerleme **121/200**, kalan **79**. VFX-32–40 henüz tamamlanmadı;
sıradaki preset **VFX-32 Time Slice**.


## VFX-32 — Time Slice

İkinci zaman preseti tamamlandı: 2–7 şerit farklı proje zamanlarından görüntü
alır. İlk şerit şimdiki zamanı, son şerit toplam gecikme kadar geçmişi gösterir.
Gecikme sağa, sola, aşağı veya yukarı artabilir. Toplam gecikme 0–1,50 sn,
kenar yumuşaklığı %0–100 ve ortak efekt gücü otomasyon alır. Şerit sayısı ve
yön yapısaldır. Zaman otomasyonu klip/katman yerel saatiyle karışmaz.

`creative-time-slice.js` yerel Canvas şerit çizimini ve ortak saf şerit
geometrisini içerir. Sert kenarlarda pikseller tam bir şeride aittir; tek
sayılı boyutlarda da aralık oluşmaz. Yumuşak kenarlarda komşu maskelerin
ağırlıkları toplamı birdir. Premultiplied RGBA karışımı saydam alanları ve
anahtarlanmış görüntüyü korur; %100 yumuşaklıkta şerit birleşimleri kararmaz.
Efekt gücü, sonuçla özgün kaynak arasında aynı alfa uzayında karışır.

Önizleme ve MP4, Ghost Trail'in zaman adresli örnekleyicisini kullanır.
Klipte örnekler aktif kesit/döngü başlangıcında; video katmanında görünme
başlangıcında tutulur. Sahne hedefi önceki montaj kliplerini de örnekleyebilir.
Sahne ve klip/katman hedefleri reverse, hız haritası, faz, loop, freeze ve
kare interpolasyonunu mevcut zaman haritalarından okur. Başlangıç sınırına
tutulan birden fazla şerit aynı görüntüyü yeniden çözüp çizmez: aynı zamanın
tek kompozisyonu paylaşılır. Renk karşılaştırmasının önce/sonra örnekleri ayrı
korunur. Oynatılmış kare birikmez; seek sırası sonucu değiştirmez.

Resim katmanları nötrdür. Sıfır gecikme, sıfır güç ve bypass geçmiş hazırlığını
çalıştırmaz. Katalogdaki ve kullanıcı kopyalarındaki küçük resim gerçek farklı
zamanları temsil eden hareket örneğiyle çizilir. Üst katman/sözler sahne
örneklemesine dahil değildir; mevcut efekt sırası korunur.

Doğrulama: **312 Node**, **22 Python sözleşme**, **5 yeni + 9 eski arayüz**
testi ve **3 gerçek MP4 testi / 4 ayrı çıktı / 12 kare karşılaştırması** geçti.
Saf testler dört yön, bütün şerit sayıları, sınır/faz/loop/reverse ve maske
ağırlıklarını kapsar. Arayüzde 48 alfa/karışım senaryosu, tek sayılı boyutlar,
bütün kontrollerin görüntüye etkisi, sekiz farklı yön/yumuşaklık görünümü,
hızlı seek/tekrar, sıfır gecikme, başlangıç sınırı, maksimum dikey çıktı,
önce/sonra renk, taslak/iptal, undo, yapısal kontroller, eğri/kullanıcı kopyası,
kilit, iki tema ve beş genişlik doğrulandı. Ghost Trail'in yedi regresyonu,
eski optik ve geometri kataloglarının iki authoring senaryosu da geçti.

MP4 karşılaştırmaları global eğrileri iki yönde, ters montaj klibindeki sert
şeritleri Ghost Trail ve geçişle birlikte, ayrıca fazlı/ters/döngülü video
katmanındaki yumuşak şeritleri sınar. Dört yönün hepsi gerçek çıktılarda
yer aldı; RGB ortalama 8 / luma ortalama 4 toleransları değiştirilmedi.
Waitress/CSP üzerinde 32 video preseti ve güncel preview/export betikleri
doğrulandı. Telefon, Safari/iOS, Firefox, tünel ve sesli ekran okuyucu bu turda
doğrulanmadı.

Performans sınırı devam ediyor: yedi şerit, %100 yumuşaklık ve 405×720 dikey
masaüstü Chromium örneğinde tek kare hazırlığı yaklaşık **320 ms** ölçüldü.
Bu yoğun ayar 30 FPS önizleme garantisi vermez; daha az şerit ve düşük
önizleme kalitesi gerekir. MP4 her kareyi bekler. Örnekleyici dört çözücü
grubu, 24 ham kare / 64 MiB önbellekle sınırlıdır; geçici kompozisyonlar ve
çizici yüzeyleri ek bellek kullanır.

İlerleme **122/200**, kalan **78**. Sırada **VFX-33 Shutter Stutter** var;
VFX-33–40 henüz tamamlanmadı.


## VFX-33 — Shutter Stutter

Üçüncü zaman preseti tamamlandı. Her döngü başlangıcındaki kaynak karesi
seçilen süre boyunca tutulur; kalan pencerede normal görüntü devam eder.
Klip, ses veya çıktı süresi değişmez. Kontroller: 0–3 sn tutma süresi,
0,05–3 sn tekrar aralığı, %0–100 döngü fazı ve ortak efekt gücü. Tutma süresi
en fazla tekrar aralığı kadardır. %100 güç tam kare tutar; daha düşük güç
tutulan kareyi güncel kareyle premultiplied RGBA uzayında karıştırır.

Tutma süresi ve güç otomasyon alır. Aralık ve faz yapısaldır; tutma eğrisi
düzenlenirken döngü başlangıcı kaymaz. Aralık 0,01 sn, faz %0,1 hassasiyetle
düzenlenir. Faz %0 ve %100 eşdeğerdir. Proje sıfırından önceye uzanan bir
tutma penceresi kesit/görünme başlangıcındaki kareye çekilir. Pencere başı
dahil, bitişi hariçtir; sınırlar kayan nokta toleransıyla hesaplanır.

`creative-shutter.js` proje saatine bağlı saf döngü hesabını içerir.
Oynatma geçmişi veya transport konumu değiştirilmez. `creative-temporal.js`
tek tutulan zaman damgasını ortak örnekleyiciye verir. Tam güçte tarihsel
kaynak doğrudan döner; ikinci bir karışım yüzeyi oluşturulmaz. Sıfır tutma,
sıfır güç, bypass ve serbest akış penceresi özgün kaynağı geri verir.

Hedefler sahne, montaj klibi ve video katmanıdır. Klipte tutma kendi aktif
kesit/döngü başlangıcını; katmanda görünme başlangıcını aşmaz. Ters oynatma,
hız haritası, freeze, katman fazı/döngüsü ve kare interpolasyonu mevcut zaman
haritalarından okunur. Sahne hedefi tutulan anda montajı, geçişleri, klip FX
ve temel video işlemlerini yeniden oluşturur. Bağımsız görsel/metin katmanları
ve son reactive FX kendi güncel zamanlarında kalır. Resim katmanları nötrdür.
Katalog ve kullanıcı kopyası küçük resimleri aktif bir tutma penceresini
örnekler; bütün preset ayarları değerlendirilir.

Doğrulama: **317 Node**, **23 Python sözleşme**, **6 yeni + 14 eski arayüz**
ve **3 gerçek MP4 testi / 3 çıktı / 13 kare karşılaştırması** geçti. Döngü
sınırları, faz sarma/eşdeğerliği, negatif ilk pencere, tutma sınırı, sıfır ve
bypass, eğriyle sabit başlangıç, seek tekrarı, clip/loop/reverse ve katman
haritaları test edildi. Gerçek önizlemede tutma aralığındaki iki zaman
piksel düzeyinde eşit, serbest akıştaki kare farklıdır. Aynı test önbellek
temizlendikten sonra da geçer. Şeffaf kısmi karışım ve tam kaynak kimliği,
bütün kontrollerin etkisi, önce/sonra renk geçmişi, taslak/iptal, undo/redo,
eğri/kullanıcı kopyası, kilit, iki tema ve beş genişlik doğrulandı.

MP4 testleri global tutma/güç eğrilerini hem tutma hem akış pencerelerinde,
ters montaj klibini Time Slice ve geçişle birlikte, ayrıca fazlı/ters/döngülü
video katmanını sınar. İlk çıktının 1,5 sn süresi ffprobe ile ayrıca
doğrulandı. RGB ortalama 8 / luma ortalama 4 toleransları değiştirilmedi.
Ghost Trail'in yedi, Time Slice'ın beş, eski geometri/optik kataloglarının
iki authoring regresyonu geçti. Waitress/CSP üzerinde 33 video preseti ve
güncel preview/export betikleri doğrulandı.

Performans: 3 sn tutma/aralık, %25 faz, tam güç ve 405×720 dikey masaüstü
Chromium denemesinde yakın üç kare hazırlığının ortancası yaklaşık **61 ms**
ölçüldü (42–117 ms). Bu 30 FPS önizleme garantisi değildir. Aynı zamanlı
çoklu efektler/katmanlar maliyeti artırabilir. MP4 her kareyi bekler; mevcut
24 ham kare / 64 MiB önbellek ve dört çözücü grubu sınırı korunur, geçici
kompozisyonlar ek bellek kullanır. Telefon, Safari/iOS, Firefox, tünel ve
sesli ekran okuyucu bu turda doğrulanmadı.

İlerleme **123/200**, kalan **77**. Sırada **VFX-34 Motion Smear** var;
VFX-34–40 henüz tamamlanmadı.


## VFX-34 — Motion Smear

Komşu zaman örneklerindeki renk/alfa değişimini ölçerek hareketli bölgelerde
sönümlenen iz oluşturur; statik bölgeleri korur. Optik akış veya nesne takibi
yapmaz. Kontroller: 1–6 geçmiş örnek, 0–1,5 sn iz süresi, %0–100 hareket eşiği
ve ortak güç. İz süresi 0,01 sn, eşik %0,1 hassasiyetle ayarlanır. İz süresi,
eşik ve güç otomasyon alır; örnek sayısı yapısaldır.

`creative-motion-smear.js` saf CPU çekirdeğini ve ortak ağırlık/maskeyi,
`creative-motion-smear-renderer.js` en fazla yedi dokulu WebGL birleştiricisini
içerir. Renkler premultiplied RGBA uzayında karşılaştırılır; komşu örnekler
arasındaki en büyük kanal farkı hareket maskesine dönüşür. Eşiğin üstündeki
0,08 aralık smoothstep ile yumuşatılır. Örnek ağırlıkları yaşla azalır ve
toplamları birdir; örnek sayısını artırmak efekt gücünü kendiliğinden artırmaz.
Şeffaf piksellerdeki görünmeyen RGB hareket sayılmaz; alfa değişimi sayılır.
Sonuç yine premultiplied uzayda ortak güçle karıştırılır.

Örnekleyici geçmiş zamanları hedefin görünme/kesit başlangıcına sınırlar.
Ters oynatma, hız, döngü, freeze, katman fazı ve kare interpolasyonu mevcut
zaman haritalarından okunur. Oynatılmış kare biriktirilmez; seek sırası sonucu
değiştirmez. Sahne hedefinde geçmiş montaj, geçiş, klip FX ve temel video
işlemleri yeniden çizilir; bağımsız katmanlar, altyazılar ve son reactive FX
kendi zamanlarında kalır. Klip ve video katmanı da ayrı hedeflenebilir.
Durağan resim katmanları nötrdür. Sıfır süre/güç, bypass, %100 eşik veya
geçmiş olmaması özgün kaynağı döndürür ve gereksiz örnekleme yapmaz.

GPU bağlantısı kaybolduğunda, doku yüklenemediğinde veya donanım sınırı
aşıldığında aynı CPU algoritması çalışır; bağlantı geri gelince GPU yeniden
hazırlanır. Gerçek context loss/restore ve texImage2D hatası test edildi.
18 farklı örnek sayısı/eşik/güç birleşiminde gerçek GPU ile CPU karşılaştırması
geçti (opak zemin üzerinde ortalama ≤0,8 ve yüzde 99 ≤4 kanal değeri).
Statik bölge, şeffaf kenar, komşu kare farkı ve hareket izleri ayrıca sınandı.

Doğrulama: **322 Node**, **24 Python sözleşme**, **6 yeni + 20 önceki arayüz**
ve **3 gerçek MP4 testi / 3 çıktı / 9 kare karşılaştırması** geçti. Taslak/iptal,
undo/redo, eğriler, tamsayı örnek sayısı, kullanıcı kopyası, kilit, iki tema
ve beş genişlik doğrulandı. Ghost Trail, Time Slice ve Shutter Stutter
regresyonları geçti. MP4 testleri sahne eğrilerini, Ghost Trail montajı içinde
ters klibi/geçişi ve fazlı/ters/döngülü video katmanını kapsar. RGB ortalama 8 /
luma ortalama 4 toleransları değiştirilmedi. Waitress/CSP üzerinde 34 video
preseti ve güncel önizleme/çıktı betikleri doğrulandı.

Performans: masaüstü headless Chromium'da altı geçmiş örnekli 405×720 sahne
hazırlığı yaklaşık **257 ms** ölçüldü. Ayrı 1280×720 birleştirici denemesinde
üç ölçümün ortancası GPU yolunda **84 ms**, CPU yolunda **211 ms** oldu.
Bunlar fiziksel cihaz/donanım hız garantisi değildir; 30 FPS önizleme garanti
edilmez. 24 ham kare / 64 MiB önbellek ve dört çözücü sınırı korunur; çalışma
yüzeyleri ve yediye kadar GPU dokusu ek bellek kullanır. Kaynak FPS'i geçmiş
kare hassasiyetini sınırlar. Telefon, Safari/iOS, Firefox, tünel ve sesli ekran
okuyucu bu turda doğrulanmadı.

İlerleme **124/200**, kalan **76**. Sırada **VFX-35 Reverse Echo** var.


## VFX-35 — Reverse Echo

Gelecek kareleri giderek sönümlenen yankılar olarak güncel görüntüye
yaklaştırır. Oynatılmış kare biriktirmez; proje saatinden geleceğe örnekler.
Kontroller: 1–6 yankı, 0,02–0,5 sn ileri örnek aralığı, %0–100 solma ve ortak
güç. Aralık 0,01 sn, solma %0,1 hassasiyetle ayarlanır. Aralık, solma ve güç
otomasyon alır; yankı sayısı yapısaldır. Azami ileri bakış altı × 0,5 = 3 sn.

`creative-temporal.js` ve `temporal-media.js` mevcut deterministik örnekleme
yolunu geleceğe genişletir. i'nci yankı `t + i × aralık` zamanından alınır;
ağırlığı `(1 - solma/100)^i` olur. Güncel kaynak ve mevcut yankılar toplam
ağırlıklarıyla normalize edilir, ardından ortak güçle karıştırılır. Native
Canvas `lighter` işlemi premultiplied RGBA karışımı sağlar; şeffaf kenarlara
koyu saçak eklenmez. Yeni bir WebGL bağlamı gerekmez.

Sahne hedefinde gelecekteki montaj ve geçişler, klip FX, renk/LUT, perspektif
ve temel video işlemleri yeniden oluşturulur. Bağımsız katmanlar, altyazı
ve son reactive FX kendi güncel zamanlarında kalır. Klip hedefi yalnızca
aynı kesitin geleceğini örnekler; döngülü montajda sınır o anki döngüye
taşınır. Çıkış geçişindeki klibin yankıları da kendi sonunu aşmaz. Son kare
tutulurken klip bitişi ileri kaymaz. Video katmanında örnekler görünme
bitişini ve proje sonunu aşmaz; kaynak döngüsü, faz, ters oynatma, hız rampası,
freeze ve kare interpolasyonu mevcut zaman haritalarından okunur.

Bitiş sınırı hariçtir: dışarıdaki örnekler atılır, son kareye yığılmaz veya
sonraki klipten alınmaz. Yaklaşan sonlarda yankı sayısı doğal olarak azalır.
İlk karede geleceğe bakış mümkündür. Gelecek örnek kalmayınca, %100 solma,
sıfır güç veya bypass durumunda özgün kaynak döner ve çözücüler bırakılır.
Durağan resim katmanları nötrdür. Seek sırası ve önbellek temizliği görüntüyü
değiştirmez; transport ve çıktı süresi değiştirilmez.

Doğrulama: **328 Node**, **25 Python sözleşme**, **6 yeni + 26 önceki arayüz**
ve **3 gerçek MP4 testi / 3 çıktı / 11 kare karşılaştırması** geçti. Sınırlar,
döngülü montajın iki geçiş kaynağı, reverse/ramp/freeze haritaları, katman
fazı/döngüsü, ilk kare, son karede devreden çıkma ve eğriler sınandı. Gerçek
tarayıcıda şeffaf karışım, bütün kontrollerin piksel etkisi, seek/önbellek
tekrarı, taslak/iptal, undo/redo, kullanıcı kopyası/küçük resmi, kilit, iki
tema ve beş genişlik doğrulandı. Son sınır düzeltmesinden sonra klip/katman
senaryosu, küçük resim karşılaştırması da piksel düzeyinde yeniden çalıştı.

MP4 senaryoları ilk kare ve proje sonu dahil gelecekteki montaj geçişleriyle
sahne eğrilerini, Ghost Trail montajı içindeki ters klibi ve fazlı/ters/döngülü
video katmanını kapsar. RGB ortalama 8 / luma ortalama 4 toleransları
değiştirilmedi. Motion Smear, Shutter Stutter, Time Slice, Ghost Trail ve
önceki geometri/optik authoring regresyonları geçti. Waitress/CSP üzerinde
35 video preseti ve güncel önizleme/çıktı betikleri doğrulandı.

Performans: masaüstü headless Chromium'da altı yankı, 0,1 sn aralık, sıfır
solma ve 405×720 dikey görüntüde üç yakın kare hazırlığının ortancası yaklaşık
**301 ms** ölçüldü (275–314 ms). Bu 30 FPS önizleme garantisi değildir.
Birden çok katman ve iç içe sahne/klip yankıları maliyeti artırır; MP4 her
kareyi bekler. 24 ham kare / 64 MiB önbellek ve dört çözücü sınırı korunur;
geçici kompozisyonlar ek bellek kullanır. Kaynak FPS'i örnek hassasiyetini
sınırlar. Telefon, Safari/iOS, Firefox, tünel ve sesli ekran okuyucu bu turda
doğrulanmadı.

İlerleme **125/200**, kalan **75**. Sırada **VFX-36 Volumetric Rays** var.


## Son teslim — kalan 75 preset

**Video VFX-36–50:** radyal ışınlar, hareketli damla kırılması, sis katmanları,
bölgesel sıcak hava dalgası, dört yönlü ışık sızıntısı, tarama çizgileri,
halftone, kenar/grid blueprint, kağıt paleti, Voronoi vitray, film şeridi,
gecikmeli ikinci gerçek görüntülü split screen, iris, parlaklık maskeli
görünme ve sıralı paneller. Sahne, klip ve görsel/video katmanı ortak
renderer'ı kullanır. Iris/luma/paneller görünmenin yerel saatini, otomasyon
proje saatini kullanır. Split Screen Offset önceki gerçek kaynağı örnekler;
ters oynatma, faz, döngü, hız ve görünme sınırlarını mevcut sampler çözer.

**Audio AFX-06–10 / 31–35 / 41–50:** cathedral/plate, vuruştan önce yükselen
reverse reverb, pitch feedback shimmer, yakalanmış reverb freeze, octave/fifth,
temel perdeyi koruyan formant zarfı, gerçek Hz kaydırma, oversampled ring,
parallel compression, transient shaping, harici kaynaklı Soft Pump, mid/side
air, alt frekans mono anchor ve beş granular algoritma. Pitch Rain nota ve
olasılık listeleri düzenlenebilir. Capture başlangıç/bitiş/hold değerleri
proje ile saklanır. Soft Pump kaynak seçimi ayrıca kanal sidechain'ini
etkinleştirmez; çift ducking yapılmaz. Bağımlılık sırası ve döngü doğrulaması
track ve bus hedeflerinde ortaktır.

Bu **20 yeni ses preseti oynatmadan önce hazırlanır**. İleri bakış/capture
gerektiren işlemlerle tarayıcı önizlemesi ve export aynı Python PCM motorunu
kullanır. Hazır tampon proje saatine göre çalar; sarma yeniden hesaplatmaz.
Ses ayarı, dosyası veya routing değişince tampon geçersizleşir; oynatma
durur ve görünür durum mesajı yeniden oynatmada hazırlık yapılacağını söyler.
Hazırlık iptal edilebilir; eski istek yeni ayarın sesini ezemez. Örneği dinle
aynı algoritmayla üretilmiş referans sesi kullanır. Master monitor seviyesi,
duyulan sesin loudness/analiz tap'i ve transport mevcut yola bağlıdır.

FFT/pitch/ring hazırlığı sınırlı pencerelerle, granular ve miks kontrolleri
iptal noktalarıyla çalışır; rastgelelik yerel ve tohumludur. Buna rağmen
hazırlanmış kanal zinciri tüm giriş PCM'ini ve çıkış tamponunu tutar.
Uzun/çok kanallı projeler daha fazla süre ve bellek gerektirir. Bu presetlerde
oynatım sırasında anlık knob işleme veya telefonda sabit FPS garantisi yoktur.
Çıktı mevcut proje süresiyle sınırlıdır; reverb/freeze kuyruğu süreyi otomatik
uzatmaz. Kanal/bus gain, pan ve ortak miks davranışları korunur.

**Text TFX-31–50:** dört gerçek kelime vurgusu, sonraki satır önizlemesi,
editorial/credit/chapter/quote/location başlıkları, uzun gölge, echo, halo,
çift mürekkep, ışık taraması, dust/liquid/radial ripple/slice ve iki düzenlenebilir
metin arasında morph. TFX-31–34 gerçek kelime zamanları gerektirir; zaman
olmadan tahmin üretmez. TFX-35 söz hedeflidir. TFX-36–40 ve TFX-50 metin/başlık
katmanı hedeflidir; uygun olmayan hedeflerde düğmeler açıklamayla devre dışıdır.
Kelime efektleri kapalı veya sıfır güçteyken mevcut karaoke ve iki satırlı
şablon piksel olarak korunur. Başlıkların ikinci satırı ve Türkçe/Unicode
içeriği desteklenir. TFX-50 ikinci metni mevcut kutuya sarıp sığdırır;
kaynak metni değiştirmez. Radial ripple premultiplied RGBA örnekler.

**Reactive ARX-31–50:** gerçek FFT centroid/chroma, üç bant renk, RMS bloom,
transient ışık, kick lens, treble fray, mid warp, onset fracture, bass bend;
kelime pulse, harf spektrumu, vokal halo, bas konturu, beat tracking;
beat camera, bar kaleido, iki bant call/response, enerji yükselişi spiral ve
sessizlik sonrası bloom. Bütün zarflar hazırlanmış nedensel analiz/proje
saatinden okunur; oynatılmış kare sayısı veya önceki seek sırası kullanılmaz.
Manuel/proje BPM ve seçili track/bus pre/post kaynakları korunur. Stereo
antifaz enerjisi analizde kaybolmaz. ARX-41–45 arka planı değiştirmez;
ARX-41 gerçek kelime zamanlarıyla çalışır. Kontur min/max sınırları denetlenir.
Eski analizde yeni RMS/chroma verisi yoksa ilgili efekt nötr kalır ve yeniden
analiz hazırlama açıklaması görünür. Sessizlikte sahte harmonik/olay üretilmez.

**Kontroller ve düzeltmeler:** sayısal ince giriş, birimler, otomasyon,
taslak/iptal, önce/sonra, undo/redo, kullanıcı kopyaları ve arama ortak katalog
üzerinden çalışır. Ayrık yön/dalga/beat seçeneklerinin isimleri vardır.
Metin/nota listeleri typed string alanlarıdır; boyut/kontrol karakteri/nota
aralıkları istemci ve sunucuda doğrulanır ve HTML olarak yorumlanmaz.
İlk AudioWorklet render kuantumunun proje offset'i constructor options ile
verilir; 48 kHz soğuk başlangıçta mesaj yetişme yarışına bağlı kayma giderildi.

**Son doğrulama:** 335 JavaScript ve 44 Python testi geçti. 88 senaryoluk
arayüz turunda 87 geçti; genişleyen spektrum aramasındaki eski adet beklentisi
6 olarak düzeltildi ve ilgili senaryo geçti. Son metin/bypass kontrolleriyle
birlikte 89 farklı arayüz senaryosu kapsandı; son 6 testlik tekrar tamamen
geçti. İki tema, 320/375/768/1024/1440 genişlik, gerçek native ses örnekleri,
hazırlık/iptal, hedefler, kilitler, geçmiş ve kullanıcı presetleri denetlendi.

5 MP4 testi **29 çıktı / 107 kare karşılaştırmasını** geçti: son 15 video,
20 metin ve 20 reactive preset; gecikmeli ters video katmanı ve gerçek
AAC sesine mux edilmiş Hz kaydırma. RGB ortalama 8 / luma ortalama 4
toleransları değiştirilmedi. Yeni prepared seslerin track/bus hedeflerinde
40 gerçek WAV karşılaştırması da 44 Python testine dahildir. Granular örnekleme
tam proje uzunluğunda indeks dizisi oluşturmadan, yalnızca tane konumlarıyla
çalışır; eski lineer interpolasyonla uç ve kesirli konum eşdeğerliği sınandı.
20 prepared ses örneği bu son değişiklikten sonra yeniden gerçek tarayıcıda
dinletildi. Waitress/CSP
üzerinden 50×4 katalog ve 17 güncel JS dosyasının diskteki sürümle eşitliği
doğrulandı. Yeni renderer'lar önizleme ve offline Canvas listesinde mevcuttur.

Fiziksel telefon, Safari/iOS, Firefox, public tünel ve sesli ekran okuyucu
bu turda doğrulanmadı. Yeni görsel FX ağır sahnelerde önizleme maliyetini
artırabilir; gerçek zamanlı FPS ölçümü bu teslimin kanıtı değildir.

Son durum: **200/200, kalan 0**.
