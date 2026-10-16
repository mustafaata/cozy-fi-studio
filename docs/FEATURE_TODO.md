# Özellik TODO'su

Bu liste yeni düzenleme ve üretim özelliklerinden oluşur. Sıralama önerilen
geliştirme önceliğidir. İşaretli maddeler uygulanmıştır; kısmi maddelerin kalan
kapsamı ayrıca belirtilir. Kullanım: [Düzenleme araçları](EDITING.md).
Sonraki 30 yeni özellik: [21–50 TODO'su](FEATURE_TODO_NEXT.md).

Mevcut durumda kaynak kesme, sayısal video ayarları, renk profilleri, temel
klip geçişleri, tek ön plan görseli ve ses seviyesi otomasyonu bulunuyor.
Hedef, bunları görsel ve hassas bir düzenleme akışına dönüştürmek.

Her özellik, ilgili olduğu yerde hem önizlemede hem dışa aktarılan çıktıda
aynı yaratıcı sonucu vermeli. Yedekleme, hata kurtarma ve altyapı bakım işleri
bu listenin kapsamı dışındadır.

1. [x] **Yakınlaştırılabilir ortak zaman çizgisi.** Ses, video ve otomasyon
   şeritlerinde ortak zaman cetveli; yatay kaydırma, seçime yakınlaşma ve projeyi
   ekrana sığdırma. Kullanıcı aynı anı bütün şeritlerde hizalı görebilmeli.

2. [x] **Kare hassasiyetinde gezinme.** Önceki/sonraki kare düğmeleri,
   düzenlenebilir `SS:DD:SS:KK` zaman kodu ve belirli zamana atlama. Adımlar
   seçili çıktı FPS'ine göre proje zamanında ilerlemeli.

3. [x] **Hassas ayar modu.** Shift ile ince, Alt ile büyük adım; görünür
   eksi/artı kontrolleri ve birimli değer girişi. Ses için yüzde/dB, konum için
   piksel, dönüş için derece, zaman için saniye/kare seçenekleri sunulmalı.
   Shift/Alt, video eksi/artı, yüzde/dB, konum px/%, dönüş/derece ve ses,
   video, otomasyon ve söz zamanlarında sn/kare seçimi hazır.

4. [x] **Görsel video klip düzenleme.** Küçük kare önizlemeleri olan klip
   bloklarını sürükleyerek taşıma ve iki uçtan kısaltma/uzatma. Düzenleme
   sırasında yeni başlangıç, bitiş ve süre gösterilmeli; boşluk bırakılabilmeli.

5. [x] **Böl, çoğalt ve boşluğu kapatarak sil.** Ses ve video kliplerini
   imleçte bölme, kopyalama, çoğaltma ve normal/ripple silme seçenekleri.
   Bölünmüş parçalar kendi kesitlerini ve yaratıcı ayarlarını korumalı.
   Video, ana şarkı ve ek ses katmanlarında bölme, çoğaltma, normal/ripple silme
   ve kopyala/yapıştır hazır. Ana montajda kaynak kesitleri, hız/efekt zinciri
   ve kaynak söz zamanlaması korunur; ek seslerde faz, fade ve otomasyon korunur.

6. [x] **Görsel medya kütüphanesi.** Dosya sürükleyerek içe alma; video
   küçük resimleri, ses dalga önizlemeleri, arama ve tür filtreleri. Kullanıcı
   medya kimliği yazmadan bir dosyayı doğrudan zaman çizgisine ekleyebilmeli.

7. [x] **Tuval üzerinde dönüştürme ve kırpma.** Seçim çerçevesi, köşe
   tutamaçları, en-boy oranını koruyan ölçekleme, döndürme ve aynalama.
   Kırpma çerçevesi, merkez hizalama ve güvenli alan kılavuzları eklenmeli.
   Seçim/ölçek/dönüş tutamaçları, kaynak kırpma çerçevesi ve oran önayarları,
   merkezleme, üçler/merkez ve %90/%80 güvenli alan kılavuzları hazır.

8. [x] **Video keyframe editörü.** Konum, yakınlık, dönüş ve opaklık için
   imleçte anahtar kare ekleme, önceki/sonraki anahtar kareye gitme ve elmas
   göstergeleri. İki zaman arasında pan ve zoom hareketi kurulabilmeli.
   Parametre elmasları, ortak zaman çizgisinde sürükleme, kare/sn zaman girişi,
   tuval ve hassas kontrol bağlantısı, geri alma ve eşleşen MP4 çıktısı hazır.

9. [x] **Eğri ve geçiş karakteri seçimi.** Ses otomasyonu ve video
   keyframe aralıklarında doğrusal, yumuşak giriş/çıkış, S eğrisi, sabit tutma
   ve Bézier seçenekleri. Karakter, aralık bazında seçilebilmeli.
   Altı karakter, sayısal ve sürüklenebilir Bézier tutamaçları, klavye kontrolü,
   eğriyi koruyarak nokta ekleme, geri alma ve eşleşen ses/MP4 çıktısı hazır.

10. [x] **Gelişmiş otomasyon çizim araçları.** Büyütülebilen eğri alanı,
    kalemle çizim, kutuyla çoklu nokta seçimi, toplu taşıma ve kopyala/yapıştır.
    Zaman ve değer eksenleri ayrı yakınlaştırılabilmeli; noktalar kareye,
    ritme veya işaretçiye hizalanabilmeli.
    Büyük editör, bağımsız seviye aralığı, ortak zaman zoom/kaydırma, kalem,
    kutu/listeden çoklu seçim, toplu sürükleme/sayısal taşıma, katmanlar arası
    nokta panosu ve kare/BPM-vuruş/işaretçi hizalaması hazır.

11. [x] **Canlı otomasyon kaydı.** Oynatma sırasında ses kaydırıcısını
    hareket ettirerek eğri kaydetme; oku, dokunurken yaz ve bırakınca yazmayı
    sürdür modları. Kullanıcı kaydın uygulanacağı zaman aralığını seçebilmeli.
    Katman başına hassas kayıt kaydırıcısı, sn/kare başlangıç-bitiş, görünür
    aralığı alma, üç mod, canlı dinleme, ayrı dokunuşları koruma, tek geri alma
    ve kayıt iptali hazır. Kaydetme/paketleme/render güncel kaydı tamamlar.

12. [x] **Pan ve efekt otomasyonu.** Ses seviyesinin yanında stereo
    konum, filtre kesim frekansı ve reverb miktarı için ayrı eğri şeritleri.
    Kullanıcı hangi parametreyi düzenlediğini seçebilmeli ve birden fazla
    parametreyi aynı zaman aralığında hareketlendirebilmeli.
    Parametre seçici, dört eşzamanlı özet şeridi, parametreye uygun değer/birim
    ve sınırlar, kalem/seçim/toplu taşıma, aynı parametre için katmanlar arası
    pano, katmana özel filtre/reverb ve eşleşen ses çıktısı hazır.

13. [x] **Katmana özel parametrik EQ ve efekt zinciri.** Frekans,
    kazanç ve Q ayarlı görsel EQ; her katmanda ayrı filtre, reverb ve delay.
    Efektlerin sırası değiştirilebilmeli ve her efekt ayrı bypass edilebilmeli.
    Üç bantlı görsel EQ, sürükleme/klavye/sayısal frekans-kazanç-Q, katmana özel
    delay süresi/geri beslemesi/miktarı, dört efektin sırası ve ayrı bypass hazır.
    Tek geri alma, proje/paket kaydı, ek katman oynatması ve eşleşen WAV çıktısı doğrulandı.

14. [x] **BPM ve ritim ızgarası.** Elle BPM girişi, tap tempo, otomatik
    tempo önerisi ve başlangıç vuruşunu ayarlama. Ölçü/vuruş çizgileri üzerinden
    klipler, geçişler ve otomasyon noktaları müziğe hizalanabilmeli.
    Ortak BPM/ilk vuruş/ölçü/bölüm ayarları, uygulanabilir tap ve yerel tempo
    önerileri, yakınlıkla klip hizalama, ek ses konumunu ve gerçek video geçiş
    başlangıcını ritme alma, ortak otomasyon hizalaması ve proje/paket kaydı hazır.

15. [x] **Zaman çizgisinde geçiş düzenleme.** Mevcut geçişleri açılır
    menüye ek olarak görsel bir galeriden seçme; klip sınırında süre tutamacı,
    yön ve yumuşaklık ayarı. Geçiş bölgesi döngüde izlenebilmeli; zoom ve blur
    gibi yeni geçişler eklenmeli.
    Dokuz örnekli galeri, gerçek örtüşmeyi düzenleyen fare/dokunma/klavye
    tutamacı, yön ve zamansal yumuşaklık, ortak ses saatinde geçiş döngüsü,
    zoom/blur ve aynı tuval koduyla önizleme/MP4 çıktısı hazır.

16. [x] **Klibe özel renk düzenleme ve karşılaştırma.** Her klipte
    bağımsız renk profili; beyaz dengesi, gölgeler/orta tonlar/parlak alanlar
    ve RGB eğrileri. Önce/sonra karşılaştırma kaydırıcısı ve renk ayarlarını
    başka kliplere kopyalama bulunmalı.
    Bağımsız pozlama/beyaz dengesi/ton kontrolleri, beş görünüm, dört
    kanalda hassas sayısal ve sürüklenebilir eğriler, dokunma/klavye destekli
    önce/sonra sınırı, renk panosu/toplu uygulama ve ortak önizleme/MP4 hazır.

17. [x] **Çoklu görsel ve video katmanları.** Birden fazla video, PNG,
    GIF ve metni ayrı şeritlere yerleştirme; sıra, görünürlük, kilit ve grup
    kontrolleri. Her katmanda başlangıç/bitiş, opaklık ve karışım modu olmalı.
    16 bağımsız video/GIF/saydam görsel/metin katmanı, ayrı zaman şeritleri,
    dokunma/klavye/sayısal tuval dönüşümleri, kaynak kesiti/hız/döngü ve dokuz
    karışım modu hazır. Grup taşıma/sıralama, kilit/görünürlük, tek geri alma,
    taşınabilir paket ve ortak önizleme/MP4 doğrulandı.

18. [x] **Hız rampası, ters oynatma ve kare dondurma.** Video hızını
    zaman içinde değiştirerek hızlanma/yavaşlama; seçili bölümü ters oynatma
    ve seçili kareyi istenen süre tutma. Sonuç süreleri zaman çizgisinde
    görünmeli ve hareket yumuşatma seçilebilmeli.
    Kaynak zamanında 32 hız noktası, üç önayar ve üç aralık karakteri,
    ileri/ters kesit, sn/kare dondurma süresi ve komşu kare harmanlama hazır.
    Bölme/kırpma/pano eğriyi korur; süre değişimi montajın devamını kaydırır.
    Arka plan, montaj ve video/GIF katmanları ortak önizleme/MP4 hesabını kullanır.

19. [x] **Görsel maske editörü.** Dikdörtgen, elips ve serbest şekil
    maskeleri; kenar yumuşatma, ters çevirme ve keyframe ile hareketlendirme.
    Bölgesel bulanıklık ve aynı sahnede birden fazla görüntüyü birleştirme
    yapılabilmeli.
    Arka plan/montaj/video/görsel/metinde üç şekil, 32 nokta, ters maske,
    yumuşak kenar ve bölgesel bulanıklık hazır. Dokunma/klavye/sayısal tuval
    düzenleme, yerel hareket anahtarları, bölme/kırpma sürekliliği, tek geri
    alma, kilit, taşınabilir paket ve ortak önizleme/MP4 hesabı eklendi.

20. [x] **Kelime bazlı karaoke ve yazı animasyonları.** Mevcut satır
    zamanlamasına ek olarak kelime başlangıç/bitişi düzenleme; aktif kelimeyi
    renkle doldurma, yazı makinesi ve kelime bazlı giriş animasyonları.
    Sözcük süreleri görsel zaman şeridinden değiştirilebilmeli.
    Kaynak saniyesinde 0,001 sn giriş, kenardan kırpma/gövdeden taşıma,
    yakınlaştırma, klavye/dokunma, imleçte işaretleme, tek geri alma ve iptal
    hazır. Özel zamanlı dolgu/pop, yazı makinesi ve üç kelime girişi ortak
    önizleme/MP4 çizimini kullanır. ASR zamanları, satır ölçekleme/kaydırma,
    kelime sınırından bölme/birleştirme ve proje/paket aktarımı desteklenir.

Önerilen ilk uygulama dilimi: 1–6. Bu dilim, günlük düzenlemeyi hızlandıran
hassas kontrolleri ve doğrudan klip düzenlemeyi getirir. Ardından 7–14 ile
hareket ve ses tasarımı; 15–20 ile yaratıcı video ve yazı araçları genişletilir.
