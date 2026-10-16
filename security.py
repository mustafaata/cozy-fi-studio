"""Request boundaries for a local, single-user application.

Remote use is via SSH forwarding, not an unauthenticated reverse proxy.
Loopback peers, exact hosts and same-origin requests are checked independently.
"""
import ipaddress
import logging
from urllib.parse import urlsplit

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)


def public_error(error):
    """Keep dependency errors (often containing URLs or local paths) private."""
    # Dependency exception messages and tracebacks can contain credentials and URLs.
    logger.warning("Operation failed (%s)", type(error).__name__)
    msg = str(error).strip()
    if isinstance(error, (ValueError, FileNotFoundError)) and msg:
        if not any(token in msg for token in ("://", "\\", "/", "Traceback", "Errno ", "object at 0x")):
            return msg
    return "İşlem tamamlanamadı. Kaynağı ve ayarları kontrol edip yeniden deneyin."


def install_security(app):
    app.config["TRUSTED_HOSTS"] = ["localhost", "127.0.0.1", "[::1]"]

    @app.before_request
    def local_request_only():
        try:
            local = ipaddress.ip_address(request.remote_addr or "").is_loopback
        except ValueError:
            local = False
        if not local:
            return jsonify(message="Yalnızca yerel bağlantılara izin verilir."), 403
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            return jsonify(message="Siteler arası istek reddedildi."), 403
        origin = request.headers.get("Origin")
        if origin and origin != request.host_url.rstrip("/"):
            return jsonify(message="İstek kaynağı doğrulanamadı."), 403
        referer = request.headers.get("Referer")
        if referer:
            parsed = urlsplit(referer)
            if f"{parsed.scheme}://{parsed.netloc}" != request.host_url.rstrip("/"):
                return jsonify(message="İstek kaynağı doğrulanamadı."), 403

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https:; media-src 'self' blob:; "
            "connect-src 'self' blob:; worker-src 'self' blob:; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        if request.path.startswith(("/api/", "/status/", "/download/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(Exception)
    def unhandled(error):
        if isinstance(error, HTTPException):
            return jsonify(message=error.name), error.code
        return jsonify(message=public_error(error)), 500
