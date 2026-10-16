# Düzenleme araçları

## Çalışma masası

Üstte Miks, Kurgu, Sözler, VideoFX ve Çıktı çalışma alanları bulunur. Masaüstünde önizleme ve seçili kaynağın düzenleyicisi üstte, zaman çizgisi tam genişlikte alttadır. Dar ekranda paneller tek sütuna geçer. Kurgu alanında montaj formu önce gelir; klipler yatay seçiciden seçilir. Katman/kütüphane araçları ayrı bölümde, dosya ve URL işlemleri Kaynak dosyaları bölümündedir.

Sağdaki Araç seçicisi aktif kaynağın editörlerini listeler. Bir araç seçip Aç düğmesine basın. Üstteki Araç bul düğmesi veya Ctrl/⌘+K, bütün çalışma alanlarında araç arar. Türkçe karakterlerle veya “warp”, “keyframe”, “EQ”, “chroma” gibi işlem adlarıyla arayabilirsiniz. Sonuçtaki kaynak adı hangi kanalı düzenleyeceğinizi gösterir; sonradan eklenen ses kanalları da listelenir.

Arama penceresinde aşağı ok sonuçlara geçer; yukarı/aşağı ve Home/End gezinir, Enter aracı açar, Escape pencereyi kapatır. Tab odağı pencerenin içinde tutar; pencere kapanınca odak açan kontrole döner. Arama sırasında M ve kesit kısayolları alttaki projeyi değiştirmez. Bir araca gitmek editörün kendi doğrulamasını, taslağını ve geri alma akışını kullanır.

Yeni görünüm Awesome DESIGN.md koleksiyonunun Linear panel/odak hiyerarşisinden ve ElevenLabs açık yüzey yaklaşımından uyarlanmıştır. Arayüz sistem yazı tipini kullanır; zaman ve sayılar eş aralıklıdır. Koyu/açık tema işletim sistemini izler. `studio-shell.css` çalışma alanı ve arama bileşenlerini, mevcut stil dosyasındaki tasarım tokenları ortak kontrolleri yönetir.

## Ortak zaman çizgisi

- **Zoom** imlecin çevresini yakınlaştırır; **Kaydır** görünen aralığı taşır.
- **Projeye sığdır** bütün süreyi gösterir. **Seçime odaklan** seçili video
  klibini veya ses katmanını büyütür.
- **Ses eğrileri** dalga biçimlerinin üstünde ses seviyesi eğrisini gösterir.
  Ayrı otomasyon editörü de aynı görünen zaman aralığını kullanır.
- Taşıma çubuğundaki önceki/sonraki kare düğmelerini basılı tutabilirsiniz.
  `SS:DD:SS:KK` alanına doğrudan zaman yazın; kare kısmı çıktı FPS'ine göredir.

## Çoklu klip seçimi

Ana montaj, ek ses ve video kliplerini **Shift + tık** ile seçime ekleyin
veya seçimden çıkarın. Dokunmatik kullanımda **Çoklu seçim** düğmesini açıp
kliplere dokunun. Bu modda boş bir şeritten sürükleyerek birden fazla şeridi
kapsayan seçim kutusu çizebilirsiniz; Shift kutuyu mevcut seçime ekler.

Seçili bir klibin gövdesinden sürüklemek bütün seçimi aynı miktarda taşır.
Aralıklar, kaynak kesitleri, ses otomasyonu ve fade zamanları korunur.
Çakışma veya zaman sınırında grup birlikte durur. Alt yapışmayı geçici olarak
kapatır. Klavye odağı zaman çizgisindeyken ←/→ bir kare, Shift + ←/→ on kare
taşır. **Seçime odaklan** grubun zaman aralığını büyütür.

**Seçimi kopyala**, **İmlece yapıştır**, **Seçimi çoğalt** ve **Seçimi sil**
ses ve görüntüyü birlikte işler. Kopyalama özgün kliplerden bağımsız bir
uygulama panosu kullanır. Çoğaltma grubun sonuna yapıştırır; yapıştırma için
ana/video şeritlerinde grubun sığacağı boş bir aralık gerekir. Diğer klipler
kendiliğinden kaydırılmaz. Ctrl/Cmd + C/V ve Delete kısayolları zaman çizgisi
odağında kullanılabilir. Ctrl/Cmd + A kilitsiz klipleri seçer.

Şeritteki **Toplu kilit** o şeridi grup seçimi ve grup işlemlerinden korur;
bu tercih proje dosyasında saklanır. Son ana şarkı klibinin silinmesi engellenir.
Sürükleme sırasında kaydetmek mevcut projeyi kaydeder; hareket bırakılınca
tek geri alma adımı oluşur. Escape, dokunma iptali veya pencere odağının
kaybolması önizlenen hareketi iptal eder.

## Şeritler arası ripple

Zaman çizgisindeki **Ripple** düğmesi ana şarkı panelindeki ripple aracını açar.
Başlangıç ve bitişi saniye/kare olarak girin, imleçten alın veya **Klip seçiminden
aralık** ile çoklu seçimin kapsadığı süreyi kullanın. Aralık proje zamanıdır.

**Aralığı çıkar** o bölümü kaldırır ve sonraki içeriği aralık uzunluğu kadar
geri kaydırır. **Boşluk ekle** başlangıçta aynı uzunlukta boşluk açar. Sınırı
aşan ana şarkı, video, ses ve sözler iki parçaya ayrılır. Yeni ses parçaları
özgün dosyayı kullanır; döngü fazı, fade sürekliliği, video hız rampası/ters
oynatma/dondurma ve maske saati korunur.

Kaydırılacak şeritleri tek tek seçebilirsiniz. Ses katmanı ve onun otomasyonu
ayrı seçeneklerdir; birlikte kaymaları için ikisini de seçin. Otomasyonun
Bézier ve diğer eğri karakterleri korunur; eklenen boşlukta sınırdaki değer
sabit tutulur. **Toplu kilit** seçimi engeller. Her uygulama tek geri alma
adımıdır; geçersiz bir kesim hiçbir şeride uygulanmaz.
Proje aralığında duyulabilir bölümü olmayan sesler listede **Proje dışında**
olarak gösterilir ve ripple ses seçimine kapalıdır; önce konumlarını veya
proje süresini düzenleyerek kullanılabilir hale getirebilirsiniz.

Ana şarkı veya söz şeridi seçilince mevcut sözler **proje zamanına** bağlanır.
Böylece sözleri kaydırmayı bağımsız seçebilirsiniz. Mevcut montaj tekrarları
ayrı satırlara dönüşür; kelime zamanları kesilip taşınır. Montaj dışında kalan
kaynak metinleri inceleme için zamansız satırlar olarak korunur. Satır sayacı
ve kelime editörü kullanılan zaman tabanını gösterir. Proje zamanıyla SRT/LRC
aktarımı, sayısal düzenleme, işaretleme, dinleme, yeniden çözümleme ve MP4
çıktısı aynı saati kullanır. Kaynak zamanıyla gelen yeni söz taslakları
uygulanırken mevcut montaja dönüştürülür.

Aralık en az 0,05 saniye olmalıdır. Video kesimleri klibin çıktı kare
sınırlarında ve örtüşen geçişin dışında olmalı; kısa kaynak parçaları
bırakan kesimler açıklamalı bir hatayla reddedilir. Seçili sesin proje sonunu
aşmaması için boşluk eklerken ana şarkıyı da seçin. Proje süresi ana montajdan
hesaplandığı için son ana parçanın tamamı çıkarılamaz ve proje sonuna boşluk
eklenemez. Proje saatindeki bir söz satırı kaynakta tek bir kesite karşılık
gelmiyorsa kaynak zamanı olarak dışa aktarmadan önce satırı bölün veya proje
zamanı olarak dışa aktarın.

## Video montajı

Görüntü sekmesindeki **Medya kütüphanesi** üzerinden dosya ekleyin. İlk dosya
tek klip olarak eklenir; önceden bir arka plan varsa montaja korunarak alınır.
Arama, tür filtresi, küçük resimler ve Ekle düğmeleri kullanılabilir. Mevcut
montaj sırasında arka plan yükleme düğmesi de yeni videoyu montajın sonuna ekler.

Video şeridinde gövdeden sürükleyerek taşıyın; iki kenar tutamacından kaynak
girişini/çıkışını değiştirin. Shift ince hareket sağlar; Alt yapışmayı geçici
olarak kapatır. Önizlenen düzenleme, bırakınca tek geri alma adımı olarak
kaydedilir; Escape iptal eder. Klipler yalnızca tanımlı geçiş kadar örtüşebilir.
Boşluklar önizlemede ve çıktıda siyah görünür.

**İmleçte böl**, **Çoğalt**, **Sil**, **Boşluğu kapat** komutları seçili klibe
uygulanır. Çoğaltma sonraki klipleri yeni parçanın süresi kadar ileri taşır.
Boşluğu kapatarak silme sonraki klibi silinen klibin konumuna getirir; normal
silme diğer kliplerin konumunu değiştirmez. Son klibi silmek görüntüyü kaldırır.

**Kopyala** seçili klibin bağımsız bir kopyasını uygulama panosuna alır.
**İmlece yapıştır** sonraki klipleri ileri taşır; imleç bir klibin içindeyse
önce o klibi böler ve kaynak sürekliliğini korur. Geçiş bölgesinin içinde veya
uçlara 0,05 saniyeden yakın konumda bölme yapılamaz. Pano, kaynak klip silinse
de kullanılabilir; sayfa kapandığında temizlenir.

**Kadraj** grubundaki **Dönüş · °**, **Yatay aynala** ve **Dikey aynala**
görüntüye merkezinden uygulanır; montajdaki bütün klipleri etkiler. Dönen
görüntünün dışı siyah kalır; yakınlık ve konumla kadrajı ayarlayabilirsiniz.
**Kadrajı sıfırla** dönüş, aynalama, yerleşim, yakınlık ve konumu sıfırlar.

## Slip: kaynak kesitini kaydırma

Görüntü sekmesinde bir **video montaj klibi** seçip **Slip · kaynak kesitini
kaydır** bölümünü açın. Saniye alanı, kaydırıcı veya **±1 / ±10 kare**
düğmeleri kaynak giriş ve çıkışını birlikte kaydırır. Pozitif değer daha
geçteki görüntüyü seçer. Örneğin 1–5 saniyelik kesiti +2 saniye kaydırmak
3–7 saniyelik kesiti kullanır; klibin proje konumu ve süresi değişmez.
Düğmeler kaynak dosyanın FPS değerini kullanır; çıktı FPS'inden bağımsızdır.

**Önce / Sonra · giriş / çıkış** alanları dört kaynak karesini yan yana
gösterir. Bunlar renk düzenlemesi, maske ve sahne efektleri uygulanmamış
kaynak görüntüleridir. Ters oynatmada giriş, oynatılan ilk kareyi gösterir;
dondurulmuş klipte giriş ve çıkış aynı kare olabilir. Karşılaştırma, oynatma
saatini değiştirmeyen ayrı bir video çözücü kullanır. Önizleme FPS'i kaynaktan
düşükse panelde ayrıca gösterilir. Kaynak veya hız rampası sınırları kaydırma
aralığını belirler; tam kaynağı kullanan klipte boş kaynak payı bulunmayabilir.

Değişiklikler **Uygula** seçilene kadar taslaktır. **Vazgeç**, Escape veya
bölümü kapatmak taslağı sıfırlar; klip değiştirildiğinde önceki taslak silinir.
Kaydırıcının iptali veya sürükleme sırasında pencerenin odağını kaybetmesi
hareket öncesindeki taslağa döner. Taslak sırasında proje kaydetmek mevcut
uygulanmış kesiti saklar. Uygulama tek geri alma adımıdır; JSON'a kaydetme ve
yeniden açma kaynak kesitini ve zaman eşlemesini korur.

Hız rampasının bütün noktaları ve dondurulan kare kesitle birlikte kayar;
hız, ters oynatma, kare yumuşatma ve dondurma süresi korunur. Rampa noktaları
kesitin dışında olsa da eğrinin şeklini etkilediğinden korunur ve kaydırmayı
sınırlayabilir. Diğer kliplerin konumları, boşluklar, geçişler, renk düzenlemeleri
ve maskenin yerel animasyon saati değişmez. Kaynak dışına çıkan işlem reddedilir.
Kare yüklenemezse hata panelde görünür; **Kareleri yeniden yükle** ile tekrar
denenebilir. Bölüm kapandığında karşılaştırmanın medya kaynakları bırakılır.

## Slide: klibi komşuları arasında kaydırma

Görüntü sekmesinde iki yanında komşusu bulunan bir **video montaj klibi**
seçip **Slide · klibi komşuları arasında kaydır** bölümünü açın. Kaydırma
alanı, kaydırıcı ve **±1 / ±10 kare** düğmeleri seçili klibi içeriğini ve
süresini koruyarak taşır. Buradaki kare adımları projenin çıktı FPS'ini
kullanır; saniye girişi en yakın proje karesine yuvarlanır. Uygulanacak
gerçek miktar ve yeni klip konumu taslak durumunda gösterilir.

Pozitif kaydırma sol komşunun sonunu uzatır ve sağ komşunun başını keser.
Negatif kaydırma ters yönde çalışır. Örneğin 0–3 / 3–5 / 5–8 saniyelik
üç klipte ortadakini +1 saniye kaydırmak 0–4 / 4–6 / 6–8 sonucunu verir.
Ortadaki klibin kaynak kesiti aynı kalır; montajın bitişi 8 saniyedir.
Komşuların dış sınırları, montajdaki boşluklar ve gerçek geçiş örtüşmeleri
korunur. İşlem yalnızca bu üç klibi değiştirir; ses ve söz şeritleri etkilenmez.

**Önce / sonra · üç klibi karşılaştır** bölümünde her klibin eski/yeni
proje konumu, kaynak girişi/çıkışı ve süresi görünür. Üst çubuk eski,
alt çubuk taslak yerleşimini gösterir. **Uygula** üç klibi tek geri alma
adımıyla değiştirir. Taslak sırasında kaydedilen JSON mevcut uygulanmış
projeyi içerir; uygulanmış slide düzenlemesi yeniden açıldığında korunur.
**Vazgeç**, Escape, bölümü kapatma veya klip/proje değişimi taslağı sıfırlar.
Kaydırıcı hareketinin iptali ve sürükleme sırasında pencere odağının kaybı
hareket öncesindeki taslağa döner. Taslak proje oynatma saatini değiştirmez.

Kaynak payları, minimum kesit süresi ve üç klibin dışındaki geçişlerin
gerektirdiği komşu süreleri kaydırma sınırlarına dahildir. İlk/son klipte
veya video montajının **Toplu kilit** seçeneği açıkken kontroller devre dışıdır;
neden panelde gösterilir. Kullanılabilir pay yoksa kaydırma yapılamaz.
Komşuların mevcut ters oynatma ve hız rampaları kaynak kesme noktalarında
aynı zaman eşlemesiyle kullanılır. Dondurulmuş komşularda dondurma süresi
ayarlanır, tutulan kaynak kare korunur. Sağ komşunun maskesinin yerel saati
de kesim kadar ilerletilerek kalan görüntünün proje zamanındaki animasyonu
korunur; seçili klibin maskesi kliple birlikte taşınır.

## Rolling trim: ortak kesimi taşıma

Görüntü sekmesinde bir video montaj klibi seçip **Rolling trim · ortak kesimi
taşı** bölümünü açın. **Kesim** listesinden seçili klibin öncesini veya
sonrasını seçin. İlk klipte yalnız sonrası, son klipte yalnız öncesi kullanılabilir.
Bölüm açıkken zaman çizgisinde seçilen kesimin **↔** tutamacı görünür.
Tutamaç sağa taşındığında sol klip uzar ve sağ klip kısalır; sola taşındığında
tersi olur. Örneğin 0–3 / 3–6 kesimini +1 saniye taşımak 0–4 / 4–6 üretir.
İki klibin dış sınırları ve montajın toplam süresi sabit kalır.

Tutamaç sürüklemesi bırakıldığında **tek geri alma adımıyla** uygulanır.
Ok tuşları bir, Shift ile ok tuşları on proje karesi taşır; Home/End kaynak
sınırlarına gider. Sürükleme sırasında Shift hareketi inceltir. Escape,
işaretçi iptali veya pencere odağının kaybı sürükleme öncesindeki taslağa döner.
Klip/proje değişirse hareket uygulanmadan temizlenir.

Paneldeki saniye alanı, kaydırıcı ve **±1 / ±10 kare** düğmeleri uygulanmamış
taslak hazırlar. Kare adımı çıktı FPS'ine bağlıdır; saniye girişi en yakın
proje karesine yuvarlanır. **Uygula** iki klibi tek işlemde değiştirir.
**Vazgeç**, Escape, bölümün kapanması veya seçim değişimi taslağı sıfırlar.
Taslak proje oynatma saatini değiştirmez ve kaydedilen projeye yazılmaz;
uygulanan kesim geri alma/yeniden yapma ve dosyayı yeniden açma ile korunur.

**Önce / sonra · kesimin iki tarafı** dört kaynak karesini karşılaştırır:
eski/yeni sol çıkış ve eski/yeni sağ giriş. Sol çıkışta son çıktı karesinin
kaynak zamanı, sağ girişte ilk karenin zamanı kullanılır. Görüntüler bağımsız
bir çözücüyle hazırlanır; oynatma kaynağına seek yapılmaz. Karşılaştırma
kaynak önizlemesinin FPS'ini kullanır ve renk/maske/tuval efektleri uygulanmamış
kareleri gösterir. Bölüm kapandığında kaynaklar bırakılır; yükleme hatası
görünür durum mesajıyla ve **Kareleri yeniden yükle** seçeneğiyle bildirilir.

Kaynak payı, minimum kesit, komşu geçişler ve maske saati hareket sınırlarına
dahildir. Aralarında boşluk bulunan iki klipte veya video **Toplu kilit**
açıkken rolling trim kullanılamaz; nedeni panelde görünür. Geçişle örtüşen
kliplerde tutamaç örtüşmenin merkezindedir ve gerçek örtüşme süresi korunur.
Ters oynatma ve hız rampaları mevcut kaynak zaman eşlemesini korur.
Dondurulmuş kliplerde kare aynı kalırken dondurma süreleri ayarlanır.
Sağ klibin maske saati kesim kadar ilerletilerek kalan animasyonun proje
zamanındaki fazı korunur. Bağlantısız ses ve söz şeritleri bu işlemle taşınmaz.
Bağlantılı ses, video başlangıcının hareketini izler; hazırlanmış ses kesiti değişmez.

## Videodan ses ayırma ve bağlantılı klipler

Görüntü sekmesinde bir montaj klibi seçip **Videonun sesi ve bağlantısı →
Sesi ayrı katmana çıkar** düğmesine basın. Ses, özgün video dosyasının ilk
ses kanalından hazırlanır. Hız, hız rampası ve ters oynatma stereo 44.100 Hz
PCM16 WAV'a işlenir. **J/L kesimleri için kaynak paylarını da ayır** varsayılan
olarak açıktır: tüm kaynak hazırlanır, duyulan kesit videonun sınırlarıyla
eşleşir. Seçenek kapalıyken yalnız geçerli kesit hazırlanır. Dondurulan
görüntüde kaynak payları kullanılamaz; ayrılan ses sessizdir. Ses kanalı olmayan
videolarda açıklayıcı hata gösterilir; işlem iptal edilebilir. Hazırlanırken
proje veya seçim değişirse yeni katman eklenmez.

Yeni ses katmanı videoyla aynı proje zamanında başlar ve biter; döngüsü
kapalı, seviyesi %100 ve fade süreleri sıfırdır. Katmana bağımsız kesit,
fade, seviye, pan, EQ, efekt ve otomasyon uygulanabilir. Kaynak veya hız
sonradan değişirse hazırlanmış WAV değişmez; panel yeniden ayırmak gerektiğini
bildirir. **Bağlantıyı kaldır** iki parçayı korur. Yeni sesi almak için
bağlantıyı kaldırıp videodan yeniden ayırın; eski ses katmanı ayrıca silinebilir.

Video ve ses denetçilerindeki **Birlikte taşı**, bir parçanın sayısal veya
zaman çizgisi hareketini diğerine de uygular. Sesin bitişi, fade konumları ve
otomasyon noktaları aynı miktarda taşınır. Bağlantı kapalıyken bağımsız taşıma
mümkündür; yeniden açmak mevcut zaman farkını korur. **Sesi videoya hizala**
yalnız sesin başlangıcını video başlangıcına getirir. Video çakışmaları,
proje sınırları ve iki parçadan herhangi birinin toplu kilidi işlemi bütünüyle
reddeder. Bağlantı kesitleri veya hızları birlikte değiştirmez.

Bağlantılı çift, çoklu seçimde birlikte seçilir ve taşınır. Grup kopyala/
yapıştır yeni çift için ayrı bağlantı oluşturur. Bir parçayı silmek veya ses
dosyasını değiştirmek eski bağlantıyı kaldırır; diğer parça korunur. Ses ayırma,
hizalama ve birlikte taşıma tek geri alma adımıdır; bağlantılar proje ayarlarıyla
saklanır. **Ses katmanına git / Video klibine git** ilgili denetçiyi açar.

**WAV indir** hazırlanmış sesi kaydeder. JSON proje dosyası medya içermez;
ayrılan sesi yeniden bağlamak için indirilen WAV'ı ilgili ses katmanına yükleyin.
Bağlantılı sesin adı ve boyutu eşleşirse indirmeyle değişen dosya tarihi
normalleştirilir, kesit ve bağlantı korunur. Mevcut proje paketi API'si WAV'ı
ve bağlantı ayarlarını birlikte aktarır. Paket kaydet/aç düğmeleri mevcut HTML'de
bağlanmadığı için bu dilimde paketin arayüz akışı tamamlanmış sayılmaz.

## J-cut ve L-cut: bağımsız ses sınırları

Sesi kaynak paylarıyla ayırdıktan sonra video veya ses denetçisindeki
**J-cut / L-cut · bağımsız ses kesimi** bölümünü açın. **Giriş farkı** video
başlangıcına, **Çıkış farkı** video bitişine göre saniye cinsindendir.
Girişte −0,5, sonraki sahnenin sesini yarım saniye erken başlatır (J-cut).
Çıkışta +0,5, önceki sahnenin sesini görüntü değiştikten yarım saniye sonra
bitirir (L-cut). Pozitif giriş ve negatif çıkış sesin içe doğru kırpılmasıdır.
Örneğin görüntü 3–5 saniyedeyken giriş −1 ve çıkış +0,5, sesi 2–5,5 aralığına
getirir; görüntünün 3. saniyesinde duyulan kaynak örneği aynı kalır.

Sayı alanları, kaydırıcılar ve **±1 / ±10 kare** düğmeleri taslak hazırlar;
zamanlar çıktı FPS'inin kare sınırlarına yuvarlanır. İki çubuk, video ile
taslaktaki ses aralıklarını gösterir. **Uygula** iki ses sınırını tek geri
alma adımıyla değiştirir. **Vazgeç**, Escape veya bölümü kapatma uygulanmamış
taslağı siler. Proje/seçim değişikliği de eski taslağı geçersiz kılar.
Dokunma iptali veya pencere odağının kaybı kaydırıcı hareketinden önceki taslağa
döner. **Video sınırlarına dön** iki farkı sıfırlayan taslak hazırlar; ardından
**Uygula** gerekir. Kaydedilen projeye yalnız uygulanmış kesimler yazılır.

Ses kaynak saati korunur; ses kesitini değiştirmek videoyu birlikte sürüklemez.
Sonraki **Birlikte taşı** hareketleri düzenlenmiş ses ve video arasındaki
mesafeyi korur. Fade süreleri yeni ses kenarlarına uygulanır; otomasyon
noktaları proje zamanındaki yerlerinde kalır. İki farklı sahnenin sesleri
üst üste gelebilir; her katmanın seviye, fade ve otomasyonu ayrı ayarlanır.
**Sesi videoya hizala** başlangıç konumunu taşır; kaynak kesitini geri almak
için **Video sınırlarına dön** kullanılır.

Kullanılabilir kaynak payı ve proje sınırı panelde gösterilir; en kısa kesit
0,05 saniyedir. Kaynak payları olmayan eski WAV'lar yalnız kendi içerikleri
içinde düzenlenebilir. Daha fazla pay için bağlantıyı kaldırıp kaynak payları
seçili olarak yeniden ayırın. Döngü açıkken, iki şeritten biri toplu kilitliyken
veya video kesiti/hızı değişip hazırlanan ses eski kaldığında J/L kontrolleri
gerekçesiyle birlikte kapatılır. Çok yavaş uzun kaynakta hazırlanacak WAV
20 dakikayı aşarsa kaynak paylarını kapatarak yalnız kesiti ayırabilirsiniz.

## Tuval üzerinde düzenleme

Görüntü sekmesinde **Tuval araçları → Dönüştür** seçiliyken görüntü gövdesini
sürükleyerek taşıyın. Köşeler en-boy oranını koruyarak ölçekler; yuvarlak üst
tutamaç döndürür. Tam kadraja oturan bir görüntü de taşınabilir. **Merkezle**
konumu sıfırlar. Görüntü çıktı sınırlarının dışına çıktığında görünür köşeleri
veya sayısal alanları kullanabilirsiniz. Yakınlık %10–%400 aralığındadır.
Görüntüye çift tıklamak konumu ve yakınlığı sıfırlar; kırpma ve dönüşü korur.

**Kaynağı kırp**, kaynağın dönüş/ayna/efekt uygulanmadan önceki görünümünü açar.
Kenarlar ve köşeler kırpar; seçili alanın içinden sürüklemek kırpma penceresini
taşır. **Kırpma oranı** serbest, kaynak, 16:9, 9:16 veya 1:1 olabilir. Oran
seçiliyken köşe tutamaçları bu oranı korur. **Kaynak kırpma** alanlarında her
kenarı yüzdeyle girebilirsiniz; her eksende kaynağın en az %5'i kalır. Sayısal
giriş veya geri alma seçili oranı bozarsa oran seçicisi Serbest'e döner.
Oran önayarı o anda görünen kaynağa göre hesaplanır; montajda farklı kaynak
oranına geçildiğinde ortak yüzdeler korunur, oran seçicisi gerekirse Serbest'e döner.
**Kırpmayı sıfırla** bütün kaynağı geri getirir; kaynak dosya değişmez.

Tutamacı veya düzenleme alanını odaklayıp ok tuşlarını kullanabilirsiniz.
Taşıma/kırpma bir piksel, dönüş bir derece, ölçek bir yüzde puanı adımla çalışır;
Shift ince, Alt büyük adım sağlar. Her sürükleme tek geri alma adımıdır;
Escape, pencere odağını kaybetme ve iptal edilen dokunma hareketi sürüklemeyi
geri bırakır. İşlemler montajdaki bütün video kliplerinin ortak kadrajına uygulanır.

**Kılavuz** seçicisi üçler/merkez ve %90 görüntü / %80 metin güvenli alanlarını
gösterir. Kılavuzlar, tutamaçlar ve kırpma düzenleme görünümü çıktıya eklenmez.
Görüntü sekmesinden çıkınca düzenleme çerçevesi gizlenir.

## Ses ve hassas kontroller

**Ana şarkı montajı** seçili kaynak kesitini parçalara ayırır. Ana şarkı
şeridindeki blokları taşıyın; kenarlarından kesin veya kaynak giriş/çıkışını
ve proje konumunu sn/kare alanlarından girin. Shift ince hareket, Alt geçici
yapışma kapatma sağlar; Escape sürüklemeyi iptal eder. Her işlem geri alınabilir.
Parçalar üst üste gelemez; kaynak kesiti en az 0,05 saniye olmalıdır.

**İmleçte böl**, **Çoğalt**, **Sil**, **Boşluğu kapatarak sil**, **Kopyala**
ve **İmlece yapıştır** seçili ana parçaya uygulanır. Çoğaltma parçayı hemen
ardına koyar. Yapıştırma imleçteki ana parçayı gerekirse böler. Bu iki işlem
sonraki ana parçaları ileri taşır; ripple silme sonraki ana parçaları silinen
parçanın süresi kadar sola taşır. Ek ses, video ve işaretçi konumları korunur.
Normal silme boşluk bırakır; son ana parça proje saatini sağladığı için silinemez.
Ana montajın panosu aynı kaynak dosyasında kullanılabilir.

Hız, perde koruma ve bas/tını/reverb zinciri bütün ana montaja uygulanır.
Ses/pan/filtre/reverb otomasyonu ile fade ayarları ana miks kanalında, **proje zamanına**
bağlı kalır; parçayla birlikte taşınmaz. Ses boşluklarında efekt kuyruğu
duyulabilir. Kaynak dosya değişmez. Montaj hazırlanırken oynatma durur;
hazır olunca Çal ile devam edebilirsiniz. Oynatma, önizleme ve dışa aktarma
aynı kesit/boşluk planını kullanır.

Varsayılan olarak sözler kaynak dosyanın zamanını izler: taşınan parçada taşınır, çoğaltılan
parçada tekrar eder; boşluklarda görünmez. Proje zamanıyla SRT/LRC dışa aktarma
bu tekrarları içerir. Proje zamanıyla söz içe alırken bir satır montaj kesimi
veya boşluk aşarsa satırı bölün ya da kaynak zamanını kullanın. İnceleme
döngüsü seçilen sözün imlece en yakın montaj tekrarını dinletir.
Ripple sonrasında proje zamanına bağlanan sözler için yukarıdaki ripple
bölümünde açıklanan saat ve aktarım kuralları geçerlidir.

Montaj kullanılırken eski bütün-kaynak kesme alanları devre dışıdır.
**Kaynak kesitine dön** önceki tek kesiti geri getirir; montaj geri alma ile
yeniden açılabilir. Proje dosyası kesitleri saklar; kaynak ses yeniden
bağlandığında montaj yeniden hazırlanır. En fazla 64 ana parça ve 20 dakika
proje süresi kullanılabilir.

Ek ses katmanlarında montaj komutları bulunur. Bölme, kaynağı yeniden başlatmaz;
döngü fazı, fade ve otomasyon eğrileri korunur. Çoğaltma yeni parçayı imlece
yerleştirir. Ripple silme, silinen katmanın bitişinden sonra başlayan ek ses
katmanlarını sola taşır. Video şeridi ayrı düzenlenir.

Katmandaki **Kopyala**, dosyayı, kesiti ve yaratıcı ayarları panoda tutar.
Zaman çizgisindeki **Ses yapıştır** bunları imleçte yeni bir katmana ekler;
fade ve otomasyon zamanlarını da taşır. Kaynak katman silinse de yapıştırma
çalışır. Yapıştırılan bölüm proje sonunda kısalır; ses katmanları üst üste
eklenir ve sonraki sesleri ileri taşımaz. Geri al/yinele desteklenir.

Yeni ses katmanlarında kaynak kesiti, proje konumu/bitişi, pan, fade ve döngü
alanları bulunur. Ses seviyesi yanındaki **% / dB** seçicisi aynı kazancı farklı
birimde gösterir; dB alanını boş bırakmak sesi sıfırlar. Otomasyon açıkken eğri,
normal ses seviyesi değerinin yerine geçer.

Sayısal değerleri sürüklerken Shift ince, Alt büyük adım sağlar. Görüntüdeki
**Hassas değer girişi** eksi/artı düğmeleri ve px/%, ×/% veya sn/kare seçenekleri
sunar. **Tuval yatay/dikey** piksel konumu, çıktı boyutuna göre bağımsız
yer değiştirmedir. **Kadraj yatay/dikey** ise yerleşimin boşluk/kırpma payında
hizalamadır; o eksende pay kalmıyorsa bu kadraj kontrolü devre dışıdır.

Ses kesiti/konumu/fade, video kesiti/geçişi/fade, otomasyon noktası ve söz
zamanlarında alanın yanındaki **sn / kare** seçicisinden birimi değiştirin.
Kare değeri çıktı FPS'ine göre hesaplanır. Birim değiştirmek değeri veya geri
alma geçmişini değiştirmez; gösterim en yakın kareye yuvarlanır. Yeni girilen
tam kare saniyeye çevrilir; FPS değişirse aynı saniye farklı kare sayısıyla
gösterilir. Kaynak zamanları kendi kaynak saati üzerinde kalır.

Kütüphanedeki ses dalga önizlemeleri mevcut oturum dosyalarına, video küçük
resimleri yerel medya arşivine dayanır. Dosyaları veya kütüphane öğelerini
zaman çizgisine bırakarak o konuma ekleyebilirsiniz. Çakışan video eklemelerinde
önce boşluk açın veya mevcut klibi bölün.

## Video anahtar kareleri

Görüntü sekmesindeki **Video anahtar kareleri** alanı tuval yatay/dikey konumu,
yakınlık, dönüş ve opaklığı hareketlendirir. Kadraj ayarının yanındaki **◇**
veya **İmleçte ekle** ile ilk kareyi ekleyin. Ardından başka zamana gidip
sayısal değeri değiştirin veya görüntüyü tuvalde taşıyın/ölçekleyin/döndürün;
hareket açık olan parametrede yeni anahtar kare oluşur. Diğer parametreler
sabit ayar olarak çalışmaya devam eder. Yeni kareler çıktı FPS'ine hizalanır.

Parametre seçicisi, zaman çizgisindeki elmas şeridini de değiştirir. Elmasa
tıklayarak o ana gidin; sürükleyerek zamanını değiştirin. İşaretçi hizalama
açıkken yakındaki işaretçiye yapışır; Alt geçici olarak bunu kapatır. Önceki/
sonraki düğmeleri veya listedeki zamanlar arasında gezinin. Seçili elması ok
tuşlarıyla bir kare, Shift ile on kare taşıyın; Delete ile silin. **Anahtar
zamanı** alanı sn/kare birimlerini destekler. Aynı parametrede aynı zamana
iki kare yerleştirilemez. Sürükleme tek geri alma adımıdır; Escape iptal eder.

Kareler arasında varsayılan olarak doğrusal hareket uygulanır; her aralığın
karakterini aşağıdaki geçiş editöründen değiştirebilirsiniz. İlk kareden önce ilk değer,
son kareden sonra son değer tutulur. Son kareyi silmek o anki değeri sabit
bırakır. **Bu parametrenin hareketini kaldır** tüm eğriyi kaldırıp o anki
görünümü sabitler; geri alınabilir. İlk görüntüyü korumak için ilk anahtar
kareyi değiştirmeden önce proje başlangıcına ekleyin.

Bu kareler ortak proje zamanına bağlıdır ve bütün video kliplerine uygulanır.
Video döngüsü, kaynak kesiti veya şarkı hızını değiştirmek anahtar zamanlarını
yeniden yazmaz. Opaklık, efektler/görselleştirici dahil video görünümünü siyaha
doğru soldurur; ön plan görselini ve sözleri etkilemez. Projeyi kaydetme/açma
ve MP4 çıktısı aynı eğriyi kullanır. Parametre başına en fazla 1000 kare
bulunabilir. Proje kısaltılınca dışarıda kalan kareler saklanır; süre tekrar
uzatılabilir veya parametrenin hareketi topluca kaldırılabilir.

## Eğri ve geçiş karakterleri

Ses otomasyonunda başlangıç noktasını seçin. Video anahtar karelerinde bir
anahtar zamana veya iki anahtarın arasına gidin ve parametreyi seçin.
**Sonraki aralığın geçişi**, başlangıç noktasından sonraki noktaya kadar
uygulanır; gösterilen zaman aralığını kontrol edin. Son noktanın ardından
değişecek değer olmadığı için karakter seçimi devre dışıdır.

- **Doğrusal:** Sabit hızla değişir; eski projelerin varsayılanıdır.
- **Yumuşak giriş:** Yavaş başlar, değişim hızlanır.
- **Yumuşak çıkış:** Hızlı başlar, sona yaklaşırken yavaşlar.
- **S eğrisi:** Başlangıç ve bitiş yumuşaktır.
- **Sabit tut:** Başlangıç değerini korur, sonraki noktada aniden değişir.
- **Bézier:** İki tutamaçla değişimin hızını kendiniz şekillendirin.

Örneğin sesin yükselişini S eğrisi, düşüşünü doğrusal yapabilir; video
konumunu bir süre sabit tutup sonraki aralıkta yumuşakça hareketlendirebilirsiniz.
Her aralık bağımsızdır. Ses eğrisi katmanın fade ayarlarıyla birlikte uygulanır.

Bézier grafiğinde yatay eksen geçen süreyi, dikey eksen iki değer arasındaki
ilerlemeyi gösterir. Tutamaçları sürükleyin veya dört sayısal alana 0–1 arasında
değer girin. Ok tuşları 0,01; Shift ile 0,1 adım uygular. Bir sürükleme tek geri
alma adımıdır; Escape, iptal edilen dokunma veya odak kaybı değişikliği iptal eder.
Kontroller iki uç değerin dışına taşma üretmez; azalan değerler de desteklenir.

Eğrinin üzerine aynı değerde yeni nokta eklemek mevcut şekli korur. Ek ses
katmanını taşırken veya keserken eğrinin ilgili kesiti de korunur. Böyle bir
kesitte karakteri ya da tutamacı değiştirirseniz yalnızca seçili aralığı yeniden
şekillendirirsiniz. Nokta değerini/zamanını değiştirmek, o noktaya bağlı
aralıkları yeni uçlara göre şekillendirir. Projeyi kaydetme/açma, geri al/yinele,
önizleme ve ses/MP4 çıktısı geçiş karakterlerini korur.

## Gelişmiş otomasyon çizimi

Ses katmanının otomasyon alanındaki **Büyüt**, aynı eğriyi geniş bir pencerede
açar. **Kapat** veya Escape ile denetçiye dönün; düzenlemeler ve seçim korunur.
Pencere açıkken üstteki kapatma düğmesi kaydırma sırasında da erişilebilir.

**Nokta** aracı boş alana bir nokta ekler, mevcut noktayı sürükler. Shift ile
bir noktayı seçime ekleyin veya seçimden çıkarın. **Kutu seçimi** aracıyla boş
alandan sürükleyerek bir bölge seçin; Shift önceki seçimi korur. Seçili bir
noktayı sürüklemek bütün seçimi taşır. Zaman aralıkları ve seviye farkları
korunur; grup komşu noktaların üzerinden geçmeden ve seçili parametrenin sınırları dışına taşmadan
birlikte durur. Shift sürüklemeyi inceltir.

**Listeden seç ve toplu taşı**, klavyeyle çoklu seçim için nokta listesi sunar.
Ctrl/⌘ veya Shift ile noktaları seçin. Zaman ve seviye farklarını girip
**Seçili noktaları taşı** düğmesine basın. Görünen tek **Nokta** alanı ve
geçiş karakteri editörü etkin noktayı değiştirir; diğer seçili noktaları toplu
komutlarla düzenleyin. **Seçileni sil**, yalnızca seçili noktaları kaldırır.

**Noktaları kopyala**, noktaların kendi aralarındaki zamanı, değerlerini ve
aralık karakterlerini panoya alır. **İmlece yapıştır**, ilk noktayı proje
imlecine yerleştirir; aynı zamandaki noktayı değiştirir ve diğer noktaları
korur. Noktaları başka bir ses katmanında aynı parametreye de yapıştırabilirsiniz. Grup proje
sonuna sığmıyorsa işlem uygulanmaz; imleci daha erken bir zamana alın.
Pano uygulama oturumu boyunca kullanılabilir.

Eğri alanı odaktayken Ctrl/⌘+A tümünü seçer, C kopyalar, V yapıştırır.
Delete/Backspace seçimi siler. Ok tuşları grubu yatayda 0,1 saniye, dikeyde
ses seviyesi/reverb için bir yüzde puanı taşır; Shift yatay adımı 0,01 saniyeye,
dikey adımı onda birine indirir. Pan/filtre adımları aşağıda belirtilir. Kare veya
ritim hizalamasında yatay oklar ilgili ızgaranın bir adımıyla ilerler.

**Kalem** aracıyla bir aralık çizin. Çizim bırakılana kadar yerel önizlemedir;
bırakınca tek geri alma adımıyla uygulanır. Aynı zamandan tekrar geçerseniz
son çizdiğiniz değer kullanılır. Düz kısımlar sadeleşirken tepe/dip noktaları
korunur. Çizilen bölümün dışındaki eğri korunur; gerektiğinde kısa sınır
aralıkları eklenir. Bu sınır noktaları da listeden seçilebilir. Tek tıklama
bir nokta ekler. Escape, dokunma iptali veya pencere odağını kaybetmek çizimi
ve sürüklemeyi iptal eder. Düzenleme başlarken oynatma durur; Çal ile devam edin.

**Eksenler ve hizalama** içinde zaman zoom/kaydırması ortak zaman çizgisine
bağlıdır. **Alt/üst değer** yalnızca seçili eğrinin dikey görünümünü değiştirir;
örneğin %60–80 aralığını büyüterek küçük değişimleri düzenleyin.
**Seviyeye sığdır**, seçili parametrenin tam aralığına döner. Görünüm ayarları sesi ve geri
alma geçmişini değiştirmez.

**Hizalama** için Serbest, Kare, Ritim aralığı veya İşaretçi seçin. Kare,
çıktı FPS'ini kullanır. Ritim aralığı, projenin BPM, ilk vuruş ve vuruş
bölümü ayarlarını kullanır. Bu editördeki BPM/bölüm alanı da ortak proje
ayarını değiştirir. İşaretçi, yakındaki proje işaretçisine yapışır.
Alt sürükleme sırasında hizalamayı geçici kapatır. İlgili ızgara eğri alanında
görünür; yoğun görünümde çizgiler seyreltilse de hizalama adımı değişmez.
Hizalama modu ve görünüm tercihleri editöre aittir. BPM, ilk vuruş, ölçü ve
bölüm ayarları; eğri noktaları ve karakterleri proje dosyasında saklanır.

## Canlı otomasyon kaydı

Ses katmanının **Ses otomasyonu → Canlı otomasyon kaydı** bölümünü
açın. Bu bölüm büyük editörde de kullanılabilir. **Başlangıç/Bitiş** alanları
proje saniyesi veya kareyle girilebilir; **Görünür aralığı al** ortak zaman
çizgisinde görünen bölümü seçer. Aralık proje içinde olmalıdır.

- **Oku:** Mevcut eğriyi izler; kayıt yapmaz.
- **Dokunurken yaz:** Kayıt kaydırıcısını oynatma sırasında hareket ettirince
  yazmaya başlar. Fare/dokunma veya ok tuşu bırakıldığında mevcut eğriye döner.
  Aynı kayıttaki ayrı dokunuşların arasındaki eğri korunur.
- **Bırakınca yazmayı sürdür:** İlk hareketten sonra son seviyeyi yazmaya
  devam eder; bırakmak yazmayı durdurmaz.

Mod ve aralığı seçip **Kayda hazırla** düğmesine basın. Oynatın ve **Kayıt
seviyesi** kaydırıcısını hareket ettirin. Kaydırıcı %0–200 ve %0,1 hassasiyet
sunar; ok tuşları %1, Shift ile %0,1, Alt ile %10 değiştirir. Kayıt öncesinde
hareket ettirmek tek başına nokta oluşturmaz. Aralık öncesinde başlayan bir
dokunuş, hâlâ etkinse seçili başlangıçta yazmaya başlar. Aynı anda bir katman
kaydedilir; başka katmanı hazırlamak önceki kaydı tamamlar.

**Kaydı bitir**, duraklatma ve aralık sonu bütün dokunuşları tek geri alma
adımıyla uygular. Başka zamana atlamak kaydı son örneklenen anda tamamlar;
atlanan boşluk yazılmaz. **Kaydı iptal et** veya Escape bekleyen kaydı
değişiklik yapmadan atar. Projede başka bir ayarı değiştirmek veya geri almak
bekleyen kaydı iptal eder; kaydı bitirip ardından düzenleme yapın. Pencere
odağı kaybolunca ya da sekme gizlenince kayıt o anda tamamlanır.

Normal miks seviyesi ayrı kalır; yazmak için bu bölümdeki kayıt kaydırıcısını
kullanın. Fade, mute, solo ve katman zamanlaması canlı dinlemede korunur.
Proje kaydetme, medya paketleme ve render, bekleyen kaydı tamamlayıp güncel
eğriyi alır. Kaydedilen eğri normal noktalar olarak saklanır; tekrar açma ve
dışa aktarılan ses aynı eğriyi kullanır. Kayıt sadeleştirme toleransı %0,01,
zaman çözünürlüğü mikro saniyedir; parametre başına 1000 nokta sınırı geçerlidir.
Eğri, yazılan bölgelerin dışındaki karakterlerini korur; sınıra sığmayan kayıt
uygulanmaz ve kullanıcıya hata gösterilir.

## Pan, filtre ve reverb otomasyonu

Her ses katmanının **Ses otomasyonu** bölümündeki **Parametre** seçicisinden
ses seviyesi, stereo konum, alçak geçiren filtre veya katman reverb'ünü seçin.
**Tüm parametre şeritleri** aynı proje zamanında dört eğriyi ve oynatma imlecini
birlikte gösterir. Bir şeride tıklamak onu düzenlemeye açar; seçili şerit vurgulanır.
Eğriler bağımsızdır ve aynı anda uygulanır.

- **Ses seviyesi:** %0–200. Canlı kayıt kaydırıcısı bu parametreyi yazar.
- **Stereo konum:** -1 tam sol, 0 merkez, +1 tam sağ. Nokta listesi L/R yüzdesi
  gösterir; sayısal giriş -1 ile +1 arasındadır. Ok tuşu 0,01, Shift ile 0,001.
- **Filtre:** 20–22.000 Hz. Üst sınır filtreyi tamamen açar. Ok tuşu 100 Hz,
  Shift ile 10 Hz. Düşük frekansları hassas düzenlemek için **Eksenler ve hizalama**
  bölümündeki alt/üst değer aralığını daraltın.
- **Katman reverb:** %0–100. Ok tuşu %1, Shift ile %0,1.

**Sabit değer**, eğri bulunmadığında uygulanır; **Eğriyi kaldır** yalnızca seçili
parametreyi temizler. Hazır eğriler seçili sabit değerden üretilir. Büyük editör,
kalem, kutu/listeden çoklu seçim, toplu taşıma, hizalama ve altı geçiş karakteri
bütün parametrelerde kullanılabilir. Noktaları başka katmana aynı parametre
seçiliyken yapıştırın. Parametre değiştirmek açık ses seviyesi kaydını tamamlar.
Her parametre için 1000 nokta sınırı ayrı uygulanır. Geri alma ve proje/paket
kaydı bütün parametreleri korur; eski projelerde filtre açık ve katman reverb'ü
%0 başlar.

Katman filtresi ve reverb'ü, ses seviyesi/fade ve stereo pan öncesinde uygulanır.
Ana şarkının mevcut genel efekt zincirinin ardından gelir; ek ses katmanlarında
ayrı çalışır. Reverb sabit 0,65 saniyelik stereo dürtü kullanır; ıslak kazanç
`miktar/100`, kuru kazanç `1 - miktar/200` olur. Katman bitişinde efekt kuyruğu
da kapanır; proje süresini uzatmaz. Zaman atlama filtre ve reverb geçmişini sıfırlar.
Filtre eğrisi mutlak proje zamanında 128 örnekte bir uygulanır (44,1 kHz'de
yaklaşık 2,9 ms); reverb eğrisi örnek zamanına göre hesaplanır. Tarayıcı ve Python
çıktısı aynı eğri/efekt tanımını kullanır. Python filtresi akış halinde SciPy ile
işlenir; güncel `requirements.txt` kurulmalıdır.

## Katmana özel parametrik EQ ve efekt zinciri

Her ses katmanının **Katman efekt zinciri** bölümünde üç bantlı parametrik EQ,
alçak geçiren filtre, reverb ve delay bulunur. Sinyal listede yukarıdan aşağı
işlenir. **↑ / ↓** düğmeleriyle sıralamayı değiştirin. **Etkin** işaretini
kaldırmak yalnızca o efekti bypass eder; değerleri ve otomasyon noktaları korunur.
Alanlar bypass sırasında da düzenlenebilir. Bütün işlemler geri alınabilir.

EQ'da **Bant 1 / 2 / 3** seçin. Grafikte bant tutamacını yatay sürüklemek
frekansı, dikey sürüklemek kazancı değiştirir; Shift hareketi inceltir. Çizim
bırakılana kadar önizlemedir, bırakınca tek geri alma adımıyla uygulanır.
Escape, dokunma iptali veya pencere odağını kaybetmek sürüklemeyi iptal eder.
Sayısal **Frekans / Kazanç / Q** alanları seçili bandı doğrudan değiştirir.
Frekans ekseni logaritmiktir; grafik üç bandın birleşik yanıtını gösterir.
Birleşik yanıt ±18 dB grafik sınırını aşarsa çizgi sınıra dayanır; ses hesabı
bu grafik sınırıyla kısılmaz.

- Her bandın frekansı 20–20.000 Hz, kazancı -18…+18 dB ve Q değeri 0,1–12'dir.
  Büyük Q dar bir frekans bölgesini etkiler.
- Grafik odaktayken sol/sağ ok frekansı yaklaşık %5 değiştirir; Shift ince adım
  sağlar. Yukarı/aşağı ok kazancı 1 dB, Shift ile 0,1 dB değiştirir.
- **+ / -**, seçili Q'yu 0,1, Shift ile 0,01 değiştirir.
- **EQ’yu sıfırla** üç bandın frekans/kazanç/Q değerlerini başlangıca döndürür;
  diğer efektler, sıralama ve bypass seçimi korunur.

**Filtre / Reverb** alanları mevcut otomasyonun sabit değerleriyle aynıdır.
Eğri varsa o okunur. Efekt bypass edilirse eğrisi geçici olarak duyulmaz;
yeniden etkinleştirince güncel proje zamanındaki eğri uygulanır.

**Delay** için **Gecikme · ms** (10–2000 ms), **Geri besleme · %** (0–85) ve
**Miktar · %** (0–100) girin. İlk tekrar seçilen gecikmede başlar; geri besleme
sonraki tekrarları azaltarak sürdürür. Yerel Web Audio döngüsündeki 128 örnek
geri besleme süresi dışa aktarmada da korunur (44,1 kHz'de yaklaşık 2,9 ms).
Gecikme en yakın ses örneğine yuvarlanır. Miktar `m` için ıslak kazanç `m/100`,
kuru kazanç `1 - m/200` olur. %0 delay sesi değiştirmez.

Zincir, katmanın ses seviyesi/fade ve pan ayarlarından önce uygulanır; ana
şarkının mevcut genel efektlerinin ardından gelir. Efekt sırası özellikle
zamana bağlı filtre/reverb eğrilerinin sonucunu değiştirebilir. Kaynak kesiti,
döngü, mute/solo ve katman bitişi korunur. Efekt kuyruğu katman/proje sonunda
kapanır; süre uzamaz. Zaman atlama bütün katman efektlerinin ses geçmişini sıfırlar.
Zincir proje ve medya paketine kaydolur; katman kopyalama/çoğaltmada bağımsız
bir kopyası taşınır. Eski projelerde EQ düz, delay %0 başlar.

## BPM ve ritim ızgarası

Zaman çizgisi araç çubuğundaki **Ritim** menüsünü açın. Menü klip şeritlerinin
yerini değiştirmez; dışarı tıklayın veya Escape ile kapatın.

- **Tempo · BPM:** 20–300 arasında kesirli değer kabul eder. Bu ayar müziğin
  hızını veya mevcut klip/otomasyon zamanlarını değiştirmez.
- **İlk vuruş · sn:** birinci ölçünün başlangıcıdır. Sayısal girin veya
  **İlk vuruşu imleçten al** kullanın. Izgara bu noktadan iki yönde uzanır;
  önceki ölçüler 0 ve negatif numaralarla görünür.
- **Ölçüde vuruş:** 1–12 arasında tam sayı. **Izgara aralığı:** tam, yarım,
  üçte bir, çeyrek veya sekizde bir vuruş.
- **Ritim çizgilerini göster:** ölçü/vuruş cetvelini ve ses/video/ana montaj
  şeritlerindeki çizgileri açar. Zoom ve kaydırma ortak başlangıcı korur.
  Yoğun görünümde yalnızca çizimler seyrelir; yapışma hassasiyeti değişmez.
- **Ritme yapış:** genel **Yapışma** açıkken klip sürükleme/kesmeyi ve
  kütüphaneden zaman çizgisine bırakmayı yakın ritim çizgisine bağlar. Klip
  taşırken başlangıç ve bitiş adayları değerlendirilir. Alt geçici kapatır.
  Video taşıma/kesme, sonunda çıktı FPS'inin en yakın karesine yuvarlanır.

**Tap tempo:** en az üç düzenli tıklama/klavye aktivasyonu yapın. Son 12
vuruşun tutarlı aralıklarından hesaplanır; tekil kaçırılmış vuruşlar elenir.
Üç saniyeden uzun ara yeni ölçüm başlatır. **Tap sonucunu uygula** yalnızca
BPM'yi tek geri alma adımıyla değiştirir.

**Tempo öner:** imleçten başlayan en fazla 90 saniyelik ana montajı yerel
olarak inceler; kaynak kesimleri, montaj boşlukları ve mevcut oynatma hızını
dikkate alır. En az dört saniye gerekir. Vuruş başlangıçlarından en fazla
üç BPM/ilk vuruş adayı sunulur. Analiz sırasında projeyi düzenlemek veya
**Analizi iptal et** eski sonucu geçersiz kılar. Öneri düğmesine basılmadan
proje değişmez; uygulama BPM, önerilen ilk vuruş ve çizgi görünürlüğünü tek
geri alma adımıyla değiştirir. Ritme yapış ayrıca açılır. İlk vuruşun ölçüdeki
kuvvetli vuruş olduğu garanti edilmez; dinleyip imleçten düzeltin. Değişken
tempolu veya belirgin atakları olmayan kayıtlarda elle BPM/tap kullanın.
Analiz miks efektleri, ses seviyesi, fade ve sessize alma ayarlarını kullanmaz;
ana müzik kaynağının ritmini inceler. Dosya dış bir servise gönderilmez.

Ek ses katmanında **Katman montajı → Konumu ritme hizala** başlangıcı tam
ızgaraya alır; fade ve otomasyon zamanlarını aynı miktarda taşır. Video
montajında ikinci/sonraki klibi seçip **Geçiş başlangıcını ritme hizala**
kullanın. Komut, önceki klibin sonunu koruyarak gerçek örtüşme başlangıcını
yakın uygun ritim çizgisine taşır ve geçiş süresini günceller. İzin verilen
örtüşmede çizgi yoksa daha küçük vuruş bölümü seçin. Otomasyonda
**Hizalama → Ritim aralığı**, aynı BPM/ilk vuruş/bölüm ayarını kullanır.

Ritim ayarları proje dosyası ve medya paketine kaydolur; geri alma/yeniden
açma ile geri gelir. Eski projeler 120 BPM, 4 vuruş ve ilk vuruş 0 ile açılır;
çizgiler ve ritme yapış kapalı başlar. Izgara yalnızca editördedir. Hizalanan
klip, geçiş, fade ve eğri zamanları mevcut önizleme/çıktı akışına kaydolur.

## Görsel geçiş düzenleme

**Video montajı** bölümünde önceki klibi olan bir klip seçin ve **Geçiş
galerisi**ni açın. Dokuz küçük görsel, geçişin A ve B görüntülerini nasıl
birleştirdiğini gösterir. Galeri ve mevcut **Geçiş** menüsü birlikte çalışır:
eriyerek, karararak, silme, itme, pikselleşme, çözünme, dairesel, zoom ve blur.
İlk klibin giriş geçişi yoktur; ilgili kontroller kapalıdır.

- **Yön:** silme/itmede sola, sağa, yukarı veya aşağı; zoom ve daireselde içe
  veya dışa. Diğer türler yönsüzdür.
- **Yumuşaklık:** 0–100 arasında zamansal hız eğrisini ayarlar. 0 doğrusal,
  100 yavaş başlayıp yavaş biten hareket verir; kenar maskesi yumuşatması
  değildir. Eski projelerde 0 kullanılır.
- **Geçiş süresi:** giriş klibiyle önceki klibin gerçek örtüşmesidir. En fazla
  iki komşu klibin yarısı veya 10 saniyedir. Sayı alanında saniye/kare girin
  veya video şeridinin altındaki ↔ tutamacını sürükleyin. Sola uzatır, sağa
  kısaltır. Shift sürüklemede hassas hareket; Alt yapışmayı geçici kapatır.
  İşaretçiler ve etkin ritim ızgarası, geçiş başlangıcını hizalar.
- Tutamaç odaktayken sol/sağ ok bir kare, Shift+ok on kare değiştirir.
  Home geçişi sıfırlar, End izin verilen en uzun geçişi uygular. Escape,
  pencere odağının kaybolması veya pointer iptali sürüklemeyi geri alır.
  Tamamlanan sürükleme tek geri alma adımıdır.

Süre değişikliği önceki klibin sonunu sabit tutar; giriş klibini ve sonraki
tüm klipleri birlikte taşır. Kaynak kesitleri, hızlar, sonraki boşluklar ve
geçişler korunur. 0 saniye mevcut örtüşmeyi kesmeye çevirir; zaten boşlukla
ayrılmış bir klipte 0, boşluğu değiştirmez. Pozitif geçiş eklemek o boşluğu
kapatır. Video montajının bitişi değişebilir; proje süresini ana ses montajı
belirlemeye devam eder.

**Geçişi döngüde izle**, seçili örtüşmenin ses projesi içinde kalan kısmını
ortak proje saatinden çalar. En az bir çıktı karesi ve yüklenmiş sesler
gereklidir. Ana ses kırpması ve hız değişikliği hesaba katılır. Durdurma,
kullanıcı zaman atlaması, klip/proje değişikliği, kayıt/dışa aktarma için
snapshot alma veya sayfanın gizlenmesi döngüyü kapatır. Söz çevresi dinleme
ve geçiş döngüsü birbirinin kontrolünü devralır; aynı anda yarışmaz.

Tür, yön, yumuşaklık ve gerçek süre projeye ve `.cozy` paketine kaydolur.
Galeri, önizleme ve MP4 aynı geçiş çizicisini kullanır. Blur, Canvas filtre
desteğine bağlı olmayan Gauss çekirdeğiyle çalışır; maliyeti sınırlamak için
bulanık ara görüntü düşük çözünürlükte işlenir. Bu yüzden blur yoğunluğu
şimdilik sabittir; yumuşaklık alanı geçişin zaman eğrisini değiştirir.

## Klibe özel renk ve karşılaştırma

**Görüntü → Video montajı → Klibe özel renk** bölümünü açın. Montajda
seçili klibin, tek arka planda arka plan videosunun renklerini düzenler.
Klip adı üstte görünür. Nötr, Sıcak, Soğuk, Mat ve Siyah beyaz görünümleri
başlangıç ayarı olarak kullanılabilir; görünüm seçmek o klibin renk
kontrollerini ve eğrilerini birlikte değiştirir.

- Pozlama −3–3 EV; parlaklık −0,5–0,5; kontrast/doygunluk 0–2 ve gama
  0,25–3 aralığındadır. Sıcaklık, ton dengesi, gölgeler, orta tonlar ve ışıklar
  göreli −100–100 değerleri kullanır. Kaydırıcıların yanında hassas sayı
  alanları bulunur. Kaydırma sırasında önizleme canlıdır; bırakınca tek geri
  alma adımı kaydedilir. Escape veya pointer iptali taslağı geri alır.
- **RGB eğrileri** ortak RGB ve ayrı kırmızı/yeşil/mavi kanallar sunar.
  Boş alana tıklayarak nokta ekleyin; noktayı sürükleyin veya giriş/çıkış
  yüzdelerini yazın. Her kanalda iki uç dahil en fazla 16 nokta vardır;
  noktalar arasındaki giriş aralığı en az %0,1'dir. Uçların girişleri %0/%100
  olarak sabittir, çıkışları değişebilir. Eğri komşu noktalar arasında
  doğrusal ilerler; ortak RGB eğrisi kanal eğrilerinden önce uygulanır.
  Nokta odaktayken oklar %1, Shift+ok %10, Alt+ok %0,1 değiştirir. Delete
  iç noktayı siler. Escape, odak kaybı ve pointer iptali sürüklemeyi geri
  alır. **Kanalı sıfırla** yalnızca seçili eğriyi başlangıca döndürür.
- **Renk düzenlemesini uygula** ayarları koruyarak renk işlemeyi açar/kapatır.
  **Rengi sıfırla** tüm renk kontrollerini ve eğrileri nötr duruma getirir.
  **Rengi kopyala / yapıştır** renk panosuyla başka klibe aktarır;
  **Diğer kliplere uygula** seçili profili diğer tüm kliplere tek geri alma
  adımıyla uygular. Zamanlama ve kadraj korunur. Bölme, çoğaltma ve video
  panosuyla yapıştırma renk profilini de taşır.
- **Önce / sonra karşılaştır** sahneyi solunda önce, sağında sonra olarak
  böler. Panel kaydırıcısını veya sahnedeki ↔ tutamacını sürükleyin.
  Tutamaç odaktayken sol/sağ ok %1, Shift+ok %10; Home/End %0/%100 yapar.
  Escape sürüklemeyi iptal eder. Önce görünümü seçili klibin renk işlemini
  devre dışı bırakır; diğer kliplerin renkleri, geçiş ve genel VideoFX
  işlemleri uygulanmaya devam eder. Seçili klip o anda görünmüyorsa sınır
  gizlenir. Karşılaştırma proje geçmişine veya dosyaya yazılmaz; çıktı
  her zaman düzenlenmiş görüntüyü kullanır.

Klip rengi kaynak görüntüye, kadraj ve geçişten önce uygulanır. Örtüşen iki
klip bağımsız profillerini korur; genel VideoFX renkleri birleşik sahneye
sonradan uygulanır. Tek arka plan ilk montaj klibine dönüştürüldüğünde
rengini devralır; yeni eklenen klip nötr başlar. Proje ve `.cozy` paketleri
profilleri ve eğrileri korur. Kaydetme/dışa aktarma sırasında açık renk
taslağı tamamlanır. Eski projeler nötr profille açılır.

Önizleme ve çıktı aynı çiziciyi kullanır. GPU ve CPU aynı renk işlevini
ve eğri düğümlerini değerlendirir; WebGL kullanılamadığında CPU çalışır.
CPU yolunun yüksek çözünürlükte kare maliyeti daha yüksektir.

## Çoklu sahne katmanları

Görüntü sekmesindeki **Sahne katmanları** panelinden video, hareketli GIF,
saydam PNG, JPEG/WebP veya bağımsız metin ekleyin. Video/GIF mevcut yerel
kütüphaneden de alınabilir. Ana şarkı proje saatini belirler; sahnenin temel
arka planı mevcut video montajıdır. En fazla 16 sahne katmanı eklenebilir.

- Listede üstteki katman önde çizilir. **Arkaya al / Öne al**, **Çoğalt** ve
  **Sil** seçili katmana uygulanır. Gruplar sıralanırken üyeleri birlikte
  hareket eder; çoğaltılan katman bağımsız olur.
- Her katmanın ayrı zaman şeridi ve proje başlangıç/bitişi vardır. Gövdeyi
  sürükleyin veya kenarlarından kesin. Sol/sağ ok bir kare, Shift+ok on kare
  değiştirir. Sürüklerken Shift ince hareket, Alt geçici yapışma iptalidir;
  ortak kare, ritim, işaretçi ve diğer katman kenarları kullanılabilir.
  Boş bitiş alanı proje sonunu izler. Proje aralığını taşımak kaynak kesitini
  değiştirmez; video başlangıcını kesmek oynatılan kaynak fazını korur.
- Listede kutularını işaretlediğiniz katmanları adlandırılmış bir gruba alın.
  Bir üyenin şerit gövdesini taşımak bütün grubun zamanını aynı miktarda
  değiştirir; kenar kesimleri ve tuval dönüşümleri seçili üyeyi düzenler.
  **Gör** grubun/katmanın görünürlüğünü, **Kilit** düzenlenebilirliğini değiştirir.
  Grup kilidi bütün üyeleri korur; grubun kilidini açmak üyelerin kendi
  kilitlerini kaldırmaz. **Grubu çöz** üyelerin konum ve sırasını korur.
- Konum, genişlik, dönüş ve opaklığı sayısal olarak girin veya tuvalde
  sürükleyin. Köşe boyutlandırması medya oranını korur; metinde yazı boyutu
  da ölçeklenir. Dönüş tutamacı bağımsızdır. Taşıma tutamacında oklar bir
  çıktı pikseli, Shift+ok on piksel, Alt+ok onda bir piksel değiştirir.
  Boyut tutamacı genişliği aynı adımlarla, dönüş tutamacı 0,1° / 1° / 0,01°
  değiştirir. **Arka planı düzenle** montajın mevcut tuval kontrollerine döner.
- Video/GIF katmanları sessizdir; ses düzenlemesi ses katmanlarında yapılır.
  Her videoda kaynak girişi/çıkışı, bağımsız hız ve döngü seçilir. Döngü
  kapalıyken son kaynak karesi katman bitişine kadar tutulur. PNG saydamlığı
  ve GIF hareketi korunur; videolar mevcut H.264 medya hattını kullanır.
- Metinler satır sonlarını korur, genişliğe göre sarılır; yazı tipi, boyut,
  renk ve sol/orta/sağ hizalama bağımsızdır. Boyut 720p pikseli olarak
  tanımlanır ve çıktı çözünürlüğüyle ölçeklenir.
- **Karışım modu** normal, çarp, ekran, bindirme, koyulaştır, açıklaştır,
  fark, dışlama ve toplama seçeneklerini sunar. Opaklık bütün türlere
  uygulanır. Sahne katmanları renk/VideoFX uygulanmış ana montajın üstüne,
  eski tek ön plan görseli ve sözlerin altına çizilir. Genel VideoFX
  yeni katmanlara uygulanmaz; katmanların konum/opaklık ayarları bağımsızdır.

Fare/dokunma sürüklemesi bırakılana kadar yerel önizleme taslağıdır; bırakma
tek geri alma adımıdır. Escape, odak kaybı, pointer iptali ve dış proje
editi taslağı iptal eder. Kaydetme/paketleme/render açık hareketi tamamlar.
Katmanlar, gruplar ve medya `.cozy` paketlerinde taşınır; eski projeler boş
sahne katmanlarıyla açılır. Önizleme ve MP4 aynı çizim/zamanlama kodunu
kullanır; çıktıda her aktif videonun karesi proje saatinden ayrı ayrı aranır.

## Hız rampası, ters oynatma ve kare dondurma

**Görüntü → Video montajı → Hız rampası ve zaman** paneli seçili klibe
uygulanır; montaj yoksa arka plan videosunu düzenler. **Sahne katmanları**
altındaki video/GIF katmanlarında aynı panel bulunur. Kilitli katman ve
gruplarda zaman kontrolleri de kilitlenir.

- **Yavaş → hızlı**, **Hızlı → yavaş** ve **Ortada yavaşla** önayarlarıyla
  başlayın. Grafiğin altındaki noktalarda kaynak saniyesini (veya karesini),
  hız çarpanını ve sonraki aralığın karakterini düzenleyin. **İmleçte hız
  noktası ekle** mevcut kareye nokta koyar. En fazla 32 nokta kullanılabilir.
- Çarpanlar 0,25–4 arasındadır ve klibin mevcut hızına uygulanır. Ses hızına
  bağlantı açıksa bu temel hız ana şarkının hızıdır. Noktalar kaynak zamanına
  bağlı kaldığı için klibi bölmek, kırpmak, çoğaltmak veya panodan yapıştırmak
  eğriyi başka bir zamana taşımaz. Kesit dışındaki noktalar uzatmada kullanılmak
  üzere korunur. **Rampayı temizle** yalnızca hız noktalarını kaldırır.
- **Doğrusal tempo**, kaynak boyunca saniye başına geçen proje süresini
  doğrusal değiştirir; **Yumuşak hız geçişi** aralık uçlarında yavaşça giriş ve
  çıkış yapar. **Sabit tut**, sonraki noktaya kadar mevcut çarpanı tutar.
  Süre, eğrinin integralinden hesaplanır; çıktı FPS'ine göre yukarı yuvarlanır.
- **Kesiti ters oynat** seçili kaynak giriş/çıkışını sondan başa oynatır.
  Yalnızca belirli bir bölümü ters çevirmek için önce iki sınırda bölün ve
  ortadaki klibi seçin. Bölme ve kenar tutamaçları ters yönde de aynı kaynak
  hareketini korur.
- İmleci seçili klibin/katmanın içine taşıyın, **Dondurma süresi**ni sn/kare
  olarak girin ve **İmleçteki kareyi tut**a basın. Seçili klip bu kaynak
  karesini belirtilen süre boyunca tutar. Ayrı bir dondurma bölümü oluşturmak
  için önce klibi bölün veya çoğaltın. **Dondurmayı kaldır**, saklanan hız
  rampasına ve oynatma yönüne döner. Dondurulmuş klip de bölünüp kırpılabilir.
- **Komşu kareleri harmanla**, kaynak zamanının iki kare arasında kaldığı
  yerde bu kareleri orantılı karıştırır; düşük FPS veya yavaş çekimde hareketi
  yumuşatır. Karışım hareketli kenarlarda çift görüntü oluşturabilir.
  **Kaynak kareleri** karışımı kapatır. Bu seçenek önizleme ve MP4'te aynı
  iki-kare hesabını kullanır; mevcut çıktı ayarındaki optik akış ayrı bir
  çıktı kalitesi seçeneğidir.

Panel gerçek kesit süresini saniye ve çıktı karesiyle gösterir. Şeritlerde
rampa/ters/dondurma etiketi görünür. Montajda bu panelden yapılan süre
değişiklikleri sonraki klipleri kaydırarak boşlukları korur; çok kısalan
kliplerin komşu geçişleri yeni yarım-klip sınırına daralır. Proje süresini
ana şarkı belirlemeye devam eder. Bağımsız video katmanlarında kesit süresi
döngüyü/son kareyi belirler; görünür başlangıç ve bitiş ayrı kalır.

Her düzenleme tek geri alma adımıdır. Zaman ayarları proje ve `.cozy` paketinde
saklanır. Ters/rampalı oynatma ana ses saatinden kare arayarak ilerler; yoğun
sahnelerde önizleme kare atlayabilir, MP4 her çıktı karesini bekleyerek işler.
Video kaynaklarının kendi sesi bu araçlarla miksere eklenmez.

## Görsel maske

**Görüntü → Video montajı → Görsel maske** seçili montaj klibini, montaj
yoksa arka plan videosunu düzenler. **Sahne katmanları → Görsel maske**
video/GIF, saydam görsel ve metin katmanlarında da kullanılabilir. Her hedefin
bağımsız bir maskesi vardır; birden fazla görüntüyü birleştirmek için ayrı
sahne katmanlarını maskeleyin. Katman ve grup kilitleri maskeyi de kilitler.

- **Maskeyi uygula** ile başlayın; **Dikdörtgen**, **Elips** veya **Serbest
  şekil** seçin. **Görüntüyü kes**, şeklin dışını saydamlaştırır ve alttaki
  görüntüyü gösterir. Arka planın altında görüntü yoksa siyah görünür.
- **Bölgesel bulanıklık**, yalnızca seçili klibin/katmanın şekil içindeki
  piksellerini bulanıklaştırır. Alt katmanları etkilemez. **Maskeyi ters
  çevir**, kesme veya bulanıklığı şeklin dışına uygular.
- Konum ve boyut çıktı tuvalinin yüzdesidir; dönüş dereceyle belirtilir.
  Kenar yumuşatma ve bulanıklık tuvalin kısa kenarının yüzdesini kullanır.
  Kadraj veya katman konumu değiştiğinde maske tuvaldeki yerini korur;
  görüntüyle birlikte ilerlemesini istiyorsanız maskeyi ayrıca hareketlendirin.
- **Tuvalde düzenle** ile gövdeyi veya merkez tutamacını taşıyın. Dikdörtgen
  ve elipsin köşeleri boyutlandırır; üstteki ↻ tutamacı döndürür. Serbest
  şekilde numaralı noktaları taşıyın; boyut alanları bütün şekli ölçekler.
  Seçili noktadan sonraki kenarın ortasına yeni nokta ekleyebilirsiniz.
  Sayısal X/Y alanları da bulunur; 3–32 benzersiz nokta kullanılabilir.
- Ok tuşları tutamaçları bir çıktı pikseli taşır. Shift 10, Alt 0,1 piksel
  adım sağlar; dönüş adımı 0,1 derecedir. Bir noktada Delete, seçili noktayı
  siler. Sürükleme tek geri alma adımıdır. Escape, iptal edilen dokunma,
  pencere/sekme/klip değişimi ve boyut değişikliği taslağı iptal eder.
- **İmleçte anahtar ekle**, konum, boyut, dönüş, yumuşatma ve bulanıklığın
  mevcut değerlerini kaydeder. Daha sonra sayısal alan veya tutamaçla bir
  hareketli değeri değiştirmeniz o zamanda yeni anahtar oluşturur. Listede
  zamanı, sonraki aralığın Doğrusal/Yumuşak/Tut karakterini düzenleyin;
  anahtara gidin veya silin. İçe alınan diğer eğri karakterleri korunur.
  **Hareketi kaldır**, mevcut görünümü sabit değer yapar.

Anahtar zamanları klibin kendi çıktı saatidir; kaynak hızı veya oynatma yönü
maskenin yönünü değiştirmez. Montaj döngüsünde maske de kliple döner.
Bağımsız katmanlarda maske, kaynak video döngüsünden bağımsız olarak katmanın
görünür süresi boyunca ilerler. Bölme ve başlangıçtan kırpma hareketin
sürekliliğini korur; taşıma, çoğaltma ve yapıştırma aynı yerel hareketi taşır.
Kırpılmış parçada anahtar listesi özgün maske saatini göstermeye devam eder.
Son anahtar silinince mevcut görünüm korunur. Proje ve `.cozy` paketleri tüm
şekil, nokta ve hareket verilerini taşır.

Önizleme ve MP4 aynı alfa bileşimini kullanır. Kenar yumuşatma üç geçişli
bulanıklıkla, bölgesel bulanıklık alfa ağırlıklı renklerle hesaplanır; saydam
kenarlara siyah saçak eklenmez. İş yükünü sınırlamak için yumuşak kenar
haritasının uzun kenarı en fazla 720, bulanıklık yüzeyinin uzun kenarı en
fazla 360 pikseldir; sonuç çıktı boyutuna örneklenir. Sert konturlar çıktı
çözünürlüğünde çizilir. Çok sayıda hareketli/yumuşak maskede önizleme kare
atlayabilir; MP4 her çıktı karesini işler.

## Kelime zamanları, karaoke ve yazı girişleri

Sözler sekmesinde bir satır seçip **Kelime zamanları ve karaoke** bölümünü açın.
Her kelimenin başlangıç/bitişini kaynak saniyesiyle, 0,001 sn hassasiyetinde
girebilirsiniz. Zaman şeridinde ortadan sürüklemek kelimeyi taşır; kenarlar
süresini değiştirir. Komşu kelimeye ve satırın sınırlarına gelince hareket durur.
**Yakınlaştır** kısa kelimeleri büyütür; şerit yatay kaydırılabilir.

Bir tutamacı odaklayıp oklarla 0,01 sn, Shift ile 0,1 sn, Alt ile 0,001 sn
düzenleyin. Enter kelimenin başlangıcına gider. Kelime adına tıklamak da seçip
başlangıcına gider. **Kelime başlangıcını/bitişini işaretle** oynatma imlecini
seçili kelimeye yazar. İmleç ana montaj boşluğundaysa bu düğmeler kapanır.
Sürükleme önizlenir ve bırakınca tek geri alma adımıyla kaydedilir; Escape,
iptal edilen dokunma, pencere odağı veya satır/proje değişikliği taslağı bırakır.

Eski satırlar **Tahmini zamanlama** ile sözcük uzunluklarına göre gösterilir.
**Kelimelere dağıt** bu zamanları düzenlenebilir olarak kaydeder;
**Tahmine dön** özel zamanlamayı kaldırır. Otomatik çözümlemenin geçerli kelime
zamanları varsa sessizlikleriyle birlikte saklanır. Zamanlar kaynak şarkıyı
izler; kırpma, hız, söz ötelemesi ve tekrarlanan ana montaj kesitleri aynı
kelime zamanlarını kullanır. Kaydırma/ölçekleme kelime aralıklarını korur;
kelime sınırından bölme/birleştirme özel zamanları taşır. Metindeki sözcükler
değişirse veya sözcüğün içinden bölünürse ilgili satır tahmini zamanlamaya döner.

**Şablon → Karaoke Dolgu**, her kelimeyi kendi zamanında neon rengiyle doldurur;
sessizlikte dolgu ilerlemez. **Kelime kelime (Pop)** aktif kelimeyi vurgular.
**Tipografi, Renk & Görünüm → Kelime girişi** altında yazı makinesi, belirerek,
büyüyerek veya kayarak giriş seçilebilir. Yazı makinesi Türkçe ve birleşik
karakterleri birlikte açar; diğer girişlerin süresi proje saniyesiyle ayarlanır.
Satır geçişi ve bas efektleri ayrıca kullanılabilir. Satırın ölçüsü sabit kalır;
gizli sözcükler yüzünden metin yeniden yerleşmez. Önizleme ve MP4 aynı çizimi
kullanır. Proje JSON'u ve taşınabilir paket kelime zamanlarını ve animasyonları
korur; standart SRT/LRC dışa aktarımı satır zamanlarını içerir.

## Çok kameralı kurgu

Görüntü denetçisindeki **Çok kameralı kurgu** bölümünde kütüphaneden en fazla
sekiz kamera ekleyin. Kaynak farkı, proje sıfırında kamerada gösterilecek
saniyedir. İkinci ve sonraki kameraları ilk kameranın özgün sesiyle hizalayabilir
veya farkı elle girebilirsiniz. Eşleştirme ilk 180 saniyede ±60 saniye arar;
sessiz veya tekrarlayan/belirsiz seslerde açık hata verir ve elle ayar yapılır.

Ana şarkı içindeki giriş/çıkış aralığını seçip açı kaydını başlatın. Kameraya
tıklamak veya 1–8 tuşları kesim kaydeder. Kayıt aralık sonunda durur. Durdurup
kesim zamanlarını düzeltebilir, silebilir veya taslaktan vazgeçebilirsiniz.
İlk kesim aralık girişinde olmalı; en fazla 64 kesim, en az 0,05 saniye aralık
ve yeterli kaynak payı gerekir. Video toplu kilidi uygulamayı engeller.

**Kamera kurgusunu montaja uygula** mevcut video montajını normal düzenlenebilir
kliplerle değiştirir. Ses katmanları korunur. Tek geri alma önceki montajı getirir;
kamera ayarları/kesimleri projede, kullanılmayan kameraların özgün dosyaları
da `.cozy` paketinde saklanır. Paket açıldığında kameralar yeniden hazırlanır.

Bu dilimde 240 test geçti: 186 JavaScript, 43 proje/ses/medya/paket/zaman,
4 ses hizalama ve gerçek kamera MP4 çıktısı, 7 üretim arayüz testi. Waitress/CSP,
önbelleksiz yavaş ağ, iki temada 320–1440 px, kesim/iptal/geri alma/yeniden açma
doğrulandı. Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Adlandırılmış bölüm çıktıları

**Dışa Aktar → Bölüm çıktıları** altında giriş/çıkış saniyelerini girin veya
imleçten, seçili kliplerin sınırlarından ya da iki proje işaretinden alın.
Bölümü kaydedince adını, uzantısız dosya adını ve kendine ait kare hızı,
çözünürlük, en boy oranı/kare üretimi ayarlarını değiştirebilirsiniz. Dosya
adında Latin harfleri, rakamlar, alt çizgi ve tire kullanılır; bölüm adından
Türkçe karakterleri dönüştüren başlangıç adı otomatik üretilir.

En fazla 32 bölüm saklanır. Her bölüm en az 0,05 saniyedir ve çıktı karelerine
hizalanır. Kare hızı değişince giriş/çıkış yeniden hizalanır. Ana montaj
kısalınca eski bölümler saklanır; montaj sonunu aşan aralıklar çıktıdan önce
açık hatayla reddedilir. Bölümler proje ve `.cozy` içinde saklanır; düzenlemeler
geri alınabilir. Bölüm ayarları projenin genel çıktı ayarlarını değiştirmez.

Tek bölümü veya bütün bölümleri sırayla dışa aktarın. Sıra başlangıcındaki
proje kopyası bütün çıktılarda kullanılır; sırayı iptal etmek aktif işi ve
devamını durdurur. Tamamlanan dosyalar ayrı indirme bağlantılarında kalır.
İndirme listesi oturum içindir; dosyalar `outputs/` klasöründe saklanır.
Sayfa yenilendiğinde aktif iş izlenir, henüz başlamamış sıra yeniden başlatılır.

Tam kalite motoru özgün videoyu kullanır. Ana şarkı, fade, ses otomasyonu,
geçiş, maske, metin ve hareket saatleri bölüm başlangıcında sıfırlanmaz.
Bir saniyelik gerçek MP4, tam montajın aynı aralığındaki 24 kare ve otomasyonlu
sesle karşılaştırıldı. Bu dilimde 199 test geçti: 189 JavaScript, 4 bölüm
sözleşmesi/API/MP4 ve 6 üretim arayüz testi. Waitress/CSP, önbelleksiz yavaş ağ,
iki temada 320–1440 px, sıra/iptal/hata/geri alma/yeniden açma doğrulandı.
Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Katmana ve klibe özel chroma key

Video klibi veya video/görsel sahne katmanı seçip **Klibe özel chroma key**
bölümünü açın. Kaynak görüntüden renk alma, özgün çözülmüş kareyi sabitler;
görüntüye tıklayarak/dokunarak ya da X/Y yüzde koordinatıyla örnek seçin.
Escape/Vazgeç örneklemeyi kapatır. İşlenmiş görüntüden örnek alınmadığı için
anahtarlama açıkken de kaynak rengi doğru okunur. Rengi elle veya yeşil/mavi
hazır değerlerle değiştirebilirsiniz.

Tolerans, kenar yumuşaklığı ve renk taşması temizliği 0–100 arasında hassas
sayısal giriş ve kaydırıcıyla ayarlanır. Despill, hedef rengin baskın kanalındaki
fazlalığı azaltır; beyazı ve diğer kanalları korur. Anahtarlama yerel renk
düzenlemesinden önce uygulanır. Saydamlık maske, geçiş ve blend işlemlerine
aktarılır. Sahne katmanında kaldırılan perdenin arkasından alttaki video
görünür; ana montajın arkasında başka katman olmadığı için boş alan siyahtır.
Metin katmanı anahtarlanmaz. Grup/katman ve video toplu kilitleri korunur.

Ayarlar projede/pakette saklanır. Kaydırıcı hareketi tek geri almadır;
sıfırlama, iptal, yeniden açma, iki temada 320–1440 px ve Waitress/CSP üzerinde
önbelleksiz yavaş ağ doğrulandı. 199 test geçti: 191 JavaScript, 2 Python
sözleşmesi/gerçek MP4 ve 6 üretim arayüz testi. GPU/CPU sonuçları, yarı saydam
kenarlar, despill, renk bypass ve mevcut renk karşılaştırması da kontrol edildi.
Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Renk ölçüm monitörleri

**VideoFX → Renk ölçüm monitörleri** altında parlaklık dalga biçimi, RGB parade,
RGB/parlaklık histogramı ve vectorscope birlikte gösterilir. Son kompozisyon
video, sahne katmanları, ön plan görseli ve sözleri içerir. Seçili klip ölçümü
yerel renk/chroma işlemini içerir; genel sahne efektleri bu kaynakta yer almaz.
Önce/sonra karşılaştırması veya düzenleme taslağı açıksa kompozisyon monitörleri
ekranda görülen önizlemeyi ölçer.

Monitörler önizlemeden 256 × 144 piksel örnekler, tam saydam pikselleri dışlar.
Parlaklık/chroma gamma kodlu, tam aralıklı Rec.709 SDR hesabıdır; %0–100 işaretleri
sinyal seviyesidir. Bu ölçüm HDR veya özgün dosyanın tam çözünürlüklü analizi
değildir. Canlı ölçüm en fazla yaklaşık sekiz kez/saniyedir; duraklatılmış seek
sonrasında çözülen yeni kare ayrıca ölçülür. Dondur, Bu kareyi ölç ve doğrusal/
logaritmik yoğunluk kontrolleri proje verisini veya geri alma geçmişini değiştirmez.

Bu dilimde 196 test geçti: 194 JavaScript ve 2 üretim arayüz testi. Primariler,
gri/saydam pikseller, bütün monitörlerde örnek sayılarının korunması, ön planın
ölçüme katılması, seek/dondurma ve iki temada 320–1440 px doğrulandı.
Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme kontrol edildi.
Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## 3D LUT içe aktarma

Video denetçisinde **3D LUT → .cube dosyası içe aktar** seçin. Tablo ortak proje
kütüphanesine eklenip seçili klibe uygulanır; tek arka plan videosunda da
kullanılır. Her klip kendi tablosunu, etkinlik durumunu, 0–100 yoğunluğunu ve
yerel renkten önce/sonra sırasını saklar. Chroma key ilk çalışır. Renk+LUT
önce/sonra, mevcut tuval karşılaştırmasını kullanır; karşılaştırma proje veya
çıktıyı değiştirmez.

Saf 3D `.cube` boyutları 2³–33³, TITLE ve DOMAIN_MIN/MAX desteklenir; kırmızı
ekseni en hızlı değişir, üç eksende doğrusal enterpolasyon uygulanır.
1D shaper, tanınmayan yönergeler, eksik/fazla satırlar ve geçersiz sayılar
açık hatayla reddedilir. Dosya en fazla 8 MB; kütüphane en fazla sekiz tablo
ve toplam 130.000 kanal değeridir. İçe aktarım değerleri altı ondalığa
yuvarlanır. Tablo çıkış değerleri −16…16 aralığında kabul edilir; uygulanan
SDR sonuç 0–1 aralığına sınırlanır. LUT dosyaları proje JSON'una ve `.cozy`
paketine gömülür; yeniden açmak için özgün `.cube` dosyası gerekmez.

Kaydırıcı önizlemesi taslaktır; bırakma veya proje kaydı tek işlemle uygular.
Escape/pointer iptali taslağı bırakır. Kütüphaneden tabloyu kaldırmak o tablonun
bütün klip bağlantılarını temizler ve tek geri almayla döner. Video toplu
kilidi korunur. GPU float dokular desteklenmezse CPU hesabı kullanılır.

Bu dilimde 205 test geçti: 197 JavaScript, 2 Python sözleşmesi/paket/gerçek
MP4 ve 6 üretim arayüz testi. Float GPU/CPU, işlem sırası, yoğunluk, alpha,
taslak/kayıt/iptal, geri alma, yeniden açma, chroma ve karşılaştırma kontrol
edildi. Waitress/CSP üzerinde önbelleksiz yavaş ağ ve iki temada 320–1440 px
doğrulandı; fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Dört köşeden perspektif

Video klibi veya görsel/video sahne katmanını seçip **Dört köşeden perspektif**
bölümünü açın. Kaynak tuvalindeki 1–4 köşelerini taşıyın veya X/Y değerlerini
hassas olarak girin. Ok tuşları %0,1, Shift ile %1 ilerler. Kaynak dışına taşmak
için katmanın konum/ölçek kontrollerini kullanın; köşeler kaynak düzleminde
0–100 aralığındadır. Ana montajın dış alanı siyah, sahne katmanınınki saydamdır.

**İmleçte köşe anahtarı** tüm dört köşeyi proje zamanında kaydeder. Anahtar
oluşturduktan sonra düzenleme imleçteki anahtarı değiştirir veya yeni anahtar
ekler. Anahtar zamanı, sonraki geçişi (doğrusal/yumuşak/sabit tut), git ve sil
kontrolleri listede bulunur. Kapanan, ters dönen veya içbükey dörtgenler ve
geçiş sırasında kapanan hareketler reddedilir; sabit tut ile geçerli pozlar
arasında anlık geçiş yapılabilir. En fazla 32 anahtar vardır.

Sürükleme canlı taslaktır; bırakma tek geri alma adımı, Escape/pointercancel
iptaldir. Proje kaydı/dışa aktarım bekleyen taslağı tamamlar. Kilit ve hedef
değişimi taslağı iptal eder. Renk/chroma/LUT, perspektif, katman geometrisi,
maske sırasıyla işlenir; karşılaştırma perspektifi korur. Metin katmanları bu
aracın kapsamı dışındadır. Köşe anahtarları klip taşındığında özgün proje
zamanlarını korur; gerekirse anahtar zamanlarını düzenleyin.

207 test geçti: 200 JavaScript, 2 Python sözleşme/gerçek MP4 ve 5 üretim
arayüz testi. GPU/CPU homografi, alpha ve renk yönü, saydam dış alan, anahtar
hareketi, sürükleme, iptal, kayıt, kilit, geri alma ve yeniden açma doğrulandı.
Waitress/CSP, önbelleksiz yavaş ağ ve iki temada 320–1440 px kontrol edildi.
Fiziksel telefon, ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı.

## Mekânsal Bézier hareket yolları

Video panelindeki veya seçili sahne katmanındaki **Bézier hareket yolu**
bölümünü açın. **İmleçte düğüm** proje zamanında bir konum ekler. Yatay/dikey
sapma mevcut konuma eklenen tuval yüzdesidir; mevcut video XY anahtarları
korunur ve sonuçla toplanır. Metin, görsel ve video sahne katmanları desteklenir.

Sonraki parçanın geometrisi düz çizgi veya kübik Bézier olabilir. Bézier'de
giriş/çıkış tutamaçları düğüme göre X/Y sapmasıdır; sıfır tutamaç düğümle
çakıştığı için gizlenir, sayısal değer girildiğinde görünür. Sonraki parçanın
zamanını ayrıca doğrusal, yumuşak veya sabit tut olarak seçin. Doğrusal zamanlı
Bézier parçasına düğüm eklemek De Casteljau bölmesiyle yolu aynen korur.
Yumuşak/sabit zamanlı parçayı bölmeden önce zamanı doğrusal seçin.

Tuvalde düğüm ve tutamaçları sürükleyin; oklar %0,1, Shift %1 değiştirir.
Bırakma tek geri alma, Escape/pointercancel iptaldir. Proje kaydı bekleyen
taslağı tamamlar. Kilitler korunur. Düğümler en fazla 128, sapmalar ±%100,
tutamaçlar ±%200; tuval dışındaki noktalar sayısal alanlardan düzenlenebilir.
Saat proje zamanıdır; şerit taşımak düğüm zamanlarını değiştirmez.

208 test geçti: 203 JavaScript, 2 Python sözleşme/gerçek MP4 ve 3 üretim
arayüz testi. Kübik geometri, zaman karakterleri, şekli koruyan bölme,
mevcut video dönüşümü, katman hareketi, tutamaç/klavye/sürükleme, taslak,
geri alma ve yeniden açma doğrulandı. Waitress/CSP üzerinde önbelleksiz
yavaş ağ ve iki temada 320–1440 px kontrol edildi. Fiziksel telefon, ağ
tüneli ve Safari/iOS bu dilimde doğrulanmadı.

## Bölge hareket takibi

Video klibini seçip **Bölge hareket takibi** bölümünü açın. Kaynak giriş/çıkışını
ve örnekleme hızını seçin, **İlk takip karesini getir** ile bölgeyi kaynak
görüntü üzerinde sürükleyerek veya sayısal X/Y/genişlik/yükseklik ile belirleyin.
Kenar/desen içeren bir bölge seçin. Arama yarıçapı her örnekte aranan en büyük
hareketi belirler; daha hızlı hareket için örneklemeyi veya yarıçapı artırın.

**Bölgeyi takip et** özgün dosyadan en fazla 320 piksel kenarlı gri kareleri
çözümler. Normalize ayrıntı korelasyonu parlaklık değişimini tolere eder;
güvenli eşleşmede şablon yavaşça güncellenir. Örtülme veya belirsiz eşleşmede
takip durur ve kayıp kaynak saniyesi gösterilir. En fazla 60 saniye, 128 örnek,
1–12 Hz; uzun klipleri bölümler halinde analiz edin. Ölçüm yalnızca yatay/dikey
konumdur; nesne dönüşü, ölçek ve deformasyon çözülmez.

Sonuç tablosunda kaynak zamanı ve X/Y noktalarını düzeltin veya silin. Bu
aşama proje geçmişine yazılmaz. Hedef olarak metin/görsel/video sahne katmanı
veya kaynak video klibinin maskesini seçin. Doğrudan konum veya yalnızca
hareket farkını aktarın. Uygulama sahne katmanının hareket yolunu, maskenin
X/Y anahtarlarını değiştirir; diğer biçim/maske ayarları korunur. Oluşan
anahtarlar normal araçlarla düzenlenir ve tek adımda geri alınır.

Kesit/hız rampası/ters saatler proje zamanına çevrilir; kaynak kırpma,
perspektif, ayna, dönüş, ölçek ve konum çıktı koordinatlarına çevrilir.
Sonradan bu geometriyi veya klip zamanını değiştirirseniz takibi yeniden
uygulayın. Tekrarlanan video döngülerinde anahtarlar ilk geçişe aittir.
Son görüntüye eklenen ses tepkili/global efektlerin titreşimi ölçüme dahil
değildir. Proje veya kaynak değişimi bekleyen analizi/taslağı iptal eder.

212 test geçti: 205 JavaScript, 2 Python özgün kaynak/algoritma/gerçek MP4 ve
5 üretim arayüzü testi. Ters takip, örtülme, kaynak kare saatleri, hareket
dönüşümü, maske/katman uygulama, nokta düzeltme, geri alma ve yeniden açma
doğrulandı. Waitress/CSP, önbelleksiz yavaş ağ ve iki temada 320–1440 px
kontrol edildi. Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Akıllı yeniden kadrajlama ve sürümler

Video klibinde bölge takibini tamamlayıp noktaları kontrol edin. Ardından
**Akıllı yeniden kadrajlama ve sürümler** bölümünde hedef X/Y konumunu ve
yumuşatma komşularını (0–5) seçin. Tek oran veya üç oranı (16:9, 1:1, 9:16)
birlikte üretin. Takip puanıyla ağırlıklandırılmış ortalama kamera titreşimini
azaltır. Kaynak düzlemi dışı görünmeyecek şekilde XY hareketi sınırlandırılır;
hedefe tam ulaşılamayan nokta sayısı gösterilir. Döndürülmüş görüntüde gereken
yakınlık hesaplanır; 4× sınırını aşan kadraj açık hatayla reddedilir.

Takip yalnızca seçili klibin analiz aralığını kapsar. Diğer klipler yeni oranda
merkezden doldurulur; bunların kadraj anahtarlarını ayrıca düzenleyin.
Otomatik sürüm mevcut kırpma/ayna/dönüşü korur, XY hareketi ve zoom'u kendi
hesabıyla değiştirir. Maske/perspektif saydamlığı veya son global efektler
kaynak düzleminin içinde de boş alan oluşturabilir; bu alanlara ayrıca bakın.

**Sürümü düzenlemek için aç** çıktı ve video geometrisini uygular. Normal video
XY/zoom/dönüş anahtarlarıyla düzeltip **Seçili sürümü mevcut kadrajla güncelle**
deyin. **Mevcut kadrajı yeni sürüm kaydet** elle oluşturduğunuz sürümleri saklar.
En fazla sekiz sürüm vardır. Ses, klipler, renk, opaklık ve ön plan katmanları
ortaktır; bunların biçimleri sürüme özel değildir. Video toplu kilidi sürümün
açılmasını engeller. Her düzenleme tek geri alma adımıdır.

**Seçili sürümü MP4 al** seçilen sürümün anlık kopyasını dışa aktarır; açık
projenin kadrajını değiştirmez. Geometri ve çıktı ayarları proje/pakette saklanır.

214 test geçti: 208 JavaScript, 2 Python sözleşme/paket/üç gerçek MP4 ve
4 üretim arayüzü testi. Özne konumu, üç oran, kaynak sınırları, döndürülmüş
kadraj, bağımsız sürüm düzeltmesi, çıktı kopyası, geri alma ve yeniden açma
doğrulandı. Waitress/CSP, önbelleksiz yavaş ağ ve iki temada 320–1440 px
kontrol edildi. Fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

## Tamamlanan kapsam

TODO 1–20 tamamlandı. Ana montajın hazırlanmış ses dizisi proje saatini ve
süresini belirler; kaynak dosya ve kaynak söz zamanları ayrı tutulur.
Kelime zamanları ve yazı animasyonlarıyla 20 maddelik özellik listesi tamamlandı.

## Doğrulama

J/L kesimleri diliminde 242 farklı test geçti: 181 JavaScript, 43 mevcut
Python proje/ses/video zamanı/medya/paket, 11 video ses/çıktı ve 7 üretim
arayüzü testi. Kaynak payı uzatma, içe kırpma, sabit video/kaynak senkronu,
24/30/60 FPS, faz, fade/otomasyon, eski WAV sınırları, kilit/döngü/eski kaynak
reddi, tek geri alma ve yeniden açma kontrol edildi. 60 FPS'teki üç karelik
minimum ses kesitinde kayan nokta toleransı iki sözleşmede eşitlendi.
Tam kaynak paylarıyla ters/rampalı saatler ve gerçek WAV örnekleri karşılaştırıldı;
aynı MP4 sahne kesiminde J ve L seslerinin toplamı beklenen örneklerle eşleşti.
Waitress/CSP, yavaş ağ ve önbelleksiz yenilemede yer kayması, iki temada
320–1440 px, gerçek Web Audio oynatma, dokunma sürükleme/iptal ve kaynak
dayanağını içeren paket API'siyle yeniden açma doğrulandı. Ayrı ön yüz derlemesi
yoktur; fiziksel telefon, ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı.

Videodan ses ayırma diliminde 230 farklı test geçti: 172 JavaScript,
43 mevcut Python proje/ses/video zamanı/medya/paket ve 7 yeni Python testi,
8 üretim arayüzü testi. Yeni testler gerçek ses örneklerinde kesit/ters oynatma,
18 hız/rampa/yön birleşiminde tarayıcı-sunucu kaynak saati eşleşmesi, gecikmeli
ses başlangıcı, sessiz dondurma, önbellek, geçersiz istek ve medya işlem sınırını
doğrular. Gerçek MP4 sesinde birlikte taşınmış başlangıç ve sessiz dış aralıklar
kontrol edildi. Hazırlanmış dalga formunun gerçek AudioBuffer ile oynatılması,
WAV indirme/yeniden bağlama, grup kopyalama, hizalama, kilit/çakışma reddi,
iptal, tek geri alma, proje ve paket API'siyle yeniden açma doğrulandı.
Waitress/CSP üzerinde 150 ms ağ gecikmesi, sınırlı aktarım, kapalı önbellek ve
yenilemede yer kayması kontrol edildi. İki temada 320–1440 px yerleşimi ve
bağlantılı çifti dokunarak taşıma simülasyonu geçti. İki eski yüksek çözünürlük
medya testi ilk çalışmada FFmpeg örnek üretiminde hata verdi; ayrı tekrarı geçti.
Ayrı ön yüz derlemesi yoktur; fiziksel telefon, ağ tüneli ve Safari/iOS
bu dilimde doğrulanmadı. Paket kaydet/aç HTML kontrollerinin mevcut eksikliği
özellik kapsamı dışında bırakıldı; paket doğrulaması mevcut API üzerinden yapıldı.

Rolling trim diliminde 207 farklı test geçti: 164 JavaScript, 30 Python
proje/veri sözleşmesi/ses, 9 üretim arayüzü ve 4 MP4 karşılaştırma testi.
Sabit toplam süre ve dış sınırlar, gerçek örtüşmeler, minimum kesitler,
24/30/60 FPS, hız bağlantısı, ters/rampalı/dondurulmuş kaynaklar ve sağ maske
saati kontrol edildi. Sürükleme taslağı, Escape/işaretçi iptali/odak kaybı,
klavye ve dokunma simülasyonu, seçim değişimi, kilit/boşluk sınırları,
tek geri alma ve yeniden açma doğrulandı. Farklı dosyalardan dört kaynak
karesi, yükleme hatası/yeniden deneme, hızlı taslak değişimi ve kaynakların
bırakılması test edildi; ortak karşılaştırma çözücüsünü kullanan slip,
slide, geçiş ve toplu seçim regresyonları geçti.

Tarayıcı komutlarıyla düzenlenen projeler Python doğrulamasından geçirildi.
Dört rolling ve bir slide MP4 senaryosunda 34 kare gerçek önizlemeyle
karşılaştırıldı; 60 FPS'te her iki tarafta 0,05 saniyelik dondurma sınırı
doğrulandı. Waitress/CSP üzerinde 150 ms gecikmeli, önbelleksiz yenilemede
yer kayması; iki temada uzun adlarla 320/375/768/1024/1440 px yerleşimi ve
dar ekranda Uygula kontrol edildi. Fiziksel telefon, tünel ve Safari/iOS
bu dilimde doğrulanmadı; projede ayrı ön yüz derlemesi bulunmuyor.

Slide diliminde 196 farklı test geçti: 155 JavaScript, 30 Python proje/veri
sözleşmesi/ses, 7 üretim arayüzü ve 4 MP4 karşılaştırma testi. Son kontrol
yerleşimi ve sınır düzeltmelerinden sonra üç slide arayüz testi yeniden geçti.
İki yönde sabit toplam süre, komşu dış sınırları, seçili klibin kaynak
sürekliliği, örtüşme/boşluklar, hız bağlantısı, ters/rampalı/dondurulmuş
kesitler, maske saati, iptal, tek geri alma ve yeniden açma doğrulandı.
Kesitteki 0,05 saniyelik minimumun kayan nokta hatası yüzünden reddedilmesi
tarayıcı ve sunucuda aynı toleransla düzeltildi; daha kısa kesitler reddedilir.

Tarayıcı düzenleme fonksiyonuyla üretilen projeler Python doğrulamasından
geçirildi. Beş MP4 senaryosunda 35 kare gerçek önizlemeyle karşılaştırıldı;
60 FPS'te sol/sağ komşunun 0,05 saniyeye, yani üç kareye kadar kısalması da
doğrulandı. Waitress/CSP, 150 ms ağ gecikmesi, önbelleksiz yenilemede yer
kayması, iki temada uzun isimlerle 320/375/768/1024/1440 px düzenleri ve
dar ekranda uygulama kontrol edildi. Fiziksel telefon, tünel ve Safari/iOS
bu dilimde doğrulanmadı; projede ayrı ön yüz derlemesi bulunmuyor.

Slip diliminde 145 JavaScript, 8 farklı üretim arayüzü ve 1 gerçek MP4
karşılaştırma testi geçti (154 test). Son arayüz değişikliklerinden sonra
üç slip testi, geçiş tutamacı ve toplu klip taşıma testi tekrar geçti.
Kaynak sınırları, rampalı/ters/dondurulmuş kaydırma, sabit süre/konum/geçiş,
taslak sırasında değişmeyen proje, iptal, tek geri alma ve yeniden açma
doğrulandı. Hızlı taslak değişimleri eski kareleri yayımlamaz; kaynak hatası,
yeniden deneme ve kapatırken medya bırakma kontrol edildi. Tarayıcıda
üretilen kaydırılmış proje Python doğrulamasından geçirildi; ters hız rampası,
dondurma ve geçiş içeren çıktının 7 karesi gerçek önizlemeyle karşılaştırıldı.
Toplu seçimin geçiş kaydırıcısındaki ok tuşlarını yakalaması da düzeltildi.

Waitress/CSP üzerinde 150 ms ağ gecikmesi ve önbelleksiz yenilemede yer
kayması kontrol edildi; 320/375/768/1024/1440 px düzenleri, koyu/açık tema,
azaltılmış hareket ve dar ekranda Uygula düğmesinin kullanımı doğrulandı.
Ayrı ön yüz derlemesi yoktur. Fiziksel telefon, tünel ve Safari/iOS bu
dilimde doğrulanmadı.

Kelime zamanlama diliminde 254 ilgili test geçti: 116 JavaScript, 71 arayüz,
61 Python söz/veri sözleşmesi/proje/paket/ses/kare aktarımı ve 6 gerçek MP4
karşılaştırma testi. Dokuz video senaryosunda 46 kare önizlemeyle karşılaştırıldı;
özel kelime dolgusunun hız/öteleme/ana montaj tekrarları ile yazı makinesi ve
üç giriş animasyonu kontrol edildi. Ayrı piksel kontrolleri kelimelerin gerçek
sessizlik aralıklarında beklediğini doğruladı. Son sayısal sınır ve sürükleme
iptali düzenlemelerinden sonra üç yeni arayüz testi tekrar geçti.

Üretim Waitress/CSP üzerinde 150 ms gecikme, önbelleksiz yenileme ve yer
kayması; açık/koyu temada 320/375/768/1024/1440 px yerleşim, açık kelime
editöründe seçili satırın görünürlüğü ve Chromium dokunma simülasyonunda kelime
taşıma doğrulandı. Taslak sırasında kaydedilen proje değişmez, bırakınca tek
geri alma oluşur. Proje/paket yeniden açma ve otomatik çözümlemenin kesit
ötelemesi kelime zamanlarını korur. Ayrı ön yüz derlemesi yoktur; fiziksel
telefon ve Safari/iOS doğrulaması yapılmadı.

Görsel maske diliminde 234 ilgili test geçti: 109 JavaScript, 68 arayüz,
45 Python veri sözleşmesi/paket/ses/kare aktarımı ve 12 gerçek video çıktısı
testi. On üç MP4 senaryosunda 78 kare önizlemeyle karşılaştırıldı. Yeni üç
senaryo hareketli/ters/yumuşak bölgesel bulanıklığı, renk ve zoom geçişiyle
birleşen poligonu ve maskeli video/saydam görsel/metin bileşimini kapsar.
Son bulanıklık hesabından sonra üç maske çıktı testi ayrıca tekrar geçti.

Şekillerin iç/dış pikselleri, ters maske, yumuşak sınır, yalnızca bölgedeki
bulanıklık, saydam kenarların renk/alfası ve alttaki görüntüyle birleşim
bilinen piksel değerleriyle doğrulandı. Yerel anahtar saati, bölme/kırpma,
taşıma/çoğaltma/pano, tek geri alma, iptal, grup/katman kilitleri, görünür
zaman aralığı ve yeniden açma kontrol edildi. Son kaynaklar sabitlendikten
sonra tam 68 arayüz regresyonu geçti.

Üretim Waitress/CSP üzerinde 150 ms gecikme ve önbelleksiz yenileme, yer
kayması, iki temada 320/375/768/1024/1440 px yerleşim ve gerçek dokunma
olaylarıyla maske sürükleme doğrulandı. Sürükleme sırasında kayıt taslağı
tek geri alma adımıyla yakalar; hareketli maske canlı ses saatinde çizilir.
Ayrı ön yüz derlemesi bulunmuyor. Fiziksel telefon, ağ tüneli ve Safari/iOS
bu dilimde doğrulanmadı.


Hız/zaman diliminde 218 ilgili test geçti: 103 JavaScript, 65 arayüz,
41 Python veri sözleşmesi/paket/ses/kare aktarımı ve 9 gerçek video çıktısı
testi. On MP4 senaryosunda 60 kare önizlemeyle karşılaştırıldı; yeni üç
senaryo ters oynatma, yumuşak hız rampası, kare harmanlama, dondurma,
renkli klip geçişi ve bağımsız GIF/video katmanlarını kapsar. Önceki katman,
renk ve zoom/blur geçişleri de aynı kontrollerden geçti.

Kaynak hareketi ileri/ters bölmede ve uzatmalı kırpmada, katman fazı/döngüsü,
boşlukları koruyan süre değişimi, tek geri alma, kilit ve proje/paket açma
doğrulandı. Ardışık hızlı kare aramaları yalnızca en son isteği işler;
düşük FPS'te son karenin tekrar tekrar aranmadığı, iki kare hazır olmadan
harmanlanmadığı ve kaynak değişiminde eski arama konumunun kullanılmadığı
denendi. Tam arayüz regresyonu geçti; son kaynak/önizleme değişikliklerinden
sonra üç yeni arayüz testi ayrıca tekrar geçti.

Üretim Waitress/CSP üzerinde 150 ms gecikme ve önbelleksiz yenileme, yer
kayması, iki temada 320/375/768/1024/1440 px yerleşim, gerçek dokunma
olaylarıyla önayar/geri alma ve canlı ses saatinde ters/rampalı/harmanlı
oynatma kontrol edildi. Ayrı ön yüz derlemesi bulunmuyor. Fiziksel telefon,
ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı. Kare harmanlama optik
akış değildir; yoğun sahnelerde önizleme hızı cihazın video çözme gücüne bağlıdır.

Çoklu sahne katmanı diliminde 206 ilgili test geçti: 90 JavaScript,
62 arayüz, 6 katman veri sözleşmesi/API, 21 proje/ses, 5 kare aktarımı,
2 statik kaynak, 4 renk, 3 geçiş, 5 paket ve 8 gerçek video çıktısı testi.
On bir MP4 senaryosunda 60 kare önizlemeyle karşılaştırıldı. Yeni katman
senaryoları PNG alfa/karışım/konum/dönüşü, çok satırlı farklı yazı tiplerini,
grup görünürlüğünü, bağımsız GIF döngüsü ile video kaynak fazını/son kareyi
kapsar. Önceki renk ve geçiş senaryoları da geçti.

Grup taşıma/sıralama, kilit, görünürlük, zaman kesimi, tuval taslağı/iptal,
klavye, tek geri alma, snapshot ve yeniden açma doğrulandı. Kaynak nesnesinin
özellik editlerinde korunması, hızlı ardışık aramalar, düşük FPS'te gerçek
son kare pikseli ve tekrar aramadan kare tutma denendi. Eksik medya render
işini başlamadan reddeder; saydam görsel/video/metin/grup içeren `.cozy`
paketi yeni medya klasörüne taşındı. Üretim Waitress/CSP üzerinde yavaş ağla
önbelleksiz yenileme, iki temada 320–1440 px, uzun adlar, dokunarak grup
şeridi/tuval taşıma ve gerçek ses saatinde bağımsız video oynatma geçti.
JavaScript/Python sözdizimi ve diff kontrolleri temiz. Ayrı ön yüz derlemesi
yoktur; fiziksel telefon, ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı.


Klibe özel renk diliminde 177 ilgili test geçti: 82 JavaScript, 57 arayüz,
4 renk ve 3 geçiş veri sözleşmesi, 21 proje/ses çıktısı, 5 paket ve 5 gerçek
video çıktısı testi. Sekiz MP4 senaryosunda 42 kare önizlemeyle karşılaştırıldı;
renkli kliplerin blur geçişi ve kadraj/genel efektlerle birleşmesi, tek
arka planın özel dört kanal eğrileri ve önceki geçişler denendi. GPU'nun
gerçekten kullanıldığı doğrulanarak CPU referansıyla aşırı gama/pozlama,
keskin ve 16 noktalı eğriler, alfa ve iki aktif klibin renkleri karşılaştırıldı.
Renk panosu/toplu uygulama, bypass, sürükleme/iptal, hassas klavye/sayı
girişi, tek geri alma, snapshot, yeniden açma ve paket taşıma geçti.
Karşılaştırmanın piksel sınırı, yalnızca seçili klibi etkilemesi ve proje
geçmişini değiştirmemesi doğrulandı. Üretim Waitress/CSP üzerinde yavaş ağla
önbelleksiz yenileme, iki temada 320–1440 px, dokunarak eğri/sınır düzenleme
ve gerçek ses/video oynarken renk değiştirme geçti. Ayrı ön yüz derlemesi
yoktur; fiziksel telefon, ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı.

Görsel geçiş diliminde 160 ilgili test geçti: 76 JavaScript, 52 arayüz,
3 geçiş veri sözleşmesi, 21 proje/ses çıktısı, 5 paket ve 3 gerçek video
çıktısı testi. Altı MP4 senaryosunda 30 kare önizlemeyle karşılaştırıldı:
eski erime geçişi, zoom/blur, ters silme, dikey itme ve dışa dairesel geçiş.
Yönlerin piksel davranışı, uç kareler, zamansal yumuşaklık, blur'da düz renk
ve kenar korunumu, gerçek örtüşme ve sonraki boşluk/geçiş sürekliliği denendi.
Sürükleme/iptal, klavye, tek geri alma, yeniden açma ve yeni ayarlarla medya
paketinin yeni önbelleğe taşınması geçti. Döngü tekrarları, kullanıcı atlaması,
durdurma/snapshot/proje değişikliği, proje sonu, kırpılmış 1,5× ana ses saati
ve söz dinleme döngüsüyle kontrol devri gerçek tarayıcıda doğrulandı.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme, iki temada
320–1440 px, dokunarak geçiş süresi ayarı ve tek geri alma geçti. Ayrı ön yüz
derlemesi yoktur; fiziksel telefon, ağ tüneli ve Safari/iOS doğrulanmadı.

BPM/ritim diliminde 144 ilgili test geçti: 68 JavaScript, 47 arayüz,
3 ritim veri sözleşmesi, 21 proje/ses çıktısı ve 5 paket testi. 20–300 BPM
vuruş örnekleri, örnekler arasına düşen ataklar, faz, sessizlik/gürültü reddi,
tap sapmaları, ilk vuruşun iki yönlü ızgarası ve yoğun görünüm sınırları
kontrol edildi. Gerçek ses dosyasından worker ile kesilmiş/hızlandırılmış
montajın temposu önerildi; açık uygulama, iptal ve yetersiz süre kontrolü geçti.
Klip sürükleme, gerçek video örtüşmesi, ek sesle fade/otomasyon taşıma, ortak
otomasyon BPM'si, geri alma ve yeniden açma doğrulandı. Üretim Waitress/CSP
üzerinde worker, yavaş ağla önbelleksiz yenileme, cetvel/şerit hizası,
iki temada 320–1440 px ve dokunarak ritme klip taşıma denendi. Yeni menü
klip şeritlerini sıkıştırmaz; ilk boyutu HTML'de ayrılır. Fiziksel telefon,
ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı.

Katmana özel EQ/zincir diliminde 145 ilgili test geçti: 62 JavaScript,
43 arayüz, 21 proje/ses çıktısı, 6 eğri/mikser, 8 efekt ve 5 paket testi.
Üç EQ bandının merkez kazancı ve frekans ekseni, katman bağımsızlığı, gecikme
tekrarları, bloklar arasında efekt sürekliliği ve geçersiz zincir/parametrelerin
reddi kontrol edildi. Gerçek Web Audio ile Python çıktısı 24 efekt sırasının
tamamında, dört ayrı bypass ve tüm bypass durumunda, aradan başlatmada ve
2 saniye delay'de karşılaştırıldı. Gerçek WAV ve özelleştirilmiş zincirli medya
paketinin başka dizinde açılması doğrulandı. Arayüzde sürükleme/iptal, hassas
klavye adımları, sıralama, bypass sırasında ayar koruma, tek geri alma, yeniden
açma ve yeni katman kontrolleri geçti. Üretim Waitress/CSP üzerinde yavaş ağla
önbelleksiz yenileme; iki temada 320–1440 px, dokunarak EQ düzenleme ve ek ses
katmanında oynatma sırasında sıra/bypass değiştirme, kaynağı yeniden başlatmadan
duyulur oynatma kontrol edildi. Fiziksel telefon, ağ tüneli ve Safari/iOS
bu dilimde doğrulanmadı.

Pan ve efekt otomasyonu diliminde 131 ilgili test geçti: 59 JavaScript,
41 arayüz, 21 proje/ses çıktısı, 6 eğri/mikser ve 4 efekt testi. Yeni parametrelerin
sınırları ve eski proje varsayılanları, bağımsız düzenleme, şerit seçimi, pano,
kaydetme, kayıt sırasında parametre değiştirme ve sonradan eklenen katmanda
duyulur efekt oynatması doğrulandı. Gerçek Web Audio ile Python filtre/reverb
örnekleri altı eğri türü, sabit tutma sıçraması, aradan başlatma, zamanlama
yenileme, 20 Hz ve açık filtre için karşılaştırıldı. Farklı işleme bloklarında
efekt sürekliliği, fade/pan/katman sınırları ve gerçek WAV çıktısı kontrol edildi.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme, iki temada
320–1440 px, dört şerit, dokunarak pan çizimi, hassas Hz adımları, tek geri alma
ve oynatma sırasında otomasyonun ilerlemesi geçti. Ayrı ön yüz derlemesi yoktur;
fiziksel telefon, ağ tüneli ve Safari/iOS bu dilimde doğrulanmadı. Ortamdaki
önceden var olan MoviePy/Pillow bağımlılık çakışması sürüyor; yeni SciPy kurulumu
başarılıdır.

Canlı kayıt diliminde 100 ilgili test geçti: 56 JavaScript, 38 arayüz ve
6 Python eğri/mikser testi. Dokunurken yaz/bırakınca sürdür, kayıt aralığı,
hassas klavye adımları, ayrı dokunuşlar, tek geri alma, iptal, zaman atlama,
sonradan eklenen katmanda dinleme/kayıt, aktif kaydı kaydetme ve katman silme
doğrulandı. Gerçek Web Audio çıktısında kayıt önizlemesi aralık sınırları,
fade, mute, solo ve katman bitişiyle karşılaştırıldı. Kaydedilen eğriler sunucu
doğrulamasından geçirilip Python dışa aktarma mikserinin ses örnekleriyle eşleşti.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme; 320–1440 px
genişlikler iki temada, yerel range kontrolünde dokunma simülasyonu, latch ve
geri alma kontrol edildi. Fiziksel telefon ve Safari/iOS doğrulanmadı.

Gelişmiş otomasyon diliminde 89 ilgili test geçti: 50 JavaScript, 34 arayüz
ve 5 Python eğri/mikser testi. Kutu/listeden seçim, birlikte taşıma ve
sınırlar, katmanlar arası nokta panosu, kalem sadeleştirmesi, kare/vuruş/
işaretçi hizalaması, bağımsız eksenler, iptal, tek geri alma ve yeniden açma
doğrulandı. Kalemle çizilip yapıştırılan eğri sunucu doğrulamasından geçirildi
ve dışa aktarma mikserinin gerçek ses örnekleriyle karşılaştırıldı.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme; iki temada
320–1440 px yerleşimleri, büyük pencerede klavye/listeden seçim ve dokunma
simülasyonunda kutu, grup sürükleme/iptal ve kalem çizimi kontrol edildi.
Bu dilimde yeni MP4 render testi çalıştırılmadı; video işleme değişmedi.

Eğri karakterleri diliminde Windows/Python 3.10/Chromium üzerinde 102 ilgili
test geçti: 45 JavaScript, 31 arayüz, 20 proje/ses, 4 eğri ve 2 gerçek video
çıktısı testi. Gerçek Web Audio ses/pan çıktısında altı karakter, fade ile
birleşimleri, aradan başlatma ve sabit tutma sıçraması karşılaştırıldı.
Python ses mikseri ile JavaScript eğri hesapları aynı örneklerde eşleşti;
doğrusal ve doğrusal olmayan video hareketleri MP4 kareleriyle karşılaştırıldı.
Aralık bağımsızlığı, hassas Bézier değerleri, sürükleme/iptal/klavye, eğriyi
koruyarak nokta ekleme, katman taşıma/bölme, geri alma ve yeniden açma doğrulandı.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme ve iki temada
320–1440 px düzenleri kontrol edildi; Bézier tutamaçları dokunma simülasyonunda
tek geri alma adımıyla düzenlendi.

Önceki geliştirme diliminde Windows/Python 3.10/Chromium üzerinde 108 ilgili test
geçti: 39 JavaScript, 29 arayüz, 20 proje/ses, 18 söz ve 2 gerçek video çıktısı
testi. Yeni çıktı testi hareketli konum/yakınlık/dönüş/opaklığı kırpma, aynalama,
efekt, klip geçişi, ön plan görseli ve sözlerle birlikte karşılaştırır.
Anahtar zamanlarında medya saatinin mikrosaniye yuvarlaması, çakışma reddi,
kare birimleri, tuvalden düzenleme, iptal, geri alma ve yeniden açma doğrulandı.
Üretim Waitress/CSP üzerinde yavaş ağla önbelleksiz yenileme, son video karesi
tutulurken hareketin sürmesi, şerit hizaları ve 320–1440 px genişlikler iki
temada kontrol edildi. Dokunma simülasyonunda elmas sürükleme doğrulandı;
mobil araç çubuğu sarıldığında şeritler için ayrılan alan korunur.
Önceki dilimde kırpma/konum/dönüşün birlikte uygulandığı çıktı testi,
11 medya, 5 proje paketi ve 7 gerçek çıktı
testi de geçmişti; uzun 1080p/60 FPS testi bu dilimde tekrar çalıştırılmadı.
Ses bölme ve daha erken konuma çoğaltma, kaynak fazı ve fade/otomasyon
sürekliliği açısından doğrulandı; tarayıcının gerçek OfflineAudioContext
çıktısı da sayısal eğriyle karşılaştırıldı. Video boşlukları dahil önizleme
ve MP4 kareleri karşılaştırıldı; 12 saniyelik 1080p/60 FPS çıktı çözümlendi.

Üretim Waitress sunucusunda CSP ile montaj worker'ı, yavaş ağ ve yer kaymasız
yenileme; hazırlanmış WAV'ın kaynakla örnek karşılaştırması, gerçek Web Audio
kanalında duyulur ses ve sessiz boşluk doğrulandı. Dosya içe alma, video
bölme, kaynak kırpma/oran, dönüş ve kılavuzlar; ses katmanı oynatma ve otomasyon denendi. 320–1440 px ekranlar iki temada
kontrol edildi. Bu projede ayrı bir ön yüz derlemesi bulunmuyor. Fiziksel telefon
ve Safari/iOS doğrulaması yapılmadı; dokunmatik sürükleme Chromium dokunma
simülasyonuyla doğrulandı.
# Vektör şekilleri

Take ve comp editöründe iki–sekiz alternatif ses şeridini işaretleyip
taslak açın. Alt satırlarda kaynak dalgaları görünür; dalgaya tıklamak kesim
imlecini taşır. Bölümü hassas saniyeyle kesin ve seçili bölüm için Kullan'a
basın. Aralıklar sıralı ve çakışmasızdır; boşluklar sessizliktir. Take'ler
ham kaynak, trim/faz/döngü ve proje konumuyla okunur. Take mute/seviye/
otomasyonu ve efektleri seçime işlenmez. Ortak efekt zinciri ilk take'den
çıkış kanalına alınır; o kanalda ayrıca düzenlenir.

Seçim sınırlarında eşit güçte crossfade uygulanır; kaynak payı olmadığında
süre daralır ve not gösterilir. Crossfade olmayan kenarlar 5 ms yumuşar.
Ham montaj uygulanmadan dinlenebilir. 32 bit float WAV, örtüşme tepesini
kırpmadan korur; yüksek tepe yalnızca ham dinleme seviyesini azaltır.
Uygulama kaynakları kısar ve yeni çıkışı bağlar. Tek geri alma eski karışımı
geri getirir. Kayıtlı comp tekrar açılıp üretilir; taşınmış çıktı konumu ve
çıkış ayarları korunur. Take'lere dön özgün mute/solo durumlarını geri
getirip comp çıkışını çıkarır. Referanslı kaynak/çıkışı silmeden önce comp'ı
çözün. Her take bir comp'a aittir; comp çıkışı başka comp'a take olamaz.
En fazla sekiz comp, comp başına 64 bölüm/120 sn ve iş başına 16 milyon
kaynak örneği kullanılabilir. Üç JS, iki Python (gerçek float WAV/son ses
karışımı/paket) ve üç üretim arayüzü testi geçti; 226 JS testi başarılı.

Ana şarkı panelindeki Mikrofonla seslendirme, tarayıcının mikrofon izninden
sonra 48 kHz PCM yakalar; sonuç 16 bit WAV'dır. Varsayılan veya listeden
aygıt, mono/stereo ve giriş kazancı seçilebilir. Mikrofon doğrudan hoparlöre
bağlanmaz. BPM'den geri sayım, metronom, ön çalma ve giriş dBFS göstergesi
vardır. Kulaklık kullanın; fiziksel hoparlör sesi mikrofona sızabilir.

Normal kayıt imleçten, aralık kaydı verilen proje saniyelerinden başlar.
120 saniye ve toplam 16 milyon PCM örneği sınırı vardır. Yakalama ve kesme
AudioWorklet'in örnek saatiyle yapılır. Kısa aygıt saat boşlukları sessizlikle
korunur ve kullanıcıya bildirilir; 100 ms üzeri kesinti kaydı durdurur.
Konum düzeltmesinde pozitif ms kaydı geçe taşır.

Kayıt önce yerel taslaktır: dinleme, WAV indirme, uygulama veya silme.
Uygulama boş hedefi doldurur ya da bağımsız ses katmanı ekler. Aralığa
yeniden kayıtta özgün dosya değişmez; eski şerit o aralıkta 5 ms geçişlerle
kısılır. Yeni katman hedefin seviye/efekt/otomasyonunu devralır. Tek geri
alma eski karışımı geri getirir. Proje değişen taslak WAV olarak indirilebilir.
Kaynaklar normal proje paketine dahildir. Mikrofon yetkisi yalnızca aynı
kaynağa açıldı; kamera ve konum kapalıdır. HTTPS/localhost ve AudioWorklet
gereklidir. [AudioWorklet örnek saati](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame).
Üç JS, beş güvenlik, bir Python paket/gerçek ses karışımı ve iki üretim
arayüzü testi geçti. Tarayıcı kayıt testleri sahte mikrofon aygıtıyla yapıldı;
fiziksel aygıt gecikmesi ve Safari bu ortamda doğrulanmadı.

WebVTT / ASS paneli ve mevcut İçe Al düğmesi .vtt/.ass dosyalarını önce
yerel taslakta açar. Metin, satır ve sözcük saatleri, desteklenen satır
konumu/hizalama/dikey çapa, font/boyut/renk/kalın/italik korunur. ASS ayrıca
kontur rengi ve kalınlığını korur. Satır stili alanlarını işaretleyerek genel
stilden bağımsız düzenleyin; sıfırlama genel stile döndürür. Fontlar canlı
önizleme ve gerçek çıktıda yüklenir.

WebVTT desteklenen ::cue CSS sınıflarını ve satırın tamamını kapsayan b/i
etiketlerini okur; piksel font boyutunun 720p karşılığı, dışa aktarılan
dosyanın NOTE COZY-RESOLUTION bilgisinde korunur. ASS PlayRes, stil ve
başlangıç override'ları; pos/an/fn/fs/c/1c/3c/bord/b/i ile kelime düzeyinde
k/K/kf/ko/kt zamanları desteklenir. ASS hassasiyeti 0,01 sn ve konumda
çıktı pikselidir. Çok sözcüklü tek zaman etiketi eşit paylaştırılır ve not
gösterilir; sözcüklerle eşleşmeyen hece zamanlarında satır zamanı korunur.

Örtüşen satırlar tek dil şeridinde reddedilir. Ruby/voice/dikey/region,
satır içi farklı stiller, ASS dönüşüm/çizim/hareket ve diğer CSS özellikleri
uygulanmaz; dönüştürme notlarında belirtilir. İndirmede kutu/neon/proje
hareketleri, ASS satır genişliği ve kelime zamanlı zorunlu satır sonu gibi
kayıplar ayrıca bildirilir. HTML, CSS veya ASS kodu çalıştırılmaz.
Biçim referansları: [WebVTT](https://www.w3.org/TR/2026/CRD-webvtt1-20260520/),
[ASS etiketleri](https://aegisub.org/docs/latest/ass_tags/).
Üç JS biçim testi, iki Python (gerçek MP4 dahil) ve üç üretim arayüzü testi
geçti; mevcut 220 JS testi de başarılı.

Altyazı dilleri ve çeviri paneli 16 bağımsız dil şeridi tutar. İlk yeni dil
eklenirken mevcut sözler “Özgün altyazı / und” adıyla saklanır. Etkin dil
normal söz editörüne ve MP4'e aktarılır; her düzenleme etkin şeride yansır.
Şerit adı ve tr/en/pt-BR gibi dil kodu düzenlenebilir. Karşılaştırma, kaynak
satırları proje saatine dönüştürüp zaman aralığı örtüşen çevirileri gösterir.
Çeviri taslağı elle doldurulur; tüm satırlar doldurulduğunda yeni şerit
oluşur. Satır zamanları korunur, eski dilin kelime zamanları çıkarılır.
Taslak uygulanana kadar yereldir; kaynak dil değişince iptal edilir.
Ripple tüm dilleri birlikte işler. İki JS, iki Python (etkin dil gerçek
MP4) ve üç üretim arayüzü testi geçti.

Başlık ve alt bant tasarımcısı bir sahne katmanında en fazla dört satır,
satır başına sekiz metin parçası kullanır. Font, boyut, renk, kalın/italik
her parçada bağımsızdır; metin tuval genişliğinde sarılır. Arka plan, opaklık,
boşluk/köşe, vurgu ve nota/daire/elmas ikonları düzenlenebilir. Giriş/çıkış
solma, sola/yukarı kayma, ölçek veya açılma olabilir; süre katman saatindedir.
Kaydedilen 16 bileşen projeyle taşınır; bileşeni güncellemek önceden eklenmiş
katmanları değiştirmez. Çok uzun/dar başlıklar 4096 piksel raster sınırına
uydurulur; aşırı taşma kırpılır. İki JS, iki Python (gerçek MP4 dahil) ve
üç üretim arayüzü testi geçti.

Ses tepkili parçacıklar paneli kıvılcım, kar ve ışık alanını bağımsız sahne
katmanı olarak ekler. Ses bandı yoğunluğu ve boyutu, tepki miktarı ise
sessizlikte kalan temel alanı belirler. Hız genişlik yüzdesi/saniye, boyut
720p pikselidir. Yön 0° sağ, 90° aşağıdır; yayılım, ömür, renk, alan oranı
ve tohum düzenlenebilir. Döngüler sabit tohum ve katman saatinden hesaplanır;
oynatma sırası veya seek geçmişi sonucu değiştirmez. En fazla katman başına
600, proje genelinde 4000 parçacık kullanılabilir. Kaynak kuru ses karışımı
analizi önizleme ve çıktıda ortaktır. İki JS, iki Python (gerçek MP4 dahil)
ve üç üretim arayüzü testi geçti.

Sahne katmanları → Şekil ve vektör çizgileri: dikdörtgen, elips, ok veya
serbest yol ekleyin. Kalem yeni yolu mevcut yolun yerine çizer; açık yollarda
dolgu kullanılmaz. En fazla 64 nokta, göreli giriş/çıkış Bézier tutamaçları,
şekli koruyan parça bölme, kapatma, nokta silme ve klavyeyle hassas taşıma
desteklenir. Tuval sınırından taşan eğri parçaları kırpılır.

Kontur ve kesik boyutları 720p pikselidir; çıktı boyutuna ölçeklenir. Çizim
başlangıcı katman başlangıcına göredir. Süre sıfırsa şekil tam görünür;
diğer sürelerde kontur yay uzunluğuna göre çizilir, dolgu sonunda görünür.
Şekiller normal katman hareketi, karışım, maske ve perspektifi kullanır;
medya yüklemesi gerektirmez. Sürükleme tek geri almadır; Escape iptal eder.

Doğrulama: üç geometri/sözleşme testi, iki Python testi (paket ve gerçek
MP4), üç üretim arayüzü testi (CSP, yavaş ağ, yeniden açma, 320–1440 px ve
iki tema) geçti. Fiziksel telefon, dış tünel ve Safari bu ortamda doğrulanmadı.



### Ses grupları ve dinamik işlemciler (45–46)

Ana şarkı panelindeki Ses grupları ve send/return bölümü sekiz ortak grup ve dört paylaşılan reverb/delay dönüşü sağlar. Katman ve grup gönderimleri kendi seviye/pan kontrolleri sonrasındadır; dönüşler yalnızca ıslak sinyaldir. Grup mute üye gönderimlerini de kapatır; solo grup üyelerini açar. Dönüş kuyruğunu kesmek için dönüş kanalını kısın. Grup otomasyonu proje saatini kullanır.

Her katmanın efekt zinciri içinde ve grup kartında Gate · kompresör · limiter bulunur. Sabit sıra efektler → gate → kompresör → limiter → seviye/pan şeklindedir. Kompresör stereo bağlantılı tepe dedektörü, yumuşak diz, attack/release, makeup ve paralel karışım kullanır. Gate histerezis ve tutma ile sınır çevresindeki hızlı açılıp kapanmayı azaltır. Limiter sıfır attack ile örnek tepelerini sınırlar; true-peak limiter değildir. İşlemci azaltım göstergeleri 20 Hz güncellenir. Ses Worklet desteklemeyen tarayıcıda etkin dinamik işlemci için görünür hata verilir.


### Harici sidechain (47)

Dinamik işlemci bölümündeki Harici sidechain, bir katman veya grup çıkışını hedef kanalın dedektörüne gönderir. Sinyal kaynak seviye/pan kontrollerinden sonra alınır; mute/solo ve otomasyon da dedektörü etkiler. Hedef kanalı kendi kaynak grubuna geri göndermek dahil ses döngüleri hem tarayıcıda hem sunucuda reddedilir. Referans verilen katman silinmeden önce kaynak seçimi kaldırılmalıdır; grup silme ilgili sidechain bağlantılarını tek işlemle kaldırır ve kilitlere uyar.

Dedektör alt/üst kesim filtreleri, eşik ve kısma derinliği bağımsızdır. Compress eşik üstünü orana göre kısar, Duck sabit derinliğe iner, Pump giriş darbesinden sonra tutma süresince kısar. Attack/release tüm karakterlerde geçerlidir. Filtreli kaynağı dinle hedef kanalın sesini dedektör sesiyle değiştirir. İşlem gate/kompresör/limiter öncesindedir. Arama yapıldığında efekt/dedektör geçmişi temizlenir.


### Spektral ses temizleme (48)

Ana şarkı panelindeki Spektral ses temizleme bölümünde işlenecek katmanı seçin. Çalışma başı/sonu kaynak saniyesidir; bir ayarda en fazla 120 saniyelik alan ve 32 azaltma bölgesi saklanır. Spektrogramı analiz edin, fare/dokunma ile zaman ve frekans aralığı seçin; sayısal alanlar ve ok tuşları hassas düzeltme sağlar. Seçimi azaltma bölgesi yapmak kısma miktarı ve yumuşak kenarları açar. Üst üste gelen bölgelerin kazançları çarpılır.

Seçimden gürültü profili al, mümkünse yalnızca istenmeyen sesin bulunduğu aralığı örnekler. Profilin azaltma gücü ve en düşük kazancı ayarlanabilir; seçilen çalışma alanının tamamına uygulanır. Özgün, işlenen ve çıkarılan sinyal ayrı dinlenir. Bu taslak dinlemesi kaynak sesidir; kanal/mix efektleri uygulanmaz. Ayarları uygula tek geri alma oluşturur. Kaynak File/AudioBuffer korunur; ana şarkıdaki kesimler, montaj, tempo ve kanal efektleri temizlenen kaynak üzerinde normal çalışır. Paketler özgün dosya ve düzenlenebilir ayarları içerir. İşleyici başarısız olduğunda hata görünür ve eski/ham sesi yanlışlıkla çalmak engellenir; bypass veya geri alma ile devam edilebilir.

Temizlik 2048 örnek Hann penceresi ve 512 örnek adımı ile stereo bağlantılı STFT kullanır. Bu çözünürlükten daha dar zaman/frekans müdahaleleri pencerenin çevresine yayılır. Ana/yardımcı kaynaklar 44.1 kHz analiz saatine alınır. Yeni mikrofon kaydı eski kaynağın temizlik bölgelerini devralmaz; comp çıktısı kaynaklardan işlenmiş temizliği ikinci kez uygulamaz.


### Perde korumalı esnetme ve warp (49)

Ana şarkı panelinde bir kaynak katman seçip kesitinden warp taslağı açın. Kaynak alanları özgün dosyanın saniyeleridir; hedef işaret alanları proje saniyesidir. Üst dalga satırına tıklamak eşlemeyi koruyarak işaret ekler; alt işareti sürüklemek hedef zamanını değiştirir. Oklar hedefi 1 ms, Shift 10 ms taşır; Alt ile kaynak zamanı taşınır. İlk kaynak/hedef ve son kaynak işareti kesit uçlarıdır. İşaretler kaynakta ve hedefte en az 50 ms aralıklı, her aralığın hızı 0.25–4× olmalıdır. Giriş ve çıkış en fazla 120 saniyedir; çıkış mevcut proje süresine sığmalıdır.

Hız ve perde değişimi bağımsızdır. Perdeyi koru, ±12 yarım ses değişimi, formant koruma ve crisp/mixed/smooth geçici ses karakteri mevcut Pedalboard işlemcisini kullanır. İşaret birleşimlerinde kaynak payı ve ayarlanabilir geçiş kullanılır. Önce taslağı dinleyin; uygulama normal WAV kaynaklı yeni katman oluşturur, kanal efektlerini kopyalar ve istenirse özgün katmanı kısar. Spektral temizlik dosyaya işlenir ve çıkışa ikinci kez eklenmez. Ana şarkının genel ton/tempo bus ayarları yeni katmana eklenmez.

Kayıtlı warp yeniden açılıp üretilebilir; kaynak dosya ve eski çıktılar geri alma için korunur. Kaynağa dön çıkışı kaldırıp kaynağın önceki mute/solo durumunu geri getirir. Bağımlı comp/warp varsa önce o düzenleme kaldırılmalıdır. Kayıtlı warp içinde kullanılan dosyayı değiştirmek için önce warp kaldırılmalı; aynı dosya yeniden bağlanabilir. Paket özgün kaynak, üretilmiş float WAV ve düzenlenebilir eşlemeyi içerir. Yerel işlem meşgulse taslak korunur ve hata gösterilir.


### LUFS ölçümü ve hedefleme (50)

Çıktı panelindeki LUFS ölçümü ve hedefleme bölümünde canlı anlık (400 ms), kısa süreli (3 sn), dinlenen toplam ve true-peak gösterilir. Arama ölçeri sıfırlar; dinleme ses seviyesi ölçüme katılmaz. Tam mix analizi, kanal/grup efektleri, otomasyon ve ana tepe sınırlamasından sonraki bütün proje sesini ölçer. R128 toplam ölçümü mutlak ve göreli kapılar kullanır; FFmpeg loudnorm işlemcisinin dinamik geçiş istatistikleri ayrıca normalizasyon için saklanır. [EBU ölçüm tanımları](https://tech.ebu.ch/loudness/) ve [FFmpeg normalizasyon seçenekleri](https://ffmpeg.org/ffmpeg-filters.html#loudnorm).

−14, −16 ve −23 LUFS hazır ayarları veya özel toplam, dBTP ve LRA hedefleri seçilebilir. Hedefe göre dinleme, tam mix'i ölçüp tepe/LRA uygunsa doğrusal kazanç, gerektiğinde iki geçişli dinamik normalizasyon uygular; gerçek sonuç yeniden ölçülür. Dinleme aralığı proje saatinde en fazla 120 saniyedir. Kaynak dosyalar korunur. Hedefleri çıktıya uygula tek geri alma ile kaydeder; normal transport mix'i çalar, normalizasyon taslağı ayrı ses oynatıcısındadır. Ses veya hedef değişirse eski taslak temizlenir. Analiz iptali sunucu işlemini de durdurur.

Canlı ve dosya true-peak ölçümleri dört fazlı, 32 katsayılı Kaiser-sinc interpolasyonu ve dosya uçlarında sıfır uzatma kullanır. Toplam canlı kapı histogramının çözünürlüğü 0.01 LU'dur. Ölçer sertifikalı yayın ölçüm cihazı değildir. Hedefler PCM ses aşamasındadır; AAC kodlaması tepe değerini değiştirebilir. Mono ve desteklenen çok kanallı kaynakların stereo dönüşümü tarayıcının hoparlör kurallarıyla eşlendi; mono kaynak çıktıda artık 3 dB düşük kalmaz.


### İç içe ve yeniden kullanılan sekanslar (29)

Ana şarkı panelindeki İç içe sekanslar bölümünde ana montaj kesiti, yardımcı ses, video ve sahne/metin klipleri işaretlenerek sekans oluşturulur. Zaman çizgisi/sahne seçimini işaretle mevcut seçimleri alır. Ana çizgide üyeler yerine tek sekans klibi görünür. Çift tıklama veya Enter içeride düzenlemeyi açar; oklar bir kare, Shift ve oklar on kare taşır. Fare/dokunma taşıması tek geri almadır; Shift ince hareket, Escape iptal sağlar. Başka bir sekansı üye seçmek dört düzeye kadar iç içe düzenleme oluşturur.

İçeride yerel imleç ve klip satırları 0'dan başlar; önizleme bütün proje sahnesini gösterir. Üye seçimiyle yerel konum, ses seviyesi, metin/opaklık/XY ve kaynak kesimleri düzenlenir. Ayrıntılı editör düğmesi mevcut klip araçlarını açar. Üyeyi üst çizgiye çıkar, işaretlileri açık sekansa ekle ve sekansı çöz kaynakları değiştirmez. Bağlı ses/video çifti ve mevcut sahne grubu aynı kapsayıcı içinde tutulmalıdır. Sekans/üye kilitleri içeriği de korur. Ana kaynak ve ortak video/mix efektleri proje genelindedir; sekans klipleri mevcut proje saatinin içinde kalır. Ana montajın son kesiti silinince kapsayıcının boş kuyruğu proje sonuna kısalır; kalan içerik taşarsa işlem reddedilir.

Aynı sekansı burada kullan seçilen proje konumunda aynı tanımın yeni kullanımını oluşturur. Metin, sayısal klip ayarları, kaynak kesimleri, ses otomasyonu ve sahne katman sırası bütün bağlı kullanımlara yerel saatleri korunarak yansır; kullanımların konumu, adı ve kilidi bağımsızdır. İç sidechain kaynakları yeni kullanımın kendi kanallarına bağlanır. Kilitli bir kullanım varsa ortak içeriği değiştiren işlem uygulanmaz. Klip ekleme/silme, bölme veya grup yapısını değiştirmek için önce kullanımı bağımsızlaştırın; iç içe bağlı kullanımda önce üst kapsayıcı bağımsızlaştırılır.

Kaynak File/AudioBuffer korunur. Her kullanım mevcut ses/klip/katman/sekans sınırlarından pay alır; paket yeni ses kanalı için aynı dosyayı ayrı medya üyesi olarak saklar. Ses dalgası yüklenemezse işlem kendi proje/geçmiş değişikliğini geri alır; arada başka bir düzenleme yapılmışsa o düzenleme korunur ve eksik kaynak hatası gösterilir. Sekansın kullandığı sesi veya ana proje saatini değiştirmeden önce sekans çözülmelidir; aynı dosya yeniden bağlanabilir. Proje/paket, dinleme ve gerçek çıktı aynı klip verisini kullanır.

## Ortak kontrol kullanımı

Sayısal alanları fareyle yatay veya yukarı sürükleyerek değiştirebilirsiniz. Shift ince, Alt on kat büyük adım verir; Escape sürüklemeyi iptal eder. Kare ve tamsayı alanları kendi adımlarını korur. Süre alanlarının saniye görünümünde Shift ile 1 ms adımı kullanılabilir. Dokunmatik ekranda sayı yazma/spinner ve panel kaydırması kullanılır. Salt okunur uç noktalar sürüklenemez.

Kaynak dalga biçiminde normal tekerlek paneli kaydırır; Ctrl/⌘ + tekerlek kaynak yakınlığını değiştirir. Bu yakınlık proje zaman çizgisinin Zoom kontrolünden ayrıdır. Yapışma proje işaretlerini ilgili kaynağın zamanına dönüştürür.

Görüntüde Kaynak giriş/çıkış/hız ve Hassas değer girişi içindeki kaynak parametreleri seçili video klibini düzenler. Proje oynatma ve bütün kliplerin kadrajı başlıklı alanlar ortak ayarlardır. Kaynak yüklenmeden kaynak zamanları, Şarkı hızına bağla açıkken bağımsız kaynak hızı kapalıdır. Bas kazancı gerçek 0–15 dB gösterilir; kanal seviyesinde yüzde/dB seçimi bağımsızdır.

Hassas panelde artır/azalt düğmeleri geçerli aralığın ucunda kapanır; boş veya geçersiz giriş son kayıtlı değere döner. Seçili kaynağın bilgisi beklenirken kaynak sayısı ve düğmeler kapalı kalır. İşaretçi silindikten sonra klavye odağı sıradaki işaretçiye, sonuncuda İşaretçi ekle düğmesine geçer.

Kare görünümü tam kareleri gösterir; birim değiştirmek özgün saniye hassasiyetini değiştirmez. Söz satırlarında kareye oturan zaman proje içinde korunur; LRC/SRT dosyasının zaman hassasiyeti dışa aktarırken uygulanır.

Kare değeri, geçerli aralıktaki en yakın tam karedir; özgün süre farklıysa alanın açıklaması yaklaşık gösterimi belirtir. Aralıkta tam kare yoksa “sn kullanın” görünür ve saniye birimine geçerek düzenleyebilirsiniz. Hassas değer paneli kesirli kare girişini de destekler.

dB alanında boş değer sessizliktir. Boş alandan sürükleme −120 dB'den başlar; normal seviyeye geçmek için istediğiniz dB değerini yazabilir veya yüzde kontrolünü kullanabilirsiniz. Bu başlangıç bir alt sınır değildir; daha düşük sonlu değerler de yazılabilir. Escape sürüklemeyi önceki seviyeye döndürür.

İşaretçiler zaman çizgisinde odaklanabilir. Sol/sağ ok bir kare, Shift ile onda bir kare, Alt ile on kare taşır; Enter ad/zaman editörünü açar, Delete siler. Editörde ad, proje zamanı, git ve sil alanları bulunur. Sürüklemede Escape iptal eder. Ana şarkıdaki Araç seçicisi miks, kayıt, comp, ses işleme, warp, gruplar ve sekans bölümüne gider.
