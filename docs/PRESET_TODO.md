# Efekt presetleri TODO — 200 yeni tasarım

Tarih: 15 Ekim 2026. Durum: **Onaylanan beş aşama tamamlandı.**

İlerleme: **200/200** — Video 50/50, Audio 50/50, Text 50/50,
Audio reactive 50/50. Kullanım, uygulama sınırları ve doğrulama:
[PRESET_IMPLEMENTATION.md](PRESET_IMPLEMENTATION.md).

İstek dört ayrı katalog olarak ele alındı: 50 video FX, 50 audio FX,
50 text FX ve 50 audio reactive FX. Aşağıdaki 200 kutu yalnızca presetleri
sayar; ortak katalog araçları veya efekt motorları bu sayıya dahil değildir.
Mevcut presetler bu 200 maddenin yerine sayılmaz.

## Tasarım sınırları ve mevcut durum

İncelenen başlangıç noktaları: `static/project-schema.json`,
`static/js/video-controls.js`, `static/js/track-effects.js`,
`static/js/lyric-renderer.js`, `static/js/titles.js` ve
`static/js/particle-editor.js`.

- Video tarafında renk, eğriler/LUT, film kaplamaları, maske, hareket ve
  temel bas efektleri mevcut. Yeni optik, geometrik ve zamansal efektler gerekir.
- Ses zincirinde EQ, filtre, reverb, delay, kompresör/gate/limiter ve
  sidechain mevcut. Modülasyon, distorsiyon, pitch ve granular aileleri gerekir.
- Başlık giriş/çıkışları ve söz/kelime animasyonları mevcut. Harf düzeyinde
  hareket, malzeme, kontur ve maske animasyonları genişletilecek.
- Bas tepkisi, görselleştiriciler ve üç parçacık görünümü mevcut. Yeni
  spektrum geometrileri, stereo analizi ve olay tetikleyicileri gerekir.

Her alt başlığın **Motor** satırı gerekli işi belirtir: **mevcut** mevcut
işlemcilerle yeni kombinasyon; **genişletme** mevcut davranışa yeni kontrol;
**yeni** yeni bir efekt algoritması. Bu sınıflandırma iş tahminidir;
uygulama sırasında ilgili preview/export yolları birlikte incelenecek.
İsim değişikliği veya aynı efektin yalnızca daha güçlü/zayıf kopyası ayrı
preset sayılmaz. Her maddenin ayırt edici bir davranışı ve kullanım amacı vardır.

## Ortak kullanım tasarımı

Katalogda kategori, efekt ailesi, ad ve açıklamayla arama; favoriler;
son kullanılanlar; küçük görsel/sesli önizleme ve kullanıcı presetini
farklı kaydetme bulunacak. Seçili presetin amacı ve değiştireceği alanlar
uygulamadan önce görülebilecek.

Her preset 3–5 anlamlı makro kontrol sunacak; gelişmiş görünümde zincir
sırası ve ayrıntılı değerler açılacak. Süreler ms/sn veya ritim bölümü,
frekanslar Hz, kazançlar dB, geometrik değerler px/°/% ile gösterilecek.
Ortak kontroller: güç, bypass, önce/sonra karşılaştırması ve sıfırlama.
Mevcut otomasyon/anahtar kare sistemine uygun sürekli parametreler bağlanacak;
algoritma seçimi gibi ayrık değerler açıkça ayrı gösterilecek.

Uygulama hedefi her zaman görünür olacak: seçili video klibi/katmanı,
ses kanalı/bus, metin/başlık veya söz satırı. Preset sadece kendi efekt
alanlarını değiştirir; medya, metin içeriği, klip zamanlaması ve mevcut
otomasyon kullanıcı seçimi olmadan değiştirilmez. Otomasyonlu alana
uygulama varsayılan olarak yalnızca taban değeri değiştirir; eğriyi değiştirme
ayrı ve açık bir eylemdir. Bir preset uygulaması tek geri alma adımıdır.

Video FX bölümündeki hareketler klip/proje saatinden çalışır; ses analizi
gerektirmez. Audio reactive bölümündekiler ise seçilen ses kaynağına bağlıdır.
Text FX bağımsız metin ve başlıklarda kullanılabilir; sözlerde zamanlama
gerektiren seçenekler mevcut satır/kelime zamanlarını kullanır. Eksik kelime
zamanlarında bunun gerektiği gösterilir, zamanlar kendiliğinden uydurulmaz.

## 1. Video FX — 50 preset

### Renk ayrımı ve film görünümü

Motor: **mevcut** renk eğrileri/LUT; **genişletme** tonal bölge ve renk aralığı seçimi.

- [x] **VFX-01 · Amber Silver** — Sıcak ışıklarla gümüş gölgeleri ayıran sinematik ton. Kontroller: ışık sıcaklığı, gölge tonu, ayrım eşiği, karışım.
- [x] **VFX-02 · Selective Red** — Kırmızı öğeleri canlı tutup diğer renkleri soldurur. Kontroller: hedef renk, tolerans, kenar yumuşaklığı, arka plan doygunluğu.
- [x] **VFX-03 · Bleach Chrome** — Gümüşlü parlaklık ve sıkı kontrastla metalik görünüm. Kontroller: renk kaybı, kontrast eğrisi, parlak alan koruması, güç.
- [x] **VFX-04 · Cross Process** — Gölgelerde yeşil, ışıklarda magenta sapmasıyla çapraz banyo görünümü. Kontroller: iki ton, geçiş noktası, kanal eğrileri.
- [x] **VFX-05 · Dusk Duotone** — Görüntüyü iki renkli alacakaranlık paletine dönüştürür. Kontroller: koyu/açık renk, eşik, ton yumuşaklığı, karışım.

### Film yüzeyi ve kayıt kusurları

Motor: **mevcut** grain/dust/scanlines; **yeni** çizik, kare titreşimi ve tarama modeli.

- [x] **VFX-06 · Super 8 Gate** — İnce gren, çerçeve titreşimi ve küçük pozlama dalgalanmaları. Kontroller: gren boyutu, kare kayması, pozlama sapması, hız.
- [x] **VFX-07 · Archive Scratches** — Görüntü boyunca ilerleyen eski film çizikleri. Kontroller: çizik sıklığı, uzunluğu, kontrastı, tohum.
- [x] **VFX-08 · Tape Tracking** — Alt kenarda analog takip bandı ve yatay kayıt kayması. Kontroller: bant yüksekliği, kayma, gürültü, tekrar süresi.
- [x] **VFX-09 · CRT Phosphor** — Fosfor maskesi ve kavisle tüplü ekran görünümü. Kontroller: maske adımı, tarama çizgisi, kavis, ışık yayılımı.
- [x] **VFX-10 · Projector Flicker** — Mekanik projeksiyon ritmi, hafif vignette ve periyodik ışık dalgası. Kontroller: titreşim hızı, derinlik, vignette, faz.

### Optik ve odak

Motor: **mevcut** blur/bloom; **yeni** yönlü/radyal bulanıklık, halation ve odak maskeleri.

- [x] **VFX-11 · Anamorphic Streak** — Parlak alanlardan yatay sinema lensi çizgileri çıkarır. Kontroller: ışık eşiği, çizgi uzunluğu, renk, güç.
- [x] **VFX-12 · Halation Red** — Parlak kenarlara sıcak kırmızı film taşması ekler. Kontroller: eşik, yayılma yarıçapı, sıcaklık, karışım.
- [x] **VFX-13 · Tilt Miniature** — Seçilen odak şeridi dışında görüntüyü yumuşatır. Kontroller: odak konumu, şerit genişliği, açı, blur.
- [x] **VFX-14 · Split Diopter** — İki ayrı odak bölgesi arasında yumuşak optik sınır kurar. Kontroller: bölge merkezleri, odak yarıçapları, sınır geçişi.
- [x] **VFX-15 · Dream Diffusion** — Parlaklık koruyan yumuşak odak ve ışık halesi. Kontroller: diffusion yarıçapı, bloom eşiği, karışım, ayrıntı koruması.

### Objektif ve perspektif

Motor: **mevcut** perspektif; **yeni** lens distorsiyonu ve silindirik örnekleme.

- [x] **VFX-16 · Fisheye Bubble** — Merkez çevresinde balıkgözü büyütme. Kontroller: merkez, kavis, yarıçap, kenar doldurma.
- [x] **VFX-17 · Barrel Vintage** — Dışa açılan lens eğrisiyle eski geniş açı hissi. Kontroller: distorsiyon, optik merkez, kırpma, vignette.
- [x] **VFX-18 · Pincushion Tunnel** — Kenarları içeri çekerek tünel derinliği yaratır. Kontroller: çekim miktarı, merkez, zoom, karışım.
- [x] **VFX-19 · Isometric Window** — Görüntüyü üç boyutlu bir pencere gibi yatırır. Kontroller: yatay/dikey açı, derinlik, konum, çerçeve kalınlığı.
- [x] **VFX-20 · Cylinder Wrap** — Görüntüyü dönen silindir yüzeyine sarar. Kontroller: silindir yarıçapı, dönüş, görünür yay, gölgeleme.

### Ayna ve kırılma

Motor: **mevcut** mirror/kaleidoscope; **genişletme/yeni** bölünmüş yüzey ve prizmatik örnekleme.

- [x] **VFX-21 · Prism Facets** — Görüntüyü farklı açılarda kırılan prizma parçalarına böler. Kontroller: yüzey sayısı, kırılma, renk ayrımı, merkez.
- [x] **VFX-22 · Liquid Mirror** — Ayna eksenini yavaş dalgalanan bir yüzeye dönüştürür. Kontroller: eksen, dalga boyu, genlik, hız.
- [x] **VFX-23 · Shattered Tiles** — Görüntü parçalarını aralıklı cam karolar gibi dağıtır. Kontroller: karo boyutu, aralık, dönüş sapması, tohum.
- [x] **VFX-24 · Infinite Corridor** — İç içe perspektif kopyalarıyla sonsuz koridor. Kontroller: tekrar sayısı, ölçek oranı, kaçış noktası, opaklık düşüşü.
- [x] **VFX-25 · Tri Mirror** — Üçgen simetriyle dönen mozaik kompozisyon. Kontroller: üçgen ölçeği, simetri açısı, merkez, dönüş hızı.

### Dijital bozulma

Motor: **mevcut** glitch/RGB/pixelate; **genişletme/yeni** bölgesel blok, palet ve satır işlemleri.

- [x] **VFX-26 · Codec Blocks** — Hareket eden bloklarda kontrollü sıkıştırma kırılması görünümü. Kontroller: blok boyutu, bozulma oranı, yenileme süresi, tohum.
- [x] **VFX-27 · RGB Scan Tear** — Hareketli tarama bandında kanalları farklı yönlere kaydırır. Kontroller: bant yüksekliği, kanal mesafesi, tarama hızı, yön.
- [x] **VFX-28 · Pixel Sort Ribbons** — Eşik üstü pikselleri satır/sütun boyunca şeritlere sıralar. Kontroller: parlaklık eşiği, yön, azami şerit uzunluğu, karışım.
- [x] **VFX-29 · Terminal Dither** — Sınırlı paletle sıralı dithering görünümü. Kontroller: palet, hücre ölçeği, eşik, kontrast.
- [x] **VFX-30 · Signal Dropout** — Kısa bölgesel sinyal kayıpları ve yatay kopmalar. Kontroller: olay aralığı, tutma süresi, bölge yüksekliği, tohum.

### Zaman ve hareket izi

Motor: **yeni** geçmiş kare örnekleme ve deterministik zamansal birleştirme.
İleri/geri aramada da doğru kaynak karelerinden yeniden hesaplanır.

- [x] **VFX-31 · Ghost Trail** — Önceki kareleri giderek solan hareket hayaletleri olarak ekler. Kontroller: iz sayısı, kare aralığı, opaklık düşüşü, karışım.
- [x] **VFX-32 · Time Slice** — Görüntü şeritlerine farklı zaman gecikmeleri uygular. Kontroller: şerit sayısı, toplam gecikme, yön, sınır yumuşaklığı.
- [x] **VFX-33 · Shutter Stutter** — Klip süresini değiştirmeden seçilen kareleri ritmik tutar. Kontroller: tutma süresi, tekrar aralığı, faz, karışım.
- [x] **VFX-34 · Motion Smear** — Ardışık kare farklarını kullanarak hareketli bölgelerde iz oluşturur. Kontroller: hareket eşiği, örnek sayısı, iz süresi, güç.
- [x] **VFX-35 · Reverse Echo** — Gelecek kareleri geri yaklaşan görsel yankı olarak birleştirir. Kontroller: ileri örnek aralığı, yankı sayısı, solma, karışım.

### Atmosfer ve ışık

Motor: **mevcut** rain/lightleak; **yeni** hacimsel ışık, sis ve kırılma alanları.

- [x] **VFX-36 · Volumetric Rays** — Seçili ışık merkezinden görüntüye ışınlar yayar. Kontroller: merkez, ışık eşiği, ışın uzunluğu, yoğunluk.
- [x] **VFX-37 · Window Rain** — Cam damlalarının arkasında yerel kırılma oluşturur. Kontroller: damla boyutu, yoğunluk, akış hızı, kırılma.
- [x] **VFX-38 · Fog Layers** — Farklı hızlarda hareket eden derinlikli sis katları. Kontroller: kat sayısı, yoğunluk, yön, hız farkı.
- [x] **VFX-39 · Heat Haze** — Sıcak hava gibi yukarı akan yerel görüntü dalgası. Kontroller: genlik, dalga ölçeği, yükselme hızı, bölge maskesi.
- [x] **VFX-40 · Light Leak Sweep** — Çerçeve kenarından geçen renkli ışık sızıntısı. Kontroller: kenar, renk, geçiş süresi, yayılma.

### Grafik ve illüstrasyon

Motor: **mevcut** edge/pixelate; **yeni** çizgi tarama, halftone ve hücresel görüntü dönüşümü.

- [x] **VFX-41 · Ink Etching** — Tonları yönlü mürekkep taramalarına dönüştürür. Kontroller: çizgi açısı, sıklık, ton katmanı, kağıt rengi.
- [x] **VFX-42 · Comic Halftone** — Baskı noktaları ve konturla çizgi roman görünümü. Kontroller: nokta adımı, kontur kalınlığı, palet, eşik.
- [x] **VFX-43 · Blueprint Lines** — Nesne kenarlarını teknik çizim gibi mavi yüzeye çizer. Kontroller: kenar eşiği, çizgi rengi, zemin, ızgara adımı.
- [x] **VFX-44 · Paper Cutout** — Ton bölgelerini az sayıda düz renkli kağıt katına indirger. Kontroller: ton sayısı, palet, sınır yumuşaklığı, kat gölgesi.
- [x] **VFX-45 · Stained Glass** — Hücresel renk parçaları ve koyu derzlerle vitray etkisi. Kontroller: hücre boyutu, derz kalınlığı, renk düzleştirme, tohum.

### Kadraj ve geçiş kompozisyonu

Motor: **mevcut** maske/keyframe; **genişletme/yeni** kompozit geçiş ve bölmeli kadraj.
Geçişler klip zamanını değiştirmez; giriş/çıkış aralığına uygulanır.

- [x] **VFX-46 · Filmstrip Scroll** — Kenar delikleri ve kayan çoklu karelerle film şeridi. Kontroller: kare sayısı, kayma hızı, delik boyutu, aralık.
- [x] **VFX-47 · Split Screen Offset** — İki panelde farklı kadraj ve küçük zaman farkı. Kontroller: bölme ekseni, oran, panel gecikmesi, ayırıcı.
- [x] **VFX-48 · Iris Reveal** — Ayarlanabilir çokgen diyaframla görüntüyü açar/kapatır. Kontroller: yaprak sayısı, merkez, süre, kenar yumuşaklığı.
- [x] **VFX-49 · Luma Dissolve** — Görüntü parlaklığına göre aşamalı görünme. Kontroller: eşik eğrisi, geçiş süresi, yön, yumuşaklık.
- [x] **VFX-50 · Shutter Panels** — Paralel paneller halinde ardışık açılma. Kontroller: panel sayısı, yön, panel gecikmesi, giriş/çıkış süresi.

## 2. Audio FX — 50 preset

Hedef seçili kanal veya uygun bus'tır. Her preset ayrıca dry/wet ve çıkış
kazancı sunar. Karşılaştırmada algılanan ses yüksekliğini eşitleme seçeneği
bulunur; preset mevcut kanal seviyesini kendiliğinden değiştirmez.
Yeni DSP aileleri tarayıcı dinleme ve ses dosyası/MP4 çıktısında birlikte uygulanır.

### Oda ve yakın alan

Motor: **genişletme** mevcut reverb için ayarlanabilir erken yansıma ve sönüm.

- [x] **AFX-01 · Wood Room** — Kısa, sıcak ahşap oda yansımaları. Kontroller: oda boyutu, erken yansıma, yüksek frekans sönümü, predelay.
- [x] **AFX-02 · Drum Chamber** — Vurmalılara yoğun ama kısa oda kuyruğu. Kontroller: predelay, kuyruk süresi, difüzyon, alt kesim.
- [x] **AFX-03 · Vocal Booth** — Yakın vokale hafif hacim ve kontrollü gövde. Kontroller: erken yansıma seviyesi, sönüm, predelay, orta bant EQ.
- [x] **AFX-04 · Stairwell** — Dikey sert yüzeylerde belirgin aralıklı yansımalar. Kontroller: ilk yansıma aralığı, yansıma sayısı, sönüm, stereo dağılım.
- [x] **AFX-05 · Dark Club** — Alt frekansları taşırmadan karanlık geniş oda. Kontroller: kuyruk, üst kesim, alt kesim, difüzyon.

### Büyük ve yaratıcı reverb

Motor: **genişletme** reverb; **yeni** ters zarf, pitch feedback ve kuyruk dondurma.

- [x] **AFX-06 · Cathedral Air** — Uzun, açık ve gecikmeli katedral alanı. Kontroller: kuyruk, predelay, difüzyon, üst frekans sönümü.
- [x] **AFX-07 · Metal Plate** — Yoğun ve parlak metal plaka yankısı. Kontroller: yoğunluk, kuyruk, parlaklık, predelay.
- [x] **AFX-08 · Reverse Bloom** — Vuruş öncesine yükselen ters reverb. Kontroller: yükseliş süresi, tepe konumu, filtre, karışım; ileri örnekleme gereksinimi gösterilir.
- [x] **AFX-09 · Shimmer Cloud** — Kuyruk içinde oktav yükselen parıltılı alan. Kontroller: pitch aralığı, pitch feedback, kuyruk, üst kesim.
- [x] **AFX-10 · Frozen Cathedral** — İşaretlenen anda reverb kuyruğunu tutarak drone üretir. Kontroller: yakalama zamanı, tutma süresi, sönüm, filtre; yakalama proje olayı olarak saklanır.

### Delay ve uzamsal yankı

Motor: **mevcut** delay/EQ; **genişletme/yeni** çoklu tap, stereo yönlendirme ve ducking.

- [x] **AFX-11 · Slapback Stage** — Tek kısa yankıyla sahne derinliği. Kontroller: gecikme ms, tekrar seviyesi, renk filtresi, stereo konum.
- [x] **AFX-12 · Dotted Ping Pong** — Noktalı ritim bölümüyle sağ/sol sekme. Kontroller: BPM kaynağı, bölüm, feedback, stereo açıklık.
- [x] **AFX-13 · Dub Throw** — Koyu filtreli, otomasyonla açılan uzun tekrarlar. Kontroller: süre/bölüm, feedback, filtre rezonansı, gönderim miktarı.
- [x] **AFX-14 · Multi Tap Stair** — Artan aralıklarla basamaklanan dört yankı. Kontroller: temel aralık, tap dağılımı, seviye eğrisi, pan dağılımı.
- [x] **AFX-15 · Ducking Echo** — Kaynak çalarken geri çekilen, boşluklarda çıkan delay. Kontroller: gecikme, ducking eşiği, derinlik, release.

### Analog modülasyon

Motor: **yeni** chorus, flanger, phaser, vibrato ve rotary işlemcileri.

- [x] **AFX-16 · Ensemble Chorus** — Çok sesli küçük gecikmelerle yaylı/pad genişliği. Kontroller: ses sayısı, gecikme, derinlik, hız.
- [x] **AFX-17 · Jet Flanger** — Tarama yapan kısa feedback gecikmesiyle jet hareketi. Kontroller: tarama aralığı, hız, feedback, faz.
- [x] **AFX-18 · Velvet Phaser** — Yumuşak dolaşan faz çentikleri. Kontroller: kademe sayısı, merkez frekans, tarama hızı, rezonans.
- [x] **AFX-19 · Tape Vibrato** — Eski bant gibi ince perde salınımı. Kontroller: hız, perde derinliği, düzensizlik, stereo faz.
- [x] **AFX-20 · Rotary Cabinet** — Dönen hoparlörün genlik ve Doppler hareketi. Kontroller: düşük/yüksek hız, hızlanma süresi, mikrofon mesafesi, rotor dengesi.

### Saturation ve distorsiyon

Motor: **yeni** harmonik şekillendirme ve bant ayrımlı distorsiyon; mevcut EQ ile tonlama.

- [x] **AFX-21 · Warm Tape** — Yumuşak tepe sıkışması ve sıcak harmonikler. Kontroller: drive, bias, yüksek frekans kaybı, çıkış telafisi.
- [x] **AFX-22 · Tube Glow** — Hafif asimetrik tüp doygunluğuyla gövde. Kontroller: drive, asimetri, ton, karışım.
- [x] **AFX-23 · Parallel Grit** — Temiz sinyalle sert distorsiyonu paralel karıştırır. Kontroller: drive, distorsiyon filtresi, paralel oran, çıkış.
- [x] **AFX-24 · Bass Fuzz Split** — Alt bası temiz tutup üst harmonikleri kirletir. Kontroller: bölme frekansı, fuzz, ton, üst bant oranı.
- [x] **AFX-25 · Wavefold Spark** — Dalga tepelerini katlayarak parlak sentetik harmonikler. Kontroller: fold eşiği, kat sayısı, bias, üst kesim.

### Lo-fi ve dijital doku

Motor: **yeni** bit/sample azaltma, bant salınımı ve deterministik yüzey gürültüsü.

- [x] **AFX-26 · Bitcrush Arcade** — Düşük bit çözünürlüğüyle oyun konsolu dokusu. Kontroller: bit sayısı, sample-hold oranı, filtre, karışım.
- [x] **AFX-27 · Dusty Vinyl** — Plak çıtırtısı ve yumuşak bant sınırlaması. Kontroller: çıtırtı yoğunluğu, yüzey gürültüsü, alt/üst kesim, tohum.
- [x] **AFX-28 · Broken Cassette** — Yavaş wow ve hızlı flutter ile eskimiş kaset. Kontroller: wow derinliği, flutter derinliği, hızlar, dropout oranı.
- [x] **AFX-29 · Telephone Booth** — Dar bantlı rezonans ve hafif sürüşle telefon karakteri. Kontroller: alt/üst sınır Hz, rezonans, drive, karışım.
- [x] **AFX-30 · Sample Rate Dust** — Örnekleme düşürme ve aliasing dokusunu tonlanabilir biçimde sunar. Kontroller: hedef örnek oranı, ön filtre, son filtre, güç.

### Perde ve ses rengi

Motor: **yeni** süreyi koruyan pitch/formant, harmonizer, frequency shifter ve ring modulation.

- [x] **AFX-31 · Octave Mist** — Temiz kaynak altında yumuşak bir alt oktav. Kontroller: oktav seviyesi, takip yumuşaklığı, alt kesim, karışım.
- [x] **AFX-32 · Fifth Halo** — Kaynağa beşli üst armoni ve kısa alan ekler. Kontroller: semiton aralığı, armoni seviyesi, gecikme, reverb.
- [x] **AFX-33 · Formant Shadow** — Perdeyi koruyup vokal rengini koyulaştırır. Kontroller: formant kayması, işlem bölgesi, yumuşatma, karışım.
- [x] **AFX-34 · Frequency Drift** — Tüm kısmi frekanslara sabit Hz kaydırma uygulayan metalik doku. Kontroller: kaydırma Hz, LFO miktarı, hız, karışım.
- [x] **AFX-35 · Ring Robot** — Taşıyıcıyla çarpılarak robotik yan bantlar üretir. Kontroller: taşıyıcı Hz, dalga biçimi, modülasyon miktarı, filtre.

### Ritim ve filtre hareketi

Motor: **mevcut** otomasyon/filtre; **yeni** envelope follower, step gate ve sample reorder.

- [x] **AFX-36 · Tempo Tremolo** — Ritme bağlı ses seviyesi salınımı. Kontroller: bölüm, dalga biçimi, derinlik, faz.
- [x] **AFX-37 · Auto Wah** — Kaynak enerjisiyle açılıp kapanan rezonans filtresi. Kontroller: frekans aralığı, hassasiyet, attack/release, rezonans.
- [x] **AFX-38 · Step Gate** — Düzenlenebilir 16 adımlı aç/kapa ritmi. Kontroller: adım deseni, bölüm, gate uzunluğu, yumuşatma.
- [x] **AFX-39 · Filter Staircase** — Her ritim adımında farklı filtre kesimi. Kontroller: adım değerleri, alt/üst frekans, rezonans, glide.
- [x] **AFX-40 · Stutter Grid** — Seçili ritim hücresini tamponlayıp tekrarlar. Kontroller: hücre süresi, tekrar deseni, çapraz geçiş, başlangıç fazı.

### Dinamik ve stereo karakter

Motor: **mevcut** dynamics/sidechain; **genişletme/yeni** transient ve mid/side işleme.

- [x] **AFX-41 · Parallel Punch** — Sert kompresyonu temiz atakla birleştirir. Kontroller: eşik, oran, attack/release, paralel karışım.
- [x] **AFX-42 · Transient Snap** — Sustain artırmadan vurmalı ataklarını öne çıkarır. Kontroller: attack kazancı, sustain kazancı, algılama süresi, çıkış.
- [x] **AFX-43 · Soft Pump** — Seçili sidechain kaynağına müzikal seviye eğilmesi. Kontroller: kaynak, derinlik, attack/release, filtre; kaynak yoksa seçim gereksinimi gösterilir.
- [x] **AFX-44 · Mid Side Air** — Merkez gövdesini tutup yan kanallara üst frekans açıklığı. Kontroller: crossover, yan bant kazancı, genişlik, merkez kazancı.
- [x] **AFX-45 · Mono Anchor** — Alt bandı merkeze toplayıp üst alanı genişletir. Kontroller: mono sınırı Hz, geçiş eğimi, üst bant genişliği, denge.

### Granular ve ses tasarımı

Motor: **yeni** granular örnekleme; mevcut filtre/reverb ile son tonlama.

- [x] **AFX-46 · Granular Cloud** — Kısa ses tanelerini üst üste dağıtarak ambient bulut. Kontroller: tane süresi, yoğunluk, perde yayılımı, konum yayılımı.
- [x] **AFX-47 · Grain Reverse** — Her taneyi ters çevirerek parçalı geri akış. Kontroller: tane süresi, örtüşme, okuma aralığı, karışım.
- [x] **AFX-48 · Pitch Rain** — Farklı perdelerde seyrek taneler yağdırır. Kontroller: nota kümesi, tane sıklığı, perde olasılıkları, stereo yayılım.
- [x] **AFX-49 · Texture Freeze** — İşaretli ses bölgesinden devamlı doku üretir. Kontroller: yakalama aralığı, tane süresi, jitter, tutma süresi.
- [x] **AFX-50 · Granular Riser** — Tanelerin perde ve yoğunluğunu zaman içinde yükseltir. Kontroller: başlangıç/bitiş perdesi, yoğunluk eğrisi, yükseliş süresi, reverb.

## 3. Text FX — 50 preset

Her preset düzenlenebilir gerçek metni korur. Harf animasyonu Unicode
grafem kümeleri üzerinden çalışır; Türkçe karakterler, emoji ve birleşik
işaretler parçalanmaz. Ortak kontroller: giriş, bekleme, çıkış, easing,
yazı/zemin rengi ve güç. Aşağıdaki kontroller presete özgüdür.

### Harf ve kelime girişleri

Motor: **mevcut** fade/pop/slide/typewriter; **genişletme** harf bazlı sıralama ve hareket.

- [x] **TFX-01 · Cascade Letters** — Harfler soldan sağa küçük düşüşlerle yerleşir. Kontroller: harf gecikmesi, düşüş mesafesi, yumuşama, çıkış sırası.
- [x] **TFX-02 · Word Lift** — Kelimeler satır tabanından sırayla yükselir. Kontroller: kelime aralığı, yükseliş, görünürlük rampası, easing.
- [x] **TFX-03 · Center Bloom** — Harfler kelimenin merkezinden dışa doğru açılır. Kontroller: harf aralığı, açılma süresi, ölçek başlangıcı, yayılım.
- [x] **TFX-04 · Tracking Expand** — Sıkışık harfler açılarak nihai aralığına oturur. Kontroller: ilk/son tracking, süre, bulanıklık, eğri.
- [x] **TFX-05 · Scatter Assemble** — Dağılmış harfler kendi konumlarına toplanır. Kontroller: dağılım alanı, dönüş sapması, gecikme, tohum.

### Maske ve görünme

Motor: **mevcut** title wipe; **genişletme/yeni** metin içi çok yönlü maske animasyonu.

- [x] **TFX-06 · Line Wipe** — İnce bir çizgi metni geçerek görünür kılar. Kontroller: yön, çizgi kalınlığı, süre, çizgi rengi.
- [x] **TFX-07 · Circle Reveal** — Seçili merkezden genişleyen daireyle metin açılır. Kontroller: merkez, yarıçap eğrisi, kenar yumuşaklığı, süre.
- [x] **TFX-08 · Gradient Sweep** — Yumuşak alfa gradyanı metnin üzerinden geçer. Kontroller: açı, geçiş genişliği, süre, çıkış yönü.
- [x] **TFX-09 · Split Curtain** — Metin merkezden iki yana açılan maskeyle belirir. Kontroller: eksen, merkez oranı, süre, kenar yumuşaklığı.
- [x] **TFX-10 · Stripe Reveal** — Birbirini takip eden şeritler metni açar. Kontroller: şerit sayısı, açı, sıra gecikmesi, yön.

### Kontur ve çizim

Motor: **yeni** tarayıcıda çizilen harf alfa sınırlarından kapalı kontur çıkarımı.
Türkçe karakterler, font fallback ve emoji silueti desteklenir; ek font kontur dosyası gerekmez.

- [x] **TFX-11 · Outline Trace** — Harf konturları çizilir, ardından içleri dolar. Kontroller: çizim süresi, kontur kalınlığı, dolgu gecikmesi, renkler.
- [x] **TFX-12 · Neon Sign On** — Harf segmentleri sıralı yanıp kararlı neon ışığına dönüşür. Kontroller: segment sırası, ateşleme süresi, glow, titreme miktarı.
- [x] **TFX-13 · Chalk Write** — Tebeşir dokusuyla kontur ve dolgu ortaya çıkar. Kontroller: çizim hızı, doku yoğunluğu, kenar pürüzü, renk.
- [x] **TFX-14 · Double Stroke Chase** — İki renkli kontur birbirini izler. Kontroller: takip gecikmesi, renkler, çizgi kalınlığı, döngü süresi.
- [x] **TFX-15 · Contour Erase** — Dolgu sönerken kontur üzerinden metin silinir. Kontroller: dolgu sönümü, silme yönü, silme süresi, kontur ışığı.

### Malzeme ve yüzey

Motor: **yeni** metin maskesi içi malzeme örnekleme; mevcut renk/gölge ile birleştirme.

- [x] **TFX-16 · Chrome Shine** — Metalik harfler üzerinde hareketli yansıma. Kontroller: yansıma açısı, hız, parlaklık, koyu/açık tonlar.
- [x] **TFX-17 · Gold Foil** — Altın folyo dokusu ve ince parıltı. Kontroller: doku ölçeği, ışık yönü, pürüz, altın tonu.
- [x] **TFX-18 · Glass Type** — Arkadaki görüntüyü harf içinde kıran cam metin. Kontroller: kırılma, kenar ışığı, opaklık, blur.
- [x] **TFX-19 · Paper Emboss** — Kağıda kabartılmış tipografi. Kontroller: kabartma yüksekliği, ışık açısı, gölge yumuşaklığı, kağıt tonu.
- [x] **TFX-20 · Hologram Foil** — Görüş açısı gibi hareket eden çok renkli yüzey. Kontroller: renk döngüsü, tarama açısı, hız, parıltı.

### Dijital tipografi

Motor: **yeni** metne özel parçalama, scramble ve piksel dönüşümü.

- [x] **TFX-21 · Decode Scramble** — Rastgele semboller sırayla gerçek harflere çözülür. Kontroller: sembol kümesi, çözülme sırası, süre, tohum.
- [x] **TFX-22 · RGB Type Tear** — Metin maskesi içinde kısa kanal kopmaları. Kontroller: kanal mesafesi, kopma aralığı, bant yüksekliği, güç.
- [x] **TFX-23 · Pixel Assemble** — Kare parçacıklar birleşerek harfleri kurar. Kontroller: hücre boyutu, geliş mesafesi, süre, tohum.
- [x] **TFX-24 · Scanline Type** — Yatay tarama ışığıyla metin satır satır görünür. Kontroller: tarama hızı, çizgi adımı, ışık genişliği, glow.
- [x] **TFX-25 · Terminal Cursor** — Gerçek zamanlı yazım ve yanıp sönen terminal imleci. Kontroller: harf süresi, durak deseni, imleç biçimi, yanıp sönme hızı.

### Kinetik tipografi

Motor: **genişletme/yeni** harf transformları, yay ve yol üzerinde yerleşim.

- [x] **TFX-26 · Elastic Bounce** — Harfler yay fiziği eğrisiyle yerlerine sekerek oturur. Kontroller: yay sertliği, sönüm, gecikme, ilk mesafe.
- [x] **TFX-27 · Letter Wave** — Harfler boyunca faz farkıyla dolaşan dalga. Kontroller: dalga boyu, genlik, hız, yön.
- [x] **TFX-28 · Orbit Caption** — Metin seçili merkez çevresinde yay üzerinde ilerler. Kontroller: yarıçap, yay açısı, hız, harf yönelimi.
- [x] **TFX-29 · Flip Tiles** — Harfler kart gibi dönerek görünür. Kontroller: dönüş ekseni, perspektif, harf gecikmesi, süre.
- [x] **TFX-30 · Perspective Crawl** — Metin uzaklaşan perspektif düzleminde akar. Kontroller: eğim, kaçış noktası, akış hızı, uzaklık sönümü.

### Söz ve kelime vurgusu

Motor: **mevcut** kelime zamanlama; **genişletme** aktif/pasif kelime maskeleri ve vurgu şekilleri.
Bu aile kelime zamanlaması ister; zamanlanmış bağımsız metinde de kullanılabilir.

- [x] **TFX-31 · Karaoke Ribbon** — Renk şeridi aktif kelimenin içinde soldan sağa dolar. Kontroller: dolgu rengi, şerit yüksekliği, yumuşaklık, pasif opaklık.
- [x] **TFX-32 · Active Word Spotlight** — Aktif kelime net kalırken diğerleri hafif solar. Kontroller: pasif blur, pasif opaklık, geçiş süresi, vurgu rengi.
- [x] **TFX-33 · Underline Runner** — İnce çizgi konuşulan kelimenin altına kayar. Kontroller: kalınlık, kenar payı, kayma süresi, renk.
- [x] **TFX-34 · Word Scale Focus** — Aktif kelime sabit yerleşim içinde büyüyüp geri döner. Kontroller: ölçek, attack/release, vurgu rengi, komşu kelime opaklığı.
- [x] **TFX-35 · Dual Line Relay** — Sonraki satır önceden belirir, aktif satır vurguyla devralır. Kontroller: ön gösterim süresi, satır aralığı, devralma süresi, pasif renk.

### Başlık ve bilgi şablonları

Motor: **mevcut** zengin başlık/şekil; **genişletme** bağımsız alt öğe animasyonları.

- [x] **TFX-36 · Editorial Lower Third** — İnce çizgi, ana ad ve alt açıklama farklı sırada açılır. Kontroller: çizgi süresi, metin gecikmesi, iç boşluk, vurgu rengi.
- [x] **TFX-37 · Track Credit Card** — Parça adı, sanatçı ve küçük müzik simgesiyle müzik kredisi. Kontroller: satır oranı, simge boyutu, panel opaklığı, giriş yönü.
- [x] **TFX-38 · Chapter Number** — Büyük bölüm numarasıyla başlığın kademeli açılması. Kontroller: numara boyutu, başlık gecikmesi, ayırıcı uzunluğu, hizalama.
- [x] **TFX-39 · Quote Brackets** — Köşeler metin çevresinde çizilir ve alıntı görünür. Kontroller: köşe boyutu, çizim süresi, iç boşluk, atıf gecikmesi.
- [x] **TFX-40 · Location Tag** — Konum etiketi, işaret noktası ve kısa açıklama. Kontroller: işaret boyutu, bağlayıcı uzunluğu, panel radius, açılma süresi.

### Işık ve gölge kompozisyonları

Motor: **mevcut** glow/gölge; **genişletme/yeni** çoklu metin maskesi ve zamana bağlı gölge.

- [x] **TFX-41 · Long Shadow** — Harflerden aynı yönde uzayan grafik gölge. Kontroller: gölge açısı, uzunluk, solma, renk.
- [x] **TFX-42 · Echo Stack** — Metnin gerisinde sırayla sönen tipografik kopyalar. Kontroller: kopya sayısı, konum adımı, gecikme, solma.
- [x] **TFX-43 · Soft Halo** — Okunabilir merkezi koruyan geniş ışık halesi. Kontroller: hale yarıçapı, ışık rengi, güç, çekirdek kontrastı.
- [x] **TFX-44 · Split Ink Shadow** — İki renkli ofset baskı gölgesi. Kontroller: iki ofset, renkler, karışım, hizaya dönüş süresi.
- [x] **TFX-45 · Light Sweep Type** — Harf yüzeyi üzerinde tek yönlü parlama geçişi. Kontroller: açı, ışık genişliği, süre, tekrar aralığı.

### Parçalanma ve biçim dönüşümü

Motor: **yeni** metin maskesinden parçacık üretimi, deformasyon ve çift maskeli dönüşüm.

- [x] **TFX-46 · Dust Dissolve** — Harfler ince toz parçalarına ayrılarak dağılır. Kontroller: parçacık yoğunluğu, yön, dağılma süresi, tohum.
- [x] **TFX-47 · Liquid Type** — Metin sınırları akışkan dalgayla hareket eder. Kontroller: dalga ölçeği, genlik, hız, kenar yumuşaklığı.
- [x] **TFX-48 · Ripple Letters** — Metin içinde ilerleyen halka deformasyonu. Kontroller: merkez, halka aralığı, genlik, ilerleme hızı.
- [x] **TFX-49 · Slice Exit** — Harfler yatay dilimlere ayrılıp farklı yönlere çıkar. Kontroller: dilim sayısı, mesafe, gecikme, çıkış süresi.
- [x] **TFX-50 · Title Morph Bridge** — İki kullanıcı metni arasında maskelerin akışla dönüşmesi. Kontroller: ikinci metin, dönüşüm süresi, akış miktarı, eşik yumuşaklığı; iki metin de düzenlenebilir kalır.

## 4. Audio reactive FX — 50 preset

Bu bölüm görsel efektlerdir; sesin kendisini değiştirmez. Her preset
ses kaynağı (master/kanal/bus), analiz noktası, frekans aralığı, giriş
hassasiyeti, attack/release ve görsel güç sunar. Kaynak değişimi görünürdür;
sessizlikte belirlenmiş nötr duruma döner. Her preset ayrıca kendi kontrollerini sunar.

Kick/snare/hi-hat/vokal etiketleri otomatik stem ayrıştırma vaadi değildir:
bant ve transient algılayıcılarıdır. Kullanıcı isterse gerçek stem kanalını
kaynak seçebilir. Beat fazı için proje BPM/ritim işaretleri veya algılama
seçilir; mevcut olmayan tempo bilinirmiş gibi kullanılmaz.

### Bas ve transient tepkileri

Motor: **mevcut** zoom/shake/glow; **genişletme/yeni** transient olayı ve band-seçimli zarflar.

- [x] **ARX-01 · Sub Breathing Frame** — Sürekli sub enerjisiyle kadraj yavaşça nefes alır. Kontroller: sub bandı, zoom sınırı, release, merkez.
- [x] **ARX-02 · Kick Shock Ring** — Kick transientinde merkezden bir halka yayılır. Kontroller: eşik, minimum tetik aralığı, halka hızı, kalınlık.
- [x] **ARX-03 · Snare Edge Burst** — Orta bant vuruşunda kenarlardan kısa ışık patlaması. Kontroller: bant, transient eşiği, ışık ömrü, kenar genişliği.
- [x] **ARX-04 · Hi Hat Sparks** — Tiz transientlerinde seyrek ince kıvılcımlar. Kontroller: tiz sınırı, olay yoğunluğu, kıvılcım boyu, ömür.
- [x] **ARX-05 · Bass Perspective Push** — Basla perspektif düzlemini geriye yatırıp geri getirir. Kontroller: eğim sınırı, derinlik, merkez, release.

### Spektrum düzenleri

Motor: **mevcut** bars/radial/sunburst; **genişletme/yeni** frekans gruplama ve özel geometri.

- [x] **ARX-06 · Log Spectrum Skyline** — Logaritmik bantlarda şehir silueti gibi yükselen sütunlar. Kontroller: bant sayısı, log aralığı, sütun aralığı, peak hold.
- [x] **ARX-07 · Circular Spectrum Petals** — Her frekans bandını çiçek yaprağına dönüştürür. Kontroller: yaprak sayısı, iç yarıçap, yaprak eğriliği, dönüş.
- [x] **ARX-08 · Spectral Waterfall** — Frekans geçmişini aşağı akan renk alanı olarak gösterir. Kontroller: geçmiş süresi, renk skalası, kayma hızı, dinamik aralık.
- [x] **ARX-09 · Octave Ladder** — Oktav kümelerini basamaklı ışık şeritlerine ayırır. Kontroller: başlangıç Hz, oktav sayısı, basamak aralığı, seviye eğrisi.
- [x] **ARX-10 · Spectral Ribbon** — Spektrum eğrisini akışkan dolgu şeridine dönüştürür. Kontroller: bant sayısı, eğri yumuşatma, kalınlık, renk gradyanı.

### Dalga ve stereo uzayı

Motor: **mevcut** wave/oscilloscope; **yeni** stereo faz, korelasyon ve mid/side görselleştirme.

- [x] **ARX-11 · Stereo Lissajous** — Sol/sağ sinyali XY düzleminde çizer. Kontroller: örnek penceresi, ölçek, iz solması, çizgi kalınlığı.
- [x] **ARX-12 · Polar Wave Halo** — Dalga biçimini çember üzerinde yaşayan hale yapar. Kontroller: yarıçap, dalga kazancı, örnek yoğunluğu, dönüş.
- [x] **ARX-13 · Mid Side Wings** — Merkez sinyali gövde, yan sinyali iki kanat olarak çizer. Kontroller: mid/side ölçekleri, kanat açısı, eğrilik, iz süresi.
- [x] **ARX-14 · Stereo Compass** — Stereo denge ve korelasyonu hareket eden pusula şeklinde gösterir. Kontroller: analiz penceresi, dönüş aralığı, açıklık ölçeği, yumuşatma.
- [x] **ARX-15 · Dual Wave Tunnel** — Sol/sağ dalgaları art arda derinlik halkalarına çizer. Kontroller: halka sayısı, geçmiş aralığı, perspektif, opaklık düşüşü.

### Parçacık koreografileri

Motor: **mevcut** particles; **genişletme/yeni** olay bazlı doğum, alan kuvvetleri ve bağlantı geometrisi.

- [x] **ARX-16 · Bass Ember Fountain** — Bas vuruşlarıyla aşağıdan yükselen közler. Kontroller: doğum miktarı, çıkış hızı, yerçekimi, ömür.
- [x] **ARX-17 · Treble Fireflies** — Tiz enerjisiyle yanıp sönen yavaş ışık noktaları. Kontroller: nokta sayısı, parlama eşiği, dolaşım ölçeği, ışık yarıçapı.
- [x] **ARX-18 · Onset Confetti** — Geniş bant transientinde kısa konfeti patlaması. Kontroller: olay eşiği, parça sayısı, yayılma açısı, yerçekimi.
- [x] **ARX-19 · Orbital Dust** — Orta bant enerjisi arttıkça hızlanan yörünge tozu. Kontroller: yörünge yarıçapı, taban hız, hız kazancı, iz süresi.
- [x] **ARX-20 · Constellation Links** — Sesle yaklaşan noktalar arasında ışıklı bağlar kurar. Kontroller: nokta sayısı, bağlantı mesafesi, hareket kazancı, çizgi gücü.

### Organik yüzeyler

Motor: **yeni** sesle sürülen deformasyon ve prosedürel alanlar.

- [x] **ARX-21 · Liquid Bass Pool** — Bas darbeleriyle yüzey halkaları oluşan sıvı alan. Kontroller: halka hızı, sönüm, dalga yüksekliği, ışık yönü.
- [x] **ARX-22 · Vocal Flow Field** — Seçilen vokal/mid kaynağının zarfıyla yön değiştiren akış çizgileri. Kontroller: alan ölçeği, çizgi sayısı, yön kazancı, iz süresi.
- [x] **ARX-23 · Spectral Terrain** — Frekans bantlarından yaşayan yükseklik haritası. Kontroller: ızgara çözünürlüğü, yükseklik kazancı, kamera açısı, geçmiş derinliği.
- [x] **ARX-24 · Jelly Orb** — Farklı bantlarla yüzeyi bükülen yumuşak küre. Kontroller: yüzey detay seviyesi, bant ağırlıkları, deformasyon, dönüş.
- [x] **ARX-25 · Aurora Bands** — Bant enerjileriyle açılan çok katlı kutup ışığı. Kontroller: kat sayısı, renkler, dalga genişliği, akış hızı.

### Geometrik hareketler

Motor: **mevcut** kaleidoscope; **genişletme/yeni** bant başına geometri ve çoklu merkez.

- [x] **ARX-26 · Beat Hex Grid** — Vuruşla merkezden çevreye altıgen hücreler aydınlanır. Kontroller: hücre boyutu, yayılma gecikmesi, ışık ömrü, kontur.
- [x] **ARX-27 · Triangle Stack** — Bantlara bağlı iç içe üçgenler farklı ölçeklerde açılır. Kontroller: üçgen sayısı, ölçek adımı, bant eşleme, dönüş.
- [x] **ARX-28 · Spectral Mandala** — Simetri kollarının uzunluğu frekans enerjisiyle değişir. Kontroller: simetri sayısı, bant dağılımı, merkez yarıçapı, dönüş hızı.
- [x] **ARX-29 · Cubic Pulse Wall** — Küp yüzleri seçili bantlara göre yükselir. Kontroller: satır/sütun, derinlik kazancı, perspektif, renk skalası.
- [x] **ARX-30 · Polygon Morph** — Bant oranlarıyla çokgenin köşeleri ve kenar eğrileri dönüşür. Kontroller: köşe sayısı, bant ağırlıkları, morf miktarı, kontur kalınlığı.

### Renk ve ışık tepkileri

Motor: **mevcut** hue/glow/brightness; **genişletme/yeni** spektral özellik ve tonal bölge eşlemesi.

- [x] **ARX-31 · Spectral Centroid Color** — Sesin parlaklık merkeziyle renk paletinde gezinir. Kontroller: merkez Hz aralığı, renk durakları, yumuşatma, doygunluk.
- [x] **ARX-32 · Three Band Wash** — Bas/orta/tiz enerjileri üç farklı ışık rengini karıştırır. Kontroller: üç renk, bant sınırları, bant kazançları, karışım.
- [x] **ARX-33 · Loudness Bloom** — Kısa dönem ses yüksekliğiyle parlak alan haleleri büyür. Kontroller: ölçüm penceresi, görsel eşik, bloom yarıçapı, üst sınır.
- [x] **ARX-34 · Transient Light Sweep** — Her transientte çerçeveden bir ışık şeridi geçer. Kontroller: algılama eşiği, minimum aralık, geçiş süresi, açı.
- [x] **ARX-35 · Harmonic Palette Drift** — Baskın chroma sınıflarıyla yavaş renk değişimi. Kontroller: chroma-renk eşlemesi, kararlılık eşiği, geçiş süresi, karışım; tonal olmayan seste nötr davranış.

### Görüntü deformasyonu

Motor: **mevcut** RGB/glitch/pixelate; **genişletme/yeni** ses özelliklerine bağlı yerel deformasyon.

- [x] **ARX-36 · Kick Lens Ripple** — Kick olayında görüntü üzerinde optik halka kırılması. Kontroller: merkez, kırılma kazancı, halka hızı, sönüm.
- [x] **ARX-37 · Treble Chromatic Fray** — Tiz enerjisiyle sadece görüntü kenarlarında renk saçılması. Kontroller: kenar eşiği, kanal mesafesi, bant kazancı, karışım.
- [x] **ARX-38 · Mid Elastic Warp** — Orta bant zarfıyla görüntüyü elastik bir ızgarada büker. Kontroller: ızgara ölçeği, yatay/dikey miktar, geri dönüş, merkez.
- [x] **ARX-39 · Onset Pixel Fracture** — Transientte yerel bloklar ayrılıp yerlerine döner. Kontroller: blok boyutu, ayrılma mesafesi, dönüş süresi, olay eşiği.
- [x] **ARX-40 · Bass Scan Bend** — Bas enerjisiyle yatay tarama satırlarını kavisler. Kontroller: satır aralığı, kavis kazancı, dalga fazı, release.

### Metin ve şekil tepkileri

Motor: **mevcut** lyric bass effects/shape; **genişletme/yeni** harf, kelime ve kenar düzeyinde tepki.

- [x] **ARX-41 · Word Pulse Accent** — Yalnızca aktif söz kelimesi seçili ses kaynağıyla vurgu alır. Kontroller: ölçek sınırı, renk karışımı, glow, release; kelime zamanlaması gerekir.
- [x] **ARX-42 · Spectrum Letter Wave** — Harflere dağıtılan frekans bantları dikey hareket üretir. Kontroller: bant aralığı, harf eşleme, hareket sınırı, faz yönü.
- [x] **ARX-43 · Vocal Halo Caption** — Seçili vokal kanalının zarfıyla metin halesi açılır. Kontroller: algılama bandı, hale yarıçapı, ışık kazancı, taban opaklık.
- [x] **ARX-44 · Bass Outline Weight** — Metin/şekil konturu basla kalınlaşıp incelir. Kontroller: minimum/maksimum kalınlık, bant, renk, release.
- [x] **ARX-45 · Beat Tracking Type** — Vuruş fazıyla harf aralığı açılır ve geri kapanır. Kontroller: beat kaynağı, tracking sınırı, hareket süresi, faz; satır yerleşimi sabit kalır.

### Ritim olayları ve sahne koreografisi

Motor: **mevcut** ritim işaretleri/katman transformları; **yeni** kaydedilebilir olay eşlemeleri.
Olaylar yalnızca seçilen efekt katmanlarını sürer; gerçek kurgu kliplerini değiştirmez.

- [x] **ARX-46 · Beat Camera Step** — Her beatte tanımlı kamera ofsetleri arasında ilerler. Kontroller: beat kaynağı, konum deseni, geçiş süresi, derinlik.
- [x] **ARX-47 · Bar Kaleido Turn** — Her ölçüde kaleydoskopu yeni açıya geçirir. Kontroller: BPM/ölçü, açı dizisi, simetri, dönüş süresi.
- [x] **ARX-48 · Call Response Bands** — Bas ve tiz olayları iki görsel bölgeyi sırayla canlandırır. Kontroller: iki algılama bandı, bölge oranı, tepki süresi, renkler.
- [x] **ARX-49 · Energy Build Spiral** — Yükselen enerji eğilimiyle spiral sıklaşır; düşüşte çözülür. Kontroller: analiz penceresi, eğilim eşiği, tur sınırı, çözülme süresi.
- [x] **ARX-50 · Silence To Bloom** — Belirlenen sessizlikten sonraki ilk sesle sahne açılır. Kontroller: sessizlik eşiği/süresi, açılma süresi, ışık yayılımı, yeniden tetik aralığı.

## Onay sonrası geliştirme sırası

Önerilen sıra aşağıdadır. Aşama numaraları ek preset değildir; her aşama
aynı listedeki ID'leri tamamlar. Kullanıcı kapsamı değiştirmezse bu sıra izlenir.

1. **Katalog ve ilk yaratıcı paket:** arama/favori/önizleme, hedef seçimi,
   makro kontroller; VFX-01–10, AFX-01–05 ve AFX-11–15,
   TFX-01–10, ARX-01–05 ve ARX-16–20. Toplam 40 preset.
2. **Optik, modülasyon ve tipografi:** VFX-11–20,
   AFX-16–25, TFX-11–20, ARX-06–15. Toplam 40 preset.
3. **Geometri ve ses karakteri:** VFX-21–30,
   AFX-26–30 ve AFX-36–40, TFX-21–30,
   ARX-21–30. Toplam 40 preset.
4. **Zaman, alan ve söz vurgusu:** VFX-31–40,
   AFX-06–10 ve AFX-31–35, TFX-31–40,
   ARX-31–40. Toplam 40 preset.
5. **İleri ses tasarımı ve koreografi:** VFX-41–50,
   AFX-41–50, TFX-41–50, ARX-41–50. Toplam 40 preset.

Her aşamada gereken yeni motor, ona bağlı presetlerden önce tamamlanır.
Örneğin geçmiş kare örnekleme VFX-31–35, kontur verisi TFX-11–15,
pitch/formant AFX-31–35, granular AFX-46–50 için önkoşuldur.
Henüz motoru bulunmayan preset çalışıyormuş gibi kataloğa eklenmez.

## Bir preset ne zaman tamamlanmış sayılır?

- Adı, kısa kullanım açıklaması, kategori/etiketleri, gerçek varsayılan
  değerleri ve sınırları tanımlanmış; aynı ailedeki diğerlerinden ayırt edilir.
  Bu dosyadaki tanımlar tasarım brief'idir; sayısal varsayılanlar onay sonrası
  görsel/işitsel denemelerle belirlenir.
- En az üç anlamlı kontrol gerçekten sonucu değiştirir. Makrodan gelişmiş
  değerlere geçiş anlaşılır; bypass/karşılaştırma, kullanıcı kopyası ve
  tek adımlı geri alma çalışır. Sürekli değerler uygun otomasyon hedefleridir.
- Önizleme ve dışa aktarma aynı parametreleri ve proje saatini kullanır.
  Hareket hızdan/oynatım sırasından bağımsızdır; zamansal efektlerin klip
  sınırında örnekleme kuralı (uç kareyi tutma veya sessizlik) açıkça tanımlıdır.
- Audio reactive analiz seçili kanal/bus ve pre/post FX noktasından alınır;
  master analizi her efektte zorunlu tutulmaz. Arama/sarma, sessizlik ve
  kısa klipler aynı tanımlı davranışı üretir. Rastgele davranışların tohumu saklanır.
- Ses FX için mono/stereo, örnekleme hızları, tail/predelay ve işlem gecikmesi
  dikkate alınır; önizleme ve export zamanları eşleşir. Feedback sınırlıdır;
  freeze/yankı kuyruklarının çıktı aralığındaki davranışı görünürdür.
- Metin FX uzun/kısa içerik, Türkçe karakterler, çok satır, satır/kelime
  zamanları ve farklı en-boy oranlarında denenir; animasyon metin düzenini
  veya diğer kontrollerin yerleşimini oynatmaz.
- Katalog ve kontroller klavye/dokunmayla kullanılabilir; slider yanında
  hassas sayısal giriş vardır. 320/375/768/1024/1440 genişlik ve iki tema
  kontrol edilir. Katalog örnekleri azaltılmış hareket tercihine uyar;
  kullanıcı çıktısındaki yaratıcı hareketi değiştirmek ayrıca seçilir.
- Temsili görsel ve ses örnekleriyle önizleme/export karşılaştırılır;
  gereken DSP/render ve arayüz kontrolleri üretim sunucusunda doğrulanır.
  Bu doğrulama geliştirme kabulüdür; ayrı yeni özellik kotasına sayılmaz.

## Onay kapısı

Kullanıcı planı onayladı; beş aşamadaki 200 preset uygulandı ve doğrulandı. Yalnızca
uygulanan ve doğrulanan presetlerin kutuları işaretlenir. Bu planda yedekleme,
kurtarma veya genel altyapı bakımı yeni özellik olarak sayılmamıştır.
