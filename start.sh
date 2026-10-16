#!/usr/bin/env bash
# ==============================================================================
# Cozy-Fi Studio Başlatma Scripti
# ==============================================================================

# Scriptin bulunduğu dizine geç
cd "$(dirname "$0")"

# ------------------------------------------------------------------------------
# API ve Ortam Değişkenleri
# ------------------------------------------------------------------------------
# GIPHY_API_KEY ortam değişkenini dışarıdan ayarlayın.

# Sunucu portu (Varsayılan: 5000)
: "${COZY_PORT:=5000}"
export COZY_PORT
# İsteğe bağlı diğer ayarlar (ihtiyaç halinde başlarındaki # işaretini kaldırın):
# export COZY_DATA_DIR=""
# export FFMPEG_BINARY=""
# export FFPROBE_BINARY=""

# ------------------------------------------------------------------------------
# Python Sanal Ortamını (venv) Aktif Et
# ------------------------------------------------------------------------------
if [ -f ".venv/Scripts/activate" ]; then
    # Windows (Git Bash / MSYS)
    source .venv/Scripts/activate
elif [ -f ".venv/bin/activate" ]; then
    # Linux / macOS / WSL
    source .venv/bin/activate
else
    echo "⚠️ Uyarı: '.venv' sanal ortamı bulunamadı. Sistem Python'ı deneniyor..."
fi

# ------------------------------------------------------------------------------
# Sunucuyu Başlat
# ------------------------------------------------------------------------------
echo "=================================================="
echo "🎵 Cozy-Fi Studio Başlatılıyor..."
echo "🌐 Adres: http://127.0.0.1:${COZY_PORT}"
if [ "$GIPHY_API_KEY" = "BURAYA_GIPHY_API_KEY_YAZIN" ] || [ -z "$GIPHY_API_KEY" ]; then
    echo "ℹ️  GIPHY_API_KEY ayarlanmadı (varsayılan demo modu veya GIF arama kapalı)."
else
    echo "🔑 GIPHY_API_KEY tanımlandı."
fi
echo "=================================================="

# Waitress üretim sunucusu ile başlat
python serve.py
