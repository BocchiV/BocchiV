# 🕹️ Neon Pinball

Telefon için geliştirilmiş, tam özellikli, neon temalı profesyonel pinball oyunu.
Saf HTML5 Canvas + WebAudio ile yazıldı — sıfır bağımlılık. Android APK olarak kurulabilir.

<p align="center">
  <img src="docs/menu.png" width="280" alt="Ana menü">
  <img src="docs/oyun.png" width="280" alt="Oyun içi">
</p>

## ✨ Özellikler

- **Gerçekçi fizik**: 240 Hz alt adımlı fizik motoru, dönen flipper çarpışmaları, top-top çarpışması (multiball)
- **Masa öğeleri**: 3 pop bumper, 2 slingshot, 3'lü drop target bankı, rollover şeritleri, spinner, saucer (kilit çukuru), tek yön kapılı fırlatma kanalı
- **Oyun mekanikleri**:
  - Skor çarpanı (drop target bankını tamamla → x8'e kadar)
  - 3 kilit → **MULTIBALL** (2x skor)
  - Top koruması (her serviste 12 sn)
  - Ekstra top (200K / 500K / 1M puanda)
  - Şarjlı plunger ile fırlatma
- **Görsel & ses**: Neon parlama efektleri, parçacıklar, top izi, ekran sarsıntısı, WebAudio ile sentezlenen ses efektleri, titreşim (haptik) desteği
- **Mobil öncelikli**: Çoklu dokunuş (iki flipper aynı anda), portre tam ekran, her çözünürlüğe uyum
- **Kayıt**: En yüksek skor cihazda saklanır

## 🎮 Kontroller

| Eylem | Dokunmatik | Klavye |
|---|---|---|
| Sol flipper | Ekranın sol yarısı | `←` veya `Z` |
| Sağ flipper | Ekranın sağ yarısı | `→` veya `M` |
| Fırlatma | Sağ alttaki topa basılı tut & bırak | `Boşluk` (basılı tut) |
| Duraklat | ⏸ düğmesi | `P` |

## 📦 APK Kurulumu

APK her push'ta GitHub Actions tarafından otomatik derlenir ve imzalanır.

1. **Actions** sekmesi → son "APK Derle" çalıştırması → **NeonPinball-APK** artifact'ını indir
2. Zip'ten çıkan `NeonPinball.apk` dosyasını telefona aktar
3. Telefonda dosyaya dokun → "Bilinmeyen kaynaklardan kuruluma izin ver" → Kur

Kalıcı sürüm yayınlamak için bir sürüm etiketi gönder; APK otomatik olarak **Releases** sayfasına eklenir:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

> Not: Gereken minimum Android sürümü 8.0 (API 26).

## 🛠️ Geliştirme

```bash
# Tarayıcıda oyna (masaüstünde klavye ile test edilebilir)
cd web && python3 -m http.server 8080
# http://localhost:8080

# APK'yı yerelde derle (Android SDK gerektirir)
gradle -p android assembleRelease
# Çıktı: android/app/build/outputs/apk/release/app-release.apk
```

### Proje yapısı

```
web/            Oyunun tamamı (index.html, style.css, game.js)
android/        WebView tabanlı Android sarmalayıcı (oyunu asset olarak paketler)
.github/        APK derleyen CI işlem hattı
docs/           Ekran görüntüleri
```

Oyun dosyaları `android/app/build.gradle` içindeki `assets.srcDirs` ayarıyla doğrudan `web/`
klasöründen paketlenir — kod tekrarı yoktur; web sürümü ile APK her zaman aynıdır.
